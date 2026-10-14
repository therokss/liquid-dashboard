import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaMessageStreamParams,
  BetaTextBlockParam,
  BetaTool,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { Effort } from '../options.ts'
import { messageCost, type UsageTotals } from './pricing.ts'
import type { ToolOutcome } from './tools/registry.ts'

// Loop manuale in streaming: un turno dell'utente può richiedere più chiamate all'API
// (tool_use → esecuzione → tool_result → …). Ogni messaggio dell'assistente viene salvato
// così com'è (blocchi di thinking inclusi) prima di eseguire i tool: la cronologia resta
// append-only e un riavvio a metà turno si ripara al turno successivo.

export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'
export const BINDING_BETA = 'thinking-binding-controls-2026-08-01'
export const MAX_TOKENS = 32_000
export const MAX_STEPS = 12
const MAX_PAUSES = 5

export const INTERRUPTED_TOOL = 'Esecuzione interrotta (riavvio dell\'add-on o richiesta annullata): nessun risultato disponibile.'
export const REFUSAL_TEXT = '(Risposta non disponibile: la richiesta è stata rifiutata dal modello.)'
export const EMPTY_TEXT = '(Nessuna risposta.)'

export interface Frozen {
  model: string
  effort: Effort
  system: BetaTextBlockParam[]
  tools: BetaTool[]
}

/** Funzionalità opzionali: se un modello le rifiuta con un 400 si spengono e si riprova. */
export interface Features {
  fallbacks: boolean
  blockBinding: boolean
}

export function buildRequest(frozen: Frozen, messages: BetaMessageParam[], features: Features): BetaMessageStreamParams {
  const betas: string[] = []
  if (features.fallbacks) betas.push(FALLBACK_BETA)
  if (features.blockBinding) betas.push(BINDING_BETA)
  return {
    model: frozen.model,
    max_tokens: MAX_TOKENS,
    system: frozen.system,
    tools: frozen.tools,
    messages,
    // Thinking adattivo; se un blocco non supera il controllo di continuità (es. cronologia
    // riparata dopo un riavvio) viene scartato invece di far fallire la richiesta.
    thinking: features.blockBinding ? { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } } : { type: 'adaptive' },
    output_config: { effort: frozen.effort },
    ...(features.fallbacks ? { fallbacks: 'default' as const } : {}),
    // Cache automatica sulla coda della conversazione (5 min); il prefisso fisso ha già il
    // suo breakpoint da 1 h sull'ultimo blocco del prompt di sistema.
    cache_control: { type: 'ephemeral' },
    ...(betas.length ? { betas } : {}),
  }
}

function asBlocks(content: BetaMessageParam['content']): BetaContentBlockParam[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : [...content]
}

/**
 * Prepara la cronologia per l'API in modo deterministico (stesso input → stessi byte):
 * - unisce messaggi utente consecutivi (es. dopo un errore dell'API il turno non ha risposta);
 * - aggiunge i tool_result mancanti dopo un tool_use rimasto senza risposta (riavvio,
 *   interruzione, max_tokens), sempre in testa al messaggio utente come richiede l'API.
 */
export function prepareMessages(history: BetaMessageParam[]): BetaMessageParam[] {
  const merged: BetaMessageParam[] = []
  for (const m of history) {
    const prev = merged[merged.length - 1]
    if (prev && prev.role === 'user' && m.role === 'user') {
      merged[merged.length - 1] = { role: 'user', content: [...asBlocks(prev.content), ...asBlocks(m.content)] }
    } else {
      merged.push(m)
    }
  }
  const out: BetaMessageParam[] = []
  for (let i = 0; i < merged.length; i++) {
    const m = merged[i]!
    out.push(m)
    if (m.role !== 'assistant' || typeof m.content === 'string') continue
    const ids = m.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use').map((b) => b.id)
    if (ids.length === 0) continue
    const next = merged[i + 1]
    if (!next || next.role !== 'user') continue // l'assistente è l'ultimo: si ripara quando arriva l'utente
    const nextBlocks = asBlocks(next.content)
    const have = new Set(nextBlocks.filter((b): b is BetaToolResultBlockParam => b.type === 'tool_result').map((b) => b.tool_use_id))
    const missing = ids.filter((id) => !have.has(id))
    if (missing.length === 0) continue
    const fill: BetaToolResultBlockParam[] = missing.map((id) => ({ type: 'tool_result', tool_use_id: id, content: INTERRUPTED_TOOL, is_error: true }))
    const results = nextBlocks.filter((b) => b.type === 'tool_result')
    const rest = nextBlocks.filter((b) => b.type !== 'tool_result')
    merged[i + 1] = { role: 'user', content: [...results, ...fill, ...rest] }
  }
  return out
}

/** Contenuto dell'assistente da salvare: mai vuoto (l'API rifiuta messaggi senza blocchi). */
function persistable(msg: BetaMessage): BetaMessageParam {
  if (msg.stop_reason === 'refusal') return { role: 'assistant', content: [{ type: 'text', text: REFUSAL_TEXT }] }
  if (msg.content.length === 0) return { role: 'assistant', content: [{ type: 'text', text: EMPTY_TEXT }] }
  return { role: 'assistant', content: msg.content as unknown as BetaContentBlockParam[] }
}

export interface StreamHandlers {
  onText(delta: string): void
  onBlockStart(type: string, name?: string): void
}

export type StreamFn = (params: BetaMessageStreamParams, signal: AbortSignal, handlers: StreamHandlers) => Promise<BetaMessage>

export function sdkStreamer(client: Anthropic): StreamFn {
  return async (params, signal, h) => {
    const stream = client.beta.messages.stream(params, { signal })
    stream.on('streamEvent', (ev) => {
      if (ev.type === 'content_block_start') {
        const b = ev.content_block as { type: string; name?: string }
        h.onBlockStart(b.type, b.name)
      } else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
        h.onText(ev.delta.text)
      }
    })
    return stream.finalMessage()
  }
}

export type TurnEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking' }
  | { type: 'fallback' }
  | { type: 'tool_pending'; name: string }
  | { type: 'tool'; id: string; name: string; input: unknown }
  | { type: 'tool_done'; id: string; ok: boolean }
  | { type: 'step'; usage: UsageTotals }

export interface TurnDeps {
  stream: StreamFn
  persist: (message: BetaMessageParam) => Promise<void>
  executeTool: (name: string, input: unknown) => Promise<ToolOutcome>
  /** Chiamato prima di ogni richiesta: lancia se il budget è esaurito. */
  beforeRequest: () => void
  onUsage: (usage: UsageTotals) => Promise<void>
  emit: (event: TurnEvent) => void
  /** Memoria per modello delle funzionalità rifiutate (condivisa tra i turni). */
  features: Features
}

export interface TurnResult {
  stopReason: string | null
  steps: number
  usage: UsageTotals
  aborted: boolean
  /** Avviso da mostrare (risposta troncata, contesto pieno, rifiuto). */
  notice?: string
}

function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return {
    model: b.model,
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    costUsd: a.costUsd + b.costUsd,
    fallback: a.fallback || b.fallback,
  }
}

function isAbort(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted || err instanceof Anthropic.APIUserAbortError
}

/** Riprova una volta senza la funzionalità opzionale citata in un 400. */
async function requestWithDowngrade(frozen: Frozen, history: BetaMessageParam[], deps: TurnDeps, signal: AbortSignal, handlers: StreamHandlers): Promise<BetaMessage> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await deps.stream(buildRequest(frozen, prepareMessages(history), deps.features), signal, handlers)
    } catch (err) {
      if (attempt < 2 && err instanceof Anthropic.BadRequestError) {
        const msg = String(err.message)
        if (deps.features.fallbacks && /fallback/i.test(msg)) {
          deps.features.fallbacks = false
          continue
        }
        if (deps.features.blockBinding && /block_binding|binding/i.test(msg)) {
          deps.features.blockBinding = false
          continue
        }
      }
      throw err
    }
  }
}

/**
 * Esegue un turno. `history` contiene già il messaggio dell'utente (salvato dal chiamante)
 * e viene esteso in place con i messaggi prodotti.
 */
export async function runTurn(frozen: Frozen, history: BetaMessageParam[], deps: TurnDeps, signal: AbortSignal): Promise<TurnResult> {
  let usage: UsageTotals = { model: frozen.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0, fallback: false }
  let steps = 0
  let pauses = 0
  const handlers: StreamHandlers = {
    onText: (delta) => deps.emit({ type: 'text', delta }),
    onBlockStart: (type, name) => {
      if (type === 'thinking' || type === 'redacted_thinking') deps.emit({ type: 'thinking' })
      else if (type === 'fallback') deps.emit({ type: 'fallback' })
      else if (type === 'tool_use' && name) deps.emit({ type: 'tool_pending', name })
    },
  }

  while (steps < MAX_STEPS) {
    deps.beforeRequest()
    let msg: BetaMessage
    try {
      msg = await requestWithDowngrade(frozen, history, deps, signal, handlers)
    } catch (err) {
      if (isAbort(err, signal)) return { stopReason: null, steps, usage, aborted: true }
      throw err
    }
    steps += 1
    const stepUsage = messageCost(msg)
    usage = addUsage(usage, stepUsage)
    await deps.onUsage(stepUsage)
    deps.emit({ type: 'step', usage: stepUsage })

    const saved = persistable(msg)
    await deps.persist(saved)
    history.push(saved)

    switch (msg.stop_reason) {
      case 'tool_use': {
        const calls = msg.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use')
        for (const c of calls) deps.emit({ type: 'tool', id: c.id, name: c.name, input: c.input })
        // Tool di sola lettura: in parallelo. Tutti i risultati in UN messaggio utente.
        const outcomes = await Promise.all(
          calls.map(async (c) => {
            const out = await deps.executeTool(c.name, c.input)
            deps.emit({ type: 'tool_done', id: c.id, ok: !out.isError })
            return { c, out }
          }),
        )
        if (signal.aborted) return { stopReason: 'tool_use', steps, usage, aborted: true }
        const results: BetaMessageParam = {
          role: 'user',
          content: outcomes.map(({ c, out }) => ({
            type: 'tool_result' as const,
            tool_use_id: c.id,
            content: out.content,
            ...(out.isError ? { is_error: true } : {}),
          })),
        }
        await deps.persist(results)
        history.push(results)
        continue
      }
      case 'pause_turn':
        if (++pauses > MAX_PAUSES) return { stopReason: 'pause_turn', steps, usage, aborted: false, notice: 'Il modello si è fermato troppe volte: riprova o riformula.' }
        continue
      case 'max_tokens':
        return { stopReason: 'max_tokens', steps, usage, aborted: false, notice: 'Risposta troncata per lunghezza: chiedi di continuare o restringi la domanda.' }
      case 'refusal':
        return { stopReason: 'refusal', steps, usage, aborted: false, notice: 'Il modello ha rifiutato la richiesta. Riformula la domanda.' }
      case 'model_context_window_exceeded':
        return { stopReason: msg.stop_reason, steps, usage, aborted: false, notice: 'La conversazione è troppo lunga: apri una nuova chat.' }
      default:
        return { stopReason: msg.stop_reason, steps, usage, aborted: false }
    }
  }
  return { stopReason: 'max_steps', steps, usage, aborted: false, notice: `Fermato dopo ${MAX_STEPS} passaggi con gli strumenti: chiedi di continuare se serve.` }
}
