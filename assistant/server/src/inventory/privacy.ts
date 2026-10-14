import type { DeviceEntry, EntityEntry, HAState } from '../ha/types.ts'

// Privacy Gateway: decide cosa può uscire verso Anthropic. Di default escluse tre categorie;
// l'utente può riattivarle dalle Impostazioni, con un avviso esplicito.

export interface Consents {
  /** GPS, tracker, zone con coordinate, stato dettagliato delle persone. */
  posizione: boolean
  /** Telecamere, immagini, citofono (Ring) e tutto ciò che sta su un dispositivo con telecamera. */
  telecamere: boolean
  /** Sensori dell'app mobile di HA e integrazioni di salute/fitness. */
  appMobile: boolean
}

export type PrivacyCategory = keyof Consents

export const DEFAULT_CONSENTS: Consents = { posizione: false, telecamere: false, appMobile: false }

export const PRIVACY_LABELS: Record<PrivacyCategory, string> = {
  posizione: 'posizione (GPS e tracker)',
  telecamere: 'telecamere e citofono',
  appMobile: 'app mobile e salute',
}

export function parseConsents(raw: unknown): Consents {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return { posizione: r.posizione === true, telecamere: r.telecamere === true, appMobile: r.appMobile === true }
}

const LOCATION_DOMAINS = new Set(['device_tracker'])
const CAMERA_DOMAINS = new Set(['camera', 'image', 'image_processing'])
const CAMERA_PLATFORMS = new Set(['ring', 'doorbird', 'frigate', 'unifiprotect', 'reolink', 'blink', 'nest_doorbell', 'onvif'])
const MOBILE_PLATFORMS = new Set(['mobile_app'])
const HEALTH_PLATFORMS = new Set(['withings', 'fitbit', 'garmin_connect', 'oura', 'google_fit', 'polar', 'apple_health', 'health_connect', 'whoop'])

/** Insiemi pre-calcolati dai registri, usati da classifyPrivacy. */
export interface PrivacyIndex {
  cameraDevices: Set<string>
}

export function buildPrivacyIndex(entities: EntityEntry[]): PrivacyIndex {
  const cameraDevices = new Set<string>()
  for (const e of entities) {
    if (e.device_id && CAMERA_DOMAINS.has(domainOf(e.entity_id))) cameraDevices.add(e.device_id)
  }
  return { cameraDevices }
}

export function domainOf(entityId: string): string {
  const i = entityId.indexOf('.')
  return i > 0 ? entityId.slice(0, i) : entityId
}

/** Categoria di privacy dell'entità, o null se è condivisibile di default. */
export function classifyPrivacy(entityId: string, entry: EntityEntry | undefined, index: PrivacyIndex): PrivacyCategory | null {
  const domain = domainOf(entityId)
  if (LOCATION_DOMAINS.has(domain)) return 'posizione'
  if (CAMERA_DOMAINS.has(domain)) return 'telecamere'
  if (entry) {
    if (MOBILE_PLATFORMS.has(entry.platform) || HEALTH_PLATFORMS.has(entry.platform)) return 'appMobile'
    if (CAMERA_PLATFORMS.has(entry.platform)) return 'telecamere'
    if (entry.device_id && index.cameraDevices.has(entry.device_id)) return 'telecamere'
  }
  return null
}

export function isAllowed(entityId: string, entry: EntityEntry | undefined, index: PrivacyIndex, consents: Consents): boolean {
  const cat = classifyPrivacy(entityId, entry, index)
  return cat === null || consents[cat]
}

// --- Pulizia degli attributi -------------------------------------------------------------

// Chiavi mai inviate, qualunque sia il consenso: credenziali, identificativi di rete e immagini.
const ALWAYS_DROP = /(^|_)(token|access_token|password|passwd|secret|api_?key|auth|cookie|session|credentials?)($|_)|entity_picture|stream_source|(^|_)ip($|_)|ip_address|ipv[46]|(^|_)mac($|_)|mac_address|bssid|ssid|serial|imei|imsi|iccid|(^|_)(email|phone|phone_number)($|_)|user_id|(^|_)url$|^uri$/i
// Chiavi di posizione: inviate solo con il consenso "posizione".
// (person e device_tracker sono gestiti a parte: il primo tiene solo il nome, il secondo è escluso.)
const LOCATION_KEYS = /latitude|longitude|gps|altitude|(^|_)location($|_)|address|geocoded|coordinates|^heading$|^course$/i

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
const MAC = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi
const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/gi

/** Toglie da un testo IP, MAC e URL (che spesso contengono token). */
export function scrubString(s: string): string {
  return s.replace(URL_RE, '[url rimosso]').replace(MAC, '[mac rimosso]').replace(IPV4, '[ip rimosso]')
}

const MAX_STRING = 300
const MAX_ARRAY = 40

function scrubValue(v: unknown, depth: number): unknown {
  if (typeof v === 'string') return scrubString(v.length > MAX_STRING ? v.slice(0, MAX_STRING) + '…' : v)
  if (typeof v === 'number' || typeof v === 'boolean' || v === null) return v
  if (Array.isArray(v)) {
    const items = v.slice(0, MAX_ARRAY).map((x) => scrubValue(x, depth + 1))
    if (v.length > MAX_ARRAY) items.push(`… altri ${v.length - MAX_ARRAY}`)
    return items
  }
  if (typeof v === 'object' && v) {
    if (depth >= 3) return '[oggetto]'
    return scrubObject(v as Record<string, unknown>, depth + 1, true)
  }
  return undefined
}

function scrubObject(obj: Record<string, unknown>, depth: number, dropLocation: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    if (ALWAYS_DROP.test(key)) continue
    if (dropLocation && LOCATION_KEYS.test(key)) continue
    const val = scrubValue(obj[key], depth)
    if (val !== undefined) out[key] = val
  }
  return out
}

/** Attributi condivisibili di uno stato. Per person, senza consenso, resta solo il nome. */
export function sanitizeAttributes(entityId: string, attrs: Record<string, unknown>, consents: Consents): Record<string, unknown> {
  const domain = domainOf(entityId)
  if (domain === 'person' && !consents.posizione) {
    return typeof attrs.friendly_name === 'string' ? { friendly_name: attrs.friendly_name } : {}
  }
  return scrubObject(attrs, 0, !consents.posizione)
}

/** Stato condivisibile: per le persone, senza consenso, solo casa/fuori casa. */
export function sanitizeState(entityId: string, state: string, consents: Consents): string {
  if (domainOf(entityId) === 'person' && !consents.posizione) {
    if (state === 'home' || state === 'unknown' || state === 'unavailable') return state
    return 'not_home'
  }
  return scrubString(state)
}

/** Vista sicura di uno stato completo. */
export function sanitizeStateObject(s: HAState, consents: Consents) {
  return {
    entity_id: s.entity_id,
    state: sanitizeState(s.entity_id, s.state, consents),
    attributes: sanitizeAttributes(s.entity_id, s.attributes, consents),
    last_changed: s.last_changed,
    last_updated: s.last_updated,
  }
}

/** Dati del dispositivo condivisibili: niente serial_number, connections (MAC), identifiers. */
export function sanitizeDevice(d: DeviceEntry) {
  return {
    id: d.id,
    nome: d.name_by_user ?? d.name,
    produttore: d.manufacturer,
    modello: d.model,
    model_id: d.model_id,
    firmware: d.sw_version,
    area_id: d.area_id,
    tipo: d.entry_type,
  }
}
