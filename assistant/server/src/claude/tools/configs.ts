import { z } from 'zod'
import { domainOf, sanitizeState, scrubString } from '../../inventory/privacy.ts'
import { collectEntityRefs } from '../../inventory/inventory.ts'
import { formatLocal, toDate } from '../../util/time.ts'
import { HELPER_DOMAINS, HELPER_LABELS, isHelperDomain } from '../../drafts/objects.ts'
import { ENTITY_ID, loadIndex, ToolError, type HomeIndex, type ToolContext } from './common.ts'
import { scrubConfig } from './automations.ts'
import type { ToolSpec } from './registry.ts'

// Lettura di script e helper (dalla 0.8): configurazione, se si possono modificare da qui e
// chi li usa. Servono prima di proporre una modifica con proponi_bozza.

async function usedBy(ctx: ToolContext, entityId: string): Promise<{ automazioni: string[]; script: string[] }> {
  const r = await ctx.ha.call<Record<string, string[]>>({ type: 'search/related', item_type: 'entity', item_id: entityId }).catch(() => ({}) as Record<string, string[]>)
  return { automazioni: (r.automation ?? []).filter((x) => x !== entityId), script: (r.script ?? []).filter((x) => x !== entityId) }
}

function entityStates(idx: HomeIndex, config: unknown, self: string): Record<string, unknown> {
  const refs = new Set<string>()
  collectEntityRefs(config, new Set(idx.states.keys()), refs)
  refs.delete(self)
  const out: Record<string, unknown> = {}
  for (const ref of [...refs].sort().slice(0, 30)) {
    if (!idx.allowed(ref)) {
      out[ref] = 'escluso per privacy'
      continue
    }
    const s = idx.states.get(ref)!
    out[ref] = { stato: sanitizeState(ref, s.state, idx.consents), dalle: formatLocal(s.last_changed, idx.tz, false) }
  }
  return out
}

// --- leggi_script ---------------------------------------------------------------------------

const scriptSchema = z.object({
  script: z.string().min(1).max(120).describe('entity_id (script.xxx) oppure chiave dello script'),
})

export const leggiScript: ToolSpec<typeof scriptSchema> = {
  name: 'leggi_script',
  description:
    "Configurazione completa di uno script (campi, sequenza, modalità), se si può modificare da qui, stato delle entità che usa, chi lo richiama (automazioni e altri script) e ultime esecuzioni. Da leggere prima di proporre una modifica.",
  schema: scriptSchema,
  label: (i) => `Leggo lo script ${i.script}`,
  async run(input, ctx) {
    const idx = await loadIndex(ctx)
    const ref = input.script.trim()
    const entityId = ref.startsWith('script.') ? ref : `script.${ref}`
    const state = idx.states.get(entityId)
    if (!state) throw new ToolError(`Lo script ${entityId} non esiste. Cercalo con cerca_entita.`)
    const cfg = await ctx.ha.call<{ config: unknown }>({ type: 'script/config', entity_id: entityId }).catch(() => null)
    const info = ctx.drafts ? await ctx.drafts.inspect(entityId).catch(() => null) : null
    const key = info?.key ?? entityId.slice('script.'.length)

    let tracce: unknown = 'Nessuna traccia salvata'
    try {
      const list = await ctx.ha.call<Array<Record<string, unknown>>>({ type: 'trace/list', domain: 'script', item_id: key })
      const startOf = (t: Record<string, unknown>) => toDate((t.timestamp as Record<string, unknown> | undefined)?.start)?.getTime() ?? 0
      const recent = list
        .sort((a, b) => startOf(b) - startOf(a))
        .slice(0, 5)
        .map((t) => {
          const ts = (t.timestamp ?? {}) as Record<string, unknown>
          return { inizio: formatLocal(ts.start, idx.tz), stato: t.state, esito: t.script_execution, ultimo_passo: t.last_step, ...(t.error ? { errore: scrubString(String(t.error)) } : {}) }
        })
      if (recent.length) tracce = recent
    } catch {
      // tracce opzionali
    }
    return {
      entity_id: entityId,
      chiave: key,
      alias: idx.name(entityId),
      stato: state.state === 'on' ? 'in esecuzione' : state.state === 'off' ? 'fermo' : state.state,
      ultima_esecuzione: formatLocal(state.attributes.last_triggered, idx.tz) ?? 'mai (negli ultimi riavvii)',
      modificabile: info ? info.editable : 'non verificabile qui',
      ...(info?.reason ? { motivo: info.reason } : {}),
      configurazione: cfg ? scrubConfig(cfg.config) : 'Configurazione non leggibile',
      stato_entita_usate: cfg ? entityStates(idx, cfg.config, entityId) : {},
      richiamato_da: await usedBy(ctx, entityId),
      ultime_esecuzioni: tracce,
    }
  },
}

// --- leggi_helper ---------------------------------------------------------------------------

const ATTRS = ['options', 'min', 'max', 'step', 'mode', 'unit_of_measurement', 'pattern', 'has_date', 'has_time', 'initial', 'minimum', 'maximum', 'duration', 'remaining', 'finishes_at', 'next_event', 'editable']

const helperSchema = z.object({
  entity_id: z.string().regex(ENTITY_ID, 'entity_id non valido').describe(`entity_id dell'helper (${HELPER_DOMAINS.join(', ')})`),
})

export const leggiHelper: ToolSpec<typeof helperSchema> = {
  name: 'leggi_helper',
  description:
    "Configurazione e stato di un helper (interruttore, numero, elenco, testo, data e ora, pulsante, contatore, timer, programmazione), se si può modificare da qui e quali automazioni e script lo usano. Da leggere prima di proporre una modifica: cambiare opzioni o intervalli può rompere chi lo usa.",
  schema: helperSchema,
  label: (i) => `Leggo l'helper ${i.entity_id}`,
  async run(input, ctx) {
    const idx = await loadIndex(ctx)
    const domain = domainOf(input.entity_id)
    if (!isHelperDomain(domain)) throw new ToolError(`${input.entity_id} non è un helper gestito: domini ammessi ${HELPER_DOMAINS.join(', ')}. Per gli script usa leggi_script.`)
    const { state } = idx.requireEntity(input.entity_id)
    const info = ctx.drafts ? await ctx.drafts.inspect(input.entity_id).catch(() => null) : null
    const attributi: Record<string, unknown> = {}
    for (const k of ATTRS) if (state?.attributes[k] !== undefined) attributi[k] = state.attributes[k]
    return {
      entity_id: input.entity_id,
      tipo: `${domain} (${HELPER_LABELS[domain]})`,
      nome: idx.name(input.entity_id),
      stato: state ? sanitizeState(input.entity_id, state.state, idx.consents) : 'non disponibile',
      attributi,
      modificabile: info ? info.editable : 'non verificabile qui',
      ...(info?.reason ? { motivo: info.reason } : {}),
      ...(info?.config ? { configurazione: info.config } : {}),
      usato_da: await usedBy(ctx, input.entity_id),
    }
  },
}
