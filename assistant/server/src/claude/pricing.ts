// Prezzi in USD per milione di token (listino Anthropic, ottobre 2026). Servono solo per la
// stima dei costi mostrata nell'add-on: il consuntivo ufficiale resta quello della Console.
// Scrittura in cache: ×1,25 (TTL 5 min) o ×2 (TTL 1 h) del prezzo di input.

interface Price {
  input: number
  output: number
  cacheRead: number
}

const PRICES: Array<[prefix: string, price: Price]> = [
  ['claude-opus-5-5', { input: 4, output: 20, cacheRead: 0.2 }],
  ['claude-sonnet-5-5', { input: 2, output: 10, cacheRead: 0.2 }],
  ['claude-haiku-5-5', { input: 0.1, output: 0.5, cacheRead: 0.01 }],
  ['claude-fable-5-1', { input: 10, output: 50, cacheRead: 0.25 }],
  ['claude-opus-5', { input: 5, output: 25, cacheRead: 0.5 }],
  ['claude-sonnet-5', { input: 3, output: 15, cacheRead: 0.3 }],
  ['claude-opus-4-8', { input: 5, output: 25, cacheRead: 0.5 }],
]

/** Modello sconosciuto: si stima per eccesso (prezzo del livello più caro). */
const FALLBACK_PRICE: Price = { input: 10, output: 50, cacheRead: 1 }

export function priceOf(model: string): { price: Price; known: boolean } {
  const hit = PRICES.find(([prefix]) => model === prefix || model.startsWith(prefix + '-'))
  return hit ? { price: hit[1], known: true } : { price: FALLBACK_PRICE, known: false }
}

export interface TokenUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_creation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null
}

export function costUsd(model: string, u: TokenUsage): number {
  const { price } = priceOf(model)
  const created = u.cache_creation_input_tokens ?? 0
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0
  const write5m = u.cache_creation ? u.cache_creation.ephemeral_5m_input_tokens : created
  const usd =
    u.input_tokens * price.input +
    u.output_tokens * price.output +
    (u.cache_read_input_tokens ?? 0) * price.cacheRead +
    write5m * price.input * 1.25 +
    write1h * price.input * 2
  return usd / 1_000_000
}

/** Ricerche web: $10 ogni 1000 (le letture di pagine con web_fetch costano solo i token). */
export const WEB_SEARCH_USD = 0.01

export interface UsageTotals {
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  costUsd: number
  /** Almeno una parte servita da un modello di riserva (fallback dopo un rifiuto). */
  fallback: boolean
  /** ricerche web fatturate (solo nello studio dei dispositivi) */
  searches?: number
}

interface IterationLike extends TokenUsage {
  type: string
  model?: string | null
}

/**
 * Costo di una risposta. Con i fallback lato server `usage.iterations` riporta ogni tentativo
 * (anche quello rifiutato) con il proprio modello: è la fonte corretta; altrimenti vale `usage`.
 */
export function messageCost(message: {
  model: string
  usage: TokenUsage & { iterations?: IterationLike[] | null; server_tool_use?: { web_search_requests?: number } | null }
}): UsageTotals {
  const its = (message.usage.iterations ?? []).filter((i) => i.type === 'message' || i.type === 'fallback_message')
  const parts: Array<{ model: string; u: TokenUsage }> = its.length
    ? its.map((i) => ({ model: i.model ?? message.model, u: i }))
    : [{ model: message.model, u: message.usage }]
  const totals: UsageTotals = { model: message.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, fallback: its.some((i) => i.type === 'fallback_message') }
  for (const { model, u } of parts) {
    totals.input += u.input_tokens
    totals.output += u.output_tokens
    totals.cacheRead += u.cache_read_input_tokens ?? 0
    totals.cacheWrite += u.cache_creation_input_tokens ?? 0
    totals.costUsd += costUsd(model, u)
  }
  const searches = message.usage.server_tool_use?.web_search_requests ?? 0
  if (searches > 0) {
    totals.searches = searches
    totals.costUsd += searches * WEB_SEARCH_USD
  }
  return totals
}
