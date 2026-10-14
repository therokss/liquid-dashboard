import type { BetaMessage, BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { StreamFn, StreamHandlers } from '../src/claude/loop.ts'

// Finto Claude: risposte preparate in ordine, registra ogni richiesta (copia JSON, così i test
// verificano esattamente i byte che sarebbero partiti verso l'API).

type Json = Record<string, any>

export type Step = BetaMessage | ((params: BetaMessageStreamParams, signal: AbortSignal) => BetaMessage | Promise<BetaMessage>) | Error

let n = 0

export function msg(content: Json[], stop_reason: string, extra: Json = {}): BetaMessage {
  n += 1
  return {
    id: `msg_${n}`,
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5-5',
    content,
    stop_reason,
    stop_sequence: null,
    stop_details: null,
    container: null,
    context_management: null,
    diagnostics: null,
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0, cache_creation: null, iterations: null },
    ...extra,
  } as unknown as BetaMessage
}

export const text = (t: string) => ({ type: 'text', text: t, citations: null })
export const thinking = (t = 'ragiono') => ({ type: 'thinking', thinking: t, signature: `sig-${t}` })
export const toolUse = (id: string, name: string, input: Json) => ({ type: 'tool_use', id, name, input, caller: { type: 'direct' } })

export function fakeStream(steps: Step[]): StreamFn & { requests: Json[]; remaining: () => number } {
  const queue = [...steps]
  const requests: Json[] = []
  const fn = (async (params: BetaMessageStreamParams, signal: AbortSignal, h: StreamHandlers) => {
    requests.push(JSON.parse(JSON.stringify(params)))
    const step = queue.shift()
    if (!step) throw new Error('nessuna risposta preparata')
    if (step instanceof Error) throw step
    const m = typeof step === 'function' ? await step(params, signal) : step
    for (const b of m.content as Json[]) {
      h.onBlockStart(b.type, b.name)
      if (b.type === 'text') h.onText(b.text)
    }
    return m
  }) as StreamFn & { requests: Json[]; remaining: () => number }
  fn.requests = requests
  fn.remaining = () => queue.length
  return fn
}
