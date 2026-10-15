import type { HAReader } from '../ha/data.ts'
import type { HAState, Registries } from '../ha/types.ts'
import type { AutomationWriter } from '../ha/writer.ts'
import { modernize } from '../drafts/automation.ts'
import { isObj, type CheckContext } from '../drafts/checks.ts'
import { entityName } from '../inventory/inventory.ts'
import { buildPrivacyIndex, domainOf, isAllowed, type Consents } from '../inventory/privacy.ts'
import { loadUsers, normalizeEntry, type LogbookEntry, type Progress } from '../suggest/collect.ts'
import type { ActivityEvent, UserKind } from '../suggest/types.ts'
import { toDate } from '../util/time.ts'
import { collectRefs, type AutomationInput, type EntityInfo, type StaticInput, type TraceSummary } from './rules.ts'
import type { AutomationSource } from './types.ts'

// Raccolta per "Verifica": configurazioni (caricata e dell'editor), tracce, statistiche delle
// soglie e Registro attività delle entità comandate. Solo letture, a blocchi.

type Json = Record<string, unknown>

/** Domini con stato acceso/spento confrontabile (oscillazioni e conflitti). */
const TOGGLE_DOMAINS = new Set(['light', 'switch', 'fan', 'cover', 'climate', 'media_player', 'input_boolean', 'lock', 'humidifier', 'vacuum', 'valve', 'siren', 'water_heater'])
/** Domini di trigger e condizioni utili all'analisi approfondita (cambi di stato discreti). */
const CONTEXT_DOMAINS = new Set(['binary_sensor', 'event', 'person', 'input_select', 'select'])
const MAX_LOGGED = 400

export interface VerifyCollectOptions {
  now: Date
  /** giorni di Registro attività per le regole dinamiche */
  days: number
  consents: Consents
  userKinds?: Record<string, UserKind>
  checkContext: () => Promise<CheckContext>
  writer: AutomationWriter | null
  onProgress?: (p: Progress) => void
  signal?: AbortSignal
}

export interface VerifyData {
  input: StaticInput
  tz: string
  states: Map<string, HAState>
  registries: Registries
  events: ActivityEvent[]
  /** entità seguite nel Registro attività */
  logged: string[]
}

function ms(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? v : v * 1000
  return toDate(v)?.getTime() ?? null
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>, onBatch?: (done: number) => void, signal?: AbortSignal): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) {
    if (signal?.aborted) throw new Error('annullata')
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))))
    onBatch?.(Math.min(i + size, items.length))
  }
  return out
}

export async function collectVerify(ha: HAReader, opts: VerifyCollectOptions): Promise<VerifyData> {
  const progress = (phase: string, done = 0, total = 0) => opts.onProgress?.({ phase, done, total })
  const check = () => {
    if (opts.signal?.aborted) throw new Error('annullata')
  }
  progress('Registri e stati')
  const [cfg, registries, states, ctx] = await Promise.all([ha.config(), ha.registries(), ha.states(), opts.checkContext()])
  const tz = cfg.time_zone
  const now = opts.now.getTime()
  const entries = new Map(registries.entities.map((e) => [e.entity_id, e]))

  const entities = new Map<string, EntityInfo>()
  for (const id of new Set([...states.keys(), ...entries.keys()])) {
    const s = states.get(id)
    const e = entries.get(id)
    entities.set(id, { name: entityName(id, e, s), disabled: Boolean(e?.disabled_by), state: s?.state ?? null, lastChanged: s ? (toDate(s.last_changed)?.getTime() ?? null) : null })
  }
  const registryIds = new Map<string, string>()
  for (const e of registries.entities) if (e.registry_id) registryIds.set(e.registry_id, e.entity_id)
  const devices = new Map(registries.devices.map((d) => [d.id, { name: d.name_by_user ?? d.name ?? d.id, disabled: Boolean(d.disabled_by) }]))
  // Id dei dispositivi compositi di prima della 2026.9: HA li risolve ancora sui dispositivi
  // divisi, quindi non sono "inesistenti". Disattivato solo se lo sono tutti i pezzi.
  for (const [id, split] of Object.entries(registries.compositeDevices ?? {})) {
    if (devices.has(id)) continue
    const parts = split.splitIds.map((x) => devices.get(x)).filter((x): x is { name: string; disabled: boolean } => Boolean(x))
    if (!parts.length) continue
    const main = devices.get(split.primaryId ?? '') ?? parts[0]!
    devices.set(id, { name: main.name, disabled: parts.every((p) => p.disabled) })
  }

  // Automazioni: configurazione caricata e, per quelle con id, quella dell'editor (modificabilità).
  const autoStates = [...states.values()].filter((s) => domainOf(s.entity_id) === 'automation').sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1))
  check()
  progress('Configurazioni delle automazioni', 0, autoStates.length)
  const automations: AutomationInput[] = await inBatches(
    autoStates,
    8,
    async (s): Promise<AutomationInput> => {
      const id = typeof s.attributes.id === 'string' && s.attributes.id ? s.attributes.id : null
      const loaded = await ha.call<{ config: Json }>({ type: 'automation/config', entity_id: s.entity_id }).then((r) => (isObj(r?.config) ? r.config : null)).catch(() => null)
      let source: AutomationSource = 'senza_id'
      if (id) {
        const editor = opts.writer ? await opts.writer.getConfig(id).catch(() => undefined) : undefined
        if (editor === undefined) source = loaded && 'use_blueprint' in loaded ? 'blueprint' : 'yaml'
        else if (editor === null) source = 'yaml'
        else source = 'use_blueprint' in editor ? 'blueprint' : 'editor'
      }
      if (loaded && 'use_blueprint' in loaded && source === 'editor') source = 'blueprint'
      return {
        entityId: s.entity_id,
        id,
        alias: entityName(s.entity_id, entries.get(s.entity_id), s),
        state: s.state,
        lastTriggered: ms(s.attributes.last_triggered),
        config: loaded,
        source,
        traces: [],
      }
    },
    (done) => progress('Configurazioni delle automazioni', done, autoStates.length),
    opts.signal,
  )

  // Tracce di tutte le automazioni in una richiesta.
  check()
  progress('Tracce delle esecuzioni')
  const traces = await ha.call<Json[]>({ type: 'trace/list', domain: 'automation' }, 60_000).catch(() => [] as Json[])
  const byItem = new Map<string, TraceSummary[]>()
  for (const t of Array.isArray(traces) ? traces : []) {
    const item = typeof t.item_id === 'string' ? t.item_id : null
    const start = ms(isObj(t.timestamp) ? t.timestamp.start : null)
    if (!item || start === null) continue
    const list = byItem.get(item) ?? []
    list.push({ start, execution: typeof t.script_execution === 'string' ? t.script_execution : null, error: typeof t.error === 'string' ? t.error.slice(0, 500) : null })
    byItem.set(item, list)
  }
  for (const a of automations) if (a.id) a.traces = byItem.get(a.id) ?? []

  // Perché non si caricano: validate_config sulle automazioni non disponibili.
  for (const a of automations) {
    if (a.state !== 'unavailable' || !a.config || 'use_blueprint' in a.config) continue
    const c = modernize(a.config).config
    const msg: Json = { type: 'validate_config', triggers: c.triggers, actions: c.actions }
    if (Array.isArray(c.conditions) && c.conditions.length) msg.conditions = c.conditions
    try {
      const r = await ha.call<Record<string, { valid: boolean; error: string | null }>>(msg, 30_000)
      a.validation = Object.entries(r)
        .filter(([, v]) => v && !v.valid)
        .map(([k, v]) => `${{ triggers: 'Trigger', conditions: 'Condizioni', actions: 'Azioni' }[k] ?? k}: ${v.error ?? 'non validi'}`)
    } catch {
      /* resta il messaggio generico */
    }
  }

  // Statistiche giornaliere (30 giorni) delle entità usate nelle soglie numeric_state.
  const domains = new Set([...entities.keys()].map(domainOf))
  const numeric = new Set<string>()
  const usedBy = new Map<string, Set<string>>()
  for (const a of automations) {
    if (!a.config || 'use_blueprint' in a.config) continue
    const c = modernize(a.config).config
    const findNumeric = (v: unknown, depth: number): void => {
      if (depth > 40) return
      if (Array.isArray(v)) for (const x of v) findNumeric(x, depth + 1)
      else if (isObj(v)) {
        if ((v.trigger === 'numeric_state' || v.platform === 'numeric_state' || v.condition === 'numeric_state') && v.attribute === undefined) {
          for (const id of Array.isArray(v.entity_id) ? v.entity_id : [v.entity_id]) if (typeof id === 'string' && entities.has(id)) numeric.add(id)
        }
        for (const x of Object.values(v)) findNumeric(x, depth + 1)
      }
    }
    findNumeric([c.triggers, c.conditions, c.actions], 0)
    const refs = collectRefs(c, domains)
    for (const [id, sections] of refs.entities) {
      const set = usedBy.get(id) ?? new Set<string>()
      for (const s of sections) set.add(s)
      usedBy.set(id, set)
    }
  }
  const stats = new Map<string, { min: number; max: number; days: number }>()
  if (numeric.size) {
    check()
    progress('Statistiche delle soglie')
    const r = await ha
      .call<Record<string, Array<{ min?: number | null; max?: number | null }>>>(
        { type: 'recorder/statistics_during_period', start_time: new Date(now - 30 * 86_400_000).toISOString(), end_time: opts.now.toISOString(), statistic_ids: [...numeric].sort(), period: 'day', types: ['min', 'max'] },
        60_000,
      )
      .catch(() => ({}) as Record<string, Array<{ min?: number | null; max?: number | null }>>)
    for (const [id, rows] of Object.entries(r)) {
      const mins = rows.map((x) => x.min).filter((x): x is number => typeof x === 'number')
      const maxs = rows.map((x) => x.max).filter((x): x is number => typeof x === 'number')
      if (mins.length && maxs.length) stats.set(id, { min: Math.min(...mins), max: Math.max(...maxs), days: Math.min(mins.length, maxs.length) })
    }
  }

  // Registro attività: entità comandate dalle automazioni (+ antecedenti discreti), privacy applicata.
  const privacy = buildPrivacyIndex(registries.entities)
  const logged = [...usedBy]
    .filter(([id]) => {
      if (!states.has(id) || !isAllowed(id, entries.get(id), privacy, opts.consents)) return false
      return TOGGLE_DOMAINS.has(domainOf(id)) || CONTEXT_DOMAINS.has(domainOf(id))
    })
    .map(([id]) => id)
    .sort()
    .slice(0, MAX_LOGGED)
  const events: ActivityEvent[] = []
  if (logged.length && opts.days > 0) {
    const users = await loadUsers(ha, opts.userKinds)
    const userKinds = new Map(users.map((u) => [u.id, u.kind]))
    const from = now - opts.days * 86_400_000
    const chunks: Array<[number, number]> = []
    for (let s = from; s < now; s += 86_400_000) chunks.push([s, Math.min(s + 86_400_000, now)])
    const wanted = new Set(logged)
    for (let i = 0; i < chunks.length; i++) {
      check()
      progress('Registro attività', i, chunks.length)
      const [s, e] = chunks[i]!
      const rows = await ha.call<LogbookEntry[]>({ type: 'logbook/get_events', start_time: new Date(s).toISOString(), end_time: new Date(e).toISOString(), entity_ids: logged }, 120_000)
      for (const row of Array.isArray(rows) ? rows : []) {
        const ev = normalizeEntry(row, userKinds, opts.consents)
        if (ev && wanted.has(ev.e)) events.push(ev)
      }
    }
    progress('Registro attività', chunks.length, chunks.length)
    events.sort((a, b) => a.t - b.t || (a.e < b.e ? -1 : a.e > b.e ? 1 : 0))
  }

  return { input: { now, automations, ctx, entities, registryIds, devices, stats }, tz, states, registries, events, logged }
}
