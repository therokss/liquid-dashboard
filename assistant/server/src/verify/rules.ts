import { modernize } from '../drafts/automation.ts'
import { idList, isObj, isTemplate, walkSteps, REGISTRY_ID_RE, type CheckContext } from '../drafts/checks.ts'
import { entityCandidates } from '../inventory/inventory.ts'
import { domainOf } from '../inventory/privacy.ts'
import { formatDuration } from '../util/time.ts'
import { replacement, SimilarityIndex } from './similar.ts'
import { checkTimePattern } from './timepattern.ts'
import type { AutomationReport, AutomationSource, Finding, Fix, RuleId, Severity, TraceStats } from './types.ts'

// Controllo rapido: regole deterministiche sulle configurazioni, sullo stato attuale delle
// entità, sulle statistiche e sulle tracce. Nessun dato esce dall'add-on.

export interface EntityInfo {
  name: string
  /** nel registro ma disabilitata */
  disabled: boolean
  /** stato attuale; null se l'entità è nel registro ma non è caricata */
  state: string | null
  lastChanged: number | null
}

export interface TraceSummary {
  start: number
  execution: string | null
  error: string | null
}

export interface AutomationInput {
  entityId: string
  id: string | null
  alias: string
  /** on, off, unavailable */
  state: string
  lastTriggered: number | null
  /** configurazione caricata (automation/config); null se non leggibile */
  config: Record<string, unknown> | null
  source: AutomationSource
  traces: TraceSummary[]
  /** errori di validate_config (solo per quelle non caricate) */
  validation?: string[]
}

export interface StaticInput {
  now: number
  automations: AutomationInput[]
  ctx: CheckContext
  /** tutte le entità note: stati ∪ registro (anche disabilitate) */
  entities: Map<string, EntityInfo>
  /** id di registro (uuid) → entity_id, anche delle disabilitate */
  registryIds: Map<string, string>
  devices: Map<string, { name: string; disabled: boolean }>
  /** min/max giornalieri delle statistiche (ultimi 30 giorni) */
  stats: Map<string, { min: number; max: number; days: number }>
}

export type Draft = Omit<Finding, 'id'>

type Section = 'triggers' | 'conditions' | 'actions' | 'variables'
const SECTION_TEXT: Record<Section, string> = {
  triggers: 'Il trigger che la usa non può scattare.',
  conditions: 'La condizione che la usa non sarà mai soddisfatta.',
  actions: "L'azione su questa entità non ha effetto (Home Assistant la salta con un avviso nel log).",
  variables: 'Le variabili che la usano restano vuote.',
}

const ENTITY_RE = /^[a-z_][a-z0-9_]*\.[a-z0-9_]+$/
const DAY = 86_400_000

/** Domini il cui stato "unknown" o senza cambi è normale (pulsanti, scene, eventi…). */
const STATELESS_DOMAINS = new Set(['button', 'input_button', 'scene', 'event', 'notify', 'tts', 'stt', 'conversation', 'image', 'ai_task', 'script', 'automation'])
/** Domini con attributi che cambiano spesso: un trigger state senza `to` scatta anche per quelli. */
const NOISY_DOMAINS = new Set(['sensor', 'device_tracker', 'weather', 'sun', 'media_player', 'climate', 'person', 'cover', 'light', 'fan', 'water_heater', 'humidifier', 'vacuum', 'remote', 'lawn_mower', 'update'])
/** Domini in cui lo stato è ciò che conta: `to: null` è sicuramente la correzione giusta. */
const STATE_SEMANTIC = new Set(['sensor', 'device_tracker', 'weather', 'person', 'sun'])
/** Trigger che possono ripetersi a breve distanza. */
const RECURRING_TRIGGERS = new Set(['state', 'numeric_state', 'event', 'mqtt', 'device', 'template', 'time_pattern', 'webhook', 'zone', 'tag'])

interface Refs {
  entities: Map<string, Set<Section>>
  templates: Map<string, Set<Section>>
  devices: Set<string>
  areas: Set<string>
  floors: Set<string>
  labels: Set<string>
}

function add(map: Map<string, Set<Section>>, id: string, section: Section): void {
  let s = map.get(id)
  if (!s) map.set(id, (s = new Set()))
  s.add(section)
}

function plainIds(v: unknown): string[] {
  if (typeof v === 'string' && isTemplate(v)) return []
  return idList(v).filter((id) => !isTemplate(id))
}

export function collectRefs(config: Record<string, unknown>, domains: Set<string>): Refs {
  const refs: Refs = { entities: new Map(), templates: new Map(), devices: new Set(), areas: new Set(), floors: new Set(), labels: new Set() }
  const walk = (v: unknown, section: Section, depth: number): void => {
    if (depth > 40) return
    if (typeof v === 'string') {
      if (isTemplate(v)) for (const id of entityCandidates(v, domains)) add(refs.templates, id, section)
      return
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, section, depth + 1)
      return
    }
    if (!isObj(v)) return
    for (const [k, x] of Object.entries(v)) {
      if (k === 'entity_id') for (const id of plainIds(x)) if (id !== 'all' && id !== 'none') add(refs.entities, id, section)
      if (k === 'device_id') for (const id of plainIds(x)) refs.devices.add(id)
      if (k === 'area_id') for (const id of plainIds(x)) refs.areas.add(id)
      if (k === 'floor_id') for (const id of plainIds(x)) refs.floors.add(id)
      if (k === 'label_id') for (const id of plainIds(x)) refs.labels.add(id)
      if ((k === 'above' || k === 'below' || k === 'zone') && typeof x === 'string' && ENTITY_RE.test(x) && domains.has(domainOf(x))) add(refs.entities, x, section)
      walk(x, section, depth + 1)
    }
  }
  for (const section of ['triggers', 'conditions', 'actions', 'variables'] as const) walk(config[section], section, 0)
  return refs
}

function sectionsText(sections: Set<Section>): string {
  return [...sections].map((s) => SECTION_TEXT[s]).join(' ')
}

/** Durata di un delay in secondi (null se a template o non interpretabile). */
export function durationSeconds(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    if (isTemplate(v)) return null
    const m = /^(\d+):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?$/.exec(v.trim())
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0)
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  if (isObj(v)) {
    const n = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : Number(v[k] ?? 0) || 0)
    return n('days') * 86_400 + n('hours') * 3600 + n('minutes') * 60 + n('seconds') + n('milliseconds') / 1000
  }
  return null
}

export function traceStats(traces: TraceSummary[], now: number): TraceStats {
  const sorted = [...traces].sort((a, b) => b.start - a.start)
  const outcomes: Record<string, number> = {}
  for (const t of sorted) outcomes[t.execution ?? 'in_corso'] = (outcomes[t.execution ?? 'in_corso'] ?? 0) + 1
  let perHour: number | null = null
  if (sorted.length >= 3) {
    const span = now - sorted.at(-1)!.start
    if (span > 0) perHour = Math.round((sorted.length / (span / 3_600_000)) * 10) / 10
  }
  return {
    stored: sorted.length,
    outcomes,
    lastError: sorted.find((t) => t.error)?.error ?? null,
    perHour,
    last: sorted[0] ? new Date(sorted[0].start).toISOString() : null,
  }
}

/** Divide un id inesistente in id esistenti concatenati ("530" → "5", "30"). */
export function splitConcatenated(bad: string, ids: Set<string>): string[] | null {
  const memo = new Map<number, string[] | null>()
  const go = (i: number): string[] | null => {
    if (i === bad.length) return []
    if (memo.has(i)) return memo.get(i)!
    let out: string[] | null = null
    for (let j = bad.length; j > i && !out; j--) {
      const part = bad.slice(i, j)
      if (!ids.has(part)) continue
      const rest = go(j)
      if (rest) out = [part, ...rest]
    }
    memo.set(i, out)
    return out
  }
  const parts = go(0)
  return parts && parts.length >= 2 ? parts : null
}

/** Trigger id usati da `condition: trigger` (con dove) e dai template `trigger.id`. */
function triggerIdUses(config: Record<string, unknown>): { conditions: Set<string>; templates: Set<string> } {
  const conditions = new Set<string>()
  const templates = new Set<string>()
  const walk = (v: unknown, depth: number): void => {
    if (depth > 40) return
    if (typeof v === 'string') {
      if (!isTemplate(v)) return
      for (const m of v.matchAll(/trigger\.id\s*(?:==|!=)\s*['"]([^'"]+)['"]/g)) templates.add(m[1]!)
      for (const m of v.matchAll(/trigger\.id\s+(?:not\s+)?in\s*[[(]([^\])]*)[\])]/g)) for (const q of m[1]!.matchAll(/['"]([^'"]+)['"]/g)) templates.add(q[1]!)
      return
    }
    if (Array.isArray(v)) {
      for (const x of v) walk(x, depth + 1)
      return
    }
    if (!isObj(v)) return
    if (v.condition === 'trigger') {
      const ids = Array.isArray(v.id) ? v.id : [v.id]
      for (const id of ids) if (typeof id === 'string' || typeof id === 'number') conditions.add(String(id))
    }
    for (const x of Object.values(v)) walk(x, depth + 1)
  }
  walk(config.conditions, 0)
  walk(config.actions, 0)
  return { conditions, templates }
}

function asList(v: unknown): unknown[] {
  return v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]
}

function triggerKind(t: unknown): string | null {
  if (!isObj(t)) return null
  const k = t.trigger ?? t.platform
  return typeof k === 'string' ? k : null
}

export interface StaticResult {
  reports: AutomationReport[]
  findings: Draft[]
}

export function runStaticRules(input: StaticInput): StaticResult {
  const { ctx, entities, now } = input
  const domains = new Set([...entities.keys()].map(domainOf))
  for (const d of ctx.services.keys()) domains.add(d)
  const sim = new SimilarityIndex([...ctx.entities].map(([id, e]) => [id, e.name] as [string, string]))
  const findings: Draft[] = []
  const reports: AutomationReport[] = []

  // Soglie numeric_state di tutte le automazioni, per l'isteresi nulla (V4).
  const thresholds = new Map<string, Array<{ automation: string; above?: number; below?: number; hasFor: boolean }>>()

  for (const a of input.automations) {
    const key = a.id ?? a.entityId
    const mine: Draft[] = []
    const push = (rule: RuleId, code: string, severity: Severity, title: string, detail: string, refs: string[], sigKey: string, fix?: Fix) => {
      mine.push({ signature: `${rule}:${code}:${key}:${sigKey}`, rule, code, severity, automation: a.entityId, title, detail, refs, ...(fix ? { fix } : {}) })
    }
    const traces = traceStats(a.traces, now)
    const used = new Set<string>()
    let mode = 'single'

    // V2 — stato
    if (a.state === 'unavailable') {
      const why = a.validation?.length ? ` Home Assistant segnala: ${a.validation.join(' ')}` : ' Il motivo è nei log di Home Assistant (Impostazioni → Sistema → Log) o nelle Riparazioni.'
      push('V2', 'non_caricata', 'errore', 'Automazione non caricata', `Home Assistant non è riuscito a caricarla: non scatta mai.${why}`, [], 'stato')
    } else if (a.state === 'off') {
      push('V2', 'disattivata', 'info', 'Automazione disattivata', 'È spenta: non scatta finché non la riattivi. Se non serve più, puoi eliminarla.', [], 'stato')
    }

    if (!a.config) {
      if (a.state !== 'unavailable') push('V1', 'config_non_leggibile', 'info', 'Configurazione non leggibile', 'Home Assistant non ha restituito la configurazione: i controlli sul contenuto sono stati saltati.', [], 'config')
      reports.push(report(a, mode, traces, used))
      findings.push(...mine)
      continue
    }

    // --- Blueprint: si controllano solo gli input (un problema per tipo, con l'elenco) ---------
    if (isObj(a.config.use_blueprint)) {
      const missing = new Set<string>()
      const missingDevices = new Set<string>()
      const walk = (v: unknown, depth: number): void => {
        if (depth > 20) return
        if (typeof v === 'string') {
          if (ENTITY_RE.test(v) && domains.has(domainOf(v))) {
            const [d, obj] = v.split('.') as [string, string]
            if (ctx.services.get(d)?.has(obj)) return // nome di un servizio (es. notify.mobile_app_…)
            if (entities.has(v)) used.add(v)
            else missing.add(v)
          } else if (REGISTRY_ID_RE.test(v) && !input.devices.has(v) && !input.registryIds.has(v)) missingDevices.add(v)
        } else if (Array.isArray(v)) for (const x of v) walk(x, depth + 1)
        else if (isObj(v)) for (const x of Object.values(v)) walk(x, depth + 1)
      }
      walk(a.config.use_blueprint.input, 0)
      if (missing.size) {
        const list = [...missing].sort()
        push('V1', 'entita_inesistente', 'avviso', list.length === 1 ? `Entità inesistente negli input: ${list[0]}` : `${list.length} entità inesistenti negli input`,
          `Gli input della blueprint indicano entità che non esistono più: ${list.slice(0, 30).join(', ')}${list.length > 30 ? '…' : ''}. Correggili dall'editor di Home Assistant.`, list, 'input')
      }
      if (missingDevices.size) {
        push('V1', 'dispositivo_inesistente', 'avviso', 'Dispositivo inesistente negli input', `Gli input della blueprint indicano dispositivi che non esistono più (${[...missingDevices].join(', ')}).`, [...missingDevices], 'input_device')
      }
      reports.push(report(a, mode, traces, used))
      findings.push(...mine)
      continue
    }

    const modern = modernize(a.config)
    const c = modern.config
    mode = typeof c.mode === 'string' ? c.mode : 'single'
    const triggers = asList(c.triggers)
    const refs = collectRefs(c, domains)

    // --- V1 — riferimenti --------------------------------------------------------------------
    for (const [id, sections] of refs.entities) {
      if (REGISTRY_ID_RE.test(id)) {
        const target = input.registryIds.get(id)
        if (!target) {
          push('V1', 'entita_dispositivo_inesistente', 'errore', "Entità di un blocco \"dispositivo\" eliminata", `Un trigger, una condizione o un'azione di tipo dispositivo punta a un'entità che non esiste più (id di registro ${id}). ${sectionsText(sections)} Va rifatto scegliendo di nuovo il dispositivo, o meglio con l'entity_id.`, [id], id)
        } else {
          used.add(target)
          if (entities.get(target)?.disabled) push('V1', 'entita_disabilitata', 'avviso', `Entità disabilitata: ${target}`, `Un blocco di tipo dispositivo usa ${target}, che è disabilitata. ${sectionsText(sections)}`, [target], target)
        }
        continue
      }
      if (!ENTITY_RE.test(id)) {
        push('V1', 'entity_id_non_valido', 'errore', `entity_id non valido: "${id}"`, `"${id}" non è nel formato dominio.nome. ${sectionsText(sections)}`, [id], id)
        continue
      }
      const e = entities.get(id)
      if (!e) {
        const similar = sim.similar(id)
        const other = sim.otherDomain(id)
        const best = replacement(similar)
        let detail = `${id} non esiste in questa installazione (rinominata o rimossa). ${sectionsText(sections)}`
        if (similar.length) detail += ` Entità simili: ${similar.map((s) => `${s.entityId} ("${s.name}")`).join(', ')}.`
        if (other.length) detail += ` Esiste ${other.join(', ')} in un altro dominio: forse è stata convertita (es. con "Mostra come"), ma servizi e stati cambiano, quindi va sistemata a mano.`
        push('V1', 'entita_inesistente', 'errore', `Entità inesistente: ${id}`, detail, [id], id,
          best ? { kind: 'sostituisci_entita', from: id, to: best.to, certain: best.certain, label: `Sostituisci ${id} con ${best.to} ("${best.name}")` } : undefined)
        continue
      }
      used.add(id)
      if (e.disabled) {
        push('V1', 'entita_disabilitata', 'avviso', `Entità disabilitata: ${id}`, `${e.name} (${id}) è disabilitata nel registro. ${sectionsText(sections)}`, [id], id)
        continue
      }
      // V3 — entità senza dati
      if (STATELESS_DOMAINS.has(domainOf(id))) continue
      if (e.state === null) {
        push('V3', 'entita_non_caricata', 'avviso', `Entità non caricata: ${id}`, `${e.name} (${id}) è nel registro ma non ha uno stato: l'integrazione non la sta fornendo. ${sectionsText(sections)}`, [id], id)
      } else if ((e.state === 'unavailable' || e.state === 'unknown') && e.lastChanged !== null && now - e.lastChanged > DAY) {
        push('V3', 'entita_senza_dati', 'avviso', `${e.name}: ${e.state === 'unavailable' ? 'non disponibile' : 'senza valore'} da ${formatDuration(now - e.lastChanged)}`,
          `${id} è "${e.state}" da ${formatDuration(now - e.lastChanged)}: dispositivo spento, scarico o non più raggiungibile? ${sectionsText(sections)}`, [id], id)
      }
    }
    for (const [id, sections] of refs.templates) {
      if (refs.entities.has(id)) continue
      const e = entities.get(id)
      if (e) {
        used.add(id)
        continue
      }
      const [d, obj] = id.split('.') as [string, string]
      if (ctx.services.get(d)?.has(obj)) continue // è il nome di un servizio, non un'entità
      const similar = sim.similar(id)
      const best = replacement(similar)
      push('V1', 'template_rotto', 'avviso', `Template con entità inesistente: ${id}`,
        `Un template cita ${id}, che non esiste: restituisce un valore vuoto o un errore. ${sectionsText(sections)}${similar.length ? ` Entità simili: ${similar.map((s) => `${s.entityId} ("${s.name}")`).join(', ')}.` : ''}`, [id], id,
        best ? { kind: 'sostituisci_entita', from: id, to: best.to, certain: best.certain, label: `Sostituisci ${id} con ${best.to} ("${best.name}")` } : undefined)
    }
    for (const id of refs.devices) {
      const d = input.devices.get(id)
      if (!d) push('V1', 'dispositivo_inesistente', 'errore', 'Dispositivo inesistente', `Il dispositivo ${id} non esiste più (rimosso o riassociato con un nuovo id). Trigger, condizioni e azioni di tipo dispositivo che lo usano non funzionano: vanno rifatti scegliendo il dispositivo nuovo, o meglio con un'entità.`, [id], id)
      else if (d.disabled) push('V1', 'dispositivo_disabilitato', 'avviso', `Dispositivo disabilitato: ${d.name}`, `${d.name} è disabilitato: i blocchi che lo usano non funzionano.`, [id], id)
    }
    for (const [set, known, label, code] of [
      [refs.areas, ctx.areas, "L'area", 'area_inesistente'],
      [refs.floors, ctx.floors, 'Il piano', 'piano_inesistente'],
      [refs.labels, ctx.labels, "L'etichetta", 'etichetta_inesistente'],
    ] as const) {
      for (const id of set) if (!known.has(id)) push('V1', code, 'errore', `${label} "${id}" non esiste`, `${label} ${id} non esiste più: le azioni rivolte a essa non raggiungono nessuna entità.`, [id], id)
    }
    for (const { step, path } of walkSteps(c.actions, 'actions')) {
      const action = step.action
      if (typeof action !== 'string' || isTemplate(action)) continue
      const m = /^([a-z_][a-z0-9_]*)\.([a-z0-9_]+)$/.exec(action)
      if (!m) continue
      if (ctx.services.get(m[1]!)?.has(m[2]!)) continue
      const why = m[1] === 'script' ? 'Lo script non esiste più.' : m[1] === 'notify' ? "Il servizio di notifica non esiste più (app del telefono rimossa o rinominata?)." : "L'integrazione che lo forniva non è caricata o il servizio è stato rinominato."
      push('V1', 'servizio_inesistente', 'errore', `Servizio inesistente: ${action}`, `${why} Quando l'automazione arriva a questo passo (${path}) si ferma con un errore.`, [action], action)
    }
    if (triggers.length === 0) push('V1', 'senza_trigger', 'info', 'Nessun trigger', "Scatta solo se avviata a mano o da un'altra automazione o script. Se non è voluto, aggiungi un trigger.", [], 'triggers')
    if (asList(c.actions).length === 0) push('V1', 'senza_azioni', 'avviso', 'Nessuna azione', 'Quando scatta non fa nulla: completala o eliminala.', [], 'actions')

    // --- V4 — soglie -------------------------------------------------------------------------
    const numericBlocks: Array<Record<string, unknown>> = []
    const findNumeric = (v: unknown, depth: number): void => {
      if (depth > 40) return
      if (Array.isArray(v)) for (const x of v) findNumeric(x, depth + 1)
      else if (isObj(v)) {
        if (v.trigger === 'numeric_state' || v.platform === 'numeric_state' || v.condition === 'numeric_state') numericBlocks.push(v)
        for (const x of Object.values(v)) findNumeric(x, depth + 1)
      }
    }
    findNumeric([c.triggers, c.conditions, c.actions], 0)
    for (const b of numericBlocks) {
      if (b.attribute !== undefined || b.value_template !== undefined) continue
      const resolve = (v: unknown): number | null => {
        if (typeof v === 'number') return v
        if (typeof v === 'string' && ENTITY_RE.test(v)) {
          const n = Number(entities.get(v)?.state)
          return Number.isFinite(n) ? n : null
        }
        return null
      }
      const above = resolve(b.above)
      const below = resolve(b.below)
      const isTrigger = b.trigger === 'numeric_state' || b.platform === 'numeric_state'
      for (const id of plainIds(b.entity_id)) {
        if (isTrigger) {
          let list = thresholds.get(id)
          if (!list) thresholds.set(id, (list = []))
          list.push({ automation: a.entityId, ...(above !== null ? { above } : {}), ...(below !== null ? { below } : {}), hasFor: b.for !== undefined })
        }
        const st = input.stats.get(id)
        if (!st || st.days < 7) continue
        const what = isTrigger ? 'il trigger non è mai scattato' : 'la condizione non è mai stata vera'
        if (above !== null && st.max <= above && below === null) {
          push('V4', 'soglia_mai_raggiunta', 'avviso', `Soglia mai superata: ${id} sopra ${above}`, `Negli ultimi ${st.days} giorni ${entities.get(id)?.name ?? id} è arrivato al massimo a ${round(st.max)}: ${what} con "sopra ${above}". La soglia è giusta (unità di misura, decimali)?`, [id], `${id}:above:${above}`)
        }
        if (below !== null && st.min >= below && above === null) {
          push('V4', 'soglia_mai_raggiunta', 'avviso', `Soglia mai raggiunta: ${id} sotto ${below}`, `Negli ultimi ${st.days} giorni ${entities.get(id)?.name ?? id} è sceso al minimo a ${round(st.min)}: ${what} con "sotto ${below}". La soglia è giusta (unità di misura, decimali)?`, [id], `${id}:below:${below}`)
        }
        if (above !== null && below !== null && (st.max <= above || st.min >= below)) {
          push('V4', 'soglia_mai_raggiunta', 'avviso', `Intervallo mai raggiunto: ${id} tra ${above} e ${below}`, `Negli ultimi ${st.days} giorni ${entities.get(id)?.name ?? id} è stato tra ${round(st.min)} e ${round(st.max)}: ${what}.`, [id], `${id}:range:${above}:${below}`)
        }
      }
    }

    // --- V5 — logica ---------------------------------------------------------------------------
    const definedIds = new Set<string>()
    for (const t of triggers) if (isObj(t) && (typeof t.id === 'string' || typeof t.id === 'number')) definedIds.add(String(t.id))
    const uses = triggerIdUses(c)
    for (const bad of [...uses.conditions].filter((id) => !definedIds.has(id))) {
      const parts = splitConcatenated(bad, definedIds)
      const list = definedIds.size ? `Gli id dei trigger sono: ${[...definedIds].map((x) => `"${x}"`).join(', ')}.` : 'Nessun trigger ha un id.'
      push('V5', 'trigger_id_inesistente', 'errore', `Condizione su un trigger id inesistente: "${bad}"`,
        `Una \`condition: trigger\` controlla l'id "${bad}", che nessun trigger ha: quel ramo non viene mai eseguito. ${list}${parts ? ` Sembra l'unione di ${parts.map((p) => `"${p}"`).join(' e ')}.` : ''}`, [], bad,
        parts ? { kind: 'trigger_id', from: bad, to: parts, certain: true, label: `Usa gli id ${parts.map((p) => `"${p}"`).join(' e ')} al posto di "${bad}"` } : undefined)
    }
    for (const bad of [...uses.templates].filter((id) => !definedIds.has(id) && !uses.conditions.has(id))) {
      push('V5', 'trigger_id_inesistente', 'errore', `Template su un trigger id inesistente: "${bad}"`, `Un template confronta trigger.id con "${bad}", che nessun trigger ha.${definedIds.size ? ` Gli id dei trigger sono: ${[...definedIds].map((x) => `"${x}"`).join(', ')}.` : ''}`, [], `tpl:${bad}`)
    }
    let waitTotal = 0
    let waits = false
    for (const { step } of walkSteps(c.actions, 'actions')) {
      if (step.delay !== undefined) waitTotal += durationSeconds(step.delay) ?? 60
      if (step.wait_for_trigger !== undefined || step.wait_template !== undefined) waits = true
    }
    const failedSingle = traces.outcomes.failed_single ?? 0
    const recurring = triggers.some((t) => RECURRING_TRIGGERS.has(triggerKind(t) ?? ''))
    if (mode === 'single' && (waitTotal >= 60 || waits) && recurring && failedSingle === 0) {
      push('V5', 'single_con_attesa', 'info', `Attende ${waits ? 'un evento' : formatDuration(waitTotal * 1000)} in mode single`,
        "Mentre aspetta, una nuova attivazione viene ignorata (e Home Assistant scrive un avviso nel log). Se deve ripartire da capo usa `mode: restart`; se ogni attivazione conta, `mode: queued`.", [], 'mode')
    }

    // --- V6 — frequenza ------------------------------------------------------------------------
    const noTo: Array<{ index: number; ids: string[] }> = []
    triggers.forEach((t, i) => {
      if (!isObj(t)) return
      const kind = triggerKind(t)
      if (kind === 'state') {
        if (['to', 'from', 'not_to', 'not_from', 'attribute'].some((k) => k in t)) return
        const ids = plainIds(t.entity_id).filter((id) => NOISY_DOMAINS.has(domainOf(id)))
        if (ids.length) noTo.push({ index: i, ids })
      } else if (kind === 'time_pattern') {
        const issue = checkTimePattern(t, a.alias)
        if (!issue) return
        push('V6', 'time_pattern', issue.severity, issue.title, issue.detail, [], `trigger:${i}`,
          issue.pattern ? { kind: 'time_pattern', trigger: i, pattern: issue.pattern, certain: issue.certain, label: issue.label ?? 'Correggi il time_pattern' } : undefined)
      }
    })
    const stateNoTo = noTo.length > 0
    if (stateNoTo) {
      const ids = [...new Set(noTo.flatMap((x) => x.ids))]
      const rate = traces.perHour
      const severity: Severity = (rate !== null && rate >= 10) || (rate === null && ids.some((id) => domainOf(id) === 'device_tracker' || domainOf(id) === 'weather')) ? 'avviso' : 'info'
      const certain = ids.every((id) => STATE_SEMANTIC.has(domainOf(id)))
      const which = noTo.map((x) => x.index + 1)
      push('V6', 'state_senza_to', severity, `Scatta anche quando cambiano gli attributi: ${ids.join(', ')}`,
        `${which.length === 1 ? `Il trigger ${which[0]} non ha` : `I trigger ${which.join(', ')} non hanno`} \`to:\`: scatta${which.length === 1 ? '' : 'no'} a ogni cambio di attributo (posizione, distanza, previsioni, luminosità…), non solo quando cambia lo stato.${rate !== null && rate >= 1 ? ` Le ultime esecuzioni sono circa ${Math.round(rate)} all'ora.` : ''} Con \`to: null\` scatta solo quando cambia lo stato.`, ids, 'state_no_to',
        { kind: 'to_null', triggers: noTo.map((x) => x.index), certain, label: `Aggiungi \`to: null\` ${which.length === 1 ? `al trigger ${which[0]}` : `ai trigger ${which.join(', ')}`}` })
    }
    const hasPattern = triggers.some((t) => triggerKind(t) === 'time_pattern')
    if (!stateNoTo && !hasPattern && traces.perHour !== null && traces.perHour >= 60) {
      push('V6', 'frequenza_alta', 'avviso', `Scatta circa ${Math.round(traces.perHour)} volte all'ora`, `Le ultime ${traces.stored} esecuzioni sono molto ravvicinate. Controlla che il trigger sia specifico (\`to:\`, \`for:\`, condizioni) o che non ci sia un ciclo con un'altra automazione.`, [], 'rate')
    }

    // --- V9 — esiti delle esecuzioni -----------------------------------------------------------
    const errorsN = traces.outcomes.error ?? 0
    if (errorsN > 0) {
      const all = errorsN === traces.stored && traces.stored >= 2
      push('V9', 'esecuzioni_in_errore', all ? 'errore' : 'avviso', traces.stored === 1 ? "L'ultima esecuzione è in errore" : `${errorsN} delle ultime ${traces.stored} esecuzioni in errore`,
        `L'automazione si è fermata con un errore${traces.lastError ? `: "${traces.lastError.slice(0, 300)}"` : '.'}`, [], 'error')
    }
    if (failedSingle > 0) {
      push('V9', 'esecuzioni_ignorate', 'avviso', `${failedSingle} attivazioni ignorate (già in esecuzione)`,
        `Con \`mode: ${mode}\` le attivazioni arrivate mentre era ancora in corso sono state scartate. Se deve ripartire da capo usa \`mode: restart\`; se ogni attivazione conta, \`mode: queued\`.`, [], 'failed_single')
    }
    const maxRuns = traces.outcomes.failed_max_runs ?? 0
    if (maxRuns > 0) {
      push('V9', 'massimo_esecuzioni', 'avviso', `${maxRuns} attivazioni oltre il massimo`, `Sono state scartate perché c'erano già troppe esecuzioni in corso o in coda (\`max\`). Scatta troppo spesso o resta in attesa troppo a lungo.`, [], 'failed_max_runs')
    }
    const failedCond = traces.outcomes.failed_conditions ?? 0
    if (traces.stored >= 3 && failedCond === traces.stored) {
      push('V9', 'ferma_alle_condizioni', 'info', 'Le ultime esecuzioni si sono fermate alle condizioni', `Tutte le ultime ${traces.stored} attivazioni non hanno superato le condizioni: va bene se è voluto, altrimenti controlla le condizioni (o il trigger scatta più spesso del necessario).`, [], 'failed_conditions')
    }

    // --- V10 — sintassi ------------------------------------------------------------------------
    if (modern.fixes.length) {
      push('V10', 'sintassi_vecchia', 'info', 'Sintassi precedente al 2024.10', `Usa ancora ${modern.fixes.map((f) => f.split(' → ')[0]).join(', ')}: funziona, ma la forma attuale è ${modern.fixes.map((f) => f.split(' → ')[1]).join(', ')}. Si aggiorna da sola con qualunque correzione salvata da qui o dall'editor.`, [], 'syntax',
        { kind: 'sintassi', certain: true, label: 'Aggiorna la sintassi' })
    }

    reports.push(report(a, mode, traces, used))
    findings.push(...mine)
  }

  // V4 — isteresi nulla: stessa soglia per "sopra" e "sotto" sulla stessa entità, senza `for:`.
  for (const [id, list] of thresholds) {
    const aboves = list.filter((x) => x.above !== undefined && x.below === undefined && !x.hasFor)
    const belows = list.filter((x) => x.below !== undefined && x.above === undefined && !x.hasFor)
    for (const up of aboves) {
      const level = up.above!
      const down = belows.find((d) => d.below === level)
      if (!down) continue
      const involved = [...new Set([up.automation, down.automation])]
      const autoKey = input.automations.find((x) => x.entityId === up.automation)
      findings.push({
        signature: `V4:isteresi_nulla:${autoKey?.id ?? up.automation}:${id}:${level}`,
        rule: 'V4',
        code: 'isteresi_nulla',
        severity: 'info',
        automation: up.automation,
        title: `Stessa soglia per salire e scendere: ${id} a ${level}`,
        detail: `${involved.length > 1 ? `Questa automazione e ${down.automation} usano` : 'I trigger usano'} "sopra ${level}" e "sotto ${level}" su ${id} senza \`for:\`: quando il valore oscilla attorno alla soglia scattano a ripetizione. Usa due soglie diverse (es. sopra ${level + 1}, sotto ${level - 1}) oppure un \`for:\`.`,
        refs: [id, ...involved.filter((x) => x !== up.automation)],
      })
    }
  }
  return { reports, findings }
}

function round(n: number): string {
  return String(Math.round(n * 100) / 100)
}

function report(a: AutomationInput, mode: string, traces: TraceStats, used: Set<string>): AutomationReport {
  return {
    entityId: a.entityId,
    id: a.id,
    alias: a.alias,
    state: a.state,
    source: a.source,
    editable: a.source === 'editor',
    mode,
    lastTriggered: a.lastTriggered ? new Date(a.lastTriggered).toISOString() : null,
    traces,
    entities: [...used].sort(),
    findings: [],
  }
}

const SEVERITY_ORDER: Record<Severity, number> = { errore: 0, avviso: 1, info: 2 }

/** Ordina (gravità, automazione, regola), assegna gli id e collega i problemi alle automazioni. */
export function numberFindings(drafts: Draft[], reports: AutomationReport[]): Finding[] {
  const alias = new Map(reports.map((r) => [r.entityId, r.alias.toLowerCase()]))
  const sorted = [...drafts].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      (alias.get(a.automation) ?? a.automation).localeCompare(alias.get(b.automation) ?? b.automation) ||
      Number(a.rule.slice(1)) - Number(b.rule.slice(1)) ||
      a.signature.localeCompare(b.signature),
  )
  // Firme uniche: due problemi identici nella stessa automazione contano una volta.
  const seen = new Set<string>()
  const out: Finding[] = []
  for (const d of sorted) {
    if (seen.has(d.signature)) continue
    seen.add(d.signature)
    out.push({ id: `f${out.length + 1}`, ...d })
  }
  const byAuto = new Map(reports.map((r) => [r.entityId, r]))
  for (const r of reports) r.findings = []
  for (const f of out) byAuto.get(f.automation)?.findings.push(f.id)
  return out
}
