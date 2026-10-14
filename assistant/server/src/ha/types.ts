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
    primary_config_entry: str(raw.primary_config_entry),
    config_entries: strList(raw.config_entries),
    via_device_id: str(raw.via_device_id),
    sw_version: str(raw.sw_version),
    labels: strList(raw.labels),
  }
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
