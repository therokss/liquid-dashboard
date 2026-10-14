import type { HAReader } from '../ha/data.ts'
import type { HAState, Registries } from '../ha/types.ts'
import { buildInventory, collectEntityRefs } from '../inventory/inventory.ts'
import { domainOf, sanitizeState, type Consents } from '../inventory/privacy.ts'
import { toDate } from '../util/time.ts'
import { LocalClock } from './clock.ts'
import type { Activity, ActivityEvent, AutomationInfo, Cause, EntityMeta, UserInfo, UserKind } from './types.ts'

// Raccolta dei dati per "Suggerisci": Registro attività di HA (logbook) a blocchi di un
// giorno, con i campi context_* che dicono chi ha causato ogni cambio; medie orarie di
// illuminamento; configurazioni delle automazioni per sapere cosa è già automatizzato.
// Solo letture, a blocchi e in sequenza per non appesantire Home Assistant.

/** Domini su cui si agisce (conseguenze). */
export const ACTION_DOMAINS = new Set([
  'light', 'switch', 'fan', 'cover', 'climate', 'media_player', 'lock', 'vacuum', 'humidifier', 'water_heater', 'valve',
  'input_boolean', 'scene', 'script', 'siren', 'lawn_mower', 'alarm_control_panel',
])

/** Classi di binary_sensor utili come antecedenti. */
export const ANTECEDENT_BINARY_CLASSES = new Set([
  'motion', 'occupancy', 'presence', 'door', 'window', 'opening', 'garage_door', 'moisture', 'power', 'running', 'plug',
  'sound', 'vibration',
])

const ANTECEDENT_DOMAINS = new Set(['event', 'person', 'input_select'])

type Json = Record<string, unknown>

export interface LogbookEntry {
  when?: number | string
  entity_id?: string
  state?: string
  attributes?: { event_type?: unknown }
  context_user_id?: string
  context_event_type?: string
  context_entity_id?: string
  context_domain?: string
}

export interface Progress {
  phase: string
  done: number
  total: number
}

export interface CollectOptions {
  days: number
  now: Date
  consents: Consents
  /** Tipo di utente scelto nelle impostazioni (persona o sistema). */
  userKinds?: Record<string, UserKind>
  onProgress?: (p: Progress) => void
  signal?: AbortSignal
}

const VOICE_OR_APP_EVENTS = new Set(['homekit_state_change', 'alexa_smart_home', 'google_assistant_command'])

/** Tipo predefinito di un utente HA: gli utenti di sistema (tranne il Cloud, cioè la voce) sono "sistema". */
export function defaultUserKind(u: { name: string; systemGenerated: boolean }): UserKind {
  if (/cloud/i.test(u.name)) return 'persona'
  if (u.systemGenerated) return 'sistema'
  return /node.?red|\bmcp\b|ha-mcp|openclaw|\bbot\b|\bapi\b|integrazion|automat/i.test(u.name) ? 'sistema' : 'persona'
}

export async function loadUsers(ha: HAReader, overrides: Record<string, UserKind> = {}): Promise<UserInfo[]> {
  const list = await ha.call<Json[]>({ type: 'config/auth/list' }, 15_000).catch(() => [] as Json[])
  return list
    .filter((u) => u.is_active !== false)
    .map((u) => {
      const name = String(u.name ?? u.username ?? 'Utente')
      const systemGenerated = u.system_generated === true
      const id = String(u.id)
      const override = overrides[id]
      return { id, name, systemGenerated, kind: override ?? defaultUserKind({ name, systemGenerated }), overridden: Boolean(override) }
    })
    .sort((a, b) => Number(a.systemGenerated) - Number(b.systemGenerated) || a.name.localeCompare(b.name))
}

/** Causa di un cambio di stato dai campi context_* del Registro attività. */
export function classifyCause(entry: LogbookEntry, users: Map<string, UserKind>): { c: Cause; by?: string } {
  const evType = entry.context_event_type
  if (evType === 'automation_triggered') return { c: 'automazione', ...(entry.context_entity_id ? { by: entry.context_entity_id } : {}) }
  if (evType === 'script_started') return { c: 'script', ...(entry.context_entity_id ? { by: entry.context_entity_id } : {}) }
  if (entry.context_user_id) {
    const kind = users.get(entry.context_user_id) ?? 'persona'
    return { c: kind === 'sistema' ? 'sistema' : 'manuale', by: entry.context_user_id }
  }
  if (evType && VOICE_OR_APP_EVENTS.has(evType)) return { c: 'manuale', by: entry.context_domain ?? evType }
  if (entry.context_entity_id) return { c: 'altro', by: entry.context_entity_id }
  if (evType) return { c: 'altro', by: entry.context_domain ?? evType }
  return { c: 'fisico' }
}

/** Entità da seguire: inventario (privacy e rilevanza già applicate) ristretto ai domini utili. */
export function selectEntities(registries: Registries, states: Map<string, HAState>, consents: Consents): Map<string, EntityMeta> {
  const inv = buildInventory({ registries, states, consents, referenced: new Set() })
  const areas = new Map(registries.areas.map((a) => [a.area_id, a.name]))
  const out = new Map<string, EntityMeta>()
  for (const e of inv.entities) {
    const useful =
      ACTION_DOMAINS.has(e.domain) ||
      ANTECEDENT_DOMAINS.has(e.domain) ||
      (e.domain === 'binary_sensor' && e.device_class !== null && ANTECEDENT_BINARY_CLASSES.has(e.device_class)) ||
      (e.domain === 'sensor' && e.device_class === 'illuminance')
    if (!useful) continue
    out.set(e.entity_id, {
      id: e.entity_id,
      domain: e.domain,
      name: e.name,
      areaId: e.area_id,
      areaName: e.area_id ? (areas.get(e.area_id) ?? null) : null,
      deviceClass: e.device_class,
    })
  }
  return out
}

function idsUnder(v: unknown, key: string, out: Set<string>, depth = 0): void {
  if (depth > 30 || !v || typeof v !== 'object') return
  if (Array.isArray(v)) {
    for (const x of v) idsUnder(x, key, out, depth + 1)
    return
  }
  for (const [k, x] of Object.entries(v)) {
    if (k === key) {
      if (typeof x === 'string') out.add(x)
      else if (Array.isArray(x)) for (const y of x) if (typeof y === 'string') out.add(y)
    } else {
      idsUnder(x, key, out, depth + 1)
    }
  }
}

/** Indice delle automazioni: entità nei trigger, nelle condizioni e nelle azioni (aree e dispositivi espansi). */
export async function automationIndex(ha: HAReader, registries: Registries, states: Map<string, HAState>, onBatch?: (done: number, total: number) => void, signal?: AbortSignal): Promise<AutomationInfo[]> {
  const known = new Set(states.keys())
  const entries = new Map(registries.entities.map((e) => [e.entity_id, e]))
  const deviceArea = new Map(registries.devices.map((d) => [d.id, d.area_id]))
  const byArea = new Map<string, string[]>()
  const byDevice = new Map<string, string[]>()
  for (const e of registries.entities) {
    if (e.disabled_by) continue
    const area = e.area_id ?? (e.device_id ? deviceArea.get(e.device_id) ?? null : null)
    if (area) byArea.set(area, [...(byArea.get(area) ?? []), e.entity_id])
    if (e.device_id) byDevice.set(e.device_id, [...(byDevice.get(e.device_id) ?? []), e.entity_id])
  }
  const refs = (part: unknown, expand: boolean): string[] => {
    const out = new Set<string>()
    collectEntityRefs(part, known, out)
    if (expand) {
      const areas = new Set<string>()
      const devices = new Set<string>()
      idsUnder(part, 'area_id', areas)
      idsUnder(part, 'device_id', devices)
      for (const a of areas) for (const id of byArea.get(a) ?? []) out.add(id)
      for (const d of devices) for (const id of byDevice.get(d) ?? []) out.add(id)
    } else {
      const devices = new Set<string>()
      idsUnder(part, 'device_id', devices)
      for (const d of devices) for (const id of byDevice.get(d) ?? []) out.add(id)
    }
    return [...out].sort()
  }

  const targets = [...states.values()].filter((s) => domainOf(s.entity_id) === 'automation' && !entries.get(s.entity_id)?.disabled_by)
  const out: AutomationInfo[] = []
  for (let i = 0; i < targets.length; i += 8) {
    if (signal?.aborted) throw new Error('annullata')
    const batch = targets.slice(i, i + 8)
    const configs = await Promise.all(batch.map((s) => ha.call<{ config: Json }>({ type: 'automation/config', entity_id: s.entity_id }).catch(() => null)))
    batch.forEach((s, j) => {
      const config = configs[j]?.config ?? {}
      const blueprint = 'use_blueprint' in config
      const triggers = (config.triggers ?? config.trigger ?? []) as unknown
      const kinds = new Set<string>()
      for (const t of Array.isArray(triggers) ? triggers : [triggers]) {
        if (t && typeof t === 'object') {
          const k = (t as Json).trigger ?? (t as Json).platform
          if (typeof k === 'string') kinds.add(k)
        }
      }
      // Da blueprint: non si sa cosa sia trigger o azione, si considera tutto entrambi.
      const all = blueprint ? refs(config, true) : []
      out.push({
        entityId: s.entity_id,
        id: typeof s.attributes.id === 'string' ? s.attributes.id : null,
        alias: typeof s.attributes.friendly_name === 'string' ? s.attributes.friendly_name : s.entity_id,
        enabled: s.state === 'on',
        unavailable: s.state === 'unavailable',
        triggerEntities: blueprint ? all : refs(triggers, false),
        conditionEntities: blueprint ? [] : refs(config.conditions ?? config.condition ?? [], false),
        actionEntities: blueprint ? all : refs(config.actions ?? config.action ?? [], true),
        triggerKinds: blueprint ? ['blueprint'] : [...kinds].sort(),
      })
    })
    onBatch?.(Math.min(i + 8, targets.length), targets.length)
  }
  return out
}

function whenMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 1000)
  return toDate(v)?.getTime() ?? null
}

/** Voce del Registro attività → evento normalizzato (null se non è un cambio di stato utile). */
export function normalizeEntry(entry: LogbookEntry, users: Map<string, UserKind>, consents: Consents): ActivityEvent | null {
  const t = whenMs(entry.when)
  if (t === null || typeof entry.entity_id !== 'string' || typeof entry.state !== 'string') return null
  if (entry.state === 'unavailable' || entry.state === 'unknown') return null
  const cause = classifyCause(entry, users)
  const ev: ActivityEvent = { t, e: entry.entity_id, s: sanitizeState(entry.entity_id, entry.state, consents), ...cause }
  const et = entry.attributes?.event_type
  if (typeof et === 'string' && et) ev.et = et.slice(0, 60)
  return ev
}

async function luxSeries(ha: HAReader, entities: Map<string, EntityMeta>, from: number, to: number): Promise<Activity['lux']> {
  const byArea = new Map<string, string>()
  for (const e of entities.values()) if (e.deviceClass === 'illuminance' && e.areaId && !byArea.has(e.areaId)) byArea.set(e.areaId, e.id)
  const out: Activity['lux'] = new Map()
  if (byArea.size === 0) return out
  const ids = [...new Set(byArea.values())]
  const r = await ha
    .call<Record<string, Array<{ start: unknown; mean?: number | null }>>>(
      { type: 'recorder/statistics_during_period', start_time: new Date(from).toISOString(), end_time: new Date(to).toISOString(), statistic_ids: ids, period: 'hour', types: ['mean'] },
      60_000,
    )
    .catch(() => ({}) as Record<string, Array<{ start: unknown; mean?: number | null }>>)
  for (const [area, id] of byArea) {
    const rows = r[id]
    if (!rows?.length) continue
    const m = new Map<number, number>()
    for (const row of rows) {
      const start = typeof row.start === 'number' ? row.start : toDate(row.start)?.getTime()
      if (start !== undefined && typeof row.mean === 'number') m.set(start, row.mean)
    }
    if (m.size) out.set(area, { sensor: id, byHour: m })
  }
  return out
}

export async function collectActivity(ha: HAReader, opts: CollectOptions): Promise<Activity> {
  const progress = (phase: string, done = 0, total = 0) => opts.onProgress?.({ phase, done, total })
  const check = () => {
    if (opts.signal?.aborted) throw new Error('annullata')
  }
  progress('Registri e configurazione')
  const [raw, registries, states] = await Promise.all([ha.call<Json>({ type: 'get_config' }), ha.registries(), ha.states()])
  const tz = typeof raw.time_zone === 'string' ? raw.time_zone : 'UTC'
  const country = typeof raw.country === 'string' ? raw.country : null
  const lat = Number(raw.latitude)
  const lon = Number(raw.longitude)
  const location = Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0) ? { lat, lon } : null
  const users = await loadUsers(ha, opts.userKinds)
  const userKinds = new Map(users.map((u) => [u.id, u.kind]))

  const entities = selectEntities(registries, states, opts.consents)
  check()
  progress('Automazioni esistenti', 0, 1)
  const automations = await automationIndex(ha, registries, states, (d, tot) => progress('Automazioni esistenti', d, tot), opts.signal)

  // Finestra: da mezzanotte di N giorni fa ad adesso, un giorno per richiesta.
  const clock = new LocalClock(tz, country)
  const to = opts.now.getTime()
  const from = clock.startOfDay(to - opts.days * 86_400_000)
  const logged = [...entities.values()].filter((e) => e.domain !== 'sensor').map((e) => e.id).sort()
  const events: ActivityEvent[] = []
  const chunks: Array<[number, number]> = []
  for (let s = from; s < to; s += 86_400_000) chunks.push([s, Math.min(s + 86_400_000, to)])
  for (let i = 0; i < chunks.length; i++) {
    check()
    progress('Registro attività', i, chunks.length)
    const [s, e] = chunks[i]!
    const rows = await ha.call<LogbookEntry[]>(
      { type: 'logbook/get_events', start_time: new Date(s).toISOString(), end_time: new Date(e).toISOString(), entity_ids: logged },
      120_000,
    )
    for (const row of Array.isArray(rows) ? rows : []) {
      const ev = normalizeEntry(row, userKinds, opts.consents)
      if (ev && entities.has(ev.e)) events.push(ev)
    }
  }
  progress('Registro attività', chunks.length, chunks.length)
  events.sort((a, b) => a.t - b.t || (a.e < b.e ? -1 : a.e > b.e ? 1 : 0))

  check()
  progress('Luminosità per stanza')
  const lux = await luxSeries(ha, entities, from, to)

  const byCause: Record<Cause, number> = { manuale: 0, automazione: 0, script: 0, sistema: 0, fisico: 0, altro: 0 }
  for (const ev of events) byCause[ev.c] += 1
  return {
    from,
    to,
    tz,
    country,
    location,
    entities,
    events,
    automations,
    lux,
    persons: [...entities.values()].filter((e) => e.domain === 'person').map((e) => e.id),
    stats: {
      entities: logged.length,
      events: events.length,
      byCause,
      firstDay: events.length ? clock.at(events[0]!.t).day : null,
      requestedDays: opts.days,
      luxAreas: lux.size,
      automations: automations.length,
    },
  }
}
