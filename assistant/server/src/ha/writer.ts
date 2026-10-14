import type { HAConnection } from './connection.ts'
import type { HARest } from './rest.ts'
import type { HAState } from './types.ts'

// Le UNICHE scritture verso Home Assistant, chiamate solo dal server dopo il tap di un
// amministratore (mai da Claude): salvare/eliminare un'automazione con l'API REST dell'editor,
// assegnarle la categoria "Claude", attivarla o disattivarla.

export class WriteError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export interface AutomationWriter {
  /** Configurazione salvata in automations.yaml, o null se l'id non è modificabile dall'editor. */
  getConfig(id: string): Promise<Record<string, unknown> | null>
  save(id: string, config: Record<string, unknown>): Promise<void>
  remove(id: string): Promise<void>
  getState(entityId: string): Promise<HAState | null>
  /** Configurazione caricata (dopo il reload) dell'automazione. */
  loadedConfig(entityId: string): Promise<Record<string, unknown> | null>
  ensureCategory(name: string, icon: string): Promise<string>
  setCategory(entityId: string, categoryId: string): Promise<void>
  setEnabled(entityId: string, enabled: boolean): Promise<void>
}

/** Creazione dell'interruttore di prova per i collaudi (una sola volta, vedi setup/testHelper.ts). */
export interface HelperWriter {
  createInputBoolean(name: string, icon: string): Promise<{ id: string }>
}

function message(data: unknown, fallback: string): string {
  if (data && typeof data === 'object' && typeof (data as { message?: unknown }).message === 'string') return (data as { message: string }).message
  return typeof data === 'string' && data ? data : fallback
}

export class HAWriter implements AutomationWriter, HelperWriter {
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

  async ensureCategory(name: string, icon: string): Promise<string> {
    const list = await this.conn.sendMessage<Array<{ category_id: string; name: string }>>({ type: 'config/category_registry/list', scope: 'automation' })
    const found = list.find((c) => c.name.toLowerCase() === name.toLowerCase())
    if (found) return found.category_id
    const created = await this.conn.sendMessage<{ category_id: string }>({ type: 'config/category_registry/create', scope: 'automation', name, icon })
    return created.category_id
  }

  async setCategory(entityId: string, categoryId: string): Promise<void> {
    if (!entityId.startsWith('automation.')) throw new WriteError(400, 'Solo le automazioni possono ricevere la categoria')
    await this.conn.sendMessage({ type: 'config/entity_registry/update', entity_id: entityId, categories: { automation: categoryId } })
  }

  async createInputBoolean(name: string, icon: string): Promise<{ id: string }> {
    return this.conn.sendMessage<{ id: string }>({ type: 'input_boolean/create', name, icon })
  }

  async setEnabled(entityId: string, enabled: boolean): Promise<void> {
    if (!entityId.startsWith('automation.')) throw new WriteError(400, 'Si possono attivare o disattivare solo automazioni')
    await this.conn.sendMessage({ type: 'call_service', domain: 'automation', service: enabled ? 'turn_on' : 'turn_off', target: { entity_id: entityId } })
  }
}
