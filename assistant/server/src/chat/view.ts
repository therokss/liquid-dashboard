import type { BetaContentBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import type { Conversation } from './store.ts'
import { toolLabel } from '../claude/tools/registry.ts'

// Trasforma la cronologia API (blocchi di thinking, tool_use, tool_result, blocco <contesto>)
// in ciò che l'interfaccia mostra: messaggi dell'utente, risposte con i chip degli strumenti.

export type ViewPart =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; label: string; ok: boolean | null }
  | { type: 'note'; text: string; tone: 'info' | 'warning' | 'error' }

export type ViewItem =
  | { kind: 'user'; text: string; ts: string }
  | { kind: 'assistant'; parts: ViewPart[]; ts: string; costUsd?: number; cacheRead?: number; fallback?: boolean }

function blocks(content: BetaMessageParam['content']): BetaContentBlockParam[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content
}

export function toView(conv: Conversation): ViewItem[] {
  const items: ViewItem[] = []
  const toolParts = new Map<string, Extract<ViewPart, { type: 'tool' }>>()
  let current: Extract<ViewItem, { kind: 'assistant' }> | null = null

  const ensureAssistant = (ts: string) => {
    if (!current) {
      current = { kind: 'assistant', parts: [], ts }
      items.push(current)
    }
    return current
  }

  for (const line of conv.lines) {
    if (line.type === 'message') {
      const m = line.message
      const bs = blocks(m.content)
      if (m.role === 'user') {
        for (const b of bs) {
          if (b.type === 'tool_result') {
            const part = toolParts.get(b.tool_use_id)
            if (part) part.ok = !b.is_error
          }
        }
        const text = bs
          .filter((b): b is Extract<BetaContentBlockParam, { type: 'text' }> => b.type === 'text' && !b.text.startsWith('<contesto>') && !b.text.startsWith('<evento'))
          .map((b) => b.text)
          .join('\n')
        if (text) {
          current = null
          items.push({ kind: 'user', text, ts: line.ts })
        }
        continue
      }
      if (m.role !== 'assistant') continue
      const a = ensureAssistant(line.ts)
      // Con un fallback a metà risposta, il testo prima del blocco `fallback` è stato scartato.
      const lastFallback = bs.map((b) => b.type as string).lastIndexOf('fallback')
      if (lastFallback >= 0) a.fallback = true
      for (const [i, b] of bs.entries()) {
        if (b.type === 'text' && i > lastFallback && b.text.trim()) a.parts.push({ type: 'text', text: b.text })
        else if (b.type === 'tool_use') {
          const part = { type: 'tool' as const, id: b.id, name: b.name, label: toolLabel(b.name, b.input), ok: null }
          toolParts.set(b.id, part)
          a.parts.push(part)
        }
      }
    } else if (line.type === 'turn') {
      const a = ensureAssistant(line.ts)
      a.costUsd = (a.costUsd ?? 0) + line.costUsd
      if (line.cacheRead) a.cacheRead = (a.cacheRead ?? 0) + line.cacheRead
      if (line.fallback) a.fallback = true
      if (line.aborted) a.parts.push({ type: 'note', text: 'Risposta interrotta.', tone: 'info' })
      else if (line.error) a.parts.push({ type: 'note', text: line.error, tone: line.stopReason === null ? 'error' : 'warning' })
      current = null
    }
  }
  return items
}
