import type { HAConnection } from './connection.ts'
import {
  toAreaEntry,
  toDeviceEntry,
  toEntityEntry,
  toFloorEntry,
  type HAConfigInfo,
  type HAState,
  type Registries,
} from './types.ts'
import { log } from '../log.ts'

// Accesso in SOLA LETTURA ai dati di Home Assistant per la chat e (dalla Fase 3) per le analisi.
// Ogni comando passa da un elenco chiuso: la Fase 1 non può modificare nulla per costruzione.

export const READ_TYPES = new Set([
  'get_config',
  'get_states',
  'get_services',
  'config/entity_registry/list',
  'config/device_registry/list',
  'config/area_registry/list',
  'config/floor_registry/list',
  'config/label_registry/list',
  'config/category_registry/list',
  'config_entries/get',
  'automation/config',
  'script/config',
  'search/related',
  'trace/list',
  'logbook/get_events',
  'history/history_during_period',
  'recorder/statistics_during_period',
  'trigger_platforms/subscribe',
  'device_automation/trigger/list',
  'manifest/get',
  'subscribe_events',
  'unsubscribe_events',
])

const REGISTRY_EVENTS = [
  'entity_registry_updated',
  'device_registry_updated',
  'area_registry_updated',
  'floor_registry_updated',
  'label_registry_updated',
  'category_registry_updated',
]

type Json = Record<string, unknown>

/** Interfaccia minima usata dai tool: facile da simulare nei test. */
export interface HAReader {
  config(): Promise<HAConfigInfo>
  registries(): Promise<Registries>
  states(): Promise<Map<string, HAState>>
  call<T = unknown>(msg: Json, timeoutMs?: number): Promise<T>
  /** Primo evento di una sottoscrizione "una tantum" (es. catalogo dei trigger). */
  subscribeOnce(msg: Json, waitMs: number): Promise<unknown>
}

export class HAData implements HAReader {
  private regCache: Promise<Registries> | null = null
  private cfgCache: Promise<HAConfigInfo> | null = null
  private statesCache: { at: number; value: Promise<Map<string, HAState>> } | null = null
  private unsubs: Array<() => Promise<void>> = []

  constructor(
    private readonly conn: Pick<HAConnection, 'sendMessage' | 'subscribe' | 'onState'>,
    private readonly opts: { statesTtlMs?: number } = {},
  ) {}

  /** Invalida le cache a ogni riconnessione e quando cambia un registro. */
  watch(): void {
    this.conn.onState((s) => {
      if (s !== 'connected') return
      this.invalidate()
      void this.subscribeRegistryEvents()
    })
  }

  invalidate(): void {
    this.regCache = null
    this.cfgCache = null
    this.statesCache = null
  }

  private async subscribeRegistryEvents(): Promise<void> {
    this.unsubs = []
    for (const event_type of REGISTRY_EVENTS) {
      try {
        this.unsubs.push(
          await this.conn.subscribe({ type: 'subscribe_events', event_type }, () => {
            this.regCache = null
          }),
        )
      } catch (err) {
        log.warn(`Sottoscrizione a ${event_type} non riuscita`, err instanceof Error ? err.message : err)
      }
    }
  }

  call<T = unknown>(msg: Json, timeoutMs?: number): Promise<T> {
    if (!READ_TYPES.has(String(msg.type))) {
      return Promise.reject(new Error(`Comando non ammesso (sola lettura): ${String(msg.type)}`))
    }
    return this.conn.sendMessage<T>(msg, timeoutMs)
  }

  async subscribeOnce(msg: Json, waitMs: number): Promise<unknown> {
    if (!READ_TYPES.has(String(msg.type))) throw new Error(`Comando non ammesso (sola lettura): ${String(msg.type)}`)
    let first: unknown = undefined
    let got!: () => void
    const arrived = new Promise<void>((r) => (got = r))
    const unsubscribe = await this.conn.subscribe(msg, (ev) => {
      if (first === undefined) {
        first = ev
        got()
      }
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([arrived, new Promise((r) => (timer = setTimeout(r, waitMs)))])
    clearTimeout(timer)
    await unsubscribe().catch(() => undefined)
    return first
  }

  config(): Promise<HAConfigInfo> {
    this.cfgCache ??= this.call<Json>({ type: 'get_config' })
      .then((c) => ({
        location_name: String(c.location_name ?? 'Casa'),
        version: String(c.version ?? ''),
        time_zone: String(c.time_zone ?? 'UTC'),
        language: String(c.language ?? 'it'),
        country: typeof c.country === 'string' ? c.country : null,
        unit_system: (c.unit_system as Record<string, string>) ?? {},
      }))
      .catch((err) => {
        this.cfgCache = null
        throw err
      })
    return this.cfgCache
  }

  registries(): Promise<Registries> {
    this.regCache ??= this.loadRegistries().catch((err) => {
      this.regCache = null
      throw err
    })
    return this.regCache
  }

  private async loadRegistries(): Promise<Registries> {
    const [entities, devices, areas, floors, labels, categories, entries] = await Promise.all([
      this.call<Json[]>({ type: 'config/entity_registry/list' }, 60_000),
      this.call<Json[]>({ type: 'config/device_registry/list' }, 60_000),
      this.call<Json[]>({ type: 'config/area_registry/list' }),
      this.call<Json[]>({ type: 'config/floor_registry/list' }).catch(() => [] as Json[]),
      this.call<Json[]>({ type: 'config/label_registry/list' }).catch(() => [] as Json[]),
      this.call<Json[]>({ type: 'config/category_registry/list', scope: 'automation' }).catch(() => [] as Json[]),
      this.call<Json[]>({ type: 'config_entries/get' }).catch(() => [] as Json[]),
    ])
    return {
      entities: entities.map(toEntityEntry),
      devices: devices.map(toDeviceEntry),
      areas: areas.map(toAreaEntry),
      floors: floors.map(toFloorEntry),
      labels: labels.map((l) => ({ label_id: String(l.label_id), name: String(l.name ?? l.label_id) })),
      automationCategories: categories.map((c) => ({ category_id: String(c.category_id), name: String(c.name ?? c.category_id) })),
      configEntryDomain: Object.fromEntries(entries.map((e) => [String(e.entry_id), String(e.domain)])),
      loadedAt: Date.now(),
    }
  }

  /** Stati correnti, con una memo breve: più tool nello stesso turno non rileggono 5.000 entità. */
  states(): Promise<Map<string, HAState>> {
    const ttl = this.opts.statesTtlMs ?? 5_000
    const now = Date.now()
    if (!this.statesCache || now - this.statesCache.at > ttl) {
      const value = this.call<HAState[]>({ type: 'get_states' }, 60_000).then((list) => new Map(list.map((s) => [s.entity_id, s])))
      value.catch(() => {
        if (this.statesCache?.value === value) this.statesCache = null
      })
      this.statesCache = { at: now, value }
    }
    return this.statesCache.value
  }
}
