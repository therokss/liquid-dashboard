// Trigger time_pattern spiegati a parole. L'errore tipico: `minutes: "5"` vuol dire "al minuto 5
// di ogni ora" (una volta all'ora), non "ogni 5 minuti" (che si scrive "/5"). In Home Assistant,
// se un'unità più grande è indicata, quelle più piccole non indicate valgono 0; quelle più
// grandi non indicate valgono "*".

export type Unit = 'hours' | 'minutes' | 'seconds'
const UNITS: Unit[] = ['hours', 'minutes', 'seconds']
const RANGE: Record<Unit, number> = { hours: 24, minutes: 60, seconds: 60 }
const WORD: Record<Unit, [string, string]> = { hours: ['ora', 'ore'], minutes: ['minuto', 'minuti'], seconds: ['secondo', 'secondi'] }

export type PatternValue = { kind: 'any' } | { kind: 'every'; n: number } | { kind: 'at'; n: number }

export function parseValue(v: unknown): PatternValue | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  if (s === '*') return { kind: 'any' }
  let m = /^\/(\d{1,2})$/.exec(s)
  if (m) return { kind: 'every', n: Number(m[1]) }
  m = /^(\d{1,2})$/.exec(s)
  if (m) return { kind: 'at', n: Number(m[1]) }
  return null
}

export interface Pattern {
  hours: PatternValue
  minutes: PatternValue
  seconds: PatternValue
  /** unità scritte nel trigger */
  given: Set<Unit>
}

/** Valori effettivi con i default di Home Assistant; null se il trigger non è interpretabile. */
export function resolvePattern(t: Record<string, unknown>): Pattern | null {
  const given = new Set<Unit>()
  const raw: Partial<Record<Unit, PatternValue>> = {}
  for (const u of UNITS) {
    if (t[u] === undefined || t[u] === null) continue
    const v = parseValue(t[u])
    if (!v) return null
    raw[u] = v
    given.add(u)
  }
  if (!given.size) return null
  let minutes = raw.minutes
  let seconds = raw.seconds
  if (!minutes && raw.hours) minutes = { kind: 'at', n: 0 }
  if (!seconds && minutes) seconds = { kind: 'at', n: 0 }
  return { hours: raw.hours ?? { kind: 'any' }, minutes: minutes ?? { kind: 'any' }, seconds: seconds ?? { kind: 'any' }, given }
}

function count(v: PatternValue, unit: Unit): number {
  if (v.kind === 'any') return RANGE[unit]
  if (v.kind === 'every') return v.n > 0 ? Math.ceil(RANGE[unit] / v.n) : 0
  return v.n < RANGE[unit] ? 1 : 0
}

export function perDay(p: Pattern): number {
  return count(p.hours, 'hours') * count(p.minutes, 'minutes') * count(p.seconds, 'seconds')
}

const two = (n: number) => String(n).padStart(2, '0')

/** Ogni quanti secondi scatta, se è un intervallo regolare (es. "/5" sui minuti → 300). */
export function intervalSeconds(p: Pattern): number | null {
  const { hours: h, minutes: m, seconds: s } = p
  if (h.kind === 'any' && m.kind === 'any' && s.kind === 'any') return 1
  if (h.kind === 'any' && m.kind === 'any' && s.kind === 'every' && 60 % s.n === 0) return s.n
  if (h.kind === 'any' && m.kind === 'any' && s.kind === 'at') return 60
  if (h.kind === 'any' && m.kind === 'every' && 60 % m.n === 0 && s.kind === 'at') return m.n * 60
  if (h.kind === 'any' && m.kind === 'at' && s.kind === 'at') return 3600
  if (h.kind === 'every' && 24 % h.n === 0 && m.kind === 'at' && s.kind === 'at') return h.n * 3600
  if (h.kind === 'at' && m.kind === 'at' && s.kind === 'at') return 86_400
  return null
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function every(n: number, unit: Unit): string {
  return n === 1 ? `ogni ${WORD[unit][0]}` : `ogni ${n} ${WORD[unit][1]}`
}

/** Descrizione a parole, es. "una volta all'ora, alle xx:05:00". */
export function describePattern(p: Pattern): string {
  const { hours: h, minutes: m, seconds: s } = p
  const at = (v: PatternValue) => (v.kind === 'at' ? two(v.n) : 'xx')
  if (h.kind === 'any' && m.kind === 'any' && s.kind === 'any') return 'ogni secondo'
  if (h.kind === 'any' && m.kind === 'any' && s.kind === 'every') return every(s.n, 'seconds')
  if (h.kind === 'any' && m.kind === 'any' && s.kind === 'at') return `una volta al minuto, al secondo ${two(s.n)}`
  if (h.kind === 'any' && m.kind === 'every' && s.kind === 'at') return every(m.n, 'minutes') + (s.n ? ` (al secondo ${two(s.n)})` : '')
  if (h.kind === 'any' && m.kind === 'at' && s.kind === 'at') return `una volta all'ora, alle xx:${two(m.n)}:${two(s.n)}`
  if (h.kind === 'every' && m.kind === 'at' && s.kind === 'at') return `${every(h.n, 'hours')}, ai minuti ${two(m.n)}:${two(s.n)}`
  if (h.kind === 'at' && m.kind === 'at' && s.kind === 'at') return `una volta al giorno, alle ${two(h.n)}:${two(m.n)}:${two(s.n)}`
  const n = perDay(p)
  return `${n} volte al giorno (ore ${at(h)}, minuti ${m.kind === 'every' ? `/${m.n}` : at(m)}, secondi ${s.kind === 'every' ? `/${s.n}` : at(s)})`
}

export interface Hint {
  n: number
  unit: Unit
  /** da dove viene: id del trigger o nome dell'automazione */
  from: 'id' | 'alias'
  text: string
}

const UNIT_WORDS: Array<[RegExp, Unit]> = [
  [/^(s|sec|secs|secondi|secondo|second|seconds)$/, 'seconds'],
  [/^(m|min|mins|minuti|minuto|minute|minutes)$/, 'minutes'],
  [/^(h|ora|ore|hour|hours)$/, 'hours'],
]

function unitOf(word: string): Unit | null {
  for (const [re, u] of UNIT_WORDS) if (re.test(word)) return u
  return null
}

/** Intervallo voluto, se il nome lo dice: id "5min", "10sec"; alias "5 min …" o "… ogni 10 secondi". */
export function intervalHint(triggerId: unknown, alias: string): Hint | null {
  if (typeof triggerId === 'string' || typeof triggerId === 'number') {
    const m = /^\s*(\d{1,3})\s*([a-z]+)\s*$/i.exec(String(triggerId))
    const unit = m ? unitOf(m[2]!.toLowerCase()) : null
    if (m && unit) return { n: Number(m[1]), unit, from: 'id', text: String(triggerId) }
  }
  const m = /(?:^|\bogni\s+)(\d{1,3})\s*(sec|secondi|secondo|min|minuti|minuto|ore|ora)\b/i.exec(alias)
  const unit = m ? unitOf(m[2]!.toLowerCase()) : null
  if (m && unit) return { n: Number(m[1]), unit, from: 'alias', text: m[0].trim() }
  return null
}

/** Pattern per "ogni N <unità>", tenendo i valori esatti più piccoli già scritti (es. il secondo). */
export function everyPattern(n: number, unit: Unit, t: Record<string, unknown>): Record<string, string> | null {
  let value = n
  let u = unit
  if (u === 'seconds' && value >= 60 && value % 60 === 0) {
    value /= 60
    u = 'minutes'
  }
  if (u === 'minutes' && value >= 60 && value % 60 === 0) {
    value /= 60
    u = 'hours'
  }
  if (value < 1 || value >= RANGE[u]) return null
  const out: Record<string, string> = { [u]: `/${value}` }
  for (const smaller of UNITS.slice(UNITS.indexOf(u) + 1)) {
    const v = parseValue(t[smaller])
    if (v?.kind === 'at') out[smaller] = String(v.n)
  }
  return out
}

export interface PatternIssue {
  severity: 'avviso' | 'info'
  title: string
  detail: string
  pattern?: Record<string, string>
  certain: boolean
  label?: string
}

/** Problema di un trigger time_pattern, o null se fa quello che sembra voler fare. */
export function checkTimePattern(t: Record<string, unknown>, alias: string): PatternIssue | null {
  const p = resolvePattern(t)
  if (!p) return null
  const desc = describePattern(p)
  const every1s = p.hours.kind === 'any' && p.minutes.kind === 'any' && (p.seconds.kind === 'any' || (p.seconds.kind === 'every' && p.seconds.n === 1))
  if (every1s) return { severity: 'avviso', title: 'Scatta ogni secondo', detail: `Il time_pattern scatta ${desc}: 86.400 esecuzioni al giorno. Di solito basta un trigger sullo stato dell'entità o un intervallo più lungo.`, certain: false }

  const hint = intervalHint(t.id, alias)
  const interval = intervalSeconds(p)
  if (hint) {
    const wanted = hint.n * (hint.unit === 'hours' ? 3600 : hint.unit === 'minutes' ? 60 : 1)
    if (interval === wanted) return null
    const pattern = everyPattern(hint.n, hint.unit, t)
    if (!pattern) return null
    // Certa se è l'errore classico: il numero giusto sull'unità giusta, senza "/" e senza unità più grandi.
    const written = parseValue(t[hint.unit])
    const certain = written?.kind === 'at' && written.n === hint.n && UNITS.slice(0, UNITS.indexOf(hint.unit)).every((u) => !p.given.has(u))
    const where = hint.from === 'id' ? `l'id del trigger ("${hint.text}")` : `il nome ("${hint.text}")`
    return {
      severity: 'avviso',
      title: `Scatta ${desc}, non ${every(hint.n, hint.unit)}`,
      detail: `${where[0]!.toUpperCase()}${where.slice(1)} fa pensare a ${every(hint.n, hint.unit)}, ma il time_pattern scatta ${desc}. In Home Assistant un numero indica il momento esatto; per un intervallo si scrive "/${hint.n}".`,
      pattern,
      certain,
      label: `${capitalize(every(hint.n, hint.unit))} (${Object.entries(pattern).map(([k, v]) => `${k}: "${v}"`).join(', ')})`,
    }
  }

  // Valore esatto sull'unità più piccola scritta, con le più grandi libere: l'errore classico.
  const smallest = UNITS.filter((u) => p.given.has(u)).at(-1)!
  const written = parseValue(t[smallest])
  const larger = UNITS.slice(0, UNITS.indexOf(smallest))
  if (smallest !== 'hours' && written?.kind === 'at' && written.n >= 1 && larger.every((u) => !p.given.has(u))) {
    // Ogni pochi secondi sarebbe peggio di adesso: lì si spiega e basta.
    const pattern = smallest === 'minutes' || written.n >= 10 ? everyPattern(written.n, smallest, t) : null
    return {
      severity: 'info',
      title: `Scatta ${desc}`,
      detail: `\`${smallest}: "${written.n}"\` vuol dire "al ${WORD[smallest][0]} ${written.n}", cioè ${desc}. Se volevi ${every(written.n, smallest)} si scrive "/${written.n}"; se va bene così, ignora questo avviso.`,
      ...(pattern ? { pattern, label: `${capitalize(every(written.n, smallest))} (${smallest}: "/${written.n}")` } : {}),
      certain: false,
    }
  }
  return null
}
