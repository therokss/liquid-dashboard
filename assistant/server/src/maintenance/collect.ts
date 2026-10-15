import type { HAReader } from '../ha/data.ts'
import type { Registries } from '../ha/types.ts'
import { toSamples } from '../claude/tools/history.ts'
import { domainOf } from '../inventory/privacy.ts'
import { loadManifests, type Manifest } from '../devices/catalog.ts'
import { OFFLINE_DAYS, offlineCandidates, type MaintenanceInput } from './rules.ts'
import type { ConfigEntryInfo, ReauthFlow } from './types.ts'

// Raccolta dei dati per la Manutenzione: registri, stati, integrazioni e, solo per i dispositivi
// che adesso non rispondono, lo storico (quando hanno dato l'ultimo segno di vita).

const DAY = 86_400_000
const HISTORY_BATCH = 100
const INVALID = new Set(['unavailable', 'unknown', ''])
/** Oltre lo storico: le statistiche a lungo termine dei sensori numerici vanno indietro di anni. */
const STATISTICS_DAYS = 365

type Json = Record<string, unknown>

export function toConfigEntries(raw: Json[]): ConfigEntryInfo[] {
  const str = (v: unknown) => (typeof v === 'string' && v !== '' ? v : null)
  return raw
    .filter((e) => str(e.entry_id) && str(e.domain))
    .map((e) => ({
      entryId: String(e.entry_id),
      domain: String(e.domain),
      title: str(e.title) ?? '',
      state: str(e.state) ?? 'loaded',
      reason: str(e.reason),
      disabled: Boolean(e.disabled_by),
      supportsRemoveDevice: e.supports_remove_device === true,
      source: str(e.source),
    }))
}

export function toReauthFlows(raw: Json[]): ReauthFlow[] {
  return raw
    .filter((f) => (f.context as Json | undefined)?.source === 'reauth' && typeof f.handler === 'string')
    .map((f) => {
      const id = (f.context as Json).entry_id
      return { domain: String(f.handler), entryId: typeof id === 'string' ? id : null }
    })
}

function ms(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v > 1e12 ? v : v * 1000
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : t
  }
  return null
}

/** Fine dell'ultimo periodo con uno stato valido (fino al cambio successivo), o null. */
export function lastValidEnd(rows: unknown[], now: number): number | null {
  const samples = toSamples(rows)
  let last: number | null = null
  samples.forEach((x, i) => {
    if (INVALID.has(x.s)) return
    last = samples[i + 1]?.t ?? now
  })
  return last
}

export interface Collected {
  input: MaintenanceInput
  durationMs: number
}

export async function collectMaintenance(ha: HAReader, manifests: Map<string, Manifest>, now: number = Date.now()): Promise<Collected> {
  const started = Date.now()
  const [registries, states, rawEntries, rawFlows] = await Promise.all([
    ha.registries(),
    ha.states(),
    ha.call<Json[]>({ type: 'config_entries/get' }, 30_000).catch(() => [] as Json[]),
    ha.call<Json[]>({ type: 'config_entries/flow/progress' }, 30_000).catch(() => [] as Json[]),
  ])
  const entries = toConfigEntries(Array.isArray(rawEntries) ? rawEntries : [])
  const reauth = toReauthFlows(Array.isArray(rawFlows) ? rawFlows : [])
  const missing = [...new Set(entries.map((e) => e.domain))].filter((d) => !manifests.has(d))
  if (missing.length) for (const [d, m] of await loadManifests(ha, missing)) manifests.set(d, m)

  const base = { now, registries, states, entries, reauth, manifests }
  const candidates = offlineCandidates(base)
  const start = now - OFFLINE_DAYS * DAY
  const coverageDays = candidates.size ? await coverage(ha, start, now) : OFFLINE_DAYS
  const lastValid = new Map<string, number | null>()
  const ids = [...new Set([...candidates.values()].flat())]
  for (let i = 0; i < ids.length; i += HISTORY_BATCH) {
    const batch = ids.slice(i, i + HISTORY_BATCH)
    const r = await ha.call<Record<string, unknown[]>>(
      {
        type: 'history/history_during_period',
        start_time: new Date(start).toISOString(),
        end_time: new Date(now).toISOString(),
        entity_ids: batch,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      },
      120_000,
    )
    for (const id of batch) lastValid.set(id, lastValidEnd(r?.[id] ?? [], now))
  }
  await fromStatistics(ha, registries, candidates, lastValid, now)
  return { input: { ...base, lastValid, coverageDays }, durationMs: Date.now() - started }
}

/** Giorni di storico disponibili: il primo stato di sun.sun (c'è in ogni casa e cambia ogni giorno). */
async function coverage(ha: HAReader, start: number, now: number): Promise<number> {
  try {
    const r = await ha.call<Record<string, unknown[]>>({
      type: 'history/history_during_period',
      start_time: new Date(start).toISOString(),
      end_time: new Date(now).toISOString(),
      entity_ids: ['sun.sun'],
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false,
    })
    const first = toSamples(r?.['sun.sun'] ?? [])[0]
    return first ? Math.min(OFFLINE_DAYS, Math.floor((now - Math.max(first.t, start)) / DAY)) : 0
  } catch {
    return 0
  }
}

/**
 * Per i dispositivi senza dati nello storico: l'ultima statistica giornaliera dei loro sensori
 * numerici (anche diagnostici, come la batteria) dice da quanto tempo tacciono, oltre i 30 giorni.
 */
async function fromStatistics(ha: HAReader, registries: Registries, candidates: Map<string, string[]>, lastValid: Map<string, number | null>, now: number): Promise<void> {
  const silent = [...candidates].filter(([, ids]) => ids.every((id) => lastValid.get(id) === null))
  if (!silent.length) return
  const byDevice = new Map<string, string[]>()
  for (const e of registries.entities) {
    if (e.device_id && !e.disabled_by && domainOf(e.entity_id) === 'sensor') byDevice.set(e.device_id, [...(byDevice.get(e.device_id) ?? []), e.entity_id])
  }
  const sensors = silent.flatMap(([deviceId]) => byDevice.get(deviceId) ?? [])
  if (!sensors.length) return
  const last = new Map<string, number>()
  for (let i = 0; i < sensors.length; i += HISTORY_BATCH) {
    const batch = sensors.slice(i, i + HISTORY_BATCH)
    const r = await ha
      .call<Record<string, unknown[]>>(
        {
          type: 'recorder/statistics_during_period',
          start_time: new Date(now - STATISTICS_DAYS * DAY).toISOString(),
          end_time: new Date(now).toISOString(),
          statistic_ids: batch,
          period: 'day',
          types: ['mean', 'state'],
        },
        120_000,
      )
      .catch(() => ({}) as Record<string, unknown[]>)
    for (const id of batch) {
      const ends = (r[id] ?? []).map((row) => ms((row as Json)?.end)).filter((x): x is number => x !== null)
      if (ends.length) last.set(id, Math.max(...ends))
    }
  }
  for (const [deviceId, ids] of silent) {
    const ends = (byDevice.get(deviceId) ?? []).map((id) => last.get(id)).filter((x): x is number => x !== undefined)
    if (!ends.length) continue
    // Il dispositivo ha taciuto da quando l'ultima statistica si è chiusa: vale per tutte le sue entità.
    const end = Math.min(now, Math.max(...ends))
    for (const id of ids) lastValid.set(id, end)
  }
}
