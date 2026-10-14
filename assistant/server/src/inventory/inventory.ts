import type { AreaEntry, DeviceEntry, EntityEntry, FloorEntry, HAState, Registries } from '../ha/types.ts'
import { deviceName } from '../ha/types.ts'
import { buildPrivacyIndex, classifyPrivacy, domainOf, PRIVACY_LABELS, type Consents, type PrivacyCategory } from './privacy.ts'

// Inventario compatto della casa per il prompt di sistema: poche centinaia di entità utili
// su migliaia. Regole deterministiche (R1–R6) e rendering stabile byte per byte, così due
// conversazioni sulla stessa casa condividono la prompt cache.

/** R4: integrazioni di infrastruttura, media server e AI che non servono alla domotica. */
export const NOISE_PLATFORMS = new Set([
  'unifi', 'proxmoxve', 'hacs', 'hassio', 'systemmonitor', 'openmediavault', 'tautulli', 'plex', 'qbittorrent',
  'nut', 'watchman', 'cpuspeed', 'backup', 'speedtestdotnet', 'onedrive', 'co2signal', 'waze_travel_time', 'openrgb',
  'music_assistant', 'openai_conversation', 'extended_openai_conversation', 'openai_tts', 'cloud', 'wyoming',
  'google_translate', 'elevenlabs', 'ollama_vision', 'ollama', 'ai_automation_suggester', 'llmvision', 'deepseek',
  'llama', 'openai_response', 'anthropic', 'google_generative_ai_conversation', 'uptime', 'version', 'sun_position',
  'mqtt_room', 'glances', 'pi_hole', 'adguard', 'synology_dsm', 'tailscale', 'github',
])

/** R5a: domini sempre inclusi (azionabili o centrali per le automazioni). */
const ALWAYS_DOMAINS = new Set([
  'light', 'fan', 'climate', 'humidifier', 'vacuum', 'lawn_mower', 'cover', 'lock', 'valve', 'water_heater',
  'alarm_control_panel', 'siren', 'remote', 'event', 'scene', 'script', 'input_boolean', 'input_number',
  'input_select', 'input_text', 'input_datetime', 'input_button', 'timer', 'schedule', 'counter', 'person', 'zone',
  'weather', 'assist_satellite', 'media_player', 'sun',
])

/** R5b: se il dispositivo ha già un'entità "primaria", il suo switch è quasi sempre secondario. */
const PRIMARY_DOMAINS = new Set(['light', 'fan', 'cover', 'climate', 'lock', 'valve', 'media_player', 'vacuum', 'humidifier', 'water_heater', 'lawn_mower'])

const BINARY_CLASSES = new Set([
  'occupancy', 'motion', 'presence', 'door', 'window', 'opening', 'garage_door', 'moisture', 'smoke', 'gas',
  'carbon_monoxide', 'problem', 'power', 'running', 'plug', 'light', 'battery_charging', 'lock', 'safety', 'sound',
  'vibration', 'cold', 'heat', 'tamper',
])

const SENSOR_CLASSES = new Set([
  'temperature', 'humidity', 'illuminance', 'power', 'pressure', 'atmospheric_pressure', 'carbon_dioxide', 'co2',
  'pm25', 'pm10', 'volatile_organic_compounds', 'volatile_organic_compounds_parts', 'moisture', 'enum', 'timestamp',
  'duration', 'water', 'gas',
])

/** Piattaforme "create dall'utente": i loro sensori sono quasi sempre intenzionali. */
const USER_PLATFORMS = new Set([
  'template', 'group', 'utility_meter', 'min_max', 'history_stats', 'statistics', 'raccolta_rifiuti',
  'waste_collection_schedule', 'time_date', 'derivative', 'integration', 'threshold', 'trend', 'filter',
])

export interface InventoryEntity {
  entity_id: string
  domain: string
  name: string
  device_class: string | null
  unit: string | null
  area_id: string | null
  device_id: string | null
  /** Inclusa solo perché usata da automazioni, script o scene (R6). */
  forced: boolean
}

export interface InventoryAutomation {
  entity_id: string
  id: string | null
  alias: string
  enabled: boolean
  category: string | null
}

export interface InventoryStats {
  totalEntities: number
  included: number
  forcedByAutomations: number
  excludedPrivacy: Record<PrivacyCategory, number>
  byDomain: Record<string, number>
  automations: number
}

export interface Inventory {
  entities: InventoryEntity[]
  automations: InventoryAutomation[]
  stats: InventoryStats
}

export interface InventoryInput {
  registries: Registries
  states: Map<string, HAState>
  consents: Consents
  /** entity_id usati da automazioni, script e scene (R6). */
  referenced: Set<string>
}

function attrString(s: HAState | undefined, key: string): string | null {
  const v = s?.attributes[key]
  return typeof v === 'string' && v !== '' ? v : null
}

export function entityName(entityId: string, entry: EntityEntry | undefined, state: HAState | undefined): string {
  return attrString(state, 'friendly_name') ?? entry?.name ?? entry?.original_name ?? entityId
}

/** Decide se un'entità entra nell'inventario per rilevanza (R1–R5), privacy esclusa. */
export function isRelevant(
  entityId: string,
  entry: EntityEntry | undefined,
  state: HAState | undefined,
  devicesWithPrimary: Set<string>,
): boolean {
  const domain = domainOf(entityId)
  if (entry) {
    if (entry.disabled_by) return false // R1
    if (entry.hidden_by) return false // R2
    if (entry.entity_category) return false // R3
    if (NOISE_PLATFORMS.has(entry.platform)) return false // R4
  }
  if (!state) return false // entità senza stato (non caricata): niente da mostrare
  if (ALWAYS_DOMAINS.has(domain)) return true // R5a
  const deviceClass = attrString(state, 'device_class')
  const platform = entry?.platform ?? null
  switch (domain) {
    case 'switch': // R5b
      return !entry?.device_id || !devicesWithPrimary.has(entry.device_id)
    case 'binary_sensor': // R5c
      return !entry || (deviceClass !== null && BINARY_CLASSES.has(deviceClass)) || platform === 'group' || platform === 'template'
    case 'sensor': // R5d
      return !entry || (deviceClass !== null && SENSOR_CLASSES.has(deviceClass)) || (platform !== null && USER_PLATFORMS.has(platform))
    default: // R5e: pulsanti, number, select, update, notify, calendari… fuori
      return false
  }
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function buildInventory(input: InventoryInput): Inventory {
  const { registries, states, consents, referenced } = input
  const entries = new Map(registries.entities.map((e) => [e.entity_id, e]))
  const devices = new Map(registries.devices.map((d) => [d.id, d]))
  const privacy = buildPrivacyIndex(registries.entities)

  const devicesWithPrimary = new Set<string>()
  for (const e of registries.entities) {
    if (e.device_id && !e.disabled_by && PRIMARY_DOMAINS.has(domainOf(e.entity_id))) devicesWithPrimary.add(e.device_id)
  }

  const excludedPrivacy: Record<PrivacyCategory, number> = { posizione: 0, telecamere: 0, appMobile: 0 }
  const allIds = new Set<string>([...entries.keys(), ...states.keys()])
  const included: InventoryEntity[] = []
  let forcedCount = 0

  for (const entityId of allIds) {
    const domain = domainOf(entityId)
    if (domain === 'automation') continue // elencate a parte
    const entry = entries.get(entityId)
    const state = states.get(entityId)
    const cat = classifyPrivacy(entityId, entry, privacy)
    if (cat && !consents[cat]) {
      if (state || !entry?.disabled_by) excludedPrivacy[cat] += 1
      continue
    }
    let forced = false
    if (!isRelevant(entityId, entry, state, devicesWithPrimary)) {
      // R6: anche se "rumorosa", un'entità usata da un'automazione deve essere conosciuta.
      if (!referenced.has(entityId) || !state || entry?.disabled_by) continue
      forced = true
      forcedCount += 1
    }
    const device = entry?.device_id ? devices.get(entry.device_id) : undefined
    included.push({
      entity_id: entityId,
      domain,
      name: entityName(entityId, entry, state),
      device_class: attrString(state, 'device_class'),
      unit: attrString(state, 'unit_of_measurement'),
      area_id: entry?.area_id ?? device?.area_id ?? null,
      device_id: entry?.device_id ?? null,
      forced,
    })
  }
  included.sort((a, b) => cmp(a.entity_id, b.entity_id))

  const categoryNames = new Map(registries.automationCategories.map((c) => [c.category_id, c.name]))
  const automations: InventoryAutomation[] = []
  for (const [entityId, state] of states) {
    if (domainOf(entityId) !== 'automation') continue
    const entry = entries.get(entityId)
    if (entry?.disabled_by) continue
    const catId = entry?.categories.automation
    automations.push({
      entity_id: entityId,
      id: attrString(state, 'id'),
      alias: entityName(entityId, entry, state),
      enabled: state.state !== 'off',
      category: catId ? (categoryNames.get(catId) ?? null) : null,
    })
  }
  automations.sort((a, b) => cmp(a.entity_id, b.entity_id))

  const byDomain: Record<string, number> = {}
  for (const e of included) byDomain[e.domain] = (byDomain[e.domain] ?? 0) + 1

  return {
    entities: included,
    automations,
    stats: {
      totalEntities: allIds.size,
      included: included.length,
      forcedByAutomations: forcedCount,
      excludedPrivacy,
      byDomain: Object.fromEntries(Object.entries(byDomain).sort(([a], [b]) => cmp(a, b))),
      automations: automations.length,
    },
  }
}

// --- Rendering -------------------------------------------------------------------------

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function entityLine(e: InventoryEntity): string {
  const extra = [e.device_class, e.unit].filter(Boolean).join(', ')
  return `${e.entity_id} · ${oneLine(e.name)}${extra ? ` (${extra})` : ''}${e.forced ? ' [usata da automazioni]' : ''}`
}

function deviceLabel(d: DeviceEntry): string {
  const model = [d.manufacturer, d.model].filter(Boolean).map((s) => oneLine(s!)).join(' ')
  return `"${oneLine(deviceName(d))}"${model ? ` (${model})` : ''}`
}

/**
 * Testo dell'inventario: piani → aree → dispositivi → entità, tutto ordinato.
 * Non contiene stati né orari: cambierebbero a ogni turno e romperebbero la cache.
 */
export function renderInventory(inv: Inventory, registries: Registries, consents: Consents): string {
  const areas = new Map<string, AreaEntry>(registries.areas.map((a) => [a.area_id, a]))
  const floors = new Map<string, FloorEntry>(registries.floors.map((f) => [f.floor_id, f]))
  const devices = new Map(registries.devices.map((d) => [d.id, d]))

  // area_id (o '' = senza area) → device_id (o '' = senza dispositivo) → entità
  const tree = new Map<string, Map<string, InventoryEntity[]>>()
  for (const e of inv.entities) {
    const areaKey = e.area_id && areas.has(e.area_id) ? e.area_id : ''
    const devKey = e.device_id && devices.has(e.device_id) ? e.device_id : ''
    let byDev = tree.get(areaKey)
    if (!byDev) tree.set(areaKey, (byDev = new Map()))
    let list = byDev.get(devKey)
    if (!list) byDev.set(devKey, (list = []))
    list.push(e)
  }

  const floorOrder = (id: string | null): [number, string] => {
    const f = id ? floors.get(id) : undefined
    return f ? [f.level ?? 999, f.name] : [10_000, '']
  }
  const areaKeys = [...tree.keys()].sort((a, b) => {
    if (a === '' || b === '') return a === '' ? (b === '' ? 0 : 1) : -1
    const fa = floorOrder(areas.get(a)!.floor_id)
    const fb = floorOrder(areas.get(b)!.floor_id)
    return fa[0] - fb[0] || cmp(fa[1], fb[1]) || cmp(areas.get(a)!.name, areas.get(b)!.name) || cmp(a, b)
  })

  const excluded = (Object.keys(PRIVACY_LABELS) as PrivacyCategory[]).filter((k) => !consents[k]).map((k) => PRIVACY_LABELS[k])
  const out: string[] = []
  out.push(`Entità nell'inventario: ${inv.stats.included} su ${inv.stats.totalEntities} registrate (filtrate per rilevanza; le altre si trovano con cerca_entita).`)
  out.push(excluded.length ? `Escluse per privacy su scelta dell'utente: ${excluded.join('; ')}.` : 'Nessuna categoria esclusa per privacy.')

  let currentFloor: string | null | undefined = undefined
  for (const areaKey of areaKeys) {
    const area = areaKey ? areas.get(areaKey)! : null
    const floorId = area?.floor_id ?? null
    if (floorId !== currentFloor && areaKey !== '') {
      currentFloor = floorId
      const f = floorId ? floors.get(floorId) : undefined
      out.push('', `## Piano: ${f ? oneLine(f.name) : 'non assegnato'}`)
    } else if (areaKey === '') {
      out.push('', '## Fuori dalle aree')
    }
    out.push(area ? `### ${oneLine(area.name)} [area_id: ${area.area_id}]` : '### Senza area')
    const byDev = tree.get(areaKey)!
    const devKeys = [...byDev.keys()].sort((a, b) => {
      if (a === '' || b === '') return a === '' ? (b === '' ? 0 : 1) : -1
      return cmp(deviceName(devices.get(a)!), deviceName(devices.get(b)!)) || cmp(a, b)
    })
    for (const devKey of devKeys) {
      const list = byDev.get(devKey)!
      if (devKey) {
        out.push(`- Dispositivo ${deviceLabel(devices.get(devKey)!)}:`)
        for (const e of list) out.push(`  - ${entityLine(e)}`)
      } else {
        for (const e of list) out.push(`- ${entityLine(e)}`)
      }
    }
  }

  out.push('', `## Automazioni (${inv.automations.length})`)
  for (const a of inv.automations) {
    const parts = [a.entity_id, `"${oneLine(a.alias)}"`, a.id ? `id ${a.id}` : 'senza id (YAML/packages)']
    if (a.category) parts.push(`categoria ${oneLine(a.category)}`)
    if (!a.enabled) parts.push('disattivata')
    out.push(`- ${parts.join(' · ')}`)
  }
  return out.join('\n')
}

// --- R6: entità usate da automazioni, script e scene ------------------------------------

const ENTITY_ID_RE = /\b([a-z_][a-z0-9_]*\.[a-z0-9_]+)\b/g

/** Raccoglie in `out` gli entity_id esistenti citati in qualunque stringa della config. */
export function collectEntityRefs(config: unknown, known: Set<string>, out: Set<string>): void {
  const walk = (v: unknown, depth: number) => {
    if (depth > 30) return
    if (typeof v === 'string') {
      for (const m of v.matchAll(ENTITY_ID_RE)) if (known.has(m[1]!)) out.add(m[1]!)
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1)
    } else if (v && typeof v === 'object') {
      for (const x of Object.values(v)) walk(x, depth + 1)
    }
  }
  walk(config, 0)
}

