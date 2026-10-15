import type { HAReader } from '../ha/data.ts'
import type { DeviceEntry, HAState, Registries } from '../ha/types.ts'
import { deviceName } from '../ha/types.ts'
import { buildInventory } from '../inventory/inventory.ts'
import { domainOf, type Consents } from '../inventory/privacy.ts'

// Catalogo dei modelli di dispositivo presenti in casa, per (produttore, modello). Lo stesso
// oggetto può comparire in più integrazioni (es. Matter + cloud + Bluetooth): si unisce in una
// voce sola. Entrano solo i dispositivi con almeno un'entità nell'inventario (niente client di
// rete, server, lettori Plex…) e le esclusioni per privacy valgono anche qui.

export interface CatalogDevice {
  id: string
  name: string
  area: string | null
  integration: string | null
}

export interface CatalogIntegration {
  domain: string
  name: string | null
  iotClass: string | null
  documentation: string | null
  devices: number
}

export interface CatalogEntry {
  /** produttore e modello normalizzati, es. "aqara|presence sensor fp2" */
  key: string
  manufacturer: string
  model: string
  modelIds: string[]
  firmware: string[]
  devices: CatalogDevice[]
  integrations: CatalogIntegration[]
  /** tipi di entità (dominio/device_class) → quante */
  entityKinds: Record<string, number>
}

export interface Manifest {
  name: string | null
  iotClass: string | null
  documentation: string | null
}

const ALIASES: Array<[RegExp, string]> = [
  [/^(signify|philips lighting|philips hue)\b/, 'signify'],
  [/^(lge|lg electronics|lg)\b/, 'lg'],
  [/^(chengdu meross|meross)\b/, 'meross'],
  [/^(woan|wonderlabs|switchbot)\b/, 'switchbot'],
  [/^(lumi united|lumi|xiaomi aqara|aqara)\b/, 'aqara'],
  [/^(allterco|shelly)\b/, 'shelly'],
  [/^(ikea)\b/, 'ikea'],
  [/^(tado)/, 'tado'],
  [/^(nabu casa)\b/, 'nabu casa'],
  [/^(sonos)\b/, 'sonos'],
  [/^(apple)\b/, 'apple'],
  [/^(samsung)\b/, 'samsung'],
  [/^(google)\b/, 'google'],
  [/^(ubiquiti)\b/, 'ubiquiti'],
  [/^(itead|sonoff)\b/, 'sonoff'],
]
const CORPORATE = /\b(inc|co|ltd|limited|gmbh|bv|b v|nv|corp|corporation|technology|technologies|tech|electronics|netherlands|llc|srl|spa|sa|ag|ab|oy|international|group)\b/g

export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function manufacturerKey(m: string | null): string {
  const s = normalizeText(m ?? '')
  for (const [re, key] of ALIASES) if (re.test(s)) return key
  return s.replace(CORPORATE, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' ') || '?'
}

export function modelKey(model: string, manufacturer: string): string {
  let s = normalizeText(model)
  // Il nome del produttore ripetuto nel modello ("SwitchBot Hub 2") e la versione hardware
  // in coda ("mss315 9.0.0") non distinguono i modelli.
  for (const w of manufacturer.split(' ')) if (w && s.startsWith(`${w} `)) s = s.slice(w.length + 1)
  s = s.replace(/(\s\d+){2,3}$/, '')
  return s || '?'
}

/** Nome da mostrare: "Shelly" + "Shelly 2PM Gen4" → "Shelly 2PM Gen4" (niente produttore ripetuto). */
export function modelLabel(manufacturer: string, model: string): string {
  const m = manufacturer.trim()
  const first = normalizeText(m).split(' ')[0]
  return first && normalizeText(model).startsWith(first) ? model.trim() : `${m} ${model.trim()}`.trim()
}

export interface CatalogInput {
  registries: Registries
  states: Map<string, HAState>
  consents: Consents
  manifests: Map<string, Manifest>
}

/** Domini delle integrazioni da cui arrivano i dispositivi del catalogo (per i manifest). */
export function catalogDomains(registries: Registries): string[] {
  return [...new Set(Object.values(registries.configEntryDomain))].sort()
}

function integrationOf(d: DeviceEntry, registries: Registries): string | null {
  if (d.primary_config_entry && registries.configEntryDomain[d.primary_config_entry]) return registries.configEntryDomain[d.primary_config_entry]!
  for (const e of d.config_entries) if (registries.configEntryDomain[e]) return registries.configEntryDomain[e]!
  return null
}

const LOCAL = (iot: string | null) => Boolean(iot?.startsWith('local'))

export function buildCatalog(input: CatalogInput): CatalogEntry[] {
  const { registries, states, consents } = input
  const inv = buildInventory({ registries, states, consents, referenced: new Set() })
  const visible = new Map<string, string[]>()
  for (const e of inv.entities) if (e.device_id) visible.set(e.device_id, [...(visible.get(e.device_id) ?? []), e.entity_id])
  const areas = new Map(registries.areas.map((a) => [a.area_id, a.name]))
  const enabledByDevice = new Map<string, string[]>()
  for (const e of registries.entities) if (e.device_id && !e.disabled_by) enabledByDevice.set(e.device_id, [...(enabledByDevice.get(e.device_id) ?? []), e.entity_id])

  const groups = new Map<string, DeviceEntry[]>()
  for (const d of registries.devices) {
    if (d.disabled_by || d.entry_type === 'service' || !visible.has(d.id)) continue
    if (!d.model && !d.model_id) continue
    const manu = manufacturerKey(d.manufacturer)
    const key = `${manu}|${modelKey(d.model ?? d.model_id!, manu)}`
    groups.set(key, [...(groups.get(key) ?? []), d])
  }

  // Stesso oggetto, nome diverso: un'integrazione usa come modello il codice che un'altra
  // riporta come model_id (es. "S4SW-001P8EU" e "Shelly 1PM Mini Gen4").
  const byModelId = new Map<string, string>()
  for (const [key, devices] of groups) {
    const manu = key.split('|')[0]!
    for (const d of devices) if (d.model_id) byModelId.set(`${manu}|${normalizeText(d.model_id)}`, key)
  }
  for (const [key, devices] of [...groups]) {
    const target = byModelId.get(key)
    if (!target || target === key || !groups.has(target)) continue
    groups.set(target, [...groups.get(target)!, ...devices])
    groups.delete(key)
  }

  const out: CatalogEntry[] = []
  for (const [key, devices] of groups) {
    const integrations = new Map<string, CatalogIntegration>()
    for (const d of devices) {
      const domain = integrationOf(d, registries)
      if (!domain) continue
      const m = input.manifests.get(domain)
      const it = integrations.get(domain) ?? { domain, name: m?.name ?? null, iotClass: m?.iotClass ?? null, documentation: m?.documentation ?? null, devices: 0 }
      it.devices += 1
      integrations.set(domain, it)
    }
    // Nome mostrato: quello del dispositivo servito da un'integrazione locale, se c'è.
    const pick =
      devices.find((d) => LOCAL(integrations.get(integrationOf(d, registries) ?? '')?.iotClass ?? null) && d.manufacturer && d.model) ??
      devices.find((d) => d.manufacturer && d.model) ??
      devices[0]!
    const kinds: Record<string, number> = {}
    for (const d of devices) {
      for (const id of enabledByDevice.get(d.id) ?? []) {
        const dc = states.get(id)?.attributes.device_class
        const k = typeof dc === 'string' && dc ? `${domainOf(id)}/${dc}` : domainOf(id)
        kinds[k] = (kinds[k] ?? 0) + 1
      }
    }
    // Produttore: il nome più corto tra quelli riportati ("Aqara" invece della ragione sociale).
    const brand = devices.map((d) => d.manufacturer?.trim()).filter((m): m is string => Boolean(m)).sort((a, b) => a.length - b.length || a.localeCompare(b))[0]
    out.push({
      key,
      manufacturer: brand ?? pick.manufacturer ?? '',
      model: pick.model ?? pick.model_id ?? '',
      modelIds: [...new Set(devices.map((d) => d.model_id).filter((x): x is string => Boolean(x)))].sort(),
      firmware: [...new Set(devices.map((d) => d.sw_version).filter((x): x is string => Boolean(x)))].sort().slice(0, 5),
      devices: devices
        .map((d) => ({ id: d.id, name: deviceName(d), area: d.area_id ? (areas.get(d.area_id) ?? null) : null, integration: integrationOf(d, registries) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      integrations: [...integrations.values()].sort((a, b) => Number(LOCAL(b.iotClass)) - Number(LOCAL(a.iotClass)) || b.devices - a.devices || a.domain.localeCompare(b.domain)),
      entityKinds: Object.fromEntries(Object.entries(kinds).sort(([a], [b]) => a.localeCompare(b))),
    })
  }
  return out.sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.model.localeCompare(b.model))
}

/** Manifest delle integrazioni (nome, classe IoT, documentazione), letti con manifest/get. */
export async function loadManifests(ha: HAReader, domains: string[]): Promise<Map<string, Manifest>> {
  const out = new Map<string, Manifest>()
  for (let i = 0; i < domains.length; i += 8) {
    const batch = domains.slice(i, i + 8)
    const res = await Promise.all(batch.map((d) => ha.call<Record<string, unknown>>({ type: 'manifest/get', integration: d }).catch(() => null)))
    batch.forEach((d, j) => {
      const m = res[j]
      if (!m) return
      out.set(d, {
        name: typeof m.name === 'string' ? m.name : null,
        iotClass: typeof m.iot_class === 'string' ? m.iot_class : null,
        documentation: typeof m.documentation === 'string' ? m.documentation : null,
      })
    })
  }
  return out
}
