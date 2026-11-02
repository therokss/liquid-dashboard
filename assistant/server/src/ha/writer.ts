import type { HAConnection } from './connection.ts'
import type { HARest } from './rest.ts'
import type { HAState } from './types.ts'
import { isHelperDomain } from '../drafts/objects.ts'

// Le UNICHE scritture verso Home Assistant, chiamate solo dal server dopo il tap di un
// amministratore (mai da Claude): salvare/eliminare un'automazione con l'API REST dell'editor,
// assegnarle la categoria "Claude", attivarla o disattivarla; dalla 0.7 (Manutenzione)
// spostare, disattivare o eliminare dispositivi ed eliminare entità non più fornite; dalla
// 0.8 salvare/eliminare script (scripts.yaml, stessa API dell'editor) e creare, modificare o
// eliminare helper dell'interfaccia (comandi <dominio>/create|update|delete).

export class WriteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

/** Ambito delle categorie nel registro: una per pagina di Home Assistant. */
export type CategoryScope = 'automation' | 'script' | 'helpers'

export interface DraftWriter {
  /** Configurazione salvata in automations.yaml, o null se l'id non è modificabile dall'editor. */
  getConfig(id: string): Promise<Record<string, unknown> | null>
  save(id: string, config: Record<string, unknown>): Promise<void>
  remove(id: string): Promise<void>
  getState(entityId: string): Promise<HAState | null>
  /** Configurazione caricata (dopo il reload) dell'automazione. */
  loadedConfig(entityId: string): Promise<Record<string, unknown> | null>
  ensureCategory(name: string, icon: string, scope?: CategoryScope): Promise<string>
  setCategory(entityId: string, categoryId: string, scope?: CategoryScope): Promise<void>
  setEnabled(entityId: string, enabled: boolean): Promise<void>

  /** Script in scripts.yaml (chiave = object_id), o null se non c'è (YAML altrove, packages). */
  getScript(key: string): Promise<Record<string, unknown> | null>
  saveScript(key: string, config: Record<string, unknown>): Promise<void>
  removeScript(key: string): Promise<void>
  /** Configurazione caricata dello script. */
  loadedScript(entityId: string): Promise<Record<string, unknown> | null>

  /** Helper creati dall'interfaccia (quelli in YAML non ci sono). */
  listHelpers(domain: string): Promise<Array<Record<string, unknown>>>
  createHelper(domain: string, config: Record<string, unknown>): Promise<Record<string, unknown>>
  updateHelper(domain: string, id: string, config: Record<string, unknown>): Promise<Record<string, unknown>>
  removeHelper(domain: string, id: string): Promise<void>

  /** Voce del registro delle entità (integrazione e unique_id), o null. */
  registryEntry(entityId: string): Promise<{ platform: string; unique_id: string } | null>
  /** entity_id dell'entità con questo unique_id (ricerca nell'intero registro). */
  entityIdFor(platform: string, uniqueId: string): Promise<string | null>
}

/** Nome storico: le automazioni sono state le prime e per anni le sole scritture. */
export type AutomationWriter = DraftWriter

/** Registri dei dispositivi e delle entità (Manutenzione). */
export interface RegistryWriter {
  updateDevice(deviceId: string, patch: { area_id?: string | null; disabled_by?: 'user' | null }): Promise<void>
  /** Solo se l'integrazione lo consente (supports_remove_device). */
  removeDevice(deviceId: string, configEntryId: string): Promise<void>
  /** Solo per entità che l'integrazione non fornisce più (attributo restored). */
  removeEntity(entityId: string): Promise<void>
}

/** Creazione dell'interruttore di prova per i collaudi (una sola volta, vedi setup/testHelper.ts). */
export interface HelperWriter {
  createInputBoolean(name: string, icon: string): Promise<{ id: string }>
}

function message(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string') return (data as { message: string }).message
  return typeof data === 'string' && data ? data : fallback
}

export class HAWriter implements DraftWriter, HelperWriter, RegistryWriter {
  constructor(
    private readonly rest: HARest,
    private readonly conn: Pick<HAConnection, 'sendMessage'>,
  ) {}

  private path(id: string): string {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new WriteError(400, `id di automazione non valido: ${id}`)
    return `/config/automation/config/${encodeURIComponent(id)}`
  }

  async getConfig(id: string): Promise<Record<string, unknown> | null> {
    const r = await this.rest.get<Record<string, unknown>>(this.path(id))
    if (r.status === 404 || r.status === 400) return null
    if (!r.ok || !r.data || typeof r.data !== 'object') throw new WriteError(r.status, message(r.data, `Lettura dell'automazione non riuscita (HTTP ${r.status})`))
    return r.data
  }

  async save(id: string, config: Record<string, unknown>): Promise<void> {
    const r = await this.rest.request('POST', this.path(id), config, 30_000)
    if (!r.ok) throw new WriteError(r.status, message(r.data, `Salvataggio rifiutato da Home Assistant (HTTP ${r.status})`))
  }

  async remove(id: string): Promise<void> {
    const r = await this.rest.request('DELETE', this.path(id), undefined, 30_000)
    if (!r.ok) throw new WriteError(r.status, message(r.data, `Eliminazione rifiutata da Home Assistant (HTTP ${r.status})`))
  }

  async getState(entityId: string): Promise<HAState | null> {
    const r = await this.rest.get<HAState>(`/states/${encodeURIComponent(entityId)}`)
    return r.ok && r.data && typeof r.data === 'object' ? r.data : null
  }

  async loadedConfig(entityId: string): Promise<Record<string, unknown> | null> {
    try {
      const r = await this.conn.sendMessage<{ config: Record<string, unknown> }>({ type: 'automation/config', entity_id: entityId })
      return r?.config ?? null
    } catch {
      return null
    }
  }

  async ensureCategory(name: string, icon: string, scope: CategoryScope = 'automation'): Promise<string> {
    const list = await this.conn.sendMessage<Array<{ category_id: string; name: string }>>({ type: 'config/category_registry/list', scope })
    const found = list.find((c) => c.name.toLowerCase() === name.toLowerCase())
    if (found) return found.category_id
    const created = await this.conn.sendMessage<{ category_id: string }>({ type: 'config/category_registry/create', scope, name, icon })
    return created.category_id
  }

  async setCategory(entityId: string, categoryId: string, scope: CategoryScope = 'automation'): Promise<void> {
    const domain = entityId.split('.')[0]!
    const ok = scope === 'helpers' ? isHelperDomain(domain) : domain === scope
    if (!ok) throw new WriteError(400, `${entityId} non può ricevere una categoria di tipo ${scope}`)
    await this.conn.sendMessage({ type: 'config/entity_registry/update', entity_id: entityId, categories: { [scope]: categoryId } })
  }

  private scriptPath(key: string): string {
    if (!/^[a-z0-9_]{1,64}$/.test(key)) throw new WriteError(400, `chiave di script non valida: ${key}`)
    return `/config/script/config/${key}`
  }

  async getScript(key: string): Promise<Record<string, unknown> | null> {
    const r = await this.rest.get<Record<string, unknown>>(this.scriptPath(key))
    if (r.status === 404 || r.status === 400) return null
    if (!r.ok || !r.data || typeof r.data !== 'object') throw new WriteError(r.status, message(r.data, `Lettura dello script non riuscita (HTTP ${r.status})`))
    return r.data
  }

  async saveScript(key: string, config: Record<string, unknown>): Promise<void> {
    const r = await this.rest.request('POST', this.scriptPath(key), config, 30_000)
    if (!r.ok) throw new WriteError(r.status, message(r.data, `Salvataggio dello script rifiutato da Home Assistant (HTTP ${r.status})`))
  }

  async removeScript(key: string): Promise<void> {
    const r = await this.rest.request('DELETE', this.scriptPath(key), undefined, 30_000)
    if (!r.ok) throw new WriteError(r.status, message(r.data, `Eliminazione dello script rifiutata da Home Assistant (HTTP ${r.status})`))
  }

  async loadedScript(entityId: string): Promise<Record<string, unknown> | null> {
    try {
      const r = await this.conn.sendMessage<{ config: Record<string, unknown> }>({ type: 'script/config', entity_id: entityId })
      return r?.config ?? null
    } catch {
      return null
    }
  }

  private helperDomain(domain: string): string {
    if (!isHelperDomain(domain)) throw new WriteError(400, `tipo di helper non ammesso: ${domain}`)
    return domain
  }

  async listHelpers(domain: string): Promise<Array<Record<string, unknown>>> {
    const r = await this.conn.sendMessage<Array<Record<string, unknown>>>({ type: `${this.helperDomain(domain)}/list` })
    return Array.isArray(r) ? r : []
  }

  async createHelper(domain: string, config: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.conn.sendMessage<Record<string, unknown>>({ ...config, type: `${this.helperDomain(domain)}/create` }, 30_000)
  }

  async updateHelper(domain: string, id: string, config: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { id: _ignored, ...fields } = config
    return this.conn.sendMessage<Record<string, unknown>>({ ...fields, type: `${this.helperDomain(domain)}/update`, [`${domain}_id`]: id }, 30_000)
  }

  async removeHelper(domain: string, id: string): Promise<void> {
    await this.conn.sendMessage({ type: `${this.helperDomain(domain)}/delete`, [`${domain}_id`]: id }, 30_000)
  }

  async registryEntry(entityId: string): Promise<{ platform: string; unique_id: string } | null> {
    try {
      const r = await this.conn.sendMessage<{ platform?: string; unique_id?: string }>({ type: 'config/entity_registry/get', entity_id: entityId })
      return r && typeof r.platform === 'string' && typeof r.unique_id === 'string' ? { platform: r.platform, unique_id: r.unique_id } : null
    } catch {
      return null
    }
  }

  async entityIdFor(platform: string, uniqueId: string): Promise<string | null> {
    const list = await this.conn.sendMessage<Array<{ entity_id: string; platform: string; unique_id: string }>>({ type: 'config/entity_registry/list' }, 60_000).catch(() => [])
    return list.find((e) => e.platform === platform && e.unique_id === uniqueId)?.entity_id ?? null
  }

  async createInputBoolean(name: string, icon: string): Promise<{ id: string }> {
    return this.conn.sendMessage<{ id: string }>({ type: 'input_boolean/create', name, icon })
  }

  async updateDevice(deviceId: string, patch: { area_id?: string | null; disabled_by?: 'user' | null }): Promise<void> {
    if (!/^[0-9a-f]{32}$/.test(deviceId)) throw new WriteError(400, `id di dispositivo non valido: ${deviceId}`)
    await this.conn.sendMessage({ type: 'config/device_registry/update', device_id: deviceId, ...patch })
  }

  async removeDevice(deviceId: string, configEntryId: string): Promise<void> {
    if (!/^[0-9a-f]{32}$/.test(deviceId)) throw new WriteError(400, `id di dispositivo non valido: ${deviceId}`)
    try {
      await this.conn.sendMessage({ type: 'config/device_registry/remove', device_id: deviceId }, 30_000)
    } catch (err) {
      // Prima della 2026.9 esiste solo il comando (ora deprecato) con la config entry.
      const unknown = (err as { code?: unknown }).code === 'unknown_command' || /unknown command/i.test(err instanceof Error ? err.message : String(err))
      if (!unknown) throw err
      await this.conn.sendMessage({ type: 'config/device_registry/remove_config_entry', device_id: deviceId, config_entry_id: configEntryId }, 30_000)
    }
  }

  async removeEntity(entityId: string): Promise<void> {
    if (!/^[a-z_][a-z0-9_]*\.[a-z0-9_]+$/.test(entityId)) throw new WriteError(400, `entity_id non valido: ${entityId}`)
    await this.conn.sendMessage({ type: 'config/entity_registry/remove', entity_id: entityId })
  }

  async setEnabled(entityId: string, enabled: boolean): Promise<void> {
    if (!entityId.startsWith('automation.')) throw new WriteError(400, 'Si possono attivare o disattivare solo automazioni')
    await this.conn.sendMessage({ type: 'call_service', domain: 'automation', service: enabled ? 'turn_on' : 'turn_off', target: { entity_id: entityId } })
  }
}
