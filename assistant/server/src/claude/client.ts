import Anthropic from '@anthropic-ai/sdk'
import type { Options } from '../options.ts'

// Client Anthropic: vive solo sul server, la chiave non raggiunge mai il browser.
export function createClaudeClient(options: Options): Anthropic | null {
  if (!options.anthropicApiKey) return null
  return new Anthropic({ apiKey: options.anthropicApiKey, maxRetries: 2, timeout: 120_000 })
}

/** Messaggio in italiano per gli errori dell'API, dal più specifico al più generico. */
export function describeClaudeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Chiave API non valida o revocata'
  if (err instanceof Anthropic.PermissionDeniedError) return "La chiave non ha accesso a questa risorsa (controlla l'organizzazione in Console)"
  if (err instanceof Anthropic.NotFoundError) return 'Modello inesistente o non disponibile per questo account'
  if (err instanceof Anthropic.RateLimitError) return 'Limite di richieste o di spesa raggiunto: riprova più tardi o controlla la Console'
  if (err instanceof Anthropic.BadRequestError) return `Richiesta rifiutata: ${err.message}`
  if (err instanceof Anthropic.APIConnectionError) return 'Impossibile raggiungere api.anthropic.com dalla rete di Home Assistant'
  if (err instanceof Anthropic.APIError) return `Errore API ${err.status ?? ''}: ${err.message}`.trim()
  return err instanceof Error ? err.message : String(err)
}

export interface ModelCheck {
  role: 'chat' | 'analisi'
  model: string
  ok: boolean
  displayName?: string
  maxInputTokens?: number
  error?: string
}

export interface AnthropicPing {
  configured: boolean
  models: ModelCheck[]
  countTokens?: { model: string; inputTokens: number } | { model: string; error: string }
}

/** Verifica chiave e modelli senza generare testo (models.retrieve + countTokens, gratuiti). */
export async function pingAnthropic(options: Options, client = createClaudeClient(options)): Promise<AnthropicPing> {
  if (!client) return { configured: false, models: [] }
  const targets: Array<{ role: ModelCheck['role']; model: string }> = [{ role: 'chat', model: options.chatModel }]
  if (options.analysisModel !== options.chatModel) targets.push({ role: 'analisi', model: options.analysisModel })

  const models = await Promise.all(
    targets.map(async ({ role, model }): Promise<ModelCheck> => {
      try {
        const info = await client.models.retrieve(model)
        const extra = info as unknown as { max_input_tokens?: number }
        return { role, model, ok: true, displayName: info.display_name, maxInputTokens: extra.max_input_tokens }
      } catch (err) {
        return { role, model, ok: false, error: describeClaudeError(err) }
      }
    }),
  )

  let countTokens: AnthropicPing['countTokens']
  try {
    const r = await client.messages.countTokens({
      model: options.chatModel,
      messages: [{ role: 'user', content: 'Quali luci sono accese in soggiorno?' }],
    })
    countTokens = { model: options.chatModel, inputTokens: r.input_tokens }
  } catch (err) {
    countTokens = { model: options.chatModel, error: describeClaudeError(err) }
  }
  return { configured: true, models, countTokens }
}
