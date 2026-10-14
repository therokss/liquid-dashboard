import { z } from 'zod'
import { ToolError, type ToolContext } from './common.ts'
import type { ToolSpec } from './registry.ts'

// L'unico strumento "con effetti": prepara una BOZZA. Non scrive nulla in Home Assistant:
// la scheda in chat mostra controlli e differenze, e solo il tap dell'amministratore applica.

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
    if (!r.ok) {
      const lines = [`Bozza respinta, nulla è stato salvato. Correggi e riprova:`, ...r.errors.map((e) => `- ${e}`)]
      if (r.warnings.length) lines.push('Avvisi:', ...r.warnings.map((w) => `- ${w}`))
      throw new ToolError(lines.join('\n'))
    }
    const d = r.draft
    return {
      bozza: d.id,
      tipo: d.kind === 'create' ? 'nuova automazione' : `modifica di ${d.target?.entityId}`,
      stato: "in attesa: l'utente vede la scheda con i pulsanti per applicarla o scartarla",
      controlli: 'superati (YAML, entità, servizi, validazione di Home Assistant)',
      ...(d.fixes.length ? { correzioni_automatiche: d.fixes } : {}),
      ...(d.warnings.length ? { avvisi: d.warnings } : {}),
      ...(d.critical.length ? { entita_critiche: d.critical.map((c) => `${c.ref}: ${c.reason}`), nota_critiche: "L'utente dovrà confermare due volte." } : {}),
      importante: "Non dire che l'automazione è stata creata o modificata: lo saprai da un <evento> quando l'utente la applica.",
    }
  },
}
