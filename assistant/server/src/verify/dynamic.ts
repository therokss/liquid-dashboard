import { domainOf } from '../inventory/privacy.ts'
import { formatDuration } from '../util/time.ts'
import type { ActivityEvent, Cause } from '../suggest/types.ts'
import type { Draft } from './rules.ts'

// Regole dinamiche dal Registro attività degli ultimi giorni, sulle entità comandate dalle
// automazioni: oscillazioni (V7), automazioni che si contraddicono e correzioni manuali (V8).

const OFF_LIKE = new Set(['off', 'closed', 'standby', 'locked', 'docked', 'idle', 'paused'])
const ON_LIKE = new Set(['on', 'open', 'playing', 'heat', 'cool', 'heat_cool', 'auto', 'dry', 'fan_only', 'unlocked', 'cleaning', 'buffering'])

/** acceso/spento, null per gli stati intermedi o non confrontabili. */
export function polarity(entityId: string, state: string): 'on' | 'off' | null {
  const d = domainOf(entityId)
  if (d === 'media_player' && state === 'idle') return null
  if (OFF_LIKE.has(state)) return 'off'
  if (ON_LIKE.has(state)) return 'on'
  return null
}

export interface DynamicOptions {
  now: number
  days: number
  tz: string
  /** entity_id dell'automazione → chiave stabile (id o entity_id) per le firme */
  keys: Map<string, string>
  names: Map<string, string>
  oscillationWindowMs?: number
  pingPongWindowMs?: number
  manualWindowMs?: number
}

export interface EntityActivity {
  changes: number
  byCause: Partial<Record<Cause, number>>
}

export interface DynamicResult {
  findings: Draft[]
  /** cambi di stato per entità (per l'analisi approfondita) */
  activity: Map<string, EntityActivity>
  /** cambi di stato causati da ogni automazione */
  actions: Map<string, number>
}

function dayKey(t: number, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(t)
}

function bump<K>(m: Map<K, { n: number; days: Set<string>; gaps: number[] }>, k: K, day: string, gap: number): void {
  let v = m.get(k)
  if (!v) m.set(k, (v = { n: 0, days: new Set(), gaps: [] }))
  v.n += 1
  v.days.add(day)
  v.gaps.push(gap)
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? 0
}

export function runDynamicRules(events: ActivityEvent[], opts: DynamicOptions): DynamicResult {
  const oscWin = opts.oscillationWindowMs ?? 120_000
  const pingWin = opts.pingPongWindowMs ?? 60_000
  const manWin = opts.manualWindowMs ?? 10 * 60_000
  const activity = new Map<string, EntityActivity>()
  const actions = new Map<string, number>()
  const flips = new Map<string, { n: number; days: Set<string>; gaps: number[] }>()
  const pingPong = new Map<string, { n: number; days: Set<string>; gaps: number[] }>()
  const reverts = new Map<string, { n: number; days: Set<string>; gaps: number[] }>()
  const byAutomationOnEntity = new Map<string, number>()
  const last = new Map<string, ActivityEvent>()

  for (const ev of events) {
    const a = activity.get(ev.e) ?? { changes: 0, byCause: {} }
    a.changes += 1
    a.byCause[ev.c] = (a.byCause[ev.c] ?? 0) + 1
    activity.set(ev.e, a)
    const fromAutomation = ev.c === 'automazione' && ev.by && opts.keys.has(ev.by)
    if (fromAutomation) {
      actions.set(ev.by!, (actions.get(ev.by!) ?? 0) + 1)
      byAutomationOnEntity.set(`${ev.by}|${ev.e}`, (byAutomationOnEntity.get(`${ev.by}|${ev.e}`) ?? 0) + 1)
    }

    const prev = last.get(ev.e)
    last.set(ev.e, ev)
    if (!prev) continue
    const p0 = polarity(prev.e, prev.s)
    const p1 = polarity(ev.e, ev.s)
    if (!p0 || !p1 || p0 === p1) continue
    const gap = ev.t - prev.t
    const day = dayKey(ev.t, opts.tz)
    const prevAuto = prev.c === 'automazione' && prev.by && opts.keys.has(prev.by) ? prev.by : null
    if (!prevAuto) continue
    if (fromAutomation && ev.by === prevAuto && gap <= oscWin) bump(flips, `${prevAuto}|${ev.e}`, day, gap)
    else if (fromAutomation && ev.by !== prevAuto && gap <= pingWin) bump(pingPong, `${prevAuto}|${ev.by}|${ev.e}`, day, gap)
    else if (ev.c === 'manuale' && gap <= manWin) bump(reverts, `${prevAuto}|${ev.e}|${p0}`, day, gap)
  }

  const findings: Draft[] = []
  const name = (id: string) => opts.names.get(id) ?? id
  const window = `negli ultimi ${opts.days} giorni`

  for (const [k, v] of flips) {
    if (v.n < 10 || v.days.size < 2) continue
    const [auto, entity] = k.split('|') as [string, string]
    findings.push({
      signature: `V7:oscillazione:${opts.keys.get(auto)}:${entity}`,
      rule: 'V7',
      code: 'oscillazione',
      severity: 'avviso',
      automation: auto,
      title: `Accende e spegne ${name(entity)} a ripetizione`,
      detail: `${window[0]!.toUpperCase()}${window.slice(1)} l'automazione ha invertito lo stato di ${entity} ${v.n} volte a meno di ${formatDuration(oscWin)} di distanza (in ${v.days.size} giorni diversi, intervallo tipico ${formatDuration(median(v.gaps))}). Di solito il trigger è troppo sensibile: aggiungi un \`for:\` al trigger o alla condizione (es. presenza assente da qualche minuto) o usa soglie diverse per accendere e spegnere.`,
      refs: [entity],
    })
  }
  for (const [k, v] of pingPong) {
    if (v.n < 3) continue
    const [a, b, entity] = k.split('|') as [string, string, string]
    findings.push({
      signature: `V8:ping_pong:${opts.keys.get(a)}:${entity}:${opts.keys.get(b)}`,
      rule: 'V8',
      code: 'ping_pong',
      severity: 'avviso',
      automation: a,
      title: `In conflitto con "${name(b)}" su ${name(entity)}`,
      detail: `${v.n} volte ${window} questa automazione ha cambiato ${entity} e "${name(b)}" (${b}) l'ha riportata indietro entro ${formatDuration(median(v.gaps))}. Le due automazioni si contraddicono: decidi quale deve prevalere e aggiungi una condizione all'altra.`,
      refs: [entity, b],
    })
  }
  for (const [k, v] of reverts) {
    const [auto, entity, pol] = k.split('|') as [string, string, string]
    const total = byAutomationOnEntity.get(`${auto}|${entity}`) ?? v.n
    const ratio = v.n / Math.max(total, 1)
    if (v.n < 3 || ratio < 0.2) continue
    findings.push({
      signature: `V8:correzioni_manuali:${opts.keys.get(auto)}:${entity}:${pol}`,
      rule: 'V8',
      code: 'correzioni_manuali',
      severity: ratio >= 0.4 ? 'avviso' : 'info',
      automation: auto,
      title: `Corretta a mano: ${name(entity)} ${pol === 'on' ? 'rispenta' : 'riaccesa'} subito dopo`,
      detail: `${v.n} volte su ${total} (${Math.round(ratio * 100)}%) ${window}, dopo che l'automazione ha ${pol === 'on' ? 'acceso' : 'spento'} ${entity} qualcuno l'ha ${pol === 'on' ? 'rispenta' : 'riaccesa'} a mano entro ${formatDuration(median(v.gaps))}. Forse scatta quando non serve: valuta una condizione in più (orario, luminosità, presenza).`,
      refs: [entity],
    })
  }
  return { findings, activity, actions }
}
