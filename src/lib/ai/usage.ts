import { createClient as createServiceClient } from '@supabase/supabase-js'

import { estimateCost } from './pricing'

export type Provider = 'gemini' | 'groq'
export type Quality = 'high' | 'standard' | 'cheap'

export interface UsageLogInput {
  clientId?: string | null
  userId?: string | null
  route: string
  provider: Provider
  model: string
  quality: Quality
  inputTokens?: number | null
  outputTokens?: number | null
  cachedTokens?: number | null
  success: boolean
  errorCode?: string | null
  durationMs: number
  meta?: Record<string, unknown>
}

function admin() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

// Logs one row to public.ai_usage_log. Failure to log NEVER throws to the
// caller - the parent generation must succeed even if telemetry is down.
export async function logAIUsage(input: UsageLogInput): Promise<void> {
  try {
    const cost = estimateCost(
      input.model,
      input.inputTokens ?? null,
      input.outputTokens ?? null,
      input.cachedTokens ?? null,
    )

    const supabase = admin()
    const { error } = await supabase.from('ai_usage_log').insert({
      client_id: input.clientId ?? null,
      user_id: input.userId ?? null,
      route: input.route,
      provider: input.provider,
      model: input.model,
      quality: input.quality,
      input_tokens: input.inputTokens ?? null,
      output_tokens: input.outputTokens ?? null,
      cached_tokens: input.cachedTokens ?? null,
      cost_usd: cost,
      success: input.success,
      error_code: input.errorCode ?? null,
      duration_ms: input.durationMs,
      meta: input.meta ?? {},
    })
    if (error) {
       
      console.error('[ai/usage] insert failed:', error.message)
    }
  } catch (e) {
     
    console.error('[ai/usage] unexpected:', e)
  }
}

export interface MonthlyUsage {
  used: number
  budget: number | null
  warnAt: number | null
}

// Sums input_tokens + output_tokens for the current calendar month for a
// client. Returns the budget + warn threshold from brand_content_settings so
// callers can decide whether to soft-block or warn.
export async function getMonthlyUsage(clientId: string): Promise<MonthlyUsage> {
  const supabase = admin()

  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()

  const [usageRes, settingsRes] = await Promise.all([
    supabase
      .from('ai_usage_log')
      .select('input_tokens, output_tokens')
      .eq('client_id', clientId)
      .gte('created_at', monthStart),
    supabase
      .from('brand_content_settings')
      .select('monthly_token_budget, monthly_token_warn_at')
      .eq('client_id', clientId)
      .maybeSingle(),
  ])

  if (usageRes.error) throw usageRes.error
  // settings row missing is fine - means no budget configured yet.

  const used = (usageRes.data ?? []).reduce(
    (sum: number, row: { input_tokens: number | null; output_tokens: number | null }) =>
      sum + (row.input_tokens ?? 0) + (row.output_tokens ?? 0),
    0,
  )

  return {
    used,
    budget: settingsRes.data?.monthly_token_budget ?? null,
    warnAt: settingsRes.data?.monthly_token_warn_at ?? null,
  }
}
