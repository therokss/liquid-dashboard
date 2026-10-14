import type { HAReader } from '../ha/data.ts'
import type { HAConfigInfo, Registries } from '../ha/types.ts'
import { buildInventory, collectEntityRefs, renderInventory, type InventoryStats } from './inventory.ts'
import { domainOf, type Consents } from './privacy.ts'
import { log } from '../log.ts'

export interface HomeSnapshot {
  config: HAConfigInfo
  inventoryText: string
  stats: InventoryStats
  createdAt: number
}

const REFS_TTL_MS = 5 * 60_000
let refsCache: { at: number; registries: Registries; refs: Set<string> } | null = null

/** R6: entità citate dalle configurazioni di automazioni e script e dalle scene. */
async function referencedEntities(ha: HAReader, registries: Registries): Promise<Set<string>> {
  if (refsCache && refsCache.registries === registries && Date.now() - refsCache.at < REFS_TTL_MS) return refsCache.refs
  const states = await ha.states()
  const known = new Set(states.keys())
  const refs = new Set<string>()
  const targets: Array<{ type: string; entity_id: string }> = []
  for (const [id, s] of states) {
    const domain = domainOf(id)
    if (domain === 'automation') targets.push({ type: 'automation/config', entity_id: id })
    else if (domain === 'script') targets.push({ type: 'script/config', entity_id: id })
    else if (domain === 'scene') collectEntityRefs(s.attributes.entity_id, known, refs)
  }
  // A blocchi: 120 automazioni in parallelo appesantirebbero la WS di HA senza motivo.
  for (let i = 0; i < targets.length; i += 8) {
    const batch = targets.slice(i, i + 8)
    const configs = await Promise.all(batch.map((t) => ha.call<{ config: unknown }>(t).catch(() => null)))
    for (const c of configs) if (c) collectEntityRefs(c.config, known, refs)
  }
  refsCache = { at: Date.now(), registries, refs }
  return refs
}

export async function buildHomeSnapshot(ha: HAReader, consents: Consents): Promise<HomeSnapshot> {
  const [config, registries, states] = await Promise.all([ha.config(), ha.registries(), ha.states()])
  let referenced = new Set<string>()
  try {
    referenced = await referencedEntities(ha, registries)
  } catch (err) {
    log.warn('Riferimenti delle automazioni non disponibili', err instanceof Error ? err.message : err)
  }
  const inventory = buildInventory({ registries, states, consents, referenced })
  return {
    config,
    inventoryText: renderInventory(inventory, registries, consents),
    stats: inventory.stats,
    createdAt: Date.now(),
  }
}

export function resetSnapshotCache(): void {
  refsCache = null
}
