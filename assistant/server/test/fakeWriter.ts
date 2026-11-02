import type { DraftWriter } from '../src/ha/writer.ts'
import { WriteError } from '../src/ha/writer.ts'
import type { HAState } from '../src/ha/types.ts'
import { slugCandidates } from '../src/drafts/service.ts'
import { haSlug } from '../src/drafts/automation.ts'

// automations.yaml, scripts.yaml e helper dell'interfaccia simulati: salva, "ricarica" (crea o
// aggiorna l'entità), elimina. Solo dati sintetici.

type Json = Record<string, any>

export interface FakeWriter extends DraftWriter {
  files: Map<string, Json>
  scripts: Map<string, Json>
  /** dominio → id → configurazione (con id), come le collezioni in .storage */
  helpers: Map<string, Map<string, Json>>
  states: Map<string, HAState>
  loaded: Map<string, Json>
  categories: Map<string, string>
  entityCategory: Map<string, string>
  /** entity_id → { platform, unique_id } */
  registry: Map<string, { platform: string; unique_id: string }>
  calls: string[]
  /** Modifica esterna (es. l'utente nell'editor di HA). */
  externalEdit(id: string, patch: Json): void
  externalScriptEdit(key: string, patch: Json): void
}

const HELPER_DEFAULTS: Record<string, Json> = {
  input_number: { step: 1, mode: 'slider' },
  input_text: { min: 0, max: 100, mode: 'text' },
}

export function fakeWriter(states: Map<string, HAState>, initial: Record<string, Json> = {}, extra: { scripts?: Record<string, Json>; helpers?: Record<string, Record<string, Json>> } = {}): FakeWriter {
  const files = new Map<string, Json>(Object.entries(initial).map(([id, c]) => [id, { id, ...c }]))
  const scripts = new Map<string, Json>(Object.entries(extra.scripts ?? {}))
  const helpers = new Map<string, Map<string, Json>>()
  for (const [domain, items] of Object.entries(extra.helpers ?? {})) helpers.set(domain, new Map(Object.entries(items).map(([id, c]) => [id, { id, ...c }])))
  const loaded = new Map<string, Json>()
  const categories = new Map<string, string>()
  const entityCategory = new Map<string, string>()
  const registry = new Map<string, { platform: string; unique_id: string }>()
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

  const reloadScript = (key: string) => {
    const cfg = scripts.get(key)
    const entityId = [...registry].find(([, r]) => r.platform === 'script' && r.unique_id === key)?.[0] ?? `script.${key}`
    if (!cfg) {
      states.delete(entityId)
      registry.delete(entityId)
      loaded.delete(entityId)
      return
    }
    registry.set(entityId, { platform: 'script', unique_id: key })
    states.set(entityId, {
      entity_id: entityId,
      state: JSON.stringify(cfg).includes('NON_CARICABILE') ? 'unavailable' : 'off',
      attributes: { friendly_name: cfg.alias, mode: cfg.mode ?? 'single', last_triggered: null },
      last_changed: '2026-10-14T10:00:00Z',
      last_updated: '2026-10-14T10:00:00Z',
    })
    loaded.set(entityId, cfg)
  }

  const helperEntity = (domain: string, item: Json) => {
    const existing = [...registry].find(([, r]) => r.platform === domain && r.unique_id === item.id)?.[0]
    const entityId = existing ?? `${domain}.${item.id}`
    registry.set(entityId, { platform: domain, unique_id: item.id })
    states.set(entityId, {
      entity_id: entityId,
      state: domain === 'input_select' ? String(item.options?.[0] ?? '') : domain === 'input_number' ? String(item.min ?? 0) : 'off',
      attributes: { friendly_name: item.name, editable: true, ...(item.options ? { options: item.options } : {}) },
      last_changed: '2026-10-14T10:00:00Z',
      last_updated: '2026-10-14T10:00:00Z',
    })
  }

  for (const id of files.keys()) reload(id)
  for (const key of scripts.keys()) reloadScript(key)
  for (const [domain, items] of helpers) for (const item of items.values()) helperEntity(domain, item)

  const collection = (domain: string) => {
    let c = helpers.get(domain)
    if (!c) helpers.set(domain, (c = new Map()))
    return c
  }

  return {
    files,
    scripts,
    helpers,
    states,
    loaded,
    categories,
    entityCategory,
    registry,
    calls,
    externalEdit(id, patch) {
      files.set(id, { ...files.get(id), ...patch })
      reload(id)
    },
    externalScriptEdit(key, patch) {
      scripts.set(key, { ...scripts.get(key), ...patch })
      reloadScript(key)
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
    async ensureCategory(name, _icon, scope = 'automation') {
      calls.push(`category ${scope} ${name}`)
      const k = `${scope}:${name}`
      if (!categories.has(k)) categories.set(k, scope === 'automation' ? `cat_${name.toLowerCase()}` : `cat_${scope}_${name.toLowerCase()}`)
      return categories.get(k)!
    },
    async setCategory(entityId, categoryId) {
      entityCategory.set(entityId, categoryId)
    },
    async setEnabled(entityId, enabled) {
      calls.push(`enabled ${entityId} ${enabled}`)
      const s = states.get(entityId)
      if (s) states.set(entityId, { ...s, state: enabled ? 'on' : 'off' })
    },

    async getScript(key) {
      calls.push(`getScript ${key}`)
      const c = scripts.get(key)
      return c ? structuredClone(c) : null
    },
    async saveScript(key, config) {
      calls.push(`saveScript ${key}`)
      if (JSON.stringify(config).includes('RIFIUTA')) throw new WriteError(400, 'Message malformed: valore non ammesso')
      scripts.set(key, structuredClone(config))
      reloadScript(key) // il reload degli script avviene prima della risposta
    },
    async removeScript(key) {
      calls.push(`removeScript ${key}`)
      if (!scripts.has(key)) throw new WriteError(400, 'Resource not found')
      scripts.delete(key)
      reloadScript(key)
    },
    async loadedScript(entityId) {
      return entityId.startsWith('script.') ? (loaded.get(entityId) ?? null) : null
    },

    async listHelpers(domain) {
      return [...collection(domain).values()].map((i) => structuredClone(i))
    },
    async createHelper(domain, config) {
      calls.push(`createHelper ${domain}`)
      if (JSON.stringify(config).includes('RIFIUTA')) throw Object.assign(new Error('valore non ammesso'), { code: 'invalid_format' })
      const c = collection(domain)
      let id = haSlug(String(config.name))
      for (let n = 2; c.has(id); n++) id = `${haSlug(String(config.name))}_${n}`
      const item = { id, ...(HELPER_DEFAULTS[domain] ?? {}), ...structuredClone(config) }
      c.set(id, item)
      helperEntity(domain, item)
      return structuredClone(item)
    },
    async updateHelper(domain, id, config) {
      calls.push(`updateHelper ${domain} ${id}`)
      const c = collection(domain)
      if (!c.has(id)) throw Object.assign(new Error(`Unable to find ${domain}_id ${id}`), { code: 'not_found' })
      const { id: _x, ...fields } = config
      const item = { id, ...(HELPER_DEFAULTS[domain] ?? {}), ...structuredClone(fields) }
      c.set(id, item)
      helperEntity(domain, item)
      return structuredClone(item)
    },
    async removeHelper(domain, id) {
      calls.push(`removeHelper ${domain} ${id}`)
      const c = collection(domain)
      if (!c.delete(id)) throw Object.assign(new Error(`Unable to find ${domain}_id ${id}`), { code: 'not_found' })
      const entityId = [...registry].find(([, r]) => r.platform === domain && r.unique_id === id)?.[0]
      if (entityId) {
        registry.delete(entityId)
        states.delete(entityId)
      }
    },

    async registryEntry(entityId) {
      return registry.get(entityId) ?? null
    },
    async entityIdFor(platform, uniqueId) {
      return [...registry].find(([, r]) => r.platform === platform && r.unique_id === uniqueId)?.[0] ?? null
    },
  }
}
