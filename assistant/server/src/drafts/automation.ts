import { parseDocument, stringify, visit } from 'yaml'

// Dalla proposta di Claude (testo YAML) a una configurazione di automazione pulita:
// niente tag (!secret, !include, !input), sintassi attuale (triggers/conditions/actions,
// trigger:, action:), solo chiavi ammesse, chiavi in ordine leggibile.

export type AutomationConfig = Record<string, unknown>

export const MAX_YAML_CHARS = 30_000

const TOP_KEYS = new Set([
  'alias', 'description', 'triggers', 'conditions', 'actions', 'mode', 'max', 'max_exceeded', 'variables',
  'trigger_variables', 'trace', 'initial_state', 'id',
])
const MODES = new Set(['single', 'restart', 'queued', 'parallel'])
const KEY_ORDER = ['alias', 'description', 'triggers', 'conditions', 'actions', 'mode', 'max', 'max_exceeded', 'variables', 'trigger_variables', 'trace', 'initial_state']

export interface ParseResult {
  config?: AutomationConfig
  errors: string[]
  /** Correzioni automatiche della sintassi (da mostrare e da far sapere a Claude). */
  fixes: string[]
  warnings: string[]
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function parseYaml(text: string): { value?: unknown; errors: string[] } {
  if (text.length > MAX_YAML_CHARS) return { errors: [`YAML troppo lungo (massimo ${MAX_YAML_CHARS} caratteri)`] }
  const doc = parseDocument(text, { uniqueKeys: true, prettyErrors: false })
  const errors = doc.errors.map((e) => `YAML non valido: ${e.message.split('\n')[0]}`)
  const tags = new Set<string>()
  visit(doc, {
    Node(_key, node) {
      if (node.tag && node.tag.startsWith('!')) tags.add(node.tag)
    },
  })
  if (tags.size) {
    errors.push(`Tag non ammessi: ${[...tags].join(', ')}. Segreti, include e input di blueprint non si possono usare: scrivi i valori direttamente.`)
  }
  if (errors.length) return { errors }
  try {
    return { value: doc.toJS({ maxAliasCount: 20 }), errors: [] }
  } catch (err) {
    return { errors: [`YAML non valido: ${err instanceof Error ? err.message : String(err)}`] }
  }
}

function asList(v: unknown): unknown[] {
  if (v === undefined || v === null) return []
  return Array.isArray(v) ? v : [v]
}

/** service: → action: in ogni passo, anche annidato (choose, if, parallel, repeat, sequence). */
function normalizeSteps(steps: unknown[], fixes: Set<string>): unknown[] {
  return steps.map((step) => {
    if (!isPlainObject(step)) return step
    const s: Record<string, unknown> = { ...step }
    if ('service' in s && !('action' in s)) {
      s.action = s.service
      delete s.service
      fixes.add('`service:` → `action:` nelle azioni')
    }
    if (Array.isArray(s.choose)) {
      s.choose = s.choose.map((c) => (isPlainObject(c) && c.sequence !== undefined ? { ...c, sequence: normalizeSteps(asList(c.sequence), fixes) } : c))
    }
    for (const k of ['default', 'then', 'else', 'sequence']) {
      if (s[k] !== undefined) s[k] = normalizeSteps(asList(s[k]), fixes)
    }
    if (s.parallel !== undefined) s.parallel = normalizeSteps(asList(s.parallel), fixes)
    if (isPlainObject(s.repeat) && s.repeat.sequence !== undefined) s.repeat = { ...s.repeat, sequence: normalizeSteps(asList(s.repeat.sequence), fixes) }
    return s
  })
}

function modernTriggers(v: unknown, fixes: Set<string>): unknown[] {
  return asList(v).map((t) => {
    if (!isPlainObject(t)) return t
    if ('platform' in t && !('trigger' in t)) {
      const { platform, ...rest } = t
      fixes.add('`platform:` → `trigger:` nei trigger')
      return { trigger: platform, ...rest }
    }
    return t
  })
}

/**
 * Sintassi attuale senza controlli (trigger/condition/action → plurali, platform → trigger,
 * service → action): per leggere configurazioni esistenti, anche scritte anni fa.
 */
export function modernize(value: Record<string, unknown>): { config: Record<string, unknown>; fixes: string[] } {
  const c: Record<string, unknown> = { ...value }
  const fixes = new Set<string>()
  for (const [singular, plural] of [['trigger', 'triggers'], ['condition', 'conditions'], ['action', 'actions']] as const) {
    if (!(singular in c)) continue
    if (!(plural in c)) {
      c[plural] = c[singular]
      fixes.add(`\`${singular}:\` → \`${plural}:\``)
    }
    delete c[singular]
  }
  if ('use_blueprint' in c) return { config: c, fixes: [...fixes] }
  c.triggers = modernTriggers(c.triggers, fixes)
  c.conditions = asList(c.conditions)
  c.actions = normalizeSteps(asList(c.actions), fixes)
  return { config: c, fixes: [...fixes] }
}

/** Normalizza e controlla la forma di una singola automazione. */
export function normalizeAutomation(raw: unknown): ParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  const fixes = new Set<string>()
  let value = raw
  if (Array.isArray(value)) {
    if (value.length !== 1) return { errors: ['Proponi una sola automazione per volta (il YAML contiene un elenco).'], fixes: [], warnings }
    value = value[0]
  }
  if (!isPlainObject(value)) return { errors: ["Il YAML deve descrivere un'automazione (una mappa con alias, triggers, actions)."], fixes: [], warnings }
  const c: Record<string, unknown> = { ...value }

  if ('use_blueprint' in c) errors.push("Le automazioni da blueprint non si possono creare da qui: scrivi l'automazione completa.")
  for (const [singular, plural] of [['trigger', 'triggers'], ['condition', 'conditions'], ['action', 'actions']] as const) {
    if (singular in c) {
      if (plural in c) errors.push(`Ci sono sia \`${singular}:\` sia \`${plural}:\`: usa solo \`${plural}:\`.`)
      else {
        c[plural] = c[singular]
        fixes.add(`\`${singular}:\` → \`${plural}:\``)
      }
      delete c[singular]
    }
  }

  const unknown = Object.keys(c).filter((k) => !TOP_KEYS.has(k) && k !== 'use_blueprint')
  if (unknown.length) errors.push(`Chiavi non ammesse: ${unknown.join(', ')}.`)
  delete c.id // l'id lo assegna l'add-on (nuova) o resta quello esistente (modifica)

  if (typeof c.alias !== 'string' || !c.alias.trim()) errors.push('Manca `alias` (nome in italiano).')
  else if (c.alias.length > 120) errors.push('`alias` troppo lungo (massimo 120 caratteri).')
  if (c.description === undefined || c.description === '') warnings.push('Manca `description`: aggiungila per spiegare cosa fa.')
  else if (typeof c.description !== 'string') errors.push('`description` deve essere un testo.')

  const triggers = modernTriggers(c.triggers, fixes)
  if (triggers.length === 0) errors.push('Serve almeno un trigger in `triggers:`.')
  c.triggers = triggers
  c.conditions = asList(c.conditions)
  const actions = normalizeSteps(asList(c.actions), fixes)
  if (actions.length === 0) errors.push('Serve almeno un\'azione in `actions:`.')
  c.actions = actions

  if (c.mode === undefined) c.mode = 'single'
  else if (typeof c.mode !== 'string' || !MODES.has(c.mode)) errors.push('`mode` deve essere single, restart, queued o parallel.')

  const ordered: AutomationConfig = {}
  for (const k of KEY_ORDER) if (c[k] !== undefined) ordered[k] = c[k]
  if ((ordered.conditions as unknown[]).length === 0) delete ordered.conditions
  return { config: errors.length ? undefined : ordered, errors, fixes: [...fixes], warnings }
}

/**
 * YAML da mostrare e copiare. Home Assistant legge lo YAML con le regole 1.1, dove on/off/yes/no
 * senza virgolette sono booleani e 00:10:00 è un numero: con `version: '1.1'` quei valori
 * testuali vengono messi tra virgolette e lo YAML incollato nell'editor significa la stessa cosa.
 */
export function toYaml(config: unknown): string {
  return stringify(config, { lineWidth: 0, indent: 2, version: '1.1' })
}

/** JSON con chiavi ordinate: due configurazioni uguali danno lo stesso testo (per l'hash). */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (isPlainObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => v[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

// --- Diff a righe (LCS), sufficiente per configurazioni di poche centinaia di righe --------

export type DiffLine = { op: ' ' | '+' | '-'; line: string }

export function lineDiff(before: string, after: string): DiffLine[] {
  const a = before.replace(/\n$/, '').split('\n')
  const b = after.replace(/\n$/, '').split('\n')
  const n = a.length
  const m = b.length
  if (n * m > 4_000_000) return [...a.map((line) => ({ op: '-' as const, line })), ...b.map((line) => ({ op: '+' as const, line }))]
  const lcs: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: ' ', line: a[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ op: '-', line: a[i++]! })
    } else {
      out.push({ op: '+', line: b[j++]! })
    }
  }
  while (i < n) out.push({ op: '-', line: a[i++]! })
  while (j < m) out.push({ op: '+', line: b[j++]! })
  return out
}
