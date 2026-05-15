// Per-model pricing used by ai_usage_log to compute cost_usd at write time.
// Values are USD per 1M tokens. Update when providers re-price.
//
// Cached input pricing applies when the call is served via Gemini's context
// cache (cachedContents API). Gemini lists cached input at ~25% of normal.

export interface ModelPricing {
  inputPerMillion: number
  outputPerMillion: number
  cachedInputPerMillion?: number
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  'gemini-2.5-pro': { inputPerMillion: 1.25, outputPerMillion: 10.0, cachedInputPerMillion: 0.3125 },
  'gemini-2.5-flash': { inputPerMillion: 0.3, outputPerMillion: 2.5, cachedInputPerMillion: 0.075 },
  'gemini-2.5-flash-lite': { inputPerMillion: 0.1, outputPerMillion: 0.4, cachedInputPerMillion: 0.025 },
  'llama-3.3-70b-versatile': { inputPerMillion: 0.59, outputPerMillion: 0.79 },
}

export function estimateCost(
  model: string,
  input: number | null | undefined,
  output: number | null | undefined,
  cached?: number | null,
): number | null {
  const price = MODEL_PRICING[model]
  if (!price) return null
  const inTokens = input ?? 0
  const outTokens = output ?? 0
  const cachedTokens = cached ?? 0
  // Cached tokens are a subset of input tokens. Charge the non-cached input
  // at full rate, the cached portion at the (lower) cached rate.
  const billableInput = Math.max(0, inTokens - cachedTokens)
  const cachedRate = price.cachedInputPerMillion ?? price.inputPerMillion
  const cost =
    (billableInput * price.inputPerMillion) / 1_000_000 +
    (cachedTokens * cachedRate) / 1_000_000 +
    (outTokens * price.outputPerMillion) / 1_000_000
  return cost
}
