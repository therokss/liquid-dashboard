import Anthropic from '@anthropic-ai/sdk'
import type { BetaMessage, BetaMessageStreamParams, BetaTextBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { Effort } from '../options.ts'
import { FALLBACK_BETA, type StreamFn } from './loop.ts'
import { messageCost, type UsageTotals } from './pricing.ts'

// Una sola richiesta con risposta JSON vincolata a uno schema (structured outputs:
// output_config.format). Serve alle analisi (Suggerisci, poi Verifica): niente tool, niente
// cronologia, il risultato si convalida comunque lato server prima di usarlo.

export class StructuredError extends Error {
  constructor(readonly code: 'rifiuto' | 'troncata' | 'json_non_valido' | 'annullata', message: string, readonly usage?: UsageTotals) {
    super(message)
  }
}

export interface StructuredRequest {
  model: string
  effort: Effort
  system: BetaTextBlockParam[]
  user: string
  schema: Record<string, unknown>
  maxTokens: number
  /**
   * Cache (5 min) sul prompt di sistema: conviene solo quando più richieste vicine lo
   * ripetono identico (i lotti di Verifica); per una richiesta isolata la scrittura costa e basta.
   */
  cacheSystem?: boolean
}

export interface StructuredResult {
  value: unknown
  usage: UsageTotals
  stopReason: string | null
}

export function buildStructuredParams(req: StructuredRequest, fallbacks: boolean): BetaMessageStreamParams {
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.cacheSystem ? withCachedTail(req.system) : req.system,
    messages: [{ role: 'user', content: req.user }],
    thinking: { type: 'adaptive' },
    output_config: { effort: req.effort, format: { type: 'json_schema', schema: req.schema } },
    ...(fallbacks ? { fallbacks: 'default' as const, betas: [FALLBACK_BETA] } : {}),
  }
}

function withCachedTail(system: BetaTextBlockParam[]): BetaTextBlockParam[] {
  return system.map((b, i) => (i === system.length - 1 ? { ...b, cache_control: { type: 'ephemeral' } } : b))
}

/** Testo della risposta: con un fallback lato server vale solo quello dopo l'ultimo blocco "fallback". */
export function answerText(msg: BetaMessage): string {
  const blocks = msg.content as Array<{ type: string; text?: string }>
  let start = 0
  blocks.forEach((b, i) => {
    if (b.type === 'fallback') start = i + 1
  })
  return blocks
    .slice(start)
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
}

export async function requestStructured(
  stream: StreamFn,
  req: StructuredRequest,
  features: { fallbacks: boolean },
  signal: AbortSignal,
  onText?: (chars: number) => void,
): Promise<StructuredResult> {
  let chars = 0
  let msg: BetaMessage
  for (let attempt = 0; ; attempt++) {
    try {
      msg = await stream(buildStructuredParams(req, features.fallbacks), signal, {
        onText: (d) => {
          chars += d.length
          onText?.(chars)
        },
        onBlockStart: () => undefined,
      })
      break
    } catch (err) {
      if (signal.aborted || err instanceof Anthropic.APIUserAbortError) throw new StructuredError('annullata', 'Analisi annullata')
      if (attempt === 0 && features.fallbacks && err instanceof Anthropic.BadRequestError && /fallback/i.test(String(err.message))) {
        features.fallbacks = false
        continue
      }
      throw err
    }
  }
  const usage = messageCost(msg)
  if (msg.stop_reason === 'refusal') throw new StructuredError('rifiuto', 'Il modello ha rifiutato la richiesta.', usage)
  if (msg.stop_reason === 'max_tokens') throw new StructuredError('troncata', 'Risposta troncata per lunghezza: riprova con meno candidati.', usage)
  const text = answerText(msg).trim()
  try {
    return { value: JSON.parse(text), usage, stopReason: msg.stop_reason }
  } catch {
    throw new StructuredError('json_non_valido', 'La risposta del modello non è un JSON valido.', usage)
  }
}
