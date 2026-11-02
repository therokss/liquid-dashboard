import { z } from 'zod'
import { ToolError, type ProposedDraft, type ProposeOutcome, type ToolContext } from './common.ts'
import type { ToolSpec } from './registry.ts'

// Gli unici strumenti "con effetti": preparano una BOZZA. Non scrivono nulla in Home Assistant:
// la scheda in chat mostra controlli e differenze, e solo il tap dell'amministratore applica.

const TIPO_LABEL = { automation: 'automazione', script: 'script', helper: 'helper' } as const

function rejected(r: Extract<ProposeOutcome, { ok: false }>): never {
  const lines = [`Bozza respinta, nulla è stato salvato. Correggi e riprova:`, ...r.errors.map((e) => `- ${e}`)]
  if (r.warnings.length) lines.push('Avvisi:', ...r.warnings.map((w) => `- ${w}`))
  throw new ToolError(lines.join('\n'))
}

function common(d: ProposedDraft) {
  return {
    stato: "in attesa: l'utente vede la scheda con i pulsanti per applicarla o scartarla",
    ...(d.fixes.length ? { correzioni_automatiche: d.fixes } : {}),
    ...(d.warnings.length ? { avvisi: d.warnings } : {}),
    ...(d.critical.length ? { entita_critiche: d.critical.map((c) => `${c.ref}: ${c.reason}`), nota_critiche: "L'utente dovrà confermare due volte." } : {}),
  }
}

// --- proponi_bozza (dalla 0.8) ---------------------------------------------------------------

const elemento = z.object({
  tipo: z.enum(['automazione', 'script', 'helper']),
  yaml: z
    .string()
    .min(10)
    .max(30_000)
    .describe(
      'automazione: alias, description, triggers, conditions, actions, mode. script: alias, description, icon, mode, fields, sequence. helper: UNA chiave col dominio e i suoi campi (es. input_boolean: { name: Modalità ospiti, icon: mdi:account-group }). Niente id, niente !secret/!include.',
    ),
  sostituisce: z
    .string()
    .max(120)
    .optional()
    .describe("Solo per MODIFICARE un oggetto esistente: entity_id (o id dell'automazione, chiave dello script). Ometti per crearne uno nuovo."),
})

const bozzaSchema = z.object({
  elementi: z
    .array(elemento)
    .min(1)
    .max(6)
    .describe("Di solito uno. Più elementi solo se servono insieme (es. helper + script + automazione che li usa): l'utente li approva con un tap e, se uno fallisce, si annullano tutti."),
  spiegazione: z.string().min(1).max(800).describe("Spiegazione breve per l'utente: cosa fa e perché, in 1–3 frasi."),
})

export const proponiBozza: ToolSpec<typeof bozzaSchema> = {
  name: 'proponi_bozza',
  description:
    "Prepara una bozza con automazioni, script e helper (interruttori, numeri, elenchi, testi, data e ora, pulsanti, contatori, timer, programmazioni), nuovi o modifiche di quelli esistenti. Il server controlla YAML, entità, servizi e validazione di Home Assistant: se qualcosa non va ricevi gli errori e devi correggere. Se è valida l'utente la vede in una scheda con le differenze e decide lui se applicarla: tu non puoi applicarla.",
  schema: bozzaSchema,
  label: (i) => {
    if (i.elementi.length > 1) return `Preparo una bozza con ${i.elementi.length} elementi`
    const e = i.elementi[0]!
    return e.sostituisce ? `Preparo la modifica di ${e.sostituisce}` : `Preparo la bozza ${e.tipo === 'automazione' ? 'dell’automazione' : e.tipo === 'script' ? 'dello script' : 'dell’helper'}`
  },
  async run(input, ctx: ToolContext) {
    if (!ctx.drafts || !ctx.call) throw new ToolError('Le bozze non sono disponibili in questo contesto.')
    const r = await ctx.drafts.proposeParts(input, ctx.call)
    if (!r.ok) rejected(r)
    const d = r.draft
    return {
      bozza: d.id,
      elementi: d.parts.map((p) => ({
        tipo: p.object === 'helper' ? `helper ${p.domain}` : TIPO_LABEL[p.object],
        azione: p.kind === 'create' ? 'creazione' : 'modifica',
        nome: p.alias,
        entity_id: p.target?.entityId ?? p.entityId ?? "assegnato da Home Assistant quando l'utente applica",
      })),
      ...common(d),
      controlli: 'superati (YAML, campi, entità, servizi, validazione di Home Assistant)',
      importante: "Non dire che qualcosa è stato creato o modificato: lo saprai da un <evento> quando l'utente applica la bozza.",
    }
  },
}

// --- proponi_automazione (chat fino alla 0.7, ancora eseguibile) ---------------------------------

const schema = z.object({
  yaml: z
    .string()
    .min(10)
    .max(30_000)
    .describe("Automazione completa in YAML (alias, description, triggers, conditions, actions, mode), con la sintassi attuale. Niente id, niente !secret/!include."),
  spiegazione: z.string().min(1).max(800).describe("Spiegazione breve per l'utente: cosa fa e perché, in 1–3 frasi."),
  sostituisce: z
    .string()
    .max(120)
    .optional()
    .describe("Solo per MODIFICARE un'automazione esistente: il suo entity_id o id. Ometti per crearne una nuova."),
})

export const proponiAutomazione: ToolSpec<typeof schema> = {
  name: 'proponi_automazione',
  description:
    "Prepara una bozza di automazione (nuova o modifica di una esistente). Il server controlla YAML, entità, servizi e validazione di Home Assistant: se qualcosa non va ricevi gli errori e devi correggere. Se la bozza è valida l'utente la vede in una scheda con le differenze e decide lui se applicarla: tu non puoi applicarla.",
  schema,
  label: (i) => (i.sostituisce ? `Preparo la modifica di ${i.sostituisce}` : 'Preparo la bozza dell’automazione'),
  async run(input, ctx: ToolContext) {
    if (!ctx.drafts || !ctx.call) throw new ToolError('Le bozze non sono disponibili in questo contesto.')
    const r = await ctx.drafts.propose(input, ctx.call)
    if (!r.ok) rejected(r)
    const d = r.draft
    const main = d.parts[d.parts.length - 1]!
    return {
      bozza: d.id,
      tipo: main.kind === 'create' ? 'nuova automazione' : `modifica di ${main.target?.entityId}`,
      ...common(d),
      controlli: 'superati (YAML, entità, servizi, validazione di Home Assistant)',
      importante: "Non dire che l'automazione è stata creata o modificata: lo saprai da un <evento> quando l'utente la applica.",
    }
  },
}
