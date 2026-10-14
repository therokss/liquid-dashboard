import { z } from 'zod'
import { sanitizeState, scrubString, domainOf } from '../../inventory/privacy.ts'
import { collectEntityRefs } from '../../inventory/inventory.ts'
import { formatLocal, toDate } from '../../util/time.ts'
import { ENTITY_ID, loadIndex, normalize, ToolError, type HomeIndex, type ToolContext } from './common.ts'
import { summarizeSeries, summarizeStatistics, toSamples } from './history.ts'
import type { ToolSpec } from './registry.ts'

// --- riepilogo_storico ------------------------------------------------------------------

const MAX_RECORDER_HOURS = 240

const storicoSchema = z.object({
  entity_ids: z.array(z.string().regex(ENTITY_ID, 'entity_id non valido')).min(1).max(5).describe('Da 1 a 5 entity_id'),
  ore: z
    .number()
    .int()
    .min(1)
    .max(2160)
    .optional()
    .describe(`Ampiezza del periodo in ore (predefinito 24). Fino a ${MAX_RECORDER_HOURS} h si usa lo storico degli stati; oltre, le statistiche giornaliere (solo sensori numerici con statistiche).`),
  fine: z.string().max(40).optional().describe('Fine del periodo, ISO 8601 (predefinito: adesso)'),
})

export const riepilogoStorico: ToolSpec<typeof storicoSchema> = {
  name: 'riepilogo_storico',
  description:
    "Riepilogo dello storico di 1–5 entità in un periodo: per i valori numerici min/max/media e andamento per fasce orarie o giornaliere; per gli stati discreti numero di cambi, tempo in ciascuno stato e ultimi passaggi con l'orario. Gli orari sono locali.",
  schema: storicoSchema,
  label: (i) => `Analizzo lo storico di ${i.entity_ids.join(', ')}${i.ore ? ` (${i.ore} h)` : ''}`,
  async run(input, ctx) {
    const idx = await loadIndex(ctx)
    for (const id of input.entity_ids) idx.requireEntity(id)
    const hours = input.ore ?? 24
    const end = input.fine ? toDate(input.fine) : ctx.now()
    if (!end) throw new ToolError('Il campo "fine" non è una data ISO valida.')
    const endMs = Math.min(end.getTime(), ctx.now().getTime())
    const startMs = endMs - hours * 3_600_000
    const periodo = { da: formatLocal(startMs, idx.tz, false), a: formatLocal(endMs, idx.tz, false) }

    if (hours > MAX_RECORDER_HOURS) {
      const r = await ctx.ha.call<Record<string, unknown[]>>(
        {
          type: 'recorder/statistics_during_period',
          start_time: new Date(startMs).toISOString(),
          end_time: new Date(endMs).toISOString(),
          statistic_ids: input.entity_ids,
          period: 'day',
          types: ['mean', 'min', 'max', 'change'],
        },
        60_000,
      )
      return {
        periodo,
        entita: Object.fromEntries(
          input.entity_ids.map((id) => [
            id,
            r[id]?.length
              ? summarizeStatistics(r[id]!, idx.tz)
              : { tipo: 'vuoto', nota: 'Nessuna statistica a lungo termine: serve un sensore numerico con state_class. Riduci il periodo a 240 ore o meno.' },
          ]),
        ),
      }
    }

    const r = await ctx.ha.call<Record<string, unknown[]>>(
      {
        type: 'history/history_during_period',
        start_time: new Date(startMs).toISOString(),
        end_time: new Date(endMs).toISOString(),
        entity_ids: input.entity_ids,
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      },
      60_000,
    )
    const buckets = hours <= 48 ? Math.ceil(hours) : Math.ceil(hours / 24)
    return {
      periodo,
      entita: Object.fromEntries(
        input.entity_ids.map((id) => {
          const samples = toSamples(r[id] ?? []).map((x) => ({ t: x.t, s: sanitizeState(id, x.s, idx.consents) }))
          return [id, { nome: idx.name(id), ...summarizeSeries(samples, { startMs, endMs, tz: idx.tz, buckets }) }]
        }),
      ),
    }
  },
}

// --- elenca_automazioni -----------------------------------------------------------------

const elencaSchema = z.object({
  testo: z.string().max(120).optional().describe("Parole da cercare nell'alias o nell'entity_id"),
  entity_id: z.string().regex(ENTITY_ID).optional().describe("Solo le automazioni che usano questa entità"),
  solo_disattivate: z.boolean().optional().describe('Solo le automazioni disattivate'),
})

export const elencaAutomazioni: ToolSpec<typeof elencaSchema> = {
  name: 'elenca_automazioni',
  description:
    "Elenco aggiornato delle automazioni con stato (attiva/disattivata), ultima esecuzione, modalità e categoria. Filtrabile per testo o per entità usata.",
  schema: elencaSchema,
  label: (i) => (i.entity_id ? `Cerco le automazioni che usano ${i.entity_id}` : i.testo ? `Cerco automazioni "${i.testo}"` : 'Elenco le automazioni'),
  async run(input, ctx) {
    const idx = await loadIndex(ctx)
    let only: Set<string> | null = null
    if (input.entity_id) {
      idx.requireEntity(input.entity_id)
      const r = await ctx.ha.call<Record<string, string[]>>({ type: 'search/related', item_type: 'entity', item_id: input.entity_id })
      only = new Set(r.automation ?? [])
    }
    const words = input.testo ? normalize(input.testo).split(/\s+/).filter(Boolean) : []
    const cats = new Map(idx.reg.automationCategories.map((c) => [c.category_id, c.name]))
    const list = [...idx.states.values()]
      .filter((s) => domainOf(s.entity_id) === 'automation')
      .filter((s) => !only || only.has(s.entity_id))
      .filter((s) => !input.solo_disattivate || s.state === 'off')
      .filter((s) => {
        const hay = normalize(`${s.entity_id} ${idx.name(s.entity_id)}`)
        return words.every((w) => hay.includes(w))
      })
      .sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1))
      .map((s) => {
        const catId = idx.entries.get(s.entity_id)?.categories.automation
        return {
          entity_id: s.entity_id,
          alias: idx.name(s.entity_id),
          id: typeof s.attributes.id === 'string' ? s.attributes.id : null,
          stato: s.state === 'on' ? 'attiva' : s.state === 'off' ? 'disattivata' : s.state,
          ultima_esecuzione: formatLocal(s.attributes.last_triggered, idx.tz, false) ?? 'mai (negli ultimi riavvii)',
          modalita: s.attributes.mode ?? null,
          ...(catId && cats.get(catId) ? { categoria: cats.get(catId) } : {}),
        }
      })
    return { totale: list.length, automazioni: list }
  },
}

// --- leggi_automazione ------------------------------------------------------------------

const leggiSchema = z.object({
  automazione: z.string().min(1).max(120).describe("entity_id (automation.xxx) oppure id dell'automazione"),
})

/** Toglie dalla configurazione segreti tipici (webhook_id, token, URL con credenziali). */
export function scrubConfig(v: unknown, depth = 0): unknown {
  if (depth > 40) return '[troppo annidato]'
  if (typeof v === 'string') return scrubString(v)
  if (Array.isArray(v)) return v.map((x) => scrubConfig(x, depth + 1))
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v)) {
      out[k] = /webhook_id|token|password|api_?key|secret/i.test(k) ? '[nascosto]' : scrubConfig(x, depth + 1)
    }
    return out
  }
  return v
}

function resolveAutomation(idx: HomeIndex, ref: string): string {
  if (ref.startsWith('automation.')) {
    if (!idx.states.has(ref)) throw new ToolError(`L'automazione ${ref} non esiste. Usa elenca_automazioni.`)
    return ref
  }
  for (const s of idx.states.values()) {
    if (domainOf(s.entity_id) === 'automation' && s.attributes.id === ref) return s.entity_id
  }
  throw new ToolError(`Nessuna automazione con id "${ref}". Usa elenca_automazioni.`)
}

export const leggiAutomazione: ToolSpec<typeof leggiSchema> = {
  name: 'leggi_automazione',
  description:
    "Configurazione completa di un'automazione, stato attuale delle entità che usa e sintesi delle ultime esecuzioni (tracce): orario, trigger, esito, ultimo passo ed eventuale errore. Primo strumento per capire perché un'automazione è o non è scattata.",
  schema: leggiSchema,
  label: (i) => `Leggo l'automazione ${i.automazione}`,
  async run(input, ctx) {
    const idx = await loadIndex(ctx)
    const entityId = resolveAutomation(idx, input.automazione)
    const state = idx.states.get(entityId)!
    const id = typeof state.attributes.id === 'string' ? state.attributes.id : null

    const cfg = await ctx.ha.call<{ config: unknown }>({ type: 'automation/config', entity_id: entityId }).catch(() => null)
    const refs = new Set<string>()
    if (cfg) collectEntityRefs(cfg.config, new Set(idx.states.keys()), refs)
    refs.delete(entityId)
    const statiEntita: Record<string, unknown> = {}
    for (const ref of [...refs].sort().slice(0, 30)) {
      if (!idx.allowed(ref)) {
        statiEntita[ref] = 'escluso per privacy'
        continue
      }
      const s = idx.states.get(ref)!
      statiEntita[ref] = { stato: sanitizeState(ref, s.state, idx.consents), dalle: formatLocal(s.last_changed, idx.tz, false) }
    }

    let tracce: unknown = 'Tracce non disponibili (automazione senza id o tracce disattivate)'
    if (id) {
      try {
        const list = await ctx.ha.call<Array<Record<string, unknown>>>({ type: 'trace/list', domain: 'automation', item_id: id })
        const startOf = (t: Record<string, unknown>) => toDate((t.timestamp as Record<string, unknown> | undefined)?.start)?.getTime() ?? 0
        tracce = list
          .sort((a, b) => startOf(b) - startOf(a))
          .slice(0, 5)
          .map((t) => {
            const ts = (t.timestamp ?? {}) as Record<string, unknown>
            return {
              inizio: formatLocal(ts.start, idx.tz),
              fine: formatLocal(ts.finish, idx.tz),
              stato: t.state,
              esito: t.script_execution,
              trigger: typeof t.trigger === 'string' ? scrubString(t.trigger) : t.trigger,
              ultimo_passo: t.last_step,
              ...(t.error ? { errore: scrubString(String(t.error)) } : {}),
            }
          })
        if (Array.isArray(tracce) && tracce.length === 0) tracce = 'Nessuna traccia salvata (HA conserva solo le ultime esecuzioni e le perde al riavvio se non memorizzate)'
      } catch {
        // tracce opzionali
      }
    }
    return {
      entity_id: entityId,
      id,
      alias: idx.name(entityId),
      stato: state.state === 'on' ? 'attiva' : state.state === 'off' ? 'disattivata' : state.state,
      ultima_esecuzione: formatLocal(state.attributes.last_triggered, idx.tz),
      esecuzioni_in_corso: state.attributes.current ?? 0,
      configurazione: cfg ? scrubConfig(cfg.config) : 'Configurazione non leggibile',
      stato_entita_usate: statiEntita,
      ultime_esecuzioni: tracce,
    }
  },
}

// --- catalogo_trigger -------------------------------------------------------------------

const catalogoSchema = z.object({
  filtro: z.string().max(60).optional().describe('Integrazione o parola chiave (es. "light", "calendar", "occupancy"). Senza filtro restituisce solo i nomi.'),
})

let catalogCache: { at: number; value: Record<string, unknown> } | null = null

export const catalogoTrigger: ToolSpec<typeof catalogoSchema> = {
  name: 'catalogo_trigger',
  description:
    "Catalogo dei tipi di trigger disponibili in questa installazione di Home Assistant, inclusi quelli specifici delle integrazioni, con i campi accettati. Consultalo prima di usare un trigger diverso da state, numeric_state, time, sun, event, template.",
  schema: catalogoSchema,
  label: (i) => `Consulto il catalogo dei trigger${i.filtro ? ` (${i.filtro})` : ''}`,
  async run(input, ctx) {
    if (!catalogCache || Date.now() - catalogCache.at > 10 * 60_000) {
      const first = await ctx.ha.subscribeOnce({ type: 'trigger_platforms/subscribe' }, 8_000)
      if (!first || typeof first !== 'object') throw new ToolError('Catalogo dei trigger non disponibile in questo momento.')
      catalogCache = { at: Date.now(), value: first as Record<string, unknown> }
    }
    const all = catalogCache.value
    const keys = Object.keys(all).sort()
    if (!input.filtro) return { totale: keys.length, trigger: keys, nota: 'Usa il parametro filtro per vedere i campi di un gruppo di trigger.' }
    const f = normalize(input.filtro)
    const match = keys.filter((k) => normalize(k).includes(f)).slice(0, 25)
    return {
      totale: match.length,
      trigger: Object.fromEntries(match.map((k) => [k, compactDescription(all[k])])),
    }
  },
}

/** Riduce la descrizione di un trigger a nomi dei campi, obbligatorietà e tipo di selettore. */
function compactDescription(desc: unknown): unknown {
  if (!desc || typeof desc !== 'object') return desc ?? null
  const d = desc as Record<string, unknown>
  const fields = d.fields && typeof d.fields === 'object' ? (d.fields as Record<string, Record<string, unknown>>) : {}
  return {
    ...(d.target ? { target: Object.keys(d.target as object).length ? d.target : true } : {}),
    campi: Object.fromEntries(
      Object.entries(fields).map(([name, f]) => {
        const selector = f?.selector && typeof f.selector === 'object' ? (f.selector as Record<string, unknown>) : {}
        const type = Object.keys(selector)[0]
        const conf = type ? selector[type] : null
        return [name, { ...(f?.required ? { obbligatorio: true } : {}), ...(type ? { tipo: type } : {}), ...(conf && typeof conf === 'object' && Object.keys(conf).length ? { opzioni: conf } : {}) }]
      }),
    ),
  }
}

export function resetTriggerCatalogCache(): void {
  catalogCache = null
}
