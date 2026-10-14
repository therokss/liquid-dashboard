import type { HAReader } from '../../ha/data.ts'
import type { AreaEntry, DeviceEntry, EntityEntry, HAState, Registries } from '../../ha/types.ts'
import { deviceName } from '../../ha/types.ts'
import { buildPrivacyIndex, classifyPrivacy, PRIVACY_LABELS, type Consents, type PrivacyCategory } from '../../inventory/privacy.ts'
import { entityName } from '../../inventory/inventory.ts'

export interface ToolContext {
  ha: HAReader
  /** Letti a ogni chiamata: se l'utente revoca un consenso vale subito, anche nelle chat aperte. */
  consents: () => Consents
  now: () => Date
}

/** Errore "atteso" di un tool: diventa un tool_result con is_error e questo messaggio. */
export class ToolError extends Error {}

export interface HomeIndex {
  reg: Registries
  states: Map<string, HAState>
  tz: string
  consents: Consents
  entries: Map<string, EntityEntry>
  devices: Map<string, DeviceEntry>
  areas: Map<string, AreaEntry>
  privacyCategory(entityId: string): PrivacyCategory | null
  allowed(entityId: string): boolean
  /** Lancia ToolError se l'entità non esiste o è esclusa per privacy. */
  requireEntity(entityId: string): { entry: EntityEntry | undefined; state: HAState | undefined }
  name(entityId: string): string
  area(entityId: string): AreaEntry | undefined
  device(entityId: string): DeviceEntry | undefined
}

export const ENTITY_ID = /^[a-z_][a-z0-9_]*\.[a-z0-9_]+$/

export function privacyMessage(cat: PrivacyCategory): string {
  return `Dato escluso per privacy (categoria: ${PRIVACY_LABELS[cat]}). L'utente può riattivare la categoria da Impostazioni → Privacy dell'add-on.`
}

export async function loadIndex(ctx: ToolContext): Promise<HomeIndex> {
  const [reg, states, cfg] = await Promise.all([ctx.ha.registries(), ctx.ha.states(), ctx.ha.config()])
  const consents = ctx.consents()
  const entries = new Map(reg.entities.map((e) => [e.entity_id, e]))
  const devices = new Map(reg.devices.map((d) => [d.id, d]))
  const areas = new Map(reg.areas.map((a) => [a.area_id, a]))
  const privacy = buildPrivacyIndex(reg.entities)

  const privacyCategory = (id: string) => classifyPrivacy(id, entries.get(id), privacy)
  const allowed = (id: string) => {
    const cat = privacyCategory(id)
    return cat === null || consents[cat]
  }
  const device = (id: string) => {
    const devId = entries.get(id)?.device_id
    return devId ? devices.get(devId) : undefined
  }
  return {
    reg, states, tz: cfg.time_zone, consents, entries, devices, areas,
    privacyCategory,
    allowed,
    requireEntity(entityId) {
      const entry = entries.get(entityId)
      const state = states.get(entityId)
      if (!entry && !state) throw new ToolError(`L'entità ${entityId} non esiste. Usa cerca_entita per trovare l'entity_id corretto.`)
      const cat = privacyCategory(entityId)
      if (cat && !consents[cat]) throw new ToolError(privacyMessage(cat))
      return { entry, state }
    },
    name: (id) => entityName(id, entries.get(id), states.get(id)),
    area(id) {
      const areaId = entries.get(id)?.area_id ?? device(id)?.area_id
      return areaId ? areas.get(areaId) : undefined
    },
    device,
  }
}

/** Minuscole, senza accenti, con _ e . come spazi: per confronti tolleranti. */
export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[._-]+/g, ' ')
}

export function deviceSummary(d: DeviceEntry | undefined): string | null {
  if (!d) return null
  const model = [d.manufacturer, d.model].filter(Boolean).join(' ')
  return model ? `${deviceName(d)} (${model})` : deviceName(d)
}
