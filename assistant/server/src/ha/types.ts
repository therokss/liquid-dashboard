// Forme (parziali) dei dati restituiti dalle API WebSocket di Home Assistant 2026.x.
// Solo i campi che l'add-on usa: il resto viene ignorato.

export interface HAState {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_changed: string
  last_updated: string
}

export interface EntityEntry {
  entity_id: string
  /** id interno del registro (uuid): lo usano trigger, condizioni e azioni di tipo "device". */
  registry_id: string | null
  platform: string
  device_id: string | null
  area_id: string | null
  disabled_by: string | null
  hidden_by: string | null
  entity_category: string | null
  name: string | null
  original_name: string | null
  labels: string[]
  categories: Record<string, string>
  /** integrazione che fornisce l'entità (null per quelle definite in YAML) */
  config_entry_id?: string | null
}

export interface DeviceEntry {
  id: string
  name: string | null
  name_by_user: string | null
  manufacturer: string | null
  model: string | null
  model_id: string | null
  area_id: string | null
  disabled_by: string | null
  entry_type: string | null
  primary_config_entry: string | null
  config_entries: string[]
  via_device_id: string | null
  sw_version: string | null
  labels: string[]
  /** Dispositivo "figlio" (HA 2026.9+): senza produttore e modello, appartiene al padre. */
  parent_device_id?: string | null
}

/** HA 2026.9 ha diviso i dispositivi condivisi da più integrazioni: id vecchio → dispositivi nuovi. */
export interface CompositeSplit {
  splitIds: string[]
  primaryId: string | null
}

export interface AreaEntry {
  area_id: string
  name: string
  floor_id: string | null
  aliases: string[]
}

export interface FloorEntry {
  floor_id: string
  name: string
  level: number | null
}

export interface LabelEntry {
  label_id: string
  name: string
}

export interface CategoryEntry {
  category_id: string
  name: string
}

export interface ConfigEntryLite {
  entry_id: string
  domain: string
}

export interface HAConfigInfo {
  location_name: string
  version: string
  time_zone: string
  language: string
  country: string | null
  unit_system: Record<string, string>
}

export interface Registries {
  entities: EntityEntry[]
  devices: DeviceEntry[]
  areas: AreaEntry[]
  floors: FloorEntry[]
  labels: LabelEntry[]
  /** Categorie con scope "automation". */
  automationCategories: CategoryEntry[]
  /** entry_id → dominio dell'integrazione (mai il titolo: può contenere email o nomi). */
  configEntryDomain: Record<string, string>
  /** Id dei vecchi dispositivi compositi (ancora validi nelle automazioni) → dispositivi divisi. */
  compositeDevices?: Record<string, CompositeSplit>
  loadedAt: number
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// Normalizzatori: i registri arrivano con molti campi in più (anche sensibili, come
// connections/MAC e serial_number dei dispositivi) che non devono proseguire oltre.

export function toEntityEntry(raw: Record<string, unknown>): EntityEntry {
  const cats = raw.categories && typeof raw.categories === 'object' ? (raw.categories as Record<string, unknown>) : {}
  return {
    entity_id: String(raw.entity_id),
    registry_id: str(raw.id),
    platform: String(raw.platform ?? ''),
    device_id: str(raw.device_id),
    area_id: str(raw.area_id),
    disabled_by: str(raw.disabled_by),
    hidden_by: str(raw.hidden_by),
    entity_category: str(raw.entity_category),
    name: str(raw.name),
    original_name: str(raw.original_name),
    labels: strList(raw.labels),
    categories: Object.fromEntries(Object.entries(cats).filter(([, v]) => typeof v === 'string')) as Record<string, string>,
    config_entry_id: str(raw.config_entry_id),
  }
}

export function toDeviceEntry(raw: Record<string, unknown>): DeviceEntry {
  return {
    id: String(raw.id),
    name: str(raw.name),
    name_by_user: str(raw.name_by_user),
    manufacturer: str(raw.manufacturer),
    model: str(raw.model),
    model_id: str(raw.model_id),
    area_id: str(raw.area_id),
    disabled_by: str(raw.disabled_by),
    entry_type: str(raw.entry_type),
    // Dalla 2026.9 ogni dispositivo ha una sola integrazione (config_entry_id); i campi al
    // plurale restano per compatibilità, e i dispositivi figli non li hanno affatto.
    primary_config_entry: str(raw.primary_config_entry) ?? str(raw.config_entry_id),
    config_entries: strList(raw.config_entries).length ? strList(raw.config_entries) : str(raw.config_entry_id) ? [str(raw.config_entry_id)!] : [],
    via_device_id: str(raw.via_device_id),
    sw_version: str(raw.sw_version),
    labels: strList(raw.labels),
    parent_device_id: str(raw.parent_device_id),
  }
}

export function toCompositeSplits(raw: unknown): Record<string, CompositeSplit> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: Record<string, CompositeSplit> = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    const x = v as { split_ids?: unknown; primary_id?: unknown }
    out[id] = { splitIds: strList(x?.split_ids), primaryId: str(x?.primary_id) }
  }
  return out
}

export function toAreaEntry(raw: Record<string, unknown>): AreaEntry {
  return { area_id: String(raw.area_id), name: String(raw.name ?? raw.area_id), floor_id: str(raw.floor_id), aliases: strList(raw.aliases) }
}

export function toFloorEntry(raw: Record<string, unknown>): FloorEntry {
  return { floor_id: String(raw.floor_id), name: String(raw.name ?? raw.floor_id), level: typeof raw.level === 'number' ? raw.level : null }
}

export function deviceName(d: DeviceEntry): string {
  return d.name_by_user ?? d.name ?? d.model ?? d.id
}
