import { modernize } from '../drafts/automation.ts'
import { isObj, isTemplate } from '../drafts/checks.ts'
import type { Fix } from './types.ts'

// Correzioni meccaniche sulla configurazione salvata nell'editor. Il risultato passa poi
// dalla pipeline delle bozze (controlli, anteprima con differenze, tap, backup, Annulla).

export class FixError extends Error {}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Sostituisce un entity_id ovunque: chiavi entity_id, soglie a entità, zone, template. */
function replaceEntity(root: unknown, from: string, to: string): number {
  let n = 0
  const inTemplate = new RegExp(`(?<![a-z0-9_.])${escape(from)}(?![a-z0-9_])`, 'g')
  const swapList = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (isTemplate(v)) return v
      const parts = v.split(',').map((s) => s.trim())
      if (!parts.includes(from)) return v
      n += 1
      return parts.map((p) => (p === from ? to : p)).join(', ')
    }
    if (Array.isArray(v)) {
      return v.map((x) => {
        if (x === from) {
          n += 1
          return to
        }
        return x
      })
    }
    return v
  }
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 40) return v
    if (typeof v === 'string') {
      if (!isTemplate(v) || !inTemplate.test(v)) return v
      inTemplate.lastIndex = 0
      const out = v.replace(inTemplate, () => {
        n += 1
        return to
      })
      return out
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1))
    if (!isObj(v)) return v
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      if (k === 'entity_id') out[k] = typeof x === 'string' && isTemplate(x) ? walk(x, depth + 1) : swapList(x)
      else if ((k === 'above' || k === 'below' || k === 'zone') && x === from) {
        n += 1
        out[k] = to
      } else out[k] = walk(x, depth + 1)
    }
    return out
  }
  const c = root as Record<string, unknown>
  for (const key of ['triggers', 'conditions', 'actions', 'variables']) if (c[key] !== undefined) c[key] = walk(c[key], 0)
  return n
}

function triggerAt(c: Record<string, unknown>, i: number, kind: string): Record<string, unknown> {
  const list = Array.isArray(c.triggers) ? c.triggers : []
  const t = list[i]
  const k = isObj(t) ? (t.trigger ?? t.platform) : undefined
  if (!isObj(t) || k !== kind) throw new FixError(`Il trigger ${i + 1} non è più un trigger ${kind}: l'automazione è cambiata, rilancia la verifica.`)
  return t
}

function replaceTriggerId(c: Record<string, unknown>, from: string, to: string[]): number {
  let n = 0
  const walk = (v: unknown, depth: number): void => {
    if (depth > 40) return
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1)
      return
    }
    if (!isObj(v)) return
    if (v.condition === 'trigger') {
      const ids = (Array.isArray(v.id) ? v.id : [v.id]).map((x) => (typeof x === 'number' ? String(x) : x))
      if (ids.includes(from)) {
        n += 1
        const next = [...new Set(ids.flatMap((x) => (x === from ? to : [x])))]
        v.id = next.length === 1 ? next[0] : next
      }
    }
    for (const x of Object.values(v)) walk(x, depth + 1)
  }
  walk(c.conditions, 0)
  walk(c.actions, 0)
  return n
}

/** Applica le correzioni scelte a una copia della configurazione (sintassi aggiornata). */
export function applyFixes(raw: Record<string, unknown>, fixes: Fix[]): Record<string, unknown> {
  const c = modernize(structuredClone(raw)).config
  if ('use_blueprint' in c) throw new FixError("Le automazioni da blueprint si correggono dall'editor di Home Assistant.")
  for (const f of fixes) {
    switch (f.kind) {
      case 'sostituisci_entita':
        if (!replaceEntity(c, f.from, f.to)) throw new FixError(`${f.from} non compare più nell'automazione: rilancia la verifica.`)
        break
      case 'to_null':
        for (const i of f.triggers) {
          const t = triggerAt(c, i, 'state')
          if (['to', 'from', 'not_to', 'not_from', 'attribute'].some((k) => k in t)) continue
          t.to = null
        }
        break
      case 'time_pattern': {
        const t = triggerAt(c, f.trigger, 'time_pattern')
        delete t.hours
        delete t.minutes
        delete t.seconds
        Object.assign(t, f.pattern)
        break
      }
      case 'trigger_id':
        if (!replaceTriggerId(c, f.from, f.to)) throw new FixError(`Nessuna condizione usa più l'id "${f.from}": rilancia la verifica.`)
        break
      case 'sintassi':
        break
    }
  }
  return c
}
