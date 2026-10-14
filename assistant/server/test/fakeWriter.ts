import type { AutomationWriter } from '../src/ha/writer.ts'
import { WriteError } from '../src/ha/writer.ts'
import type { HAState } from '../src/ha/types.ts'
import { slugCandidates } from '../src/drafts/service.ts'

// automations.yaml simulato: salva, "ricarica" (crea/aggiorna l'entità automation.*),
// elimina. Solo dati sintetici.

type Json = Record<string, any>

export interface FakeWriter extends AutomationWriter {
  files: Map<string, Json>
  states: Map<string, HAState>
  loaded: Map<string, Json>
  categories: Map<string, string>
  entityCategory: Map<string, string>
  calls: string[]
  /** Modifica esterna (es. l'utente nell'editor di HA). */
  externalEdit(id: string, patch: Json): void
}

export function fakeWriter(states: Map<string, HAState>, initial: Record<string, Json> = {}): FakeWriter {
  const files = new Map<string, Json>(Object.entries(initial).map(([id, c]) => [id, { id, ...c }]))
  const loaded = new Map<string, Json>()
  const categories = new Map<string, string>()
  const entityCategory = new Map<string, string>()
  const calls: string[] = []

  const entityOf = (id: string) => [...states.values()].find((s) => s.entity_id.startsWith('automation.') && s.attributes.id === id)?.entity_id

  const reload = (id: string) => {
    const cfg = files.get(id)
    let entityId = entityOf(id)
    if (!cfg) {
      if (entityId) states.delete(entityId)
      return
    }
    if (!entityId) entityId = slugCandidates(String(cfg.alias)).find((c) => !states.has(c))!
    const unavailable = JSON.stringify(cfg).includes('NON_CARICABILE')
    states.set(entityId, {
      entity_id: entityId,
      state: unavailable ? 'unavailable' : (states.get(entityId)?.state ?? 'on'),
      attributes: { id, friendly_name: cfg.alias, mode: cfg.mode ?? 'single' },
      last_changed: '2026-10-14T10:00:00Z',
      last_updated: '2026-10-14T10:00:00Z',
    })
    loaded.set(entityId, cfg)
  }
  for (const id of files.keys()) reload(id)

  return {
    files,
    states,
    loaded,
    categories,
    entityCategory,
    calls,
    externalEdit(id, patch) {
      files.set(id, { ...files.get(id), ...patch })
      reload(id)
    },
    async getConfig(id) {
      calls.push(`get ${id}`)
      const c = files.get(id)
      return c ? structuredClone(c) : null
    },
    async save(id, config) {
      calls.push(`save ${id}`)
      if (JSON.stringify(config).includes('RIFIUTA')) throw new WriteError(400, 'Message malformed: valore non ammesso')
      files.set(id, structuredClone(config))
      setTimeout(() => reload(id), 5) // il reload di HA è asincrono
    },
    async remove(id) {
      calls.push(`remove ${id}`)
      if (!files.has(id)) throw new WriteError(400, 'Resource not found')
      files.delete(id)
      setTimeout(() => reload(id), 5)
    },
    async getState(entityId) {
      return states.get(entityId) ?? null
    },
    async loadedConfig(entityId) {
      return loaded.get(entityId) ?? null
    },
    async ensureCategory(name) {
      calls.push(`category ${name}`)
      if (!categories.has(name)) categories.set(name, `cat_${name.toLowerCase()}`)
      return categories.get(name)!
    },
    async setCategory(entityId, categoryId) {
      entityCategory.set(entityId, categoryId)
    },
    async setEnabled(entityId, enabled) {
      calls.push(`enabled ${entityId} ${enabled}`)
      const s = states.get(entityId)
      if (s) states.set(entityId, { ...s, state: enabled ? 'on' : 'off' })
    },
  }
}
