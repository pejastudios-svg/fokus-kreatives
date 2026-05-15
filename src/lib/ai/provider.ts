import Groq from 'groq-sdk'
import { GoogleGenAI } from '@google/genai'

import { logAIUsage } from './usage'

export type ScriptProvider = 'groq' | 'gemini'

/**
 * Quality tier for a generation. Maps to a different Gemini model so we don't
 * pay Pro prices on cheap utility calls (carousels, reels, question forms).
 *
 *   high     → longform scripts (the main quality-sensitive output)
 *   standard → repurposed shortform (carousel/reel/story) and ad-hoc scripts
 *   cheap    → utility (question-form generation, anything mechanical)
 *
 * Pricing reference (Gemini 2.5):
 *   pro:        $1.25 / $10.00 per 1M tokens (input / output) - 4x flash
 *   flash:      $0.30 / $2.50 per 1M tokens
 *   flash-lite: $0.10 / $0.40 per 1M tokens
 */
export type Quality = 'high' | 'standard' | 'cheap'

export interface GenerateScriptInput {
  system: string
  user: string
  temperature: number
  maxTokens: number
  /** Request JSON object output (used by question-form generator). */
  jsonObject?: boolean
  /**
   * Quality tier. Default 'standard'. Set 'high' for longform (uses Pro),
   * 'cheap' for utility calls (uses Flash-Lite).
   */
  quality?: Quality
  /**
   * Optional Gemini cached-context name (from contextCache.getOrCreateContextCache).
   * When set, the system prompt is served from the cache instead of being
   * sent inline. Ignored on the Groq path. Falls back gracefully if Gemini
   * rejects the cache reference.
   */
  cachedContextName?: string
  /** Logical route name for ai_usage_log. e.g. 'planner.script.generate'. */
  route?: string
  /** For ai_usage_log. Optional. */
  clientId?: string
  /** For ai_usage_log. Optional. */
  userId?: string
  /** Free-form metadata stored alongside the usage row. */
  usageMeta?: Record<string, unknown>
}

export interface GenerateScriptResult {
  content: string
  provider: ScriptProvider
  model: string
}

interface UsageStats {
  inputTokens?: number | null
  outputTokens?: number | null
  cachedTokens?: number | null
}

function resolveProvider(): ScriptProvider {
  const raw = (process.env.SCRIPT_PROVIDER || '').toLowerCase().trim()
  if (raw === 'groq') return 'groq'
  return 'gemini'
}

export function resolveGeminiModel(quality: Quality): string {
  if (quality === 'high') {
    // Longform - quality matters. Pro by default, but allow override and a
    // safe fall-back to whatever GEMINI_MODEL_MAIN is set to (so a user who
    // only configured one model still works).
    return (
      process.env.GEMINI_MODEL_HIGH ||
      process.env.GEMINI_MODEL_MAIN ||
      'gemini-2.5-pro'
    )
  }
  if (quality === 'cheap') {
    return (
      process.env.GEMINI_MODEL_CHEAP ||
      process.env.GEMINI_MODEL_FALLBACK ||
      'gemini-2.5-flash-lite'
    )
  }
  // standard
  return process.env.GEMINI_MODEL_STANDARD || 'gemini-2.5-flash'
}

function resolveModel(provider: ScriptProvider, quality: Quality): string {
  if (provider === 'gemini') return resolveGeminiModel(quality)
  return process.env.GROQ_MODEL_MAIN || 'llama-3.3-70b-versatile'
}

async function generateWithGroq(
  input: GenerateScriptInput,
  model: string,
): Promise<{ content: string; usage: UsageStats }> {
  if (!process.env.GROQ_API_KEY) throw new Error('Missing GROQ_API_KEY')
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })
  const completion = await groq.chat.completions.create({
    model,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
    ...(input.jsonObject ? { response_format: { type: 'json_object' } } : {}),
    messages: [
      { role: 'system', content: input.system },
      { role: 'user', content: input.user },
    ],
  })
  const content = completion.choices[0]?.message?.content || ''
  const u = completion.usage
  return {
    content,
    usage: {
      inputTokens: u?.prompt_tokens ?? null,
      outputTokens: u?.completion_tokens ?? null,
      cachedTokens: null,
    },
  }
}

function isGeminiDailyQuotaError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  // Daily per-model quota from the free tier - string match on the canonical quotaId Google returns.
  // Distinct from a per-minute 429 (which recovers in seconds and is worth retrying).
  return /GenerateRequestsPerDayPerProjectPerModel|generate_content_free_tier_requests/i.test(msg)
}

/**
 * Gemini's error body sometimes includes a RetryInfo hint like `retryDelay: "58s"` or `"1.5s"`.
 * When present and short (≤ 90s), this means the quota is expected to replenish soon - Google
 * occasionally tags per-minute-window exhaustion with the PerDay quotaId, so the retryDelay is
 * the more reliable signal than the quotaId label.
 */
function extractGeminiRetryDelayMs(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err)
  const m = msg.match(/retryDelay["'\s:]+["']?(\d+(?:\.\d+)?)s/i)
  if (!m) return null
  const seconds = parseFloat(m[1])
  if (!isFinite(seconds) || seconds <= 0) return null
  if (seconds > 90) return null
  return Math.ceil(seconds * 1000)
}

function isTransientGeminiError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  // If Gemini itself tells us to retry in under 90s, honor that even when the quotaId says "daily".
  if (extractGeminiRetryDelayMs(err) !== null) return true
  if (isGeminiDailyQuotaError(err)) return false
  return /(503|UNAVAILABLE|overloaded|high demand|429|RESOURCE_EXHAUSTED|ECONNRESET|ETIMEDOUT)/i.test(msg)
}

/**
 * Gemini 2.5 models include "thinking" tokens that count against
 * maxOutputTokens. Pro defaults to using a generous chunk of the budget on
 * reasoning, which truncates creative-writing outputs mid-script. Cap it.
 *
 * Pro:        cap thinking at 1024 (still gets some structured planning).
 * Flash:      disable thinking (creative writing doesn't benefit much).
 * Flash-Lite: disable thinking.
 *
 * Reference: https://ai.google.dev/gemini-api/docs/thinking
 */
function thinkingConfigFor(model: string): { thinkingBudget: number } | undefined {
  const m = model.toLowerCase()
  if (m.includes('flash-lite')) return { thinkingBudget: 0 }
  if (m.includes('flash')) return { thinkingBudget: 0 }
  if (m.includes('pro')) return { thinkingBudget: 1024 }
  return undefined
}

async function callGeminiOnce(
  ai: GoogleGenAI,
  model: string,
  input: GenerateScriptInput,
): Promise<{ content: string; usage: UsageStats }> {
  // Total wait across all retries ≈ 77s. Gemini transient 503s generally recover within a minute.
  const delays = [2000, 5000, 10000, 20000, 40000]
  let lastErr: unknown
  let dailyHintedAttempts = 0
  const thinkingConfig = thinkingConfigFor(model)
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      // When a cached context name is supplied, swap systemInstruction for
      // cachedContent so the cache is honored at the API level.
      const useCache = !!input.cachedContextName
      const res = await ai.models.generateContent({
        model,
        contents: input.user,
        config: {
          ...(useCache
            ? { cachedContent: input.cachedContextName }
            : { systemInstruction: input.system }),
          temperature: input.temperature,
          maxOutputTokens: input.maxTokens,
          ...(thinkingConfig ? { thinkingConfig } : {}),
          ...(input.jsonObject ? { responseMimeType: 'application/json' } : {}),
        },
      })
      const meta = (res as { usageMetadata?: {
        promptTokenCount?: number
        candidatesTokenCount?: number
        cachedContentTokenCount?: number
        thoughtsTokenCount?: number
      } }).usageMetadata
      // Diagnostic: log finish reason + token usage so we can tell when
      // a truncated output is the model stopping early (FINISH_REASON_STOP),
      // hitting the budget (MAX_TOKENS), or being filtered (SAFETY).
      const candidates = (res as {
        candidates?: Array<{ finishReason?: string }>
      }).candidates
      const finishReason = candidates?.[0]?.finishReason ?? 'unknown'
      const outputLen = (res.text || '').length
      console.log(
        `[gemini] model=${model} finish=${finishReason} prompt=${meta?.promptTokenCount ?? '?'} candidates=${meta?.candidatesTokenCount ?? '?'} thoughts=${meta?.thoughtsTokenCount ?? '?'} cached=${meta?.cachedContentTokenCount ?? '?'} text_len=${outputLen}`,
      )
      return {
        content: res.text || '',
        usage: {
          inputTokens: meta?.promptTokenCount ?? null,
          outputTokens: meta?.candidatesTokenCount ?? null,
          cachedTokens: meta?.cachedContentTokenCount ?? null,
        },
      }
    } catch (err) {
      lastErr = err
      if (!isTransientGeminiError(err) || attempt === delays.length) throw err
      const hinted = extractGeminiRetryDelayMs(err)
      // Daily-labeled 429 with a short retryDelay: retry AT MOST once. Two in a row means the
      // quota is genuinely exhausted and we should bail fast so the caller can fall back or surface
      // the error, rather than hanging for minutes behind a frontend request.
      if (hinted !== null && isGeminiDailyQuotaError(err)) {
        if (dailyHintedAttempts >= 1) throw err
        dailyHintedAttempts++
      }
      const base = hinted ?? delays[attempt]
      const jitter = Math.floor(Math.random() * 500)
      await new Promise((r) => setTimeout(r, base + jitter))
    }
  }
  throw lastErr
}

async function generateWithGemini(
  input: GenerateScriptInput,
  model: string,
): Promise<{ content: string; usage: UsageStats }> {
  if (!process.env.GEMINI_API_KEY) throw new Error('Missing GEMINI_API_KEY')
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

  try {
    return await callGeminiOnce(ai, model, input)
  } catch (err) {
    // On a DAILY quota exhaustion only, swap to the lite model (same API key, much larger
    // free-tier daily cap - ~1000/day for flash-lite vs 20/day for flash). Per-minute 429s
    // are handled by the retry loop above, not here.
    const fallbackModel = process.env.GEMINI_MODEL_FALLBACK || 'gemini-2.5-flash-lite'
    if (model === fallbackModel || !isGeminiDailyQuotaError(err)) throw err
    console.warn(`[provider] gemini model ${model} hit daily quota; switching to ${fallbackModel} for this request.`)
    return await callGeminiOnce(ai, fallbackModel, input)
  }
}

function isTransientProviderError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /(503|UNAVAILABLE|overloaded|high demand|429|RESOURCE_EXHAUSTED|ECONNRESET|ETIMEDOUT)/i.test(msg)
}

export async function generateScript(
  input: GenerateScriptInput,
): Promise<GenerateScriptResult> {
  const quality: Quality = input.quality || 'standard'
  const primary = resolveProvider()
  const primaryModel = resolveModel(primary, quality)

  const startedAt = Date.now()
  let usedProvider: ScriptProvider = primary
  let usedModel: string = primaryModel
  let usage: UsageStats = {}
  let success = false
  let errorCode: string | null = null

  try {
    const result =
      primary === 'gemini'
        ? await generateWithGemini(input, primaryModel)
        : await generateWithGroq(input, primaryModel)
    usage = result.usage
    success = true
    return { content: result.content, provider: primary, model: primaryModel }
  } catch (err) {
    // Only fall back from Groq → Gemini. The reverse (Gemini → Groq) is unsafe:
    // Groq's free tier caps TPM at 8k, and the longform prompt + 8k output budget
    // routinely exceeds that, so a Gemini outage falling back to Groq would swap
    // one error for another. Stick with Gemini and let its extended retries handle it.
    if (primary !== 'groq' || !isTransientProviderError(err) || !process.env.GEMINI_API_KEY) {
      errorCode = err instanceof Error ? err.name : 'unknown'
      throw err
    }
    console.warn(`[provider] groq failed transiently; falling back to gemini. Error: ${err instanceof Error ? err.message : String(err)}`)
    const fallbackModel = resolveModel('gemini', quality)
    usedProvider = 'gemini'
    usedModel = fallbackModel
    try {
      const result = await generateWithGemini(input, fallbackModel)
      usage = result.usage
      success = true
      return { content: result.content, provider: 'gemini', model: fallbackModel }
    } catch (fallbackErr) {
      errorCode = fallbackErr instanceof Error ? fallbackErr.name : 'unknown'
      throw fallbackErr
    }
  } finally {
    if (input.route) {
      // Fire-and-forget: logAIUsage swallows its own errors so a telemetry
      // outage cannot fail the parent generation.
      void logAIUsage({
        clientId: input.clientId ?? null,
        userId: input.userId ?? null,
        route: input.route,
        provider: usedProvider,
        model: usedModel,
        quality,
        inputTokens: usage.inputTokens ?? null,
        outputTokens: usage.outputTokens ?? null,
        cachedTokens: usage.cachedTokens ?? null,
        success,
        errorCode,
        durationMs: Date.now() - startedAt,
        meta: {
          ...(input.usageMeta ?? {}),
          ...(input.cachedContextName ? { cached_context: true } : {}),
        },
      })
    }
  }
}
