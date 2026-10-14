import { z } from 'zod'
import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { ToolError, type ToolContext } from './common.ts'
import { cercaEntita, dettagliEntita, infoDispositivo } from './entities.ts'
import { catalogoTrigger, elencaAutomazioni, leggiAutomazione, riepilogoStorico } from './automations.ts'
import { log } from '../../log.ts'

/**
 * Versione del set di strumenti. Lo schema inviato a Claude viene congelato nella conversazione
 * (prompt cache e preserved thinking richiedono un prefisso identico); se un aggiornamento
 * cambia nomi o significato dei parametri, si incrementa e le chat vecchie restano leggibili
 * ma non proseguibili.
 */
export const TOOLSET_VERSION = 1

export interface ToolSpec<S extends z.ZodType> {
  name: string
  description: string
  schema: S
  /** Etichetta breve per l'interfaccia (chip "Cerco …"). */
  label: (input: z.infer<S>) => string
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<unknown>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpec = ToolSpec<any>

export const READ_TOOLS: AnySpec[] = [
  cercaEntita,
  dettagliEntita,
  riepilogoStorico,
  elencaAutomazioni,
  leggiAutomazione,
  catalogoTrigger,
  infoDispositivo,
]

const byName = new Map(READ_TOOLS.map((t) => [t.name, t]))

function jsonSchema(schema: z.ZodType): BetaTool.InputSchema {
  const js = z.toJSONSchema(schema, { io: 'input' }) as Record<string, unknown>
  delete js.$schema
  return js as BetaTool.InputSchema
}

/** Definizioni per l'API. Con lo streaming, eager_input_streaming evita il buffering dell'input. */
export function toolDefinitions(tools: AnySpec[] = READ_TOOLS): BetaTool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: jsonSchema(t.schema),
    eager_input_streaming: true,
  }))
}

export function toolLabel(name: string, input: unknown): string {
  const spec = byName.get(name)
  if (!spec) return name
  const parsed = spec.schema.safeParse(input)
  if (!parsed.success) return spec.name
  try {
    return spec.label(parsed.data)
  } catch {
    return spec.name
  }
}

export interface ToolOutcome {
  content: string
  isError: boolean
}

const MAX_RESULT_CHARS = 60_000

/**
 * Esegue un tool. L'input arriva dal modello (anche in streaming eager, quindi potenzialmente
 * malformato): si valida sempre con lo schema e gli errori tornano a Claude come is_error.
 */
export async function executeTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> {
  const spec = byName.get(name)
  if (!spec) return { content: `Strumento sconosciuto: ${name}`, isError: true }
  const parsed = spec.schema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i: z.core.$ZodIssue) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')
    return { content: `Parametri non validi per ${name}: ${issues}`, isError: true }
  }
  try {
    const result = await spec.run(parsed.data, ctx)
    let text = JSON.stringify(result)
    if (text.length > MAX_RESULT_CHARS) {
      text = text.slice(0, MAX_RESULT_CHARS) + '… [risultato troncato: restringi la richiesta]'
    }
    return { content: text, isError: false }
  } catch (err) {
    if (err instanceof ToolError) return { content: err.message, isError: true }
    log.warn(`Errore nello strumento ${name}`, err instanceof Error ? err.message : err)
    const msg = err instanceof Error ? err.message : String(err)
    return { content: `Errore durante la lettura da Home Assistant: ${msg}`, isError: true }
  }
}
