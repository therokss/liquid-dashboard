// Legge i dati dalla dashboard Energia di Home Assistant:
//  - energy/get_prefs → sorgenti configurate (rete, solare, batteria) e device
//  - recorder/statistics_during_period → energia (kWh) e costi nel periodo

import type { DeviceInfo, HassEntity } from '../types/ha'

export interface GridFlowFrom { stat_energy_from: string; stat_cost?: string | null; entity_energy_price?: string | null }
export interface GridFlowTo { stat_energy_to: string; stat_compensation?: string | null }

export interface EnergySource {
  type: 'grid' | 'solar' | 'battery' | 'gas' | 'water'
  flow_from?: GridFlowFrom[]
  flow_to?: GridFlowTo[]
  stat_energy_from?: string
  stat_energy_to?: string
  stat_cost?: string | null
}

export interface EnergyPrefs {
  energy_sources: EnergySource[]
  // stat_rate (HA 2025+): il sensore di potenza del dispositivo, per il consumo istantaneo
  // included_in_stat: il dispositivo "a monte" che misura già anche questo
  device_consumption: Array<{ stat_consumption: string; stat_rate?: string | null; name?: string | null; included_in_stat?: string | null }>
}

export interface EnergyStatIds {
  gridFrom: string[]
  gridTo: string[]
  gridCost: string[]
  solar: string[]
  batteryFrom: string[]
  batteryTo: string[]
  devices: Array<{ id: string; name?: string; rate?: string; parent?: string }>
}

export interface StatBucket { start: string; end: string; change?: number; sum?: number; state?: number }

type Send = <T = unknown>(msg: { type: string } & Record<string, unknown>) => Promise<T | null>

export async function fetchEnergyPrefs(send: Send): Promise<EnergyPrefs | null> {
  return await send<EnergyPrefs>({ type: 'energy/get_prefs' })
}

export function extractStatIds(prefs: EnergyPrefs): EnergyStatIds {
  const ids: EnergyStatIds = {
    gridFrom: [], gridTo: [], gridCost: [], solar: [], batteryFrom: [], batteryTo: [], devices: [],
  }
  for (const s of prefs.energy_sources ?? []) {
    if (s.type === 'grid') {
      for (const f of s.flow_from ?? []) {
        if (f.stat_energy_from) ids.gridFrom.push(f.stat_energy_from)
        if (f.stat_cost) ids.gridCost.push(f.stat_cost)
      }
      for (const t of s.flow_to ?? []) { if (t.stat_energy_to) ids.gridTo.push(t.stat_energy_to) }
      // Schema alternativo: alcune configurazioni (es. Shelly EM3) memorizzano lo
      // statistic direttamente sulla sorgente grid invece che dentro flow_from/flow_to.
      if (s.stat_energy_from) ids.gridFrom.push(s.stat_energy_from)
      if (s.stat_energy_to) ids.gridTo.push(s.stat_energy_to)
      if (s.stat_cost) ids.gridCost.push(s.stat_cost)
    } else if (s.type === 'solar') {
      if (s.stat_energy_from) ids.solar.push(s.stat_energy_from)
    } else if (s.type === 'battery') {
      if (s.stat_energy_from) ids.batteryFrom.push(s.stat_energy_from)
      if (s.stat_energy_to) ids.batteryTo.push(s.stat_energy_to)
    }
  }
  for (const d of prefs.device_consumption ?? []) {
    ids.devices.push({ id: d.stat_consumption, name: d.name ?? undefined, rate: d.stat_rate ?? undefined, parent: d.included_in_stat ?? undefined })
  }
  // Dedup: lo stesso statistic non deve essere sommato due volte (flow_from + top-level)
  ids.gridFrom = Array.from(new Set(ids.gridFrom))
  ids.gridTo = Array.from(new Set(ids.gridTo))
  ids.gridCost = Array.from(new Set(ids.gridCost))
  ids.solar = Array.from(new Set(ids.solar))
  return ids
}

export function hasEnergyConfig(prefs: EnergyPrefs | null): boolean {
  return (prefs?.energy_sources?.length ?? 0) > 0
}

// Fattore per convertire in kWh in base all'unità del sensore
export function kwhFactor(unit?: string): number {
  switch ((unit || '').trim()) {
    case 'Wh': return 0.001
    case 'MWh': return 1000
    case 'GWh': return 1_000_000
    default: return 1 // kWh o unità non energetica (es. costo €) → invariato
  }
}

// Somma il consumo/variazione ('change') nel periodo per ogni statistic_id.
// unitFactor: opzionale, per normalizzare Wh→kWh in base all'unità del sensore.
export async function fetchStatsSum(
  send: Send,
  statIds: string[],
  startISO: string,
  endISO?: string,
  unitFactor?: (id: string) => number
): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  const unique = Array.from(new Set(statIds)).filter(Boolean)
  if (!unique.length) return out
  const res = await send<Record<string, StatBucket[]>>({
    type: 'recorder/statistics_during_period',
    start_time: startISO,
    ...(endISO ? { end_time: endISO } : {}),
    statistic_ids: unique,
    period: 'day',
  })
  if (!res) return out
  for (const [id, buckets] of Object.entries(res)) {
    let sum = 0
    for (const b of buckets) sum += b.change ?? 0
    out[id] = sum * (unitFactor ? unitFactor(id) : 1)
  }
  return out
}

export function sumOf(map: Record<string, number>, ids: string[]): number {
  let s = 0
  for (const id of ids) s += map[id] ?? 0
  return s
}

// Sensori di potenza dei singoli dispositivi ("Consumo istantaneo" in Energia, "Corrente area"
// nelle stanze). Se nella dashboard Energia di HA ci sono i "singoli dispositivi", contano
// esattamente quelli: per ognuno il sensore di potenza indicato lì (stat_rate) o, se manca,
// quello del suo dispositivo o quello da cui è calcolata l'energia (attributo source). È la
// lista curata dall'utente, senza doppioni (es. la lavatrice misurata dalla presa e non anche
// dal sensore dell'elettrodomestico). Senza quella lista restano fuori le sorgenti (rete,
// solare, batteria) e i dispositivi a batteria (power station come EcoFlow, UPS, telefoni),
// che misurano flussi di energia e non un consumo, come stazioni di energia, inverter e UPS
// riconosciuti da produttore e modello; nella lista di Energia contano poi solo le prese e i
// relè (sensori su un dispositivo con un interruttore o una luce veri, non di configurazione,
// o con "presa"/"plug" nel nome o nel modello), se ce ne sono, mentre le stanze tengono anche
// pinze e simili.

/** Quello che serve dalla configurazione Energia di HA. */
export interface EnergyLoads {
  devices: Array<{ stat: string; rate?: string; name?: string; parent?: string }>
  sources: string[]
}

export function energyLoads(ids: EnergyStatIds | null): EnergyLoads {
  if (!ids) return { devices: [], sources: [] }
  return {
    devices: ids.devices.map((d) => ({ stat: d.id, rate: d.rate, name: d.name, parent: d.parent })),
    sources: [...ids.gridFrom, ...ids.gridTo, ...ids.solar, ...ids.batteryFrom, ...ids.batteryTo],
  }
}

export interface ConsumerPower {
  /** lista "Consumo istantaneo" */
  test: (e: HassEntity) => boolean
  /** badge "Corrente area" */
  inRoom: (e: HassEntity) => boolean
  /** il sensore viene dai singoli dispositivi della dashboard Energia */
  chosen: (entityId: string) => boolean
  /** nome del singolo dispositivo nella dashboard Energia */
  name: (entityId: string) => string | undefined
  /** sensore del dispositivo "a monte" (included_in_stat), che misura già anche questo */
  parent: (entityId: string) => string | undefined
}

const attr = (e: HassEntity, k: string) => (e.attributes as Record<string, unknown>)[k]

export function isPowerSensor(e: HassEntity): boolean {
  return e.entity_id.startsWith('sensor.') && attr(e, 'device_class') === 'power'
}

// Nomi da non mostrare nella lista di Energia: infrastruttura (UPS, contatori e loro fasi,
// UDR/PoE) e nomi grezzi senza friendly_name, a meno che il sensore sia uno dei singoli
// dispositivi della dashboard Energia.
const INFRA = /myups|\bups\b|contator|\bmeter\b|\budr\d*\b|\bpoe\b|phase|\bfase\b|nominale/i
const RAW_SHELLY = /shelly[a-z0-9-]*-[0-9a-f]{6,}/i // anche shellyplug-s-a1b2c3
// Stazioni di energia, inverter e UPS: hanno prese in uscita ma non sono carichi.
const POWER_STATION = /ecoflow|inverter|power\s?station|\bups\b/i
// Prese riconosciute dal nome del sensore o dal modello, anche senza interruttore.
const PLUG_WORDS = /\b(presa|prese|plug|socket|outlet|spina|enchufe)\b/i

export function isInfraPower(e: HassEntity, consumers?: ConsumerPower): boolean {
  const name = consumers?.name(e.entity_id) || (attr(e, 'friendly_name') as string) || ''
  return INFRA.test(`${name} ${e.entity_id}`) || (!consumers?.chosen(e.entity_id) && RAW_SHELLY.test(name))
}

// Il risultato dipende solo da quali entità esistono, non dagli stati: si ricalcola quando
// cambiano registro, entità di sistema, numero di entità o configurazione Energia, e resta lo
// stesso oggetto (così un selettore dello store che lo restituisce non ri-renderizza a ogni
// evento). Qualche posto in cache, perché Home e Stanze possono chiederlo con input diversi.
const consumerCache = new Map<string, { devices: Record<string, string>; system: Record<string, true>; info: Record<string, DeviceInfo>; value: ConsumerPower }>()

export function consumerPowerFilter(
  entities: Record<string, HassEntity>,
  entityDevices: Record<string, string>,
  systemEntities: Record<string, true>,
  deviceInfo: Record<string, DeviceInfo>,
  loads: EnergyLoads,
): ConsumerPower {
  const key = `${Object.keys(entities).length}|${JSON.stringify(loads)}`
  const hit = consumerCache.get(key)
  if (hit && hit.devices === entityDevices && hit.system === systemEntities && hit.info === deviceInfo) return hit.value
  const powerByDevice = new Map<string, string[]>()
  const controls = new Set<string>()
  const onBattery = new Set<string>()
  for (const e of Object.values(entities)) {
    const dev = entityDevices[e.entity_id]
    if (!dev) continue
    if (isPowerSensor(e)) powerByDevice.set(dev, [...(powerByDevice.get(dev) ?? []), e.entity_id])
    if ((e.entity_id.startsWith('switch.') || e.entity_id.startsWith('light.')) && !systemEntities[e.entity_id]) controls.add(dev)
    if (e.entity_id.startsWith('sensor.') && attr(e, 'device_class') === 'battery') onBattery.add(dev)
  }

  // 1) Singoli dispositivi della dashboard Energia.
  const chosen = new Map<string, string | undefined>()
  const sensorOfStat = new Map<string, string>()
  const base = (id: string, suffix: RegExp) => id.replace(/^sensor\./, '').replace(suffix, '')
  for (const d of loads.devices) {
    let id = d.rate && entities[d.rate] ? d.rate : undefined
    if (!id) {
      const list = powerByDevice.get(entityDevices[d.stat]) ?? []
      const b = base(d.stat, /_(energia|energy|consumo|consumption)$/)
      id = list.length === 1 ? list[0] : list.find((p) => base(p, /_(potenza|power)$/) === b)
    }
    if (!id) {
      // Energia calcolata da un helper (integrazione di Riemann): il sensore di partenza.
      const src = entities[d.stat] && attr(entities[d.stat], 'source')
      if (typeof src === 'string' && entities[src] && isPowerSensor(entities[src])) id = src
    }
    if (!id) continue
    sensorOfStat.set(d.stat, id)
    if (!chosen.has(id)) chosen.set(id, d.name || undefined)
  }
  const parents = new Map<string, string>()
  for (const d of loads.devices) {
    const own = sensorOfStat.get(d.stat)
    const up = d.parent ? sensorOfStat.get(d.parent) : undefined
    if (own && up && own !== up) parents.set(own, up)
  }
  let test: (e: HassEntity) => boolean
  let inRoom: (e: HassEntity) => boolean
  if (chosen.size) {
    test = (e) => chosen.has(e.entity_id)
    inRoom = test
  } else {
    // 2) Ripiego: niente sorgenti né dispositivi a batteria; nella lista solo prese e relè.
    const sourceDevices = new Set(loads.sources.map((id) => entityDevices[id]).filter(Boolean))
    const hw = (dev: string | undefined) => (dev ? `${deviceInfo[dev]?.manufacturer ?? ''} ${deviceInfo[dev]?.model ?? ''}` : '')
    const candidate = (e: HassEntity) => {
      if (!isPowerSensor(e)) return false
      const dev = entityDevices[e.entity_id]
      return !onBattery.has(dev) && !sourceDevices.has(dev) && !POWER_STATION.test(hw(dev))
    }
    const isLoad = (e: HassEntity) => {
      const dev = entityDevices[e.entity_id]
      return controls.has(dev) || PLUG_WORDS.test(`${(attr(e, 'friendly_name') as string) || ''} ${hw(dev)}`)
    }
    const loadsOnly = Object.values(entities).some((e) => candidate(e) && isLoad(e))
    test = (e) => candidate(e) && (!loadsOnly || isLoad(e))
    inRoom = candidate
  }
  const value: ConsumerPower = { test, inRoom, chosen: (id) => chosen.has(id), name: (id) => chosen.get(id), parent: (id) => parents.get(id) }
  consumerCache.delete(key)
  consumerCache.set(key, { devices: entityDevices, system: systemEntities, info: deviceInfo, value })
  if (consumerCache.size > 4) consumerCache.delete(consumerCache.keys().next().value as string)
  return value
}
