import type { AutomationConfig } from './automation.ts'
import { entityCandidates } from '../inventory/inventory.ts'
import { domainOf } from '../inventory/privacy.ts'

// Controlli che Home Assistant NON fa al salvataggio: un'automazione con un entity_id
// inesistente viene accettata e poi semplicemente non funziona. Qui la bozza viene
// respinta prima, così Claude può correggerla.

/** Domini e servizi che un'automazione proposta dall'assistente non può usare. */
export const DENIED_DOMAINS = new Set(['shell_command', 'python_script', 'pyscript', 'rest_command', 'command_line', 'hassio'])
export const DENIED_SERVICES = new Set([
  'homeassistant.restart', 'homeassistant.stop', 'homeassistant.reload_all', 'homeassistant.reload_core_config',
  'recorder.purge', 'recorder.purge_entities', 'recorder.disable', 'update.install', 'update.skip', 'system_log.clear',
  'zha.remove', 'backup.restore',
])
/** Servizi che aggirano il controllo per entità (possono comandare qualunque cosa): doppia conferma. */
const CRITICAL_SERVICES = new Set(['mqtt.publish'])

const CRITICAL_DOMAINS = new Set(['lock', 'alarm_control_panel', 'siren', 'valve'])
const CRITICAL_COVER_CLASSES = new Set(['garage', 'gate', 'door'])
const CRITICAL_NAME = /(apri|porta|portone|cancell|garage|serratur|citofon|door|gate|unlock|lock)/i

export interface CheckContext {
  /** Entità esistenti e non disabilitate. */
  entities: Map<string, { name: string; deviceClass: string | null; privacy: boolean }>
  devices: Set<string>
  areas: Set<string>
  floors: Set<string>
  labels: Set<string>
  /** dominio → servizi registrati. */
  services: Map<string, Set<string>>
  /** Tipi di trigger disponibili (null se il catalogo non è raggiungibile). */
  triggerTypes: Set<string> | null
  /** id di registro (uuid) delle entità non disabilitate: li usano trigger e azioni "device". */
  registryIds?: Set<string>
}

export const REGISTRY_ID_RE = /^[0-9a-f]{32}$/

export interface CriticalRef {
  ref: string
  reason: string
}

export interface CheckResult {
  errors: string[]
  warnings: string[]
  entities: string[]
  services: string[]
  critical: CriticalRef[]
}

export const isTemplate = (s: string) => s.includes('{{') || s.includes('{%')

export function idList(v: unknown): string[] {
  if (typeof v === 'string') return v.split(',').map((s) => s.trim()).filter(Boolean)
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  return []
}

export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Tutti i passi di azione, anche annidati, con il loro percorso (per i messaggi). */
export function* walkSteps(steps: unknown, path: string): Generator<{ step: Record<string, unknown>; path: string }> {
  const list = Array.isArray(steps) ? steps : steps === undefined ? [] : [steps]
  for (const [i, step] of list.entries()) {
    if (!isObj(step)) continue
    const p = `${path}[${i}]`
    yield { step, path: p }
    if (Array.isArray(step.choose)) {
      for (const [k, c] of step.choose.entries()) if (isObj(c)) yield* walkSteps(c.sequence, `${p}.choose[${k}].sequence`)
    }
    for (const key of ['default', 'then', 'else', 'sequence', 'parallel']) {
      if (step[key] !== undefined) yield* walkSteps(step[key], `${p}.${key}`)
    }
    if (isObj(step.repeat)) yield* walkSteps(step.repeat.sequence, `${p}.repeat.sequence`)
  }
}

/**
 * `allowedServices`: servizi già usati dalla versione attuale di un'automazione che si sta
 * modificando: restano ammessi anche se l'assistente non potrebbe introdurli.
 */
export function checkAutomation(config: AutomationConfig, ctx: CheckContext, opts: { allowedServices?: Set<string> } = {}): CheckResult {
  const errors: string[] = []
  const warnings: string[] = []
  const referenced = new Set<string>()
  const actionEntities = new Set<string>()
  const services = new Set<string>()
  const critical: CriticalRef[] = []
  const domains = new Set([...ctx.entities.keys()].map(domainOf))

  // Riferimenti espliciti (entity_id, device_id, area_id…) e dentro i template.
  const walk = (v: unknown, inActions: boolean, depth: number): void => {
    if (depth > 40) return
    if (typeof v === 'string') {
      if (!isTemplate(v)) return
      for (const id of entityCandidates(v, domains)) {
        referenced.add(id)
        if (inActions) actionEntities.add(id)
      }
      return
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, inActions, depth + 1)
      return
    }
    if (!isObj(v)) return
    for (const [key, val] of Object.entries(v)) {
      if (key === 'entity_id') {
        // Un entity_id a template si controlla solo come template (sotto), mai diviso alle virgole.
        for (const id of typeof val === 'string' && isTemplate(val) ? [] : idList(val)) {
          if (id === 'all' || id === 'none' || isTemplate(id)) continue
          if (REGISTRY_ID_RE.test(id)) {
            if (ctx.registryIds && !ctx.registryIds.has(id)) errors.push(`L'entità con id di registro ${id} non esiste più (o è disabilitata).`)
            continue
          }
          if (!/^[a-z_][a-z0-9_]*\.[a-z0-9_]+$/.test(id)) errors.push(`entity_id non valido: "${id}".`)
          else if (!ctx.entities.has(id)) errors.push(`L'entità ${id} non esiste (o è disabilitata). Cerca quella giusta con cerca_entita.`)
          else {
            referenced.add(id)
            if (inActions) actionEntities.add(id)
          }
        }
      } else if (key === 'device_id') {
        for (const id of idList(val)) if (!isTemplate(id) && !ctx.devices.has(id)) errors.push(`Il dispositivo ${id} non esiste.`)
      } else if (key === 'area_id') {
        for (const id of idList(val)) if (!isTemplate(id) && !ctx.areas.has(id)) errors.push(`L'area ${id} non esiste.`)
      } else if (key === 'floor_id') {
        for (const id of idList(val)) if (!isTemplate(id) && !ctx.floors.has(id)) errors.push(`Il piano ${id} non esiste.`)
      } else if (key === 'label_id') {
        for (const id of idList(val)) if (!isTemplate(id) && !ctx.labels.has(id)) errors.push(`L'etichetta ${id} non esiste.`)
      }
      walk(val, inActions, depth + 1)
    }
  }
  walk(config.triggers, false, 0)
  walk(config.conditions, false, 0)
  walk(config.variables, false, 0)
  walk(config.actions, true, 0)

  for (const id of referenced) {
    if (!ctx.entities.has(id)) warnings.push(`Il template cita ${id}, che non esiste.`)
  }

  // Tipi di trigger
  for (const [i, t] of (Array.isArray(config.triggers) ? config.triggers : []).entries()) {
    if (!isObj(t)) continue
    const type = t.trigger
    if (typeof type !== 'string') {
      if (!('triggers' in t)) errors.push(`Il trigger ${i + 1} non ha la chiave \`trigger:\`.`)
      continue
    }
    if (ctx.triggerTypes && !ctx.triggerTypes.has(type) && !ctx.triggerTypes.has(type.split('.')[0]!)) {
      warnings.push(`Tipo di trigger "${type}" non presente nel catalogo: verifica con catalogo_trigger.`)
    }
  }

  // Servizi: esistenti, mai con nome a template, mai quelli vietati.
  for (const { step, path } of walkSteps(config.actions, 'actions')) {
    const action = step.action
    if (action === undefined) continue
    if (typeof action !== 'string') {
      errors.push(`${path}: \`action\` deve essere un testo "dominio.servizio".`)
      continue
    }
    if (isTemplate(action)) {
      errors.push(`${path}: il nome del servizio non può essere un template.`)
      continue
    }
    const m = /^([a-z_][a-z0-9_]*)\.([a-z0-9_]+)$/.exec(action)
    if (!m) {
      errors.push(`${path}: "${action}" non è nel formato dominio.servizio.`)
      continue
    }
    const [, domain, service] = m
    if ((DENIED_DOMAINS.has(domain!) || DENIED_SERVICES.has(action)) && !opts.allowedServices?.has(action)) {
      errors.push(`${path}: il servizio ${action} non è ammesso nelle automazioni create dall'assistente.`)
      continue
    }
    if (!ctx.services.get(domain!)?.has(service!)) {
      errors.push(`${path}: il servizio ${action} non esiste in questa installazione.`)
      continue
    }
    services.add(action)
    if (action === 'notify.notify') warnings.push(`${path}: notify.notify invia al servizio di notifica predefinito: meglio indicare il dispositivo (es. notify.mobile_app_…).`)
    if (CRITICAL_DOMAINS.has(domain!)) critical.push({ ref: action, reason: 'comanda serrature, allarmi, sirene o valvole' })
    else if (CRITICAL_SERVICES.has(action)) critical.push({ ref: action, reason: 'servizio generico che può comandare qualunque dispositivo' })
  }

  // Entità critiche toccate dalle azioni.
  for (const id of actionEntities) {
    const info = ctx.entities.get(id)
    if (!info) continue
    const domain = domainOf(id)
    let reason: string | null = null
    if (CRITICAL_DOMAINS.has(domain)) reason = 'serratura, allarme, sirena o valvola'
    else if (domain === 'cover' && info.deviceClass && CRITICAL_COVER_CLASSES.has(info.deviceClass)) reason = 'garage, cancello o porta motorizzata'
    else if ((domain === 'button' || domain === 'switch') && (CRITICAL_NAME.test(id) || CRITICAL_NAME.test(info.name))) reason = 'apre porte, cancelli o serrature'
    else if (info.privacy) reason = 'telecamera, citofono o altra entità esclusa per privacy'
    if (reason && !critical.some((c) => c.ref === id)) critical.push({ ref: id, reason })
  }

  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)], entities: [...referenced].sort(), services: [...services].sort(), critical }
}
