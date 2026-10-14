import { formatDuration } from '../util/time.ts'
import { hhmm, LocalClock, type DayType } from './clock.ts'
import { SunCalendar } from './sun.ts'
import type { Activity, ActivityEvent, AutomationInfo, Candidate, CandidateKind, Deferred, EntityMeta, Evidence } from './types.ts'

// Motore deterministico di "Suggerisci": trova nello storico i comportamenti ripetuti fatti
// a mano che un'automazione potrebbe fare al posto dell'utente. Tutti i numeri mostrati
// all'utente e passati a Claude nascono qui; Claude scrive solo titolo, spiegazione e YAML.

export interface MinerOptions {
  now: number
  /** Firme scartate dall'utente ("Non mi interessa"). */
  dismissed?: Set<string>
  maxCandidates?: number
}

export interface MinerResult {
  candidates: Candidate[]
  deferred: Deferred[]
  observedDays: number
  dayCounts: Record<DayType, number>
}

// --- Statistica ---------------------------------------------------------------------------

/** Limite inferiore di Wilson (90%): una percentuale su pochi casi vale meno della stessa su molti. */
export function wilsonLower(k: number, n: number, z = 1.645): number {
  if (n <= 0) return 0
  const p = k / n
  const z2 = z * z
  const centre = p + z2 / (2 * n)
  const margin = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  return Math.max(0, (centre - margin) / (1 + z2 / n))
}

export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo)
}

const pct = (x: number) => `${Math.round(x * 100)}%`
const secs = (s: number) => formatDuration(Math.max(0, s) * 1000)
const DOW_SHORT = ['', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom']

// --- Stati ------------------------------------------------------------------------------

const OFF_LIKE = new Set(['off', 'closed', 'locked', 'disarmed', 'docked'])

/** Stato "di arrivo" di un'azione sul dominio, o null se non è un'azione riconoscibile. */
export function actionState(domain: string, s: string): string | null {
  switch (domain) {
    case 'light': case 'switch': case 'fan': case 'input_boolean': case 'siren': case 'humidifier':
      return s === 'on' || s === 'off' ? s : null
    case 'cover': case 'valve':
      return s === 'open' || s === 'closed' ? s : null
    case 'lock':
      return s === 'locked' || s === 'unlocked' ? s : null
    case 'media_player':
      return s === 'off' || s === 'playing' || s === 'on' ? s : null
    case 'climate': case 'water_heater':
      return s
    case 'vacuum':
      return s === 'cleaning' ? s : null
    case 'lawn_mower':
      return s === 'mowing' ? s : null
    case 'scene':
      return 'attivata'
    case 'script':
      return s === 'on' ? 'avviato' : null
    case 'alarm_control_panel':
      return s === 'disarmed' || s.startsWith('armed_') ? s : null
    default:
      return null
  }
}

/** Il dispositivo è "in funzione" (per luci dimenticate, clima acceso…). */
function isRunning(domain: string, s: string): boolean | null {
  switch (domain) {
    case 'light': case 'switch': case 'fan':
      return s === 'on' ? true : s === 'off' ? false : null
    case 'media_player':
      return ['playing', 'on', 'paused', 'buffering'].includes(s) ? true : ['off', 'standby', 'idle'].includes(s) ? false : null
    case 'climate':
      return s === 'off' ? false : true
    default:
      return null
  }
}

const ACTION_LABEL: Record<string, string> = {
  on: 'Accensione', off: 'Spegnimento', open: 'Apertura', closed: 'Chiusura', locked: 'Chiusura a chiave', unlocked: 'Sblocco',
  playing: 'Riproduzione', attivata: 'Attivazione', avviato: 'Avvio', cleaning: 'Pulizia', mowing: 'Taglio erba', disarmed: 'Disinserimento',
}

function actionLabel(domain: string, x: string): string {
  if (ACTION_LABEL[x]) return ACTION_LABEL[x]!
  if (x.startsWith('armed_')) return 'Inserimento allarme'
  if (domain === 'climate' || domain === 'water_heater') return `Modalità ${x}`
  return `Stato ${x}`
}

// --- Antecedenti ----------------------------------------------------------------------------

type AnteClass = 'presenza' | 'assenza' | 'apertura' | 'chiusura' | 'pulsante' | 'arrivo' | 'uscita' | 'media' | 'modo' | 'stato'

/** Finestra (secondi) entro cui un'azione può essere conseguenza dell'antecedente. */
const WINDOW_S: Record<AnteClass, number> = {
  presenza: 120, assenza: 1800, apertura: 180, chiusura: 120, pulsante: 20, arrivo: 900, uscita: 600, media: 180, modo: 120, stato: 300,
}
const MAX_WINDOW_MS = Math.max(...Object.values(WINDOW_S)) * 1000
const PRESENCE = new Set(['motion', 'occupancy', 'presence'])
const OPENING = new Set(['door', 'window', 'opening', 'garage_door'])

interface Ante {
  key: string
  cls: AnteClass
  entity: string
  state: string
}

function antecedentOf(ev: ActivityEvent, meta: EntityMeta): Ante | null {
  const d = meta.domain
  if (d === 'binary_sensor') {
    if (ev.s !== 'on' && ev.s !== 'off') return null
    const dc = meta.deviceClass ?? ''
    const on = ev.s === 'on'
    const cls: AnteClass = PRESENCE.has(dc) ? (on ? 'presenza' : 'assenza') : OPENING.has(dc) ? (on ? 'apertura' : 'chiusura') : 'stato'
    return { key: `${ev.e}=${ev.s}`, cls, entity: ev.e, state: ev.s }
  }
  if (d === 'event') return { key: `${ev.e}=${ev.et ?? '*'}`, cls: 'pulsante', entity: ev.e, state: ev.et ?? '*' }
  if (d === 'person') {
    if (ev.s === 'home') return { key: `${ev.e}=home`, cls: 'arrivo', entity: ev.e, state: 'home' }
    if (ev.s === 'not_home') return { key: `${ev.e}=not_home`, cls: 'uscita', entity: ev.e, state: 'not_home' }
    return null
  }
  if (d === 'media_player') return ev.s === 'playing' || ev.s === 'off' ? { key: `${ev.e}=${ev.s}`, cls: 'media', entity: ev.e, state: ev.s } : null
  if (d === 'input_boolean' || d === 'input_select') return { key: `${ev.e}=${ev.s}`, cls: 'modo', entity: ev.e, state: ev.s }
  return null
}

function anteText(a: Ante, meta: EntityMeta): string {
  switch (a.cls) {
    case 'presenza': return `presenza su "${meta.name}"`
    case 'assenza': return `fine presenza su "${meta.name}"`
    case 'apertura': return `apertura di "${meta.name}"`
    case 'chiusura': return `chiusura di "${meta.name}"`
    case 'pulsante': return `pressione di "${meta.name}"${a.state !== '*' ? ` (${a.state})` : ''}`
    case 'arrivo': return `arrivo a casa di ${meta.name}`
    case 'uscita': return `uscita di casa di ${meta.name}`
    default: return `"${meta.name}" = ${a.state}`
  }
}

// --- Contesto comune -------------------------------------------------------------------------

class Context {
  readonly clock: LocalClock
  readonly sun: SunCalendar
  readonly byEntity = new Map<string, ActivityEvent[]>()
  readonly observed: string[]
  readonly observedSet: Set<string>
  readonly dayType = new Map<string, DayType>()
  readonly dataFrom: number

  constructor(readonly a: Activity, readonly now: number) {
    this.clock = new LocalClock(a.tz, a.country)
    this.sun = new SunCalendar(a.location)
    for (const ev of a.events) {
      let list = this.byEntity.get(ev.e)
      if (!list) this.byEntity.set(ev.e, (list = []))
      list.push(ev)
    }
    // Giorni completi osservati: dal primo giorno con dati (se inizia vicino alla
    // mezzanotte, altrimenti dal successivo) a ieri.
    const first = a.events[0]
    this.dataFrom = first ? Math.max(a.from, first.t) : now
    // Mezzogiorno del primo giorno completo: si avanza di 24 h (±1 h nei cambi d'ora).
    const firstNoon = first ? this.clock.startOfDay(this.dataFrom) + (this.clock.at(this.dataFrom).min < 120 ? 12 : 36) * 3_600_000 : now
    const today = this.clock.at(now).day
    const days: string[] = []
    for (let t = firstNoon; t < now; t += 86_400_000) {
      const lt = this.clock.at(t)
      if (lt.day === today) break
      if (days[days.length - 1] !== lt.day) {
        days.push(lt.day)
        this.dayType.set(lt.day, this.clock.dayType(lt.day, lt.dow))
      }
    }
    this.observed = days
    this.observedSet = new Set(days)
  }

  meta(id: string): EntityMeta {
    return this.a.entities.get(id) ?? { id, domain: id.split('.')[0]!, name: id, areaId: null, areaName: null, deviceClass: null }
  }

  /** Stato dell'entità subito prima di t (null se ignoto). */
  stateBefore(entity: string, t: number): string | null {
    const list = this.byEntity.get(entity)
    if (!list?.length) return null
    let lo = 0
    let hi = list.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (list[mid]!.t < t) {
        ans = mid
        lo = mid + 1
      } else hi = mid - 1
    }
    return ans >= 0 ? list[ans]!.s : null
  }

  lux(areaId: string | null, t: number): number | null {
    if (!areaId) return null
    const m = this.a.lux.get(areaId)?.byHour
    if (!m) return null
    const hour = Math.floor(t / 3_600_000) * 3_600_000
    return m.get(hour) ?? m.get(hour - 3_600_000) ?? null
  }

  example(t: number, text: string): string {
    const lt = this.clock.at(t)
    const [, m, d] = lt.day.split('-')
    return `${DOW_SHORT[lt.dow]} ${d}/${m} ${hhmm(lt.min)} · ${text}`
  }
}

function automationsActingOn(a: Activity, entity: string): AutomationInfo[] {
  return a.automations.filter((x) => x.actionEntities.includes(entity))
}

function relatedSummary(list: AutomationInfo[]) {
  return list.slice(0, 4).map((x) => ({ entity_id: x.entityId, alias: x.alias, stato: x.unavailable ? 'non disponibile' : x.enabled ? 'attiva' : 'disattivata' }))
}

interface Raw extends Omit<Candidate, 'id'> {
  /** entità su cui si agisce (per la diversità) */
  target: string
  /** stesso comportamento (entità=stato, gruppo di giorni) spiegato in più modi: se ne tiene uno */
  behavior: string
}

// --- (b) Associazioni antecedente → azione ------------------------------------------------

interface Feature {
  dark: boolean | null
  lux: number | null
  min: number
}

function mineAssociations(ctx: Context, out: Raw[], deferred: Deferred[]): Set<string> {
  const { a } = ctx
  const antes: Array<{ ev: ActivityEvent; ante: Ante }> = []
  const consequents: Array<{ ev: ActivityEvent; x: string }> = []
  for (const ev of a.events) {
    const meta = ctx.meta(ev.e)
    const ante = antecedentOf(ev, meta)
    if (ante) antes.push({ ev, ante })
    if (ev.c === 'manuale' || ev.c === 'fisico') {
      const x = actionState(meta.domain, ev.s)
      if (x && (meta.domain !== 'input_boolean' || ev.c === 'manuale')) consequents.push({ ev, x })
    }
  }
  // Coppie candidate: per ogni azione, gli antecedenti nella finestra (il più vicino per chiave).
  const pairCount = new Map<string, number>()
  let j = 0
  for (const { ev: c, x } of consequents) {
    while (j < antes.length && antes[j]!.ev.t < c.t) j++
    const seen = new Set<string>()
    for (let i = j - 1; i >= 0; i--) {
      const { ev: av, ante } = antes[i]!
      if (c.t - av.t > MAX_WINDOW_MS) break
      if (c.t - av.t > WINDOW_S[ante.cls] * 1000 || av.e === c.e) continue
      if ((ante.cls === 'assenza' || ante.cls === 'uscita') && !OFF_LIKE.has(x)) continue
      // Arrivare o muoversi e poi spegnere è rimediare a una dimenticanza, non un'abitudine da
      // automatizzare; aprire una finestra e spegnere ha senso solo per il clima.
      if ((ante.cls === 'arrivo' || ante.cls === 'presenza') && OFF_LIKE.has(x)) continue
      if (ante.cls === 'apertura' && OFF_LIKE.has(x) && ctx.meta(c.e).domain !== 'climate') continue
      const key = `${ante.key}>${c.e}=${x}`
      if (seen.has(key)) continue
      seen.add(key)
      pairCount.set(key, (pairCount.get(key) ?? 0) + 1)
    }
  }

  const antesByKey = new Map<string, Array<{ ev: ActivityEvent; ante: Ante }>>()
  for (const x of antes) {
    let l = antesByKey.get(x.ante.key)
    if (!l) antesByKey.set(x.ante.key, (l = []))
    l.push(x)
  }
  const consByTarget = new Map<string, ActivityEvent[]>()
  for (const { ev, x } of consequents) {
    const k = `${ev.e}=${x}`
    let l = consByTarget.get(k)
    if (!l) consByTarget.set(k, (l = []))
    l.push(ev)
  }
  const usedAntecedents = new Set<string>()

  for (const [key, count] of pairCount) {
    if (count < 5) continue
    const [anteKey, target] = key.split('>') as [string, string]
    const eq = target.lastIndexOf('=')
    const cEntity = target.slice(0, eq)
    const x = target.slice(eq + 1)
    const list = antesByKey.get(anteKey)!
    const ante = list[0]!.ante
    const W = WINDOW_S[ante.cls] * 1000
    const cMeta = ctx.meta(cEntity)
    const aMeta = ctx.meta(ante.entity)
    const cEvents = consByTarget.get(target) ?? []
    const scene = cMeta.domain === 'scene' || cMeta.domain === 'script'

    // Occorrenze utili dell'antecedente: raffiche fuse, azione non già nello stato di arrivo.
    const eligible: Array<{ t: number; hit: boolean; delay: number; cause: ActivityEvent['c'] | null; f: Feature }> = []
    let lastKept = -Infinity
    for (const { ev } of list) {
      if (ev.t - lastKept < W) continue
      lastKept = ev.t
      const before = ctx.stateBefore(cEntity, ev.t)
      if (!scene) {
        if (before === null) continue
        if (actionState(cMeta.domain, before) === x) continue
      }
      // prima azione (a mano) sul target entro la finestra
      let lo = 0
      let hi = cEvents.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (cEvents[mid]!.t <= ev.t) lo = mid + 1
        else hi = mid
      }
      const next = cEvents[lo]
      const hit = next !== undefined && next.t - ev.t <= W
      const lt = ctx.clock.at(ev.t)
      eligible.push({
        t: ev.t,
        hit,
        delay: hit ? (next!.t - ev.t) / 1000 : 0,
        cause: hit ? next!.c : null,
        f: { dark: ctx.sun.isDark(lt.day, ev.t), lux: ctx.lux(cMeta.areaId, ev.t), min: lt.min },
      })
    }
    const hits = eligible.filter((e) => e.hit)
    const days = new Set(hits.map((h) => ctx.clock.at(h.t).day))
    if (hits.length < 5 || days.size < 3) continue
    const totalC = cEvents.length

    const base = { n: eligible.length, k: hits.length, w: wilsonLower(hits.length, eligible.length) }
    // Condizione che separa le volte buone dalle altre (buio, luce in stanza, fascia oraria).
    let cond: { tipo: string; descr: string; n: number; k: number; w: number; extra?: Record<string, unknown> } | null = null
    const consider = (tipo: string, descr: string, pred: (f: Feature) => boolean | null, extra?: Record<string, unknown>) => {
      const sub = eligible.filter((e) => pred(e.f) === true)
      const k = sub.filter((e) => e.hit).length
      if (k < 0.85 * hits.length || sub.length === 0) return
      const w = wilsonLower(k, sub.length)
      if (w < base.w + 0.08) return
      if (!cond || w > cond.w) cond = { tipo, descr, n: sub.length, k, w, ...(extra ? { extra } : {}) }
    }
    if (ctx.sun.available) consider('buio', 'col buio (dopo il tramonto o prima dell’alba)', (f) => f.dark)
    const hitLux = hits.map((h) => h.f.lux).filter((v): v is number => v !== null).sort((p, q) => p - q)
    if (hitLux.length >= 5) {
      const raw = quantile(hitLux, 0.9)
      const th = raw <= 20 ? Math.ceil(raw / 5) * 5 : raw <= 200 ? Math.ceil(raw / 10) * 10 : Math.ceil(raw / 50) * 50
      consider('luminosita', `con illuminamento in stanza ≤ ${th} lx`, (f) => (f.lux === null ? null : f.lux <= th), { soglia_lx: th, sensore: a.lux.get(cMeta.areaId ?? '')?.sensor ?? null })
    }
    const mins = hits.map((h) => h.f.min).sort((p, q) => p - q)
    if (mins.length >= 5) {
      // Arco circolare più corto che contiene il 90% delle volte buone.
      const need = Math.ceil(mins.length * 0.9)
      let best: [number, number] | null = null
      for (let i = 0; i < mins.length; i++) {
        const endIdx = i + need - 1
        const end = endIdx < mins.length ? mins[endIdx]! : mins[endIdx - mins.length]! + 1440
        if (!best || end - mins[i]! < best[1] - best[0]) best = [mins[i]!, end]
      }
      if (best && best[1] - best[0] <= 16 * 60) {
        const [s, e] = [Math.floor(best[0] / 15) * 15, Math.ceil(best[1] / 15) * 15]
        consider('orario', `tra le ${hhmm(s)} e le ${hhmm(e)}`, (f) => (e <= 1440 ? f.min >= s && f.min <= e : f.min >= s || f.min <= e - 1440), { dalle: hhmm(s), alle: hhmm(e) })
      }
    }
    const chosen = cond as { tipo: string; descr: string; n: number; k: number; w: number; extra?: Record<string, unknown> } | null
    const final = chosen ?? base
    if (final.w < 0.35) continue

    const delays = hits.map((h) => h.delay).sort((p, q) => p - q)
    const p50 = Math.round(quantile(delays, 0.5))
    const p90 = Math.round(quantile(delays, 0.9))
    const related = a.automations.filter((au) => au.triggerEntities.includes(ante.entity) && au.actionEntities.includes(cEntity))
    const working = related.find((au) => au.enabled && !au.unavailable)
    const title = `${actionLabel(cMeta.domain, x)} di "${cMeta.name}" dopo ${anteText(ante, aMeta)}`
    if (working) {
      deferred.push({ title, automation: working.alias, reason: `Esiste già un'automazione che lo fa, ma è successo a mano ${hits.length} volte: da rivedere in Verifica.` })
      continue
    }
    // Reazione in pochi secondi e senza Home Assistant di mezzo: la gestisce il dispositivo
    // (regola del bridge Hue, binding Zigbee…). Duplicarla in HA creerebbe doppioni.
    if (p90 <= 5 && hits.filter((h) => h.cause === 'fisico').length >= 0.9 * hits.length) {
      deferred.push({ title, automation: '—', reason: `Succede ${hits.length} volte entro ${p90} s senza passare da Home Assistant: la gestisce già il dispositivo o il suo bridge.` })
      continue
    }
    usedAntecedents.add(anteKey)
    const evidence: Evidence[] = [
      { label: 'Volte', value: `${hits.length} su ${base.n} (${pct(hits.length / base.n)})` },
      { label: 'Giorni diversi', value: String(days.size) },
      { label: 'Dopo quanto', value: `di solito ${secs(p50)}, quasi sempre entro ${secs(p90)}` },
    ]
    if (chosen) evidence.push({ label: 'Condizione', value: `${chosen.descr}: ${chosen.k} su ${chosen.n} (${pct(chosen.k / chosen.n)})` })
    if (totalC) evidence.push({ label: 'Azioni a mano spiegate', value: `${pct(Math.min(1, hits.length / totalC))} delle ${totalC} volte` })
    const examples = hits.slice(-3).reverse().map((h) => ctx.example(h.t, `${aMeta.name} → ${cMeta.name} dopo ${secs(h.delay)}`))
    out.push({
      kind: 'associazione',
      signature: `associazione:${key}`,
      title,
      score: Math.round(45 + 25 * Math.min(1, hits.length / 20) + 30 * final.w),
      areaId: cMeta.areaId ?? aMeta.areaId,
      entities: [cEntity, ante.entity],
      evidence,
      examples,
      target: cEntity,
      behavior: `${cEntity}=${x}`,
      dossier: {
        tipo: 'associazione',
        antecedente: { entity_id: ante.entity, nome: aMeta.name, area: aMeta.areaName, dominio: aMeta.domain, classe: aMeta.deviceClass, evento: ante.cls, stato: ante.state },
        azione: { entity_id: cEntity, nome: cMeta.name, area: cMeta.areaName, dominio: cMeta.domain, stato_finale: x },
        numeri: { volte: hits.length, occasioni: base.n, giorni: days.size, precisione: +(hits.length / base.n).toFixed(2), ritardo_p50_s: p50, ritardo_p90_s: p90, azioni_a_mano_totali: totalC },
        ...(chosen ? { condizione: { tipo: chosen.tipo, descrizione: chosen.descr, volte: chosen.k, occasioni: chosen.n, ...(chosen.extra ?? {}) } } : {}),
        ...(related.length ? { automazioni_correlate: relatedSummary(related) } : {}),
      },
    })
  }
  return usedAntecedents
}

// --- (a) Routine orarie e (f) routine esterne ---------------------------------------------

interface Slot {
  day: string
  min: number
  c: ActivityEvent['c']
  t: number
}

function bestWindow(slots: Slot[], width: number): { slots: Slot[]; days: number } | null {
  const sorted = [...slots].sort((p, q) => p.min - q.min)
  let best: { slots: Slot[]; days: number; span: number } | null = null
  const counts = new Map<string, number>()
  let j = 0
  for (let i = 0; i < sorted.length; i++) {
    while (j < sorted.length && sorted[j]!.min - sorted[i]!.min <= width) {
      counts.set(sorted[j]!.day, (counts.get(sorted[j]!.day) ?? 0) + 1)
      j++
    }
    const days = counts.size
    const span = sorted[j - 1]!.min - sorted[i]!.min
    if (!best || days > best.days || (days === best.days && span < best.span)) best = { slots: sorted.slice(i, j), days, span }
    const d = sorted[i]!.day
    const n = (counts.get(d) ?? 1) - 1
    if (n <= 0) counts.delete(d)
    else counts.set(d, n)
  }
  return best ? { slots: best.slots, days: best.days } : null
}

interface RoutineHit {
  group: DayType | 'tutti'
  dayCount: number
  support: number
  reps: Slot[]
}

function mineRoutines(ctx: Context, out: Raw[], deferred: Deferred[]): void {
  const { a } = ctx
  const groups = new Map<string, Slot[]>()
  for (const ev of a.events) {
    if (ev.c !== 'manuale' && ev.c !== 'fisico' && ev.c !== 'sistema') continue
    const meta = ctx.meta(ev.e)
    const x = actionState(meta.domain, ev.s)
    if (!x || meta.domain === 'input_boolean') continue
    const lt = ctx.clock.at(ev.t)
    if (!ctx.observedSet.has(lt.day)) continue
    const k = `${ev.e}=${x}`
    let l = groups.get(k)
    if (!l) groups.set(k, (l = []))
    l.push({ day: lt.day, min: lt.min, c: ev.c, t: ev.t })
  }
  const daysOf: Record<DayType, string[]> = { feriale: [], festivo: [] }
  for (const d of ctx.observed) daysOf[ctx.dayType.get(d)!].push(d)

  for (const [k, slots] of groups) {
    const eq = k.lastIndexOf('=')
    const entity = k.slice(0, eq)
    const x = k.slice(eq + 1)
    const meta = ctx.meta(entity)
    const found: RoutineHit[] = []
    for (const g of ['feriale', 'festivo'] as DayType[]) {
      const days = daysOf[g]
      if (days.length < 3) continue
      const set = new Set(days)
      const w = bestWindow(slots.filter((s) => set.has(s.day)), 45)
      if (!w || w.days < Math.max(3, Math.ceil(0.6 * days.length))) continue
      found.push({ group: g, dayCount: days.length, support: w.days, reps: representatives(w.slots) })
    }
    if (found.length === 0) continue
    let hits = found
    if (found.length === 2 && Math.abs(median(found[0]!.reps) - median(found[1]!.reps)) <= 30) {
      hits = [{ group: 'tutti', dayCount: found[0]!.dayCount + found[1]!.dayCount, support: found[0]!.support + found[1]!.support, reps: [...found[0]!.reps, ...found[1]!.reps] }]
    }
    for (const h of hits) emitRoutine(ctx, out, deferred, entity, x, meta, h)
  }
}

function representatives(slots: Slot[]): Slot[] {
  const center = median(slots)
  const byDay = new Map<string, Slot>()
  for (const s of slots) {
    const cur = byDay.get(s.day)
    if (!cur || Math.abs(s.min - center) < Math.abs(cur.min - center)) byDay.set(s.day, s)
  }
  return [...byDay.values()].sort((p, q) => p.t - q.t)
}

function median(slots: Slot[]): number {
  return quantile(slots.map((s) => s.min).sort((p, q) => p - q), 0.5)
}

const GROUP_LABEL: Record<RoutineHit['group'], string> = { feriale: 'nei giorni feriali', festivo: 'nel fine settimana e nei festivi', tutti: 'tutti i giorni' }

function emitRoutine(ctx: Context, out: Raw[], deferred: Deferred[], entity: string, x: string, meta: EntityMeta, h: RoutineHit): void {
  const mins = h.reps.map((r) => r.min).sort((p, q) => p - q)
  const med = quantile(mins, 0.5)
  const p10 = quantile(mins, 0.1)
  const p90 = quantile(mins, 0.9)
  const causes = { manuale: 0, fisico: 0, sistema: 0 } as Record<string, number>
  for (const r of h.reps) causes[r.c] = (causes[r.c] ?? 0) + 1
  const external = (causes.fisico! + causes.sistema!) / h.reps.length >= 0.8 && p90 - p10 <= 5
  const ratio = h.support / h.dayCount

  // Ancora solare: se rispetto al tramonto (o all'alba) gli orari sono più regolari.
  let anchor: { evento: 'sunset' | 'sunrise'; offset_min: number; dispersione_min: number } | null = null
  if (ctx.sun.available && ['light', 'cover', 'switch'].includes(meta.domain) && p90 - p10 >= 12) {
    for (const ev of ['sunset', 'sunrise'] as const) {
      const offs = h.reps
        .map((r) => {
          const s = ctx.sun.of(r.day)
          return s ? (r.t - (ev === 'sunset' ? s.set : s.rise)) / 60_000 : null
        })
        .filter((v): v is number => v !== null)
        .sort((p, q) => p - q)
      if (offs.length < h.reps.length) continue
      const spread = quantile(offs, 0.9) - quantile(offs, 0.1)
      if (spread < 0.6 * (p90 - p10) && (!anchor || spread < anchor.dispersione_min)) {
        anchor = { evento: ev, offset_min: Math.round(quantile(offs, 0.5)), dispersione_min: Math.round(spread) }
      }
    }
  }

  const covering = automationsActingOn(ctx.a, entity).filter((au) => au.triggerKinds.some((kk) => ['time', 'sun', 'time_pattern', 'calendar', 'blueprint'].includes(kk)))
  const action = actionLabel(meta.domain, x)
  const when = anchor ? `${anchor.evento === 'sunset' ? 'al tramonto' : "all'alba"} (${anchor.offset_min >= 0 ? '+' : ''}${anchor.offset_min} min)` : `verso le ${hhmm(med)}`
  const title = external ? `${action} di "${meta.name}" alle ${hhmm(med)} da un programma esterno` : `${action} di "${meta.name}" ${when} ${GROUP_LABEL[h.group]}`
  const working = covering.find((au) => au.enabled && !au.unavailable)
  if (working && !external) {
    deferred.push({ title, automation: working.alias, reason: `Un'automazione a orario agisce già su questa entità, ma è stato fatto a mano ${h.support} giorni: da rivedere in Verifica.` })
    return
  }
  const evidence: Evidence[] = [
    { label: 'Giorni', value: `${h.support} su ${h.dayCount} ${GROUP_LABEL[h.group]} (${pct(ratio)})` },
    { label: 'Orario', value: `di solito ${hhmm(med)}, tra le ${hhmm(p10)} e le ${hhmm(p90)}` },
    { label: 'Chi lo fa', value: Object.entries(causes).filter(([, n]) => n).map(([c, n]) => `${c === 'manuale' ? 'a mano' : c === 'fisico' ? 'dispositivo/app esterna' : 'strumento esterno'} ${n}`).join(', ') },
  ]
  if (anchor) evidence.push({ label: 'Legato al sole', value: `${anchor.evento === 'sunset' ? 'tramonto' : 'alba'} ${anchor.offset_min >= 0 ? '+' : ''}${anchor.offset_min} min (scarto ${anchor.dispersione_min} min invece di ${Math.round(p90 - p10)})` })
  out.push({
    kind: external ? 'routine_esterna' : 'routine',
    signature: `${external ? 'routine_esterna' : 'routine'}:${entity}=${x}:${h.group}`,
    title,
    score: Math.round(external ? 15 + 20 * ratio : 30 + 35 * ratio + 30 * Math.min(1, h.support / 15)),
    areaId: meta.areaId,
    entities: [entity],
    evidence,
    examples: h.reps.slice(-3).reverse().map((r) => ctx.example(r.t, `${meta.name}: ${action.toLowerCase()}`)),
    target: entity,
    // Una routine "tutti i giorni" copre anche i singoli gruppi.
    behavior: h.group === 'tutti' ? `${entity}=${x}` : `${entity}=${x}:${h.group}`,
    dossier: {
      tipo: external ? 'routine_esterna' : 'routine',
      azione: { entity_id: entity, nome: meta.name, area: meta.areaName, dominio: meta.domain, stato_finale: x },
      giorni: { gruppo: h.group, con_azione: h.support, osservati: h.dayCount },
      orario: { mediana: hhmm(med), p10: hhmm(p10), p90: hhmm(p90) },
      ...(anchor ? { sole: anchor } : {}),
      cause: causes,
      ...(covering.length ? { automazioni_correlate: relatedSummary(covering) } : {}),
      ...(external ? { nota: "Orari quasi identici ogni giorno e nessuna azione da Home Assistant: probabilmente un programma nell'app del dispositivo o di un altro sistema." } : {}),
    },
  })
}

// --- (c) Dispositivi dimenticati accesi ----------------------------------------------------

type Interval = [number, number]

function intervals(ctx: Context, entity: string, pred: (s: string) => boolean | null): Interval[] {
  const list = ctx.byEntity.get(entity) ?? []
  const out: Interval[] = []
  let since: number | null = null
  for (const ev of list) {
    const v = pred(ev.s)
    if (v === true && since === null) since = Math.max(ev.t, ctx.dataFrom)
    else if (v === false && since !== null) {
      out.push([since, ev.t])
      since = null
    }
  }
  if (since !== null) out.push([since, ctx.now])
  return out
}

function awayIntervals(ctx: Context): Interval[] {
  const persons = ctx.a.persons
  if (persons.length === 0) return []
  const state = new Map<string, string | null>(persons.map((p) => [p, null]))
  const evs = ctx.a.events.filter((e) => persons.includes(e.e))
  const out: Interval[] = []
  let since: number | null = null
  for (const ev of evs) {
    state.set(ev.e, ev.s)
    const allAway = [...state.values()].every((s) => s === 'not_home')
    if (allAway && since === null) since = ev.t
    else if (!allAway && since !== null) {
      out.push([since, ev.t])
      since = null
    }
  }
  if (since !== null) out.push([since, ctx.now])
  return out
}

function mineForgotten(ctx: Context, out: Raw[], deferred: Deferred[]): void {
  const away = awayIntervals(ctx)
  const span = Math.max(1, ctx.now - ctx.dataFrom)
  for (const [entity, list] of ctx.byEntity) {
    const meta = ctx.meta(entity)
    if (!['light', 'switch', 'fan', 'media_player', 'climate'].includes(meta.domain) || list.length < 4) continue
    const on = intervals(ctx, entity, (s) => isRunning(meta.domain, s))
    const onFraction = on.reduce((s, [x, y]) => s + (y - x), 0) / span
    if (onFraction > 0.85) continue // sempre acceso: è voluto (frigo, router…)
    const related = automationsActingOn(ctx.a, entity)

    // Accesi con la casa vuota.
    if (away.length) {
      const episodes: Array<{ t: number; ms: number }> = []
      for (const [s1, e1] of on) {
        for (const [s2, e2] of away) {
          const ms = Math.min(e1, e2) - Math.max(s1, s2)
          if (ms >= 20 * 60_000) episodes.push({ t: Math.max(s1, s2), ms })
        }
      }
      const days = new Set(episodes.map((ep) => ctx.clock.at(ep.t).day))
      if (days.size >= 3) {
        const title = `In funzione con la casa vuota: "${meta.name}"`
        const guard = related.find((au) => au.enabled && !au.unavailable && au.triggerEntities.some((t) => t.startsWith('person.') || t.startsWith('zone.') || t.startsWith('group.')))
        if (guard) {
          deferred.push({ title, automation: guard.alias, reason: `Un'automazione legata alla presenza agisce già su questa entità, ma è rimasta accesa ${days.size} volte: da rivedere in Verifica.` })
        } else {
          const durations = episodes.map((ep) => ep.ms).sort((p, q) => p - q)
          const total = durations.reduce((s, v) => s + v, 0)
          out.push({
            kind: 'dimenticata_fuori',
            signature: `dimenticata_fuori:${entity}`,
            title,
            score: Math.round(30 + 40 * Math.min(1, days.size / 7) + 30 * Math.min(1, total / (20 * 3_600_000))),
            areaId: meta.areaId,
            entities: [entity, ...ctx.a.persons],
            evidence: [
              { label: 'Volte', value: `${episodes.length} in ${days.size} giorni diversi` },
              { label: 'Durata tipica', value: `${formatDuration(quantile(durations, 0.5))} (in tutto ${formatDuration(total)})` },
              { label: 'Persone considerate', value: ctx.a.persons.map((p) => ctx.meta(p).name).join(', ') },
            ],
            examples: episodes.slice(-3).reverse().map((ep) => ctx.example(ep.t, `${meta.name} acceso con tutti fuori per ${formatDuration(ep.ms)}`)),
            target: entity,
            behavior: `dimenticata_fuori:${entity}`,
            dossier: {
              tipo: 'dimenticata_fuori',
              azione: { entity_id: entity, nome: meta.name, area: meta.areaName, dominio: meta.domain },
              persone: ctx.a.persons,
              numeri: { volte: episodes.length, giorni: days.size, durata_mediana_min: Math.round(quantile(durations, 0.5) / 60_000), ore_totali: +(total / 3_600_000).toFixed(1), quota_tempo_acceso: +onFraction.toFixed(2) },
              ...(related.length ? { automazioni_correlate: relatedSummary(related) } : {}),
            },
          })
        }
      }
    }

    // Accesi per tutta la notte (alle 03:00 e da almeno 3 ore).
    if (['light', 'media_player', 'fan', 'switch'].includes(meta.domain) && onFraction < 0.6) {
      const nights: Array<{ t: number; end: number; ms: number }> = []
      for (const [s, e] of on) {
        if (e - s < 3 * 3_600_000) continue
        for (let t = ctx.clock.startOfDay(s) + 3 * 3_600_000; t <= e; t += 86_400_000) {
          if (t >= s) {
            nights.push({ t, end: e, ms: e - s })
            break
          }
        }
      }
      const nightDays = new Set(nights.map((n) => ctx.clock.at(n.t).day))
      if (nightDays.size >= 3) {
        const ends = nights.filter((n) => n.end < ctx.now).map((n) => ctx.clock.at(n.end).min).sort((p, q) => p - q)
        const title = `In funzione di notte: "${meta.name}"`
        out.push({
          kind: 'dimenticata_notte',
          signature: `dimenticata_notte:${entity}`,
          title,
          score: Math.round(25 + 40 * Math.min(1, nightDays.size / 7)),
          areaId: meta.areaId,
          entities: [entity],
          evidence: [
            { label: 'Notti', value: `${nightDays.size} (acceso alle 03:00 da almeno 3 ore)` },
            ...(ends.length ? [{ label: 'Spento di solito', value: `verso le ${hhmm(quantile(ends, 0.5))}` }] : []),
            { label: 'Acceso in tutto', value: pct(onFraction) + ' del tempo' },
          ],
          examples: nights.slice(-3).reverse().map((n) => ctx.example(n.end - n.ms, `${meta.name} acceso per ${formatDuration(n.ms)}`)),
          target: entity,
          behavior: `dimenticata_notte:${entity}`,
          dossier: {
            tipo: 'dimenticata_notte',
            azione: { entity_id: entity, nome: meta.name, area: meta.areaName, dominio: meta.domain },
            numeri: { notti: nightDays.size, ...(ends.length ? { spegnimento_mediano: hhmm(quantile(ends, 0.5)) } : {}), quota_tempo_acceso: +onFraction.toFixed(2) },
            ...(related.length ? { automazioni_correlate: relatedSummary(related) } : {}),
          },
        })
      }
    }
  }
}

// --- (d) Pulsanti -----------------------------------------------------------------------------

function mineButtons(ctx: Context, out: Raw[], deferred: Deferred[], usedAntecedents: Set<string>): void {
  const actuatorTimes = ctx.a.events.filter((ev) => actionState(ctx.meta(ev.e).domain, ev.s) !== null && ctx.meta(ev.e).domain !== 'scene').map((ev) => ev.t)
  for (const [entity, list] of ctx.byEntity) {
    const meta = ctx.meta(entity)
    if (meta.domain !== 'event') continue
    if (ctx.a.automations.some((au) => au.triggerEntities.includes(entity))) continue
    const byType = new Map<string, ActivityEvent[]>()
    for (const ev of list) byType.set(ev.et ?? '*', [...(byType.get(ev.et ?? '*') ?? []), ev])
    for (const [et, presses] of byType) {
      if (presses.length < 5 || usedAntecedents.has(`${entity}=${et}`)) continue
      const withEffect = presses.filter((p) => {
        let lo = 0
        let hi = actuatorTimes.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (actuatorTimes[mid]! < p.t) lo = mid + 1
          else hi = mid
        }
        const next = actuatorTimes[lo]
        return next !== undefined && next - p.t <= 20_000
      }).length
      const days = new Set(presses.map((p) => ctx.clock.at(p.t).day))
      const label = `"${meta.name}"${et !== '*' ? ` (${et})` : ''}`
      if (withEffect / presses.length >= 0.5) {
        deferred.push({ title: `Pulsante ${label}`, automation: '—', reason: `Premuto ${presses.length} volte e quasi sempre segue un cambio: lo gestisce già il dispositivo o un altro sistema.` })
        continue
      }
      const nearby = [...ctx.a.entities.values()]
        .filter((e) => e.areaId && e.areaId === meta.areaId && ['light', 'switch', 'cover', 'fan', 'media_player', 'scene'].includes(e.domain))
        .slice(0, 8)
        .map((e) => ({ entity_id: e.id, nome: e.name }))
      out.push({
        kind: 'pulsante',
        signature: `pulsante:${entity}=${et}`,
        title: `Pulsante senza automazione: ${label}`,
        score: Math.round(15 + Math.min(20, presses.length / 2)),
        areaId: meta.areaId,
        entities: [entity],
        evidence: [
          { label: 'Pressioni', value: `${presses.length} in ${days.size} giorni` },
          { label: 'Effetto', value: `nessun cambio entro 20 s nel ${pct(1 - withEffect / presses.length)} dei casi` },
        ],
        examples: presses.slice(-3).reverse().map((p) => ctx.example(p.t, `pressione ${label}`)),
        target: entity,
        behavior: `pulsante:${entity}=${et}`,
        dossier: {
          tipo: 'pulsante',
          pulsante: { entity_id: entity, nome: meta.name, area: meta.areaName, tipo_evento: et },
          numeri: { pressioni: presses.length, giorni: days.size, senza_effetto: +(1 - withEffect / presses.length).toFixed(2) },
          entita_della_stanza: nearby,
        },
      })
    }
  }
}

// --- Selezione --------------------------------------------------------------------------------

export function mine(activity: Activity, opts: MinerOptions): MinerResult {
  const ctx = new Context(activity, opts.now)
  const raw: Raw[] = []
  const deferred: Deferred[] = []
  const used = mineAssociations(ctx, raw, deferred)
  mineRoutines(ctx, raw, deferred)
  mineForgotten(ctx, raw, deferred)
  mineButtons(ctx, raw, deferred, used)

  const dismissed = opts.dismissed ?? new Set<string>()
  const max = opts.maxCandidates ?? 15
  raw.sort((p, q) => q.score - p.score || (p.signature < q.signature ? -1 : 1))
  const perTarget = new Map<string, number>()
  const perArea = new Map<string, number>()
  const behaviors = new Set<string>()
  const chosen: Candidate[] = []
  for (const r of raw) {
    if (dismissed.has(r.signature)) continue
    // Stesso comportamento già scelto (es. associazione e routine sulla stessa accensione).
    const base = r.behavior.split(':')[0]!
    if (behaviors.has(r.behavior) || behaviors.has(base) || [...behaviors].some((b) => b.startsWith(`${r.behavior}:`))) continue
    if ((perTarget.get(r.target) ?? 0) >= 3) continue
    if (r.areaId && (perArea.get(r.areaId) ?? 0) >= 4) continue
    perTarget.set(r.target, (perTarget.get(r.target) ?? 0) + 1)
    if (r.areaId) perArea.set(r.areaId, (perArea.get(r.areaId) ?? 0) + 1)
    behaviors.add(r.behavior)
    const { target: _target, behavior: _behavior, ...rest } = r
    const id = `c${chosen.length + 1}`
    chosen.push({ ...rest, id, dossier: { id, ...rest.dossier } })
    if (chosen.length >= max) break
  }
  const dayCounts: Record<DayType, number> = { feriale: 0, festivo: 0 }
  for (const d of ctx.observed) dayCounts[ctx.dayType.get(d)!] += 1
  return { candidates: chosen, deferred: deferred.slice(0, 30), observedDays: ctx.observed.length, dayCounts }
}

export type { CandidateKind }
