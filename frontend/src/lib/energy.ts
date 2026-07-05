// Legge i dati dalla dashboard Energia di Home Assistant:
//  - energy/get_prefs → sorgenti configurate (rete, solare, batteria) e device
//  - recorder/statistics_during_period → energia (kWh) e costi nel periodo

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
  device_consumption: Array<{ stat_consumption: string; name?: string }>
}

export interface EnergyStatIds {
  gridFrom: string[]
  gridTo: string[]
  gridCost: string[]
  solar: string[]
  batteryFrom: string[]
  batteryTo: string[]
  devices: Array<{ id: string; name?: string }>
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
  for (const d of prefs.device_consumption ?? []) ids.devices.push({ id: d.stat_consumption, name: d.name })
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
