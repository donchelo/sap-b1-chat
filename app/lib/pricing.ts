export type AllowedModel = "claude-haiku-4.5" | "claude-sonnet-4.6" | "claude-opus-4.8"

// Costos en USD por cada 1,000,000 de tokens
const PRICING_TABLE: Record<AllowedModel, { input: number; output: number }> = {
  "claude-haiku-4.5": {
    input: 0.25,
    output: 1.25,
  },
  "claude-sonnet-4.6": {
    input: 3.00,
    output: 15.00,
  },
  "claude-opus-4.8": {
    input: 15.00,
    output: 75.00,
  }
}

export function calculateCost(model: AllowedModel, promptTokens: number, completionTokens: number): number {
  const pricing = PRICING_TABLE[model] || PRICING_TABLE["claude-sonnet-4.6"]
  const inputCost = (promptTokens / 1_000_000) * pricing.input
  const outputCost = (completionTokens / 1_000_000) * pricing.output
  return inputCost + outputCost
}
