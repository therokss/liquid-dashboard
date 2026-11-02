import { asList, isPlainObject, normalizeSteps, type ParseResult } from './automation.ts'

// Script e helper proposti da Claude (dalla 0.8): stessa idea delle automazioni in
// automation.ts. Niente tag, sintassi attuale, solo chiavi ammesse e controlli che Home
// Assistant farebbe solo al salvataggio, così gli errori tornano a Claude prima del tap.

// --- Script -------------------------------------------------------------------------------

const SCRIPT_KEYS = ['alias', 'description', 'icon', 'mode', 'max', 'max_exceeded', 'fields', 'variables', 'sequence', 'trace']
const SCRIPT_KEY_SET = new Set(SCRIPT_KEYS)
const FIELD_KEYS = new Set(['name', 'description', 'required', 'advanced', 'default', 'example', 'selector'])
const MODES = new Set(['single', 'restart', 'queued', 'parallel'])
/** Chiavi che Home Assistant non accetta per uno script: sono i nomi dei servizi del dominio. */
export const RESERVED_SCRIPT_KEYS = new Set(['reload', 'turn_on', 'turn_off', 'toggle'])
const ICON_RE = /^[a-z0-9_-]+:[a-z0-9_-]+$/i

/** Normalizza e controlla la forma di un singolo script (come in scripts.yaml, senza la chiave). */
export function normalizeScript(raw: unknown): ParseResult {
  const errors: string[] = []
  const warnings: string[] = []
  const fixes = new Set<string>()
  let value = raw
  if (Array.isArray(value)) {
    if (value.length !== 1) return { errors: ['Proponi un solo script per elemento (il YAML contiene un elenco).'], fixes: [], warnings }
    value = value[0]
  }
  if (!isPlainObject(value)) return { errors: ['Il YAML deve descrivere uno script (una mappa con alias e sequence).'], fixes: [], warnings }
  // Forma di scripts.yaml (`chiave: { alias, sequence }`): la chiave la decide l'add-on dall'alias.
  const keys = Object.keys(value)
  if (keys.length === 1 && isPlainObject(value[keys[0]!]) && 'sequence' in (value[keys[0]!] as object)) {
    value = value[keys[0]!]
    fixes.add(`tolta la chiave esterna \`${keys[0]}:\` (la chiave dello script viene dall'alias)`)
  }
  const c: Record<string, unknown> = { ...(value as Record<string, unknown>) }

  if ('use_blueprint' in c) errors.push("Gli script da blueprint non si possono creare da qui: scrivi lo script completo.")
  if ('actions' in c && !('sequence' in c)) {
    c.sequence = c.actions
    delete c.actions
    fixes.add('`actions:` → `sequence:` (negli script le azioni stanno in sequence)')
  }
  const unknown = Object.keys(c).filter((k) => !SCRIPT_KEY_SET.has(k) && k !== 'use_blueprint')
  if (unknown.length) errors.push(`Chiavi non ammesse in uno script: ${unknown.join(', ')}.`)

  if (typeof c.alias !== 'string' || !c.alias.trim()) errors.push('Manca `alias` (nome in italiano).')
  else if (c.alias.length > 120) errors.push('`alias` troppo lungo (massimo 120 caratteri).')
  if (c.description === undefined || c.description === '') warnings.push('Manca `description`: aggiungila per spiegare cosa fa lo script.')
  else if (typeof c.description !== 'string') errors.push('`description` deve essere un testo.')
  if (c.icon !== undefined && (typeof c.icon !== 'string' || !ICON_RE.test(c.icon))) errors.push('`icon` deve essere del tipo "mdi:nome-icona".')

  const sequence = normalizeSteps(asList(c.sequence), fixes)
  if (sequence.length === 0) errors.push("Serve almeno un'azione in `sequence:`.")
  c.sequence = sequence

  if (c.mode === undefined) c.mode = 'single'
  else if (typeof c.mode !== 'string' || !MODES.has(c.mode)) errors.push('`mode` deve essere single, restart, queued o parallel.')

  if (c.fields !== undefined) {
    if (!isPlainObject(c.fields)) errors.push('`fields` deve essere una mappa campo → descrizione.')
    else {
      for (const [name, spec] of Object.entries(c.fields)) {
        if (!/^[a-z0-9_]+$/.test(name)) errors.push(`Campo "${name}": il nome deve contenere solo minuscole, cifre e _.`)
        if (spec === null) continue
        if (!isPlainObject(spec)) {
          errors.push(`Campo "${name}": serve una mappa (name, description, required, selector…).`)
          continue
        }
        const bad = Object.keys(spec).filter((k) => !FIELD_KEYS.has(k))
        if (bad.length) errors.push(`Campo "${name}": chiavi non ammesse ${bad.join(', ')}.`)
        if (spec.selector !== undefined && (!isPlainObject(spec.selector) || Object.keys(spec.selector).length !== 1)) {
          errors.push(`Campo "${name}": \`selector\` deve avere un solo tipo (es. selector: { entity: { domain: light } }).`)
        }
      }
    }
  }
  if (c.variables !== undefined && !isPlainObject(c.variables)) errors.push('`variables` deve essere una mappa nome → valore.')

  const ordered: Record<string, unknown> = {}
  for (const k of SCRIPT_KEYS) if (c[k] !== undefined) ordered[k] = c[k]
  return { config: errors.length ? undefined : ordered, errors, fixes: [...fixes], warnings }
}

// --- Helper -------------------------------------------------------------------------------

/** Helper creati dall'interfaccia di Home Assistant (collezioni in .storage, comandi <dominio>/create|update|delete). */
export const HELPER_DOMAINS = ['input_boolean', 'input_button', 'input_number', 'input_select', 'input_text', 'input_datetime', 'counter', 'timer', 'schedule'] as const
export type HelperDomain = (typeof HELPER_DOMAINS)[number]
const HELPER_SET = new Set<string>(HELPER_DOMAINS)

export function isHelperDomain(d: string): d is HelperDomain {
  return HELPER_SET.has(d)
}

export const HELPER_LABELS: Record<HelperDomain, string> = {
  input_boolean: 'interruttore',
  input_button: 'pulsante',
  input_number: 'numero',
  input_select: 'elenco di opzioni',
  input_text: 'testo',
  input_datetime: 'data e ora',
  counter: 'contatore',
  timer: 'timer',
  schedule: 'programmazione settimanale',
}

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']

/** Campi ammessi per dominio, nell'ordine in cui si mostrano. */
const HELPER_FIELDS: Record<HelperDomain, string[]> = {
  input_boolean: ['name', 'icon', 'initial'],
  input_button: ['name', 'icon'],
  input_number: ['name', 'icon', 'min', 'max', 'step', 'initial', 'unit_of_measurement', 'mode'],
  input_select: ['name', 'icon', 'options', 'initial'],
  input_text: ['name', 'icon', 'min', 'max', 'initial', 'pattern', 'mode', 'unit_of_measurement'],
  input_datetime: ['name', 'icon', 'has_date', 'has_time', 'initial'],
  counter: ['name', 'icon', 'initial', 'minimum', 'maximum', 'step', 'restore'],
  timer: ['name', 'icon', 'duration', 'restore'],
  schedule: ['name', 'icon', ...DAYS],
}

/** Valori che Home Assistant aggiunge da solo al salvataggio: messi subito, le differenze restano pulite. */
const HELPER_DEFAULTS: Partial<Record<HelperDomain, Record<string, unknown>>> = {
  input_number: { step: 1, mode: 'slider' },
  input_text: { min: 0, max: 100, mode: 'text' },
  input_datetime: { has_date: false, has_time: false },
  counter: { initial: 0, minimum: null, maximum: null, step: 1, restore: true },
  timer: { duration: '0:00:00', restore: false },
}

export interface HelperParse extends ParseResult {
  domain?: HelperDomain
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isInt = (v: unknown): v is number => isNum(v) && Number.isInteger(v)
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

function toNumber(v: unknown): unknown {
  return typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v
}

/**
 * Un helper è una mappa con UNA chiave, il dominio, e i suoi campi:
 *   input_select: { name: Modalità casa, options: [Normale, Ospiti] }
 * L'id (e quindi l'entity_id) lo genera Home Assistant dal nome.
 */
export function normalizeHelper(raw: unknown): HelperParse {
  const errors: string[] = []
  const warnings: string[] = []
  const fixes = new Set<string>()
  const example = 'Esempio:\ninput_boolean:\n  name: Modalità ospiti\n  icon: mdi:account-group'
  if (!isPlainObject(raw) || Object.keys(raw).length !== 1) {
    return { errors: [`Un helper si descrive con una sola chiave, il dominio (${HELPER_DOMAINS.join(', ')}). ${example}`], fixes: [], warnings }
  }
  const domain = Object.keys(raw)[0]!
  if (!isHelperDomain(domain)) {
    return { errors: [`"${domain}" non è un helper che si può creare da qui. Domini ammessi: ${HELPER_DOMAINS.join(', ')}. Sensori calcolati, gruppi e contatori di consumo non sono ancora supportati.`], fixes: [], warnings }
  }
  const body = raw[domain]
  if (!isPlainObject(body)) return { domain, errors: [`I campi di ${domain} devono essere una mappa. ${example}`], fixes: [], warnings }
  const c: Record<string, unknown> = { ...body }
  if ('id' in c) {
    delete c.id
    fixes.add("tolto `id`: lo genera Home Assistant dal nome")
  }
  const allowed = HELPER_FIELDS[domain]
  const unknown = Object.keys(c).filter((k) => !allowed.includes(k))
  if (unknown.length) errors.push(`Campi non ammessi per ${domain}: ${unknown.join(', ')}. Ammessi: ${allowed.join(', ')}.`)

  if (typeof c.name !== 'string' || !c.name.trim()) errors.push('Manca `name` (nome in italiano): da lì viene anche l’entity_id.')
  else if (c.name.length > 100) errors.push('`name` troppo lungo (massimo 100 caratteri).')
  if (c.icon !== undefined && (typeof c.icon !== 'string' || !ICON_RE.test(c.icon))) errors.push('`icon` deve essere del tipo "mdi:nome-icona".')

  for (const [k, v] of Object.entries(HELPER_DEFAULTS[domain] ?? {})) if (c[k] === undefined) c[k] = v

  switch (domain) {
    case 'input_boolean':
      if (c.initial !== undefined && typeof c.initial !== 'boolean') errors.push('`initial` deve essere true o false.')
      break
    case 'input_number': {
      for (const k of ['min', 'max', 'step', 'initial']) if (c[k] !== undefined) c[k] = toNumber(c[k])
      if (!isNum(c.min) || !isNum(c.max)) errors.push('`min` e `max` sono obbligatori e numerici.')
      else if (c.min >= c.max) errors.push('`min` deve essere minore di `max`.')
      if (!isNum(c.step) || c.step <= 0) errors.push('`step` deve essere un numero maggiore di zero.')
      if (c.initial !== undefined && (!isNum(c.initial) || (isNum(c.min) && c.initial < c.min) || (isNum(c.max) && c.initial > c.max))) errors.push('`initial` deve stare tra min e max.')
      if (c.mode !== 'slider' && c.mode !== 'box') errors.push('`mode` deve essere slider o box.')
      if (c.unit_of_measurement !== undefined && typeof c.unit_of_measurement !== 'string') errors.push('`unit_of_measurement` deve essere un testo.')
      break
    }
    case 'input_select': {
      const opts = asList(c.options)
      if (opts.some((o) => typeof o === 'number' || typeof o === 'boolean')) fixes.add('opzioni convertite in testo')
      const list = opts.map((o) => (typeof o === 'number' || typeof o === 'boolean' ? String(o) : o))
      if (list.length === 0 || list.some((o) => typeof o !== 'string' || !o.trim())) errors.push('`options` deve essere un elenco di testi non vuoti (almeno uno).')
      else if (new Set(list).size !== list.length) errors.push('`options` contiene doppioni.')
      c.options = list
      if (c.initial !== undefined && !list.includes(c.initial)) errors.push('`initial` deve essere una delle opzioni.')
      break
    }
    case 'input_text': {
      for (const k of ['min', 'max']) c[k] = toNumber(c[k])
      if (!isInt(c.min) || !isInt(c.max) || c.min < 0 || c.max > 255 || c.min > c.max) errors.push('`min` e `max` sono lunghezze intere con 0 ≤ min ≤ max ≤ 255.')
      if (c.mode !== 'text' && c.mode !== 'password') errors.push('`mode` deve essere text o password.')
      if (c.initial !== undefined && typeof c.initial !== 'string') errors.push('`initial` deve essere un testo.')
      if (c.pattern !== undefined && typeof c.pattern !== 'string') errors.push('`pattern` deve essere un testo (espressione regolare).')
      break
    }
    case 'input_datetime':
      if (typeof c.has_date !== 'boolean' || typeof c.has_time !== 'boolean') errors.push('`has_date` e `has_time` devono essere true o false.')
      else if (!c.has_date && !c.has_time) errors.push('Serve almeno uno tra `has_date: true` e `has_time: true`.')
      if (c.initial !== undefined && typeof c.initial !== 'string') errors.push('`initial` deve essere un testo (es. "07:30:00" o "2026-12-24").')
      break
    case 'counter':
      for (const k of ['initial', 'minimum', 'maximum', 'step']) if (c[k] !== null) c[k] = toNumber(c[k])
      if (!isInt(c.initial)) errors.push('`initial` deve essere un intero.')
      if (c.minimum !== null && !isInt(c.minimum)) errors.push('`minimum` deve essere un intero (o assente).')
      if (c.maximum !== null && !isInt(c.maximum)) errors.push('`maximum` deve essere un intero (o assente).')
      if (isInt(c.minimum) && isInt(c.maximum) && c.minimum > c.maximum) errors.push('`minimum` deve essere minore di `maximum`.')
      if (isInt(c.initial) && ((isInt(c.minimum) && c.initial < c.minimum) || (isInt(c.maximum) && c.initial > c.maximum))) errors.push('`initial` deve stare tra minimum e maximum.')
      if (!isInt(c.step) || c.step < 1) errors.push('`step` deve essere un intero ≥ 1.')
      if (typeof c.restore !== 'boolean') errors.push('`restore` deve essere true o false.')
      break
    case 'timer':
      if (isNum(c.duration)) {
        const s = Math.max(0, Math.round(c.duration))
        c.duration = `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
        fixes.add('`duration` in secondi convertita in ore:minuti:secondi')
      } else if (typeof c.duration !== 'string' || !/^\d{1,3}:[0-5]\d(:[0-5]\d)?$/.test(c.duration)) errors.push('`duration` deve essere del tipo "0:05:00" (ore:minuti:secondi).')
      if (typeof c.restore !== 'boolean') errors.push('`restore` deve essere true o false.')
      break
    case 'schedule':
      for (const day of DAYS) {
        if (c[day] === undefined) continue
        const pad = (t: unknown) => (typeof t === 'string' && /^\d{2}:\d{2}$/.test(t) ? `${t}:00` : t)
        const ranges = asList(c[day]).map((r) => (isPlainObject(r) ? { ...r, from: pad(r.from), to: pad(r.to) } : r))
        let prevTo: string | null = null
        const sorted = [...ranges].sort((a, b) => String(isPlainObject(a) ? a.from : '').localeCompare(String(isPlainObject(b) ? b.from : '')))
        for (const r of sorted) {
          if (!isPlainObject(r) || typeof r.from !== 'string' || typeof r.to !== 'string') {
            errors.push(`${day}: ogni fascia è { from: "HH:MM:SS", to: "HH:MM:SS" }.`)
            break
          }
          const extra = Object.keys(r).filter((k) => !['from', 'to', 'data'].includes(k))
          if (extra.length) errors.push(`${day}: chiavi non ammesse nella fascia (${extra.join(', ')}).`)
          if (!TIME_RE.test(r.from) || !(TIME_RE.test(r.to) || /^24:00(:00)?$/.test(r.to))) errors.push(`${day}: orari non validi (${r.from}–${r.to}).`)
          else if (r.from >= r.to && !r.to.startsWith('24')) errors.push(`${day}: la fascia ${r.from}–${r.to} finisce prima di cominciare.`)
          else if (prevTo !== null && prevTo > r.from) errors.push(`${day}: le fasce si sovrappongono.`)
          prevTo = r.to.startsWith('24') ? '24:00:00' : r.to
        }
        c[day] = ranges
      }
      break
  }

  const ordered: Record<string, unknown> = {}
  for (const k of allowed) if (c[k] !== undefined) ordered[k] = c[k]
  return { domain, config: errors.length ? undefined : ordered, errors, fixes: [...fixes], warnings }
}

/** Opzioni presenti prima e non più dopo (per avvisare se un'automazione le usa). */
export function removedOptions(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const now = new Set(asList(after.options).map(String))
  return asList(before.options).map(String).filter((o) => !now.has(o))
}
