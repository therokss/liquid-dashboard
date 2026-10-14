import { z } from 'zod'
import { sanitizeAttributes, sanitizeDevice, sanitizeState, domainOf } from '../../inventory/privacy.ts'
import { formatLocal } from '../../util/time.ts'
import { deviceSummary, ENTITY_ID, loadIndex, normalize, privacyMessage, ToolError, type ToolContext } from './common.ts'
import { NOISE_PLATFORMS } from '../../inventory/inventory.ts'
import type { ToolSpec } from './registry.ts'

const cercaSchema = z.object({
  testo: z.string().max(120).optional().describe("Parole da cercare in entity_id, nome, area e dispositivo (es. \"luce cucina\"). Tutte le parole devono comparire."),
  dominio: z.string().max(40).optional().describe('Filtra per dominio, es. light, sensor, binary_sensor, switch, climate'),
  area: z.string().max(80).optional().describe("Filtra per area: nome o area_id"),
  device_class: z.string().max(40).optional().describe('Filtra per device_class, es. temperature, motion, door'),
  limite: z.number().int().min(1).max(50).optional().describe('Massimo risultati (predefinito 20)'),
})

export const cercaEntita: ToolSpec<typeof cercaSchema> = {
  name: 'cerca_entita',
  description:
    "Cerca entità di Home Assistant (anche fuori dall'inventario) e ne restituisce lo stato attuale. Usalo per trovare l'entity_id esatto prima di citarlo o usarlo in uno YAML. Le entità disabilitate e quelle escluse per privacy non compaiono.",
  schema: cercaSchema,
  label: (i) => `Cerco ${[i.testo && `"${i.testo}"`, i.dominio, i.area && `in ${i.area}`].filter(Boolean).join(' ') || 'entità'}`,
  async run(input, ctx) {
    const idx = await loadIndex(ctx)
    const words = input.testo ? normalize(input.testo).split(/\s+/).filter(Boolean) : []
    const areaFilter = input.area ? normalize(input.area) : null
    const results: Array<{ id: string; score: number }> = []
    const ids = new Set([...idx.entries.keys(), ...idx.states.keys()])
    for (const id of ids) {
      const entry = idx.entries.get(id)
      if (entry?.disabled_by) continue
      if (!idx.allowed(id)) continue
      const state = idx.states.get(id)
      if (input.dominio && domainOf(id) !== input.dominio) continue
      if (input.device_class && state?.attributes.device_class !== input.device_class) continue
      const area = idx.area(id)
      if (areaFilter && !(area && (normalize(area.name) === areaFilter || normalize(area.area_id) === areaFilter))) continue
      const dev = idx.device(id)
      const hay = normalize([id, idx.name(id), area?.name, area?.aliases.join(' '), deviceSummary(dev)].filter(Boolean).join(' '))
      if (!words.every((w) => hay.includes(w))) continue
      let score = 0
      if (state) score += 4
      if (entry && !entry.entity_category && !entry.hidden_by && !NOISE_PLATFORMS.has(entry.platform)) score += 2
      if (words.length && words.every((w) => normalize(id).includes(w))) score += 1
      results.push({ id, score })
    }
    results.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    const limit = input.limite ?? 20
    return {
      totale: results.length,
      ...(results.length > limit ? { nota: `Mostrati i primi ${limit}: restringi la ricerca per vedere gli altri.` } : {}),
      risultati: results.slice(0, limit).map(({ id }) => {
        const state = idx.states.get(id)
        const entry = idx.entries.get(id)
        return {
          entity_id: id,
          nome: idx.name(id),
          stato: state ? sanitizeState(id, state.state, idx.consents) : 'nessuno stato',
          unita: state?.attributes.unit_of_measurement ?? undefined,
          device_class: state?.attributes.device_class ?? undefined,
          area: idx.area(id)?.name ?? undefined,
          dispositivo: deviceSummary(idx.device(id)) ?? undefined,
          ...(entry?.entity_category ? { categoria_entita: entry.entity_category } : {}),
        }
      }),
    }
  },
}

const dettagliSchema = z.object({
  entity_id: z.string().regex(ENTITY_ID, 'entity_id non valido').describe('entity_id esatto, es. light.cucina'),
})

export const dettagliEntita: ToolSpec<typeof dettagliSchema> = {
  name: 'dettagli_entita',
  description:
    "Stato attuale completo di un'entità: attributi (ripuliti da dati sensibili), ultimo cambio, integrazione, dispositivo, area, e quali automazioni, script e scene la usano.",
  schema: dettagliSchema,
  label: (i) => `Leggo ${i.entity_id}`,
  async run({ entity_id }, ctx) {
    const idx = await loadIndex(ctx)
    const { entry, state } = idx.requireEntity(entity_id)
    let related: Record<string, unknown> = {}
    try {
      const r = await ctx.ha.call<Record<string, string[]>>({ type: 'search/related', item_type: 'entity', item_id: entity_id })
      related = Object.fromEntries(
        ['automation', 'script', 'scene']
          .filter((k) => r[k]?.length)
          .map((k) => [{ automation: 'automazioni', script: 'script', scene: 'scene' }[k]!, r[k]!.filter((id) => idx.allowed(id))]),
      )
    } catch {
      related = { nota: 'Riferimenti non disponibili' }
    }
    const dev = idx.device(entity_id)
    return {
      entity_id,
      nome: idx.name(entity_id),
      stato: state ? sanitizeState(entity_id, state.state, idx.consents) : null,
      attributi: state ? sanitizeAttributes(entity_id, state.attributes, idx.consents) : null,
      ultimo_cambio: state ? formatLocal(state.last_changed, idx.tz) : null,
      ultimo_aggiornamento: state ? formatLocal(state.last_updated, idx.tz) : null,
      area: idx.area(entity_id)?.name ?? null,
      registro: entry
        ? {
            integrazione: entry.platform,
            categoria_entita: entry.entity_category,
            nascosta: Boolean(entry.hidden_by),
            disabilitata: entry.disabled_by ? `sì (${entry.disabled_by})` : false,
            etichette: entry.labels.map((l) => idx.reg.labels.find((x) => x.label_id === l)?.name ?? l),
          }
        : { nota: 'Entità senza unique_id (definita in YAML): non modificabile dalla UI di HA' },
      dispositivo: dev ? { device_id: dev.id, descrizione: deviceSummary(dev) } : null,
      usata_da: related,
    }
  },
}

const infoSchema = z
  .object({
    device_id: z.string().max(64).optional().describe('device_id del dispositivo'),
    entity_id: z.string().regex(ENTITY_ID).optional().describe("In alternativa: un'entità del dispositivo"),
  })
  .refine((v) => Boolean(v.device_id || v.entity_id), { message: 'Indica device_id oppure entity_id' })

export const infoDispositivo: ToolSpec<typeof infoSchema> = {
  name: 'info_dispositivo',
  description:
    "Scheda di un dispositivo: produttore, modello, firmware, integrazione con link alla documentazione HA, tutte le sue entità con lo stato e i trigger di dispositivo disponibili (es. tipi di pressione dei pulsanti).",
  schema: infoSchema,
  label: (i) => `Studio il dispositivo ${i.entity_id ?? i.device_id}`,
  async run(input, ctx) {
    const idx = await loadIndex(ctx)
    let deviceId = input.device_id
    if (!deviceId && input.entity_id) {
      idx.requireEntity(input.entity_id)
      deviceId = idx.entries.get(input.entity_id)?.device_id ?? undefined
      if (!deviceId) throw new ToolError(`${input.entity_id} non appartiene a nessun dispositivo.`)
    }
    const dev = idx.devices.get(deviceId!)
    if (!dev) throw new ToolError(`Dispositivo ${deviceId} non trovato.`)
    const own = idx.reg.entities.filter((e) => e.device_id === dev.id)
    const blocked = own.map((e) => idx.privacyCategory(e.entity_id)).find((c) => c && !idx.consents[c])
    if (blocked) throw new ToolError(privacyMessage(blocked))

    const domain = (dev.primary_config_entry && idx.reg.configEntryDomain[dev.primary_config_entry]) || own[0]?.platform || null
    const [manifest, triggers] = await Promise.all([
      domain
        ? ctx.ha
            .call<Record<string, unknown>>({ type: 'manifest/get', integration: domain })
            .then((m) => ({ nome: m.name, documentazione: m.documentation, iot_class: m.iot_class, tipo: m.integration_type }))
            .catch(() => null)
        : Promise.resolve(null),
      ctx.ha
        .call<Array<Record<string, unknown>>>({ type: 'device_automation/trigger/list', device_id: dev.id })
        .then((list) =>
          list.slice(0, 60).map((t) => ({
            dominio: t.domain,
            tipo: t.type,
            ...(t.subtype ? { sottotipo: t.subtype } : {}),
            ...(typeof t.entity_id === 'string' && ENTITY_ID.test(t.entity_id) ? { entity_id: t.entity_id } : {}),
          })),
        )
        .catch(() => []),
    ])
    return {
      dispositivo: sanitizeDevice(dev),
      area: dev.area_id ? (idx.areas.get(dev.area_id)?.name ?? null) : null,
      integrazione: domain,
      manifest,
      entita: own
        .filter((e) => !e.disabled_by)
        .sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1))
        .map((e) => {
          const s = idx.states.get(e.entity_id)
          return {
            entity_id: e.entity_id,
            nome: idx.name(e.entity_id),
            stato: s ? sanitizeState(e.entity_id, s.state, idx.consents) : null,
            ...(e.entity_category ? { categoria: e.entity_category } : {}),
            ...(s?.attributes.device_class ? { device_class: s.attributes.device_class } : {}),
          }
        }),
      entita_disabilitate: own.filter((e) => e.disabled_by).length,
      trigger_di_dispositivo: triggers,
    }
  },
}
