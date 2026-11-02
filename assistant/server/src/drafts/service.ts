import { createHash, randomBytes } from 'node:crypto'
import type { HAReader } from '../ha/data.ts'
import type { HAState } from '../ha/types.ts'
import type { CategoryScope, DraftWriter } from '../ha/writer.ts'
import { WriteError } from '../ha/writer.ts'
import { buildPrivacyIndex, classifyPrivacy, domainOf } from '../inventory/privacy.ts'
import { entityName } from '../inventory/inventory.ts'
import type { ConversationStore } from '../chat/store.ts'
import { asList, haSlug, lineDiff, normalizeAutomation, normalizeSteps, parseYaml, stableJson, toYaml, type AutomationConfig } from './automation.ts'
import { checkAutomation, walkSteps, type CheckContext, type CheckResult, type CriticalRef } from './checks.ts'
import { HELPER_LABELS, isHelperDomain, normalizeHelper, normalizeScript, removedOptions, RESERVED_SCRIPT_KEYS } from './objects.ts'
import { mainPart, type Draft, type DraftCheck, type DraftPart, type DraftStore, type ObjectType } from './store.ts'
import { log } from '../log.ts'

// Ciclo di vita di una bozza: proposta (Claude) → controlli → scheda in chat → tap
// dell'amministratore → ricontrollo, backup, scrittura, verifica del caricamento →
// categoria "Claude" → eventuale "Annulla". Claude non scrive mai: scrive questo servizio.
// Dalla 0.8 una bozza può contenere più parti (helper, script, automazioni): si scrivono in
// quest'ordine e, se una fallisce, quelle già scritte tornano come prima.

export class DraftError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

/** Una sola automazione (Suggerisci, Verifica e lo strumento proponi_automazione). */
export interface ProposeInput {
  yaml: string
  spiegazione: string
  sostituisce?: string
}

export type PartType = 'automazione' | 'script' | 'helper'

export interface ProposePartsInput {
  elementi: Array<{ tipo: PartType; yaml: string; sostituisce?: string }>
  spiegazione: string
}

/** Da dove nasce la bozza: un tool_use in chat o un candidato di Suggerisci. */
export type DraftOrigin =
  | { conversationId: string; toolUseId: string }
  | { suggestion: { runId: string; candidateId: string } }
  | { verification: { runId: string; automation: string } }

export type ProposeResult =
  | { ok: true; draft: Draft }
  | { ok: false; errors: string[]; warnings: string[]; fixes: string[] }

export interface DraftServiceDeps {
  store: DraftStore
  ha: HAReader
  writer: DraftWriter
  conversations: ConversationStore
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  pollMs?: number
  pollTimeoutMs?: number
}

export const CATEGORY_NAME = 'Claude'
const CATEGORY_ICON = 'mdi:robot-outline'
export const MAX_PARTS = 6
const KEY_ORDER = ['id', 'alias', 'description', 'triggers', 'trigger', 'conditions', 'condition', 'actions', 'action', 'mode']
const SCRIPT_ORDER = ['alias', 'description', 'icon', 'mode', 'max', 'max_exceeded', 'fields', 'variables', 'sequence']
const APPLY_ORDER: Record<ObjectType, number> = { helper: 0, script: 1, automation: 2 }
const SCOPE: Record<ObjectType, CategoryScope> = { automation: 'automation', script: 'script', helper: 'helpers' }
const TYPE_OF: Record<PartType, ObjectType> = { automazione: 'automation', script: 'script', helper: 'helper' }

export function configHash(config: unknown): string {
  const c = config && typeof config === 'object' ? { ...(config as Record<string, unknown>) } : config
  if (c && typeof c === 'object') delete (c as Record<string, unknown>).id
  return createHash('sha256').update(stableJson(c)).digest('hex')
}

function ordered(config: Record<string, unknown>, order: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of order) if (k !== 'id' && config[k] !== undefined) out[k] = config[k]
  for (const [k, v] of Object.entries(config)) if (k !== 'id' && !(k in out)) out[k] = v
  return out
}

/** entity_id che Home Assistant probabilmente assegnerà a un'automazione con questo alias. */
export function slugCandidates(alias: string): string[] {
  const slug = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'automation'
  const out = new Set<string>()
  for (const base of [slug(alias.replace(/['’`"]/g, '')), slug(alias)]) {
    out.add(`automation.${base}`)
    for (let n = 2; n <= 4; n++) out.add(`automation.${base}_${n}`)
  }
  return [...out]
}

/** "l'automazione", "lo script", "l'helper input_boolean": per i messaggi. */
function partLabel(p: Pick<DraftPart, 'object' | 'domain'>): string {
  if (p.object === 'automation') return "l'automazione"
  if (p.object === 'script') return 'lo script'
  return `l'helper ${p.domain} (${HELPER_LABELS[p.domain as keyof typeof HELPER_LABELS] ?? 'helper'})`
}

/** Script nella forma che controllano checkAutomation e validate_config (solo azioni). */
function scriptCheckable(config: Record<string, unknown>): AutomationConfig {
  return { triggers: [], actions: normalizeSteps(asList(config.sequence), new Set()), ...(config.variables !== undefined ? { variables: config.variables } : {}) }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

interface Prepared {
  part?: DraftPart
  errors: string[]
  warnings: string[]
  fixes: string[]
}

interface PartsCheck {
  errors: string[]
  warnings: string[]
  entities: Set<string>
  services: Set<string>
  critical: CriticalRef[]
}

export class DraftService {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly now: () => Date
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly deps: DraftServiceDeps) {
    this.now = deps.now ?? (() => new Date())
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  /** Una scrittura alla volta: due tap ravvicinati non si sovrappongono. */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task)
    this.queue = next.catch(() => undefined)
    return next
  }

  async checkContext(): Promise<CheckContext> {
    const { ha } = this.deps
    const [reg, states, services, catalog] = await Promise.all([ha.registries(), ha.states(), ha.services(), ha.triggerCatalog().catch(() => null)])
    const entries = new Map(reg.entities.map((e) => [e.entity_id, e]))
    const privacy = buildPrivacyIndex(reg.entities)
    const entities: CheckContext['entities'] = new Map()
    for (const id of new Set([...states.keys(), ...entries.keys()])) {
      const entry = entries.get(id)
      if (entry?.disabled_by) continue
      const state = states.get(id)
      const dc = state?.attributes.device_class
      entities.set(id, {
        name: entityName(id, entry, state),
        deviceClass: typeof dc === 'string' ? dc : null,
        privacy: classifyPrivacy(id, entry, privacy) === 'telecamere',
      })
    }
    return {
      entities,
      devices: new Set([
        ...reg.devices.filter((d) => !d.disabled_by).map((d) => d.id),
        // Id dei dispositivi compositi di prima della 2026.9: HA li risolve ancora sui dispositivi divisi.
        ...Object.keys(reg.compositeDevices ?? {}),
      ]),
      areas: new Set(reg.areas.map((a) => a.area_id)),
      floors: new Set(reg.floors.map((f) => f.floor_id)),
      labels: new Set(reg.labels.map((l) => l.label_id)),
      // Copia: la mappa dei servizi è in cache e le parti in creazione vi aggiungono i propri.
      services: new Map([...services].map(([d, s]) => [d, new Set(s)])),
      triggerTypes: catalog ? new Set(Object.keys(catalog)) : null,
      registryIds: new Set(reg.entities.filter((e) => !e.disabled_by && e.registry_id).map((e) => e.registry_id!)),
    }
  }

  /** Le parti create nella stessa bozza esistono già per i controlli delle altre. */
  private plan(ctx: CheckContext, parts: DraftPart[]): void {
    for (const p of parts) {
      if (p.kind !== 'create' || !p.entityId) continue
      ctx.entities.set(p.entityId, { name: p.alias, deviceClass: null, privacy: false })
      if (p.object === 'script' && p.key) {
        let s = ctx.services.get('script')
        if (!s) ctx.services.set('script', (s = new Set()))
        s.add(p.key)
      }
    }
  }

  /**
   * Controlli di un'automazione (o delle azioni di uno script). Per una modifica, i problemi
   * che la versione attuale ha già (un riferimento rotto non ancora corretto, un servizio che
   * l'assistente non introdurrebbe) non bloccano: la bozza non peggiora nulla. Tornano come avvisi.
   */
  checkAgainst(config: AutomationConfig, ctx: CheckContext, before: AutomationConfig | null): CheckResult & { inherited: string[] } {
    if (!before) return { ...checkAutomation(config, ctx), inherited: [] }
    const allowed = new Set<string>()
    for (const { step } of walkSteps(before.actions, 'actions')) if (typeof step.action === 'string') allowed.add(step.action)
    const res = checkAutomation(config, ctx, { allowedServices: allowed })
    const old = new Set(checkAutomation(before, ctx, { allowedServices: allowed }).errors)
    return { ...res, errors: res.errors.filter((e) => !old.has(e)), inherited: res.errors.filter((e) => old.has(e)) }
  }

  /** validate_config di Home Assistant su trigger, condizioni e azioni (per gli script solo azioni). */
  async validateWithHA(config: AutomationConfig): Promise<string[]> {
    const msg: Record<string, unknown> = { type: 'validate_config', actions: config.actions }
    if (Array.isArray(config.triggers) && config.triggers.length) msg.triggers = config.triggers
    if (Array.isArray(config.conditions) && config.conditions.length) msg.conditions = config.conditions
    let r: Record<string, { valid: boolean; error: string | null }>
    try {
      r = await this.deps.ha.call(msg, 30_000)
    } catch (err) {
      return [`Validazione di Home Assistant non disponibile: ${errorText(err)}`]
    }
    const label: Record<string, string> = { triggers: 'i trigger', conditions: 'le condizioni', actions: 'le azioni' }
    return Object.entries(r)
      .filter(([, v]) => v && !v.valid)
      .map(([k, v]) => `Home Assistant rifiuta ${label[k] ?? k}: ${v.error ?? 'errore sconosciuto'}`)
  }

  // --- Proposta -----------------------------------------------------------------------------

  private async resolveAutomation(ref: string): Promise<{ entityId: string; automationId: string } | string> {
    const states = await this.deps.ha.states()
    let state: HAState | undefined
    if (ref.startsWith('automation.')) state = states.get(ref)
    else for (const s of states.values()) if (domainOf(s.entity_id) === 'automation' && s.attributes.id === ref) state = s
    if (!state) return `L'automazione "${ref}" non esiste: usa elenca_automazioni per l'entity_id giusto.`
    const id = state.attributes.id
    if (typeof id !== 'string' || !id) return `${state.entity_id} non ha un id: è definita in YAML o nei packages e non si può modificare dall'editor. Proponi all'utente lo YAML da copiare.`
    return { entityId: state.entity_id, automationId: id }
  }

  private async resolveScript(ref: string): Promise<{ entityId: string; key: string } | string> {
    const states = await this.deps.ha.states()
    let entityId = ref.startsWith('script.') ? ref : `script.${ref}`
    if (!states.has(entityId) && !ref.startsWith('script.')) entityId = (await this.deps.writer.entityIdFor('script', ref)) ?? entityId
    if (!states.has(entityId)) return `Lo script "${ref}" non esiste: cercalo con cerca_entita.`
    const entry = await this.deps.writer.registryEntry(entityId)
    return { entityId, key: entry?.platform === 'script' ? entry.unique_id : entityId.slice('script.'.length) }
  }

  private async prepareAutomation(value: unknown, sostituisce: string | undefined): Promise<Prepared> {
    const norm = normalizeAutomation(value)
    if (!norm.config) return { errors: norm.errors, warnings: norm.warnings, fixes: norm.fixes }
    const config = norm.config
    const base = { errors: [] as string[], warnings: norm.warnings, fixes: norm.fixes }
    const yaml = toYaml(config)
    if (!sostituisce) return { ...base, part: { object: 'automation', kind: 'create', alias: String(config.alias), config, yaml } }

    const t = await this.resolveAutomation(sostituisce.trim())
    if (typeof t === 'string') return { ...base, errors: [t] }
    const current = await this.deps.writer.getConfig(t.automationId)
    if (!current) return { ...base, errors: [`${t.entityId} non è in automations.yaml (packages o YAML): non si può modificare da qui.`] }
    if ('use_blueprint' in current) return { ...base, errors: [`${t.entityId} è creata da una blueprint: si modifica dall'editor di Home Assistant.`] }
    if (configHash(current) === configHash(config)) return { ...base, errors: ['La proposta è identica alla configurazione attuale: nessuna modifica.'] }
    const states = await this.deps.ha.states()
    const beforeYaml = toYaml(ordered(current, KEY_ORDER))
    return {
      ...base,
      part: {
        object: 'automation',
        kind: 'update',
        alias: String(config.alias),
        config,
        yaml,
        target: { entityId: t.entityId, key: t.automationId, alias: entityName(t.entityId, undefined, states.get(t.entityId)), baseHash: configHash(current), beforeYaml },
        diff: lineDiff(beforeYaml, yaml),
      },
    }
  }

  private async prepareScript(value: unknown, sostituisce: string | undefined): Promise<Prepared> {
    const norm = normalizeScript(value)
    if (!norm.config) return { errors: norm.errors, warnings: norm.warnings, fixes: norm.fixes }
    const config = norm.config
    const alias = String(config.alias)
    const base = { errors: [] as string[], warnings: norm.warnings, fixes: norm.fixes }
    const yaml = toYaml(config)
    const { writer } = this.deps

    if (!sostituisce) {
      const key = haSlug(alias)
      if (RESERVED_SCRIPT_KEYS.has(key)) return { ...base, errors: [`Dall'alias verrebbe la chiave riservata "${key}": scegli un alias più descrittivo.`] }
      const states = await this.deps.ha.states()
      if (states.has(`script.${key}`) || (await writer.getScript(key))) {
        return { ...base, errors: [`Esiste già uno script con chiave ${key} (script.${key}): scegli un alias diverso o, per cambiarlo, passa sostituisce: script.${key}.`] }
      }
      return { ...base, part: { object: 'script', kind: 'create', alias, config, yaml, key, entityId: `script.${key}` } }
    }

    const t = await this.resolveScript(sostituisce.trim())
    if (typeof t === 'string') return { ...base, errors: [t] }
    const current = await writer.getScript(t.key)
    if (!current) return { ...base, errors: [`${t.entityId} non è in scripts.yaml (è in YAML altrove o nei packages): non si può modificare da qui. Proponi lo YAML da copiare.`] }
    if ('use_blueprint' in current) return { ...base, errors: [`${t.entityId} è creato da una blueprint: si modifica dall'editor di Home Assistant.`] }
    if (configHash(current) === configHash(config)) return { ...base, errors: ['La proposta è identica alla configurazione attuale: nessuna modifica.'] }
    const states = await this.deps.ha.states()
    const beforeYaml = toYaml(ordered(current, SCRIPT_ORDER))
    return {
      ...base,
      part: {
        object: 'script',
        kind: 'update',
        alias,
        config,
        yaml,
        target: { entityId: t.entityId, key: t.key, alias: entityName(t.entityId, undefined, states.get(t.entityId)), baseHash: configHash(current), beforeYaml },
        diff: lineDiff(beforeYaml, yaml),
      },
    }
  }

  private async prepareHelper(value: unknown, sostituisce: string | undefined): Promise<Prepared> {
    const norm = normalizeHelper(value)
    if (!norm.config || !norm.domain) return { errors: norm.errors, warnings: norm.warnings, fixes: norm.fixes }
    const { domain, config } = norm
    const alias = String(config.name)
    const base = { errors: [] as string[], warnings: norm.warnings, fixes: norm.fixes }
    const yaml = toYaml({ [domain]: config })
    const { writer } = this.deps
    const states = await this.deps.ha.states()

    if (!sostituisce) {
      const key = haSlug(alias)
      const entityId = `${domain}.${key}`
      const items = await writer.listHelpers(domain)
      if (states.has(entityId) || items.some((i) => i.id === key)) {
        return { ...base, errors: [`Esiste già ${entityId}: scegli un nome diverso o, per cambiarlo, passa sostituisce: ${entityId}.`] }
      }
      return { ...base, part: { object: 'helper', domain, kind: 'create', alias, config, yaml, key, entityId } }
    }

    const entityId = sostituisce.trim()
    if (domainOf(entityId) !== domain) return { ...base, errors: [`sostituisce indica ${entityId}, ma lo YAML descrive un ${domain}: per un helper sostituisce è il suo entity_id, dello stesso tipo.`] }
    if (!states.has(entityId)) return { ...base, errors: [`L'helper ${entityId} non esiste: cercalo con cerca_entita.`] }
    const entry = await writer.registryEntry(entityId)
    const current = entry && entry.platform === domain ? ((await writer.listHelpers(domain)).find((i) => i.id === entry.unique_id) ?? null) : null
    if (!entry || !current) return { ...base, errors: [`${entityId} è definito in YAML (configuration.yaml o packages): non si può modificare da qui. Proponi lo YAML da copiare.`] }
    if (configHash(current) === configHash(config)) return { ...base, errors: ['La proposta è identica alla configurazione attuale: nessuna modifica.'] }
    const beforeYaml = toYaml({ [domain]: ordered(current, Object.keys(config)) })
    return {
      ...base,
      warnings: [...base.warnings, ...(await this.helperImpact(entityId, domain, current, config))],
      part: {
        object: 'helper',
        domain,
        kind: 'update',
        alias,
        config,
        yaml,
        target: { entityId, key: entry.unique_id, alias: entityName(entityId, undefined, states.get(entityId)), baseHash: configHash(current), beforeYaml },
        diff: lineDiff(beforeYaml, yaml),
      },
    }
  }

  /** Chi usa l'helper che si sta modificando e, per gli elenchi, chi usa le opzioni tolte. */
  private async helperImpact(entityId: string, domain: string, before: Record<string, unknown>, after: Record<string, unknown>): Promise<string[]> {
    const { ha } = this.deps
    const rel = await ha.call<Record<string, string[]>>({ type: 'search/related', item_type: 'entity', item_id: entityId }).catch(() => ({}) as Record<string, string[]>)
    const users = [...(rel.automation ?? []), ...(rel.script ?? [])]
    if (!users.length) return []
    const out = [`${entityId} è usato da ${users.slice(0, 8).join(', ')}${users.length > 8 ? ` e altri ${users.length - 8}` : ''}: controlla che continuino a funzionare.`]
    const removed = domain === 'input_select' ? removedOptions(before, after) : []
    if (!removed.length) return out
    for (const u of users.slice(0, 20)) {
      const type = u.startsWith('automation.') ? 'automation/config' : 'script/config'
      const cfg = await ha.call<{ config?: unknown }>({ type, entity_id: u }).catch(() => null)
      const text = JSON.stringify(cfg?.config ?? '')
      const hit = removed.filter((o) => text.includes(JSON.stringify(o)))
      if (hit.length) out.push(`${u} usa ${hit.length > 1 ? 'le opzioni' : "l'opzione"} ${hit.map((o) => `"${o}"`).join(', ')}, che la modifica toglie.`)
    }
    return out
  }

  /** Controlli di tutte le parti, con le creazioni della bozza già "presenti". */
  private async checkParts(parts: DraftPart[], ctx: CheckContext, currents: Map<DraftPart, Record<string, unknown> | null>): Promise<PartsCheck> {
    const out: PartsCheck = { errors: [], warnings: [], entities: new Set(), services: new Set(), critical: [] }
    const multi = parts.length > 1
    for (const p of parts) {
      if (p.object === 'helper') continue
      const prefix = multi ? `${p.object === 'automation' ? 'Automazione' : 'Script'} "${p.alias}": ` : ''
      const current = currents.get(p) ?? null
      const config = p.object === 'automation' ? p.config : scriptCheckable(p.config)
      const before = current ? (p.object === 'automation' ? (normalizeAutomation(current).config ?? null) : scriptCheckable(current)) : null
      const r = this.checkAgainst(config, ctx, before)
      const haErrors = r.errors.length ? [] : await this.validateWithHA(config)
      out.errors.push(...[...r.errors, ...haErrors].map((e) => prefix + e))
      out.warnings.push(...r.warnings.map((w) => prefix + w), ...r.inherited.map((e) => `${prefix}Già presente nella versione attuale: ${e}`))
      r.entities.forEach((e) => out.entities.add(e))
      r.services.forEach((s) => out.services.add(s))
      for (const c of r.critical) if (!out.critical.some((x) => x.ref === c.ref)) out.critical.push(c)
    }
    return out
  }

  async propose(input: ProposeInput, origin: DraftOrigin): Promise<ProposeResult> {
    return this.proposeParts({ elementi: [{ tipo: 'automazione', yaml: input.yaml, ...(input.sostituisce ? { sostituisce: input.sostituisce } : {}) }], spiegazione: input.spiegazione }, origin)
  }

  async proposeParts(input: ProposePartsInput, origin: DraftOrigin): Promise<ProposeResult> {
    const items = input.elementi
    if (!items.length) return { ok: false, errors: ['Indica almeno un elemento.'], warnings: [], fixes: [] }
    if (items.length > MAX_PARTS) return { ok: false, errors: [`Al massimo ${MAX_PARTS} elementi per bozza.`], warnings: [], fixes: [] }
    const multi = items.length > 1
    const errors: string[] = []
    const warnings: string[] = []
    const fixes = new Set<string>()
    const parts: DraftPart[] = []
    for (const [i, el] of items.entries()) {
      const prefix = multi ? `Elemento ${i + 1} (${el.tipo}): ` : ''
      const parsed = parseYaml(el.yaml)
      if (parsed.errors.length) {
        errors.push(...parsed.errors.map((e) => prefix + e))
        continue
      }
      const sost = el.sostituisce?.trim() || undefined
      const r =
        el.tipo === 'automazione' ? await this.prepareAutomation(parsed.value, sost) : el.tipo === 'script' ? await this.prepareScript(parsed.value, sost) : await this.prepareHelper(parsed.value, sost)
      errors.push(...r.errors.map((e) => prefix + e))
      warnings.push(...r.warnings.map((w) => prefix + w))
      r.fixes.forEach((f) => fixes.add(f))
      if (r.part) parts.push(r.part)
    }
    // Due parti sullo stesso oggetto (stessa creazione o stessa modifica) non hanno senso.
    const seen = new Set<string>()
    for (const p of parts) {
      const k = p.target ? `${p.object}:${p.target.entityId}` : p.entityId ? `${p.object}:${p.entityId}` : null
      if (k && seen.has(k)) errors.push(`Due elementi riguardano ${p.target?.entityId ?? p.entityId}: uniscili in uno solo.`)
      if (k) seen.add(k)
    }
    if (errors.length) return { ok: false, errors, warnings, fixes: [...fixes] }

    parts.sort((a, b) => APPLY_ORDER[a.object] - APPLY_ORDER[b.object])
    const ctx = await this.checkContext()
    this.plan(ctx, parts)
    const currents = new Map<DraftPart, Record<string, unknown> | null>()
    for (const p of parts) if (p.kind === 'update') currents.set(p, await this.readCurrent(p))
    const checked = await this.checkParts(parts, ctx, currents)
    if (checked.errors.length) {
      const planned = parts.filter((p) => p.kind === 'create' && p.entityId).map((p) => p.entityId)
      if (planned.length && checked.errors.some((e) => /non esiste/.test(e))) checked.errors.push(`Nella bozza vengono creati: ${planned.join(', ')} (entity_id dal nome).`)
      return { ok: false, errors: checked.errors, warnings: [...warnings, ...checked.warnings], fixes: [...fixes] }
    }

    const draft: Draft = {
      id: this.deps.store.newId(this.now().getTime()),
      conversationId: 'conversationId' in origin ? origin.conversationId : '',
      toolUseId: 'toolUseId' in origin ? origin.toolUseId : '',
      ...('suggestion' in origin ? { suggestion: origin.suggestion } : {}),
      ...('verification' in origin ? { verification: origin.verification } : {}),
      createdAt: this.now().toISOString(),
      status: 'pending',
      parts,
      explanation: input.spiegazione.trim(),
      fixes: [...fixes],
      warnings: [...warnings, ...checked.warnings],
      checks: this.checkList(parts, checked, [...fixes]),
      critical: checked.critical,
    }
    await this.deps.store.save(draft)
    return { ok: true, draft }
  }

  private checkList(parts: DraftPart[], checked: PartsCheck, fixes: string[]): DraftCheck[] {
    const withActions = parts.some((p) => p.object !== 'helper')
    const helpers = parts.filter((p) => p.object === 'helper')
    const created = parts.filter((p) => p.kind === 'create' && p.entityId).map((p) => p.entityId!)
    return [
      { label: 'YAML valido, sintassi attuale', ok: true, ...(fixes.length ? { detail: `corretto: ${fixes.join(', ')}` } : {}) },
      ...(helpers.length ? [{ label: helpers.length > 1 ? 'Campi degli helper validi' : "Campi dell'helper validi", ok: true }] : []),
      ...(created.length ? [{ label: 'Nomi liberi', ok: true, detail: created.join(', ') }] : []),
      ...(withActions
        ? [
            { label: 'Entità, aree e dispositivi esistenti', ok: true, detail: `${checked.entities.size} entità` },
            { label: 'Servizi esistenti e consentiti', ok: true, ...(checked.services.size ? { detail: [...checked.services].sort().join(', ') } : {}) },
            { label: 'Validazione di Home Assistant', ok: true },
          ]
        : []),
    ]
  }

  // --- Letture dello stato attuale ------------------------------------------------------------

  private async readCurrent(p: DraftPart, key = p.target?.key ?? p.key ?? ''): Promise<Record<string, unknown> | null> {
    const { writer } = this.deps
    if (p.object === 'automation') return writer.getConfig(key)
    if (p.object === 'script') return writer.getScript(key)
    return (await writer.listHelpers(p.domain!)).find((i) => i.id === key) ?? null
  }

  /** Per una creazione: chiave o nome già presi dopo la proposta? */
  private async taken(p: DraftPart): Promise<boolean> {
    if (p.object === 'automation' || !p.entityId) return false
    if (await this.deps.writer.getState(p.entityId)) return true
    return (await this.readCurrent(p, p.key)) !== null
  }

  /** Script o helper esistente: chiave, modificabilità e configurazione (per i tool di lettura). */
  async inspect(entityId: string): Promise<{ key: string | null; editable: boolean; reason?: string; config?: Record<string, unknown> }> {
    const { writer } = this.deps
    const domain = domainOf(entityId)
    if (domain === 'script') {
      const entry = await writer.registryEntry(entityId)
      const key = entry?.platform === 'script' ? entry.unique_id : entityId.slice('script.'.length)
      const config = await writer.getScript(key).catch(() => null)
      if (config) return { key, editable: !('use_blueprint' in config), config, ...('use_blueprint' in config ? { reason: 'creato da una blueprint: si modifica dall’editor di Home Assistant' } : {}) }
      return { key, editable: false, reason: 'non è in scripts.yaml (YAML altrove o packages): si legge ma non si modifica da qui' }
    }
    if (isHelperDomain(domain)) {
      const entry = await writer.registryEntry(entityId)
      const item = entry && entry.platform === domain ? (await writer.listHelpers(domain)).find((i) => i.id === entry.unique_id) : undefined
      if (item) {
        const { id: _id, ...config } = item
        return { key: entry!.unique_id, editable: true, config }
      }
      return { key: null, editable: false, reason: 'definito in YAML (configuration.yaml o packages): si legge ma non si modifica da qui' }
    }
    return { key: null, editable: false, reason: 'tipo non gestito: solo script e helper' }
  }

  // --- Scrittura ------------------------------------------------------------------------------

  private async newAutomationId(): Promise<string> {
    const states = await this.deps.ha.states()
    const used = new Set([...states.values()].map((s) => s.attributes.id).filter((x) => typeof x === 'string'))
    let n = this.now().getTime()
    for (;;) {
      const id = String(n)
      if (!used.has(id) && !(await this.deps.writer.getConfig(id))) return id
      n += 1
    }
  }

  private async findAutomation(automationId: string, alias: string, fullScan: boolean): Promise<string | null> {
    for (const candidate of slugCandidates(alias)) {
      const s = await this.deps.writer.getState(candidate)
      if (s?.attributes.id === automationId) return candidate
    }
    if (!fullScan) return null
    const list = await this.deps.ha.call<HAState[]>({ type: 'get_states' }, 60_000).catch(() => [] as HAState[])
    return list.find((s) => domainOf(s.entity_id) === 'automation' && s.attributes.id === automationId)?.entity_id ?? null
  }

  /** Attende che HA ricarichi l'automazione o lo script con la configurazione appena scritta. */
  private async waitLoaded(
    find: (fullScan: boolean) => Promise<string | null>,
    loadedConfig: (entityId: string) => Promise<Record<string, unknown> | null>,
    knownEntity: string | null,
    config: Record<string, unknown>,
  ): Promise<{ entityId: string | null; state: HAState | null }> {
    const pollMs = this.deps.pollMs ?? 500
    const deadline = Date.now() + (this.deps.pollTimeoutMs ?? 12_000)
    const want = configHash(config)
    let entityId = knownEntity
    let attempts = 0
    while (Date.now() < deadline) {
      attempts += 1
      if (!entityId) entityId = await find(attempts % 6 === 0)
      if (entityId) {
        const loaded = await loadedConfig(entityId)
        if (loaded && configHash(loaded) === want) return { entityId, state: await this.deps.writer.getState(entityId) }
      }
      await this.sleep(pollMs)
    }
    return { entityId, state: null }
  }

  /** entity_id del nuovo helper: di solito quello previsto dal nome. */
  private async waitHelperEntity(domain: string, id: string, expected: string): Promise<string | null> {
    const { writer } = this.deps
    const pollMs = this.deps.pollMs ?? 500
    const deadline = Date.now() + (this.deps.pollTimeoutMs ?? 12_000)
    let attempts = 0
    while (Date.now() < deadline) {
      attempts += 1
      const e = await writer.registryEntry(expected)
      if (e && e.platform === domain && e.unique_id === id) return expected
      if (attempts % 4 === 0) {
        const found = await writer.entityIdFor(domain, id)
        if (found) return found
      }
      await this.sleep(pollMs)
    }
    return null
  }

  private writeError(err: unknown, p: DraftPart, multi: boolean): DraftError {
    const status = (err instanceof WriteError && err.status === 400) || (err as { code?: unknown })?.code === 'invalid_format' ? 400 : 502
    const what = multi ? ` di ${partLabel(p)} "${p.alias}"` : ''
    return new DraftError(status, 'scrittura_rifiutata', `Home Assistant ha rifiutato il salvataggio${what}: ${errorText(err)}`)
  }

  /**
   * Scrive una parte e ne registra l'esito in p.applied. Restituisce come tornare indietro.
   * Se Home Assistant accetta ma non riesce a caricarla, la parte torna subito com'era.
   */
  private async writePart(
    p: DraftPart,
    d: Draft,
    ts: string,
    current: Record<string, unknown> | null,
    by: string,
  ): Promise<{ undo: () => Promise<void>; warning?: string }> {
    const { store, writer } = this.deps
    const multi = d.parts.length > 1
    const backupFile = p.kind === 'update' ? await store.backup(p.object, p.target!.key, current, ts, d.id, p.domain) : null
    const restore = async (): Promise<Record<string, unknown>> => {
      const before = backupFile ? await store.readBackup(backupFile) : null
      if (!before) throw new DraftError(500, 'backup_mancante', 'Backup della versione precedente non trovato.')
      return before
    }

    if (p.object === 'helper') {
      const domain = p.domain!
      if (p.kind === 'create') {
        let item: Record<string, unknown>
        try {
          item = await writer.createHelper(domain, p.config)
        } catch (err) {
          throw this.writeError(err, p, multi)
        }
        const key = typeof item?.id === 'string' ? item.id : p.key!
        const entityId = await this.waitHelperEntity(domain, key, p.entityId!)
        p.applied = { key, entityId, writtenHash: configHash(item), backupFile: null }
        return {
          undo: () => writer.removeHelper(domain, key),
          ...(entityId ? {} : { warning: "Helper creato, ma Home Assistant non mostra ancora l'entità: controlla tra qualche secondo." }),
        }
      }
      const key = p.target!.key
      let item: Record<string, unknown>
      try {
        item = await writer.updateHelper(domain, key, p.config)
      } catch (err) {
        throw this.writeError(err, p, multi)
      }
      p.applied = { key, entityId: p.target!.entityId, writtenHash: configHash(item), backupFile }
      return { undo: async () => void (await writer.updateHelper(domain, key, await restore())) }
    }

    const isScript = p.object === 'script'
    const key = p.kind === 'update' ? p.target!.key : isScript ? p.key! : await this.newAutomationId()
    try {
      if (isScript) await writer.saveScript(key, p.config)
      else await writer.save(key, { id: key, ...p.config })
    } catch (err) {
      throw this.writeError(err, p, multi)
    }
    const written = isScript ? await writer.getScript(key) : await writer.getConfig(key)
    const writtenHash = configHash(written ?? p.config)
    const remove = () => (isScript ? writer.removeScript(key) : writer.remove(key))
    const save = (c: Record<string, unknown>) => (isScript ? writer.saveScript(key, c) : writer.save(key, c))

    const loaded = isScript
      ? await this.waitLoaded(
          async (full) => {
            const expected = p.target?.entityId ?? p.entityId!
            if (await writer.getState(expected)) return expected
            return full ? writer.entityIdFor('script', key) : null
          },
          (e) => writer.loadedScript(e),
          null,
          p.config,
        )
      : await this.waitLoaded((full) => this.findAutomation(key, p.alias, full), (e) => writer.loadedConfig(e), p.target?.entityId ?? null, p.config)

    if (loaded.state?.state === 'unavailable') {
      // Configurazione accettata ma non caricabile: si torna subito allo stato precedente.
      if (p.kind === 'create') await remove().catch(() => undefined)
      else await restore().then(save).catch(() => undefined)
      await store.record({ ts, by, action: 'rollback_automatico', object: p.object, automationId: key, entityId: loaded.entityId, alias: p.alias, draftId: d.id, conversationId: d.conversationId, backupFile })
      throw new DraftError(502, 'non_caricata', `Home Assistant non è riuscito a caricare ${isScript ? 'lo script' : 'l’automazione'}${multi ? ` "${p.alias}"` : ''}: modifica annullata automaticamente.`)
    }
    p.applied = { key, entityId: loaded.entityId, writtenHash, backupFile }
    return {
      undo: async () => void (p.kind === 'create' ? await remove() : await save(await restore())),
      ...(loaded.state ? {} : { warning: `Home Assistant non ha ancora ricaricato ${isScript ? 'lo script' : 'l’automazione'}: controlla tra qualche secondo.` }),
    }
  }

  private async event(conversationId: string, text: string): Promise<void> {
    if (!conversationId) return // bozza nata da Suggerisci o Verifica: nessuna chat da avvisare
    await this.deps.conversations
      .append(conversationId, { type: 'event', id: `e${this.now().getTime().toString(36)}${randomBytes(3).toString('hex')}`, ts: this.now().toISOString(), text })
      .catch((err) => log.warn('Evento della bozza non registrato nella chat', errorText(err)))
  }

  private require(id: string, status: Draft['status']): Draft {
    const d = this.deps.store.get(id)
    if (!d) throw new DraftError(404, 'bozza_inesistente', 'Bozza non trovata')
    if (d.status !== status) throw new DraftError(409, 'stato_non_valido', `La bozza è già ${{ pending: 'in attesa', applied: 'applicata', discarded: 'scartata', undone: 'annullata' }[d.status]}.`)
    return d
  }

  apply(id: string, opts: { enabled: boolean; confirmCritical: boolean; by: string }): Promise<Draft> {
    return this.serialize(async () => {
      const { store, writer } = this.deps
      const d = this.require(id, 'pending')
      if (d.critical.length && !opts.confirmCritical) {
        throw new DraftError(400, 'conferma_richiesta', 'Questa bozza comanda entità critiche: conferma esplicitamente prima di procedere.')
      }

      // Prima di scrivere qualsiasi cosa: nessun conflitto e controlli ancora superati.
      const currents = new Map<DraftPart, Record<string, unknown> | null>()
      for (const p of d.parts) {
        if (p.kind === 'update') {
          const current = await this.readCurrent(p)
          const name = p.target!.entityId
          if (!current) throw new DraftError(409, 'non_piu_modificabile', `${name} non è più modificabile da qui (rimosso o spostato fuori dall'editor).`)
          if (configHash(current) !== p.target!.baseHash) {
            throw new DraftError(409, 'modificata_nel_frattempo', `Dopo la proposta qualcuno ha modificato ${name}: chiedi a Claude una nuova bozza aggiornata.`)
          }
          currents.set(p, current)
        } else if (await this.taken(p)) {
          throw new DraftError(409, 'nome_occupato', `${p.entityId} esiste già (creato dopo la proposta): chiedi a Claude una nuova bozza con un altro nome.`)
        }
      }
      const ctx = await this.checkContext()
      this.plan(ctx, d.parts)
      const recheck = await this.checkParts(d.parts, ctx, currents)
      if (recheck.errors.length) {
        d.lastError = recheck.errors.join(' ')
        await store.save(d)
        throw new DraftError(409, 'controlli_falliti', `La bozza non supera più i controlli: ${recheck.errors.join(' ')}`)
      }

      const ts = this.now().toISOString()
      const done: Array<{ part: DraftPart; undo: () => Promise<void> }> = []
      let warning: string | undefined
      try {
        for (const [i, p] of d.parts.entries()) {
          const r = await this.writePart(p, d, ts, currents.get(p) ?? null, opts.by)
          done.push({ part: p, undo: r.undo })
          if (r.warning) warning = r.warning
          const actual = p.applied?.entityId
          if (p.kind === 'create' && p.entityId && actual !== p.entityId && d.parts.slice(i + 1).some((q) => JSON.stringify(q.config).includes(p.entityId!))) {
            throw new DraftError(502, 'entity_id_diverso', `Home Assistant ha creato ${actual ?? 'un’entità non ancora visibile'} invece di ${p.entityId}, che le altre parti usano: modifiche annullate.`)
          }
        }
      } catch (err) {
        // Si torna indietro dalle parti già scritte, in ordine inverso.
        const failed: string[] = []
        for (const x of done.reverse()) {
          try {
            await x.undo()
            await store.record({ ts, by: opts.by, action: 'rollback_automatico', object: x.part.object, ...(x.part.domain ? { domain: x.part.domain } : {}), automationId: x.part.applied!.key, entityId: x.part.applied!.entityId, alias: x.part.alias, draftId: d.id, conversationId: d.conversationId, backupFile: x.part.applied!.backupFile })
          } catch (e) {
            failed.push(`${x.part.applied?.entityId ?? x.part.alias} (${errorText(e)})`)
          }
          delete x.part.applied
        }
        const base = err instanceof DraftError ? err : new DraftError(502, 'scrittura_rifiutata', `Home Assistant ha rifiutato il salvataggio: ${errorText(err)}`)
        d.lastError = base.message + (done.length ? ` Le parti già scritte sono state annullate.` : '') + (failed.length ? ` Attenzione, non è stato possibile annullare: ${failed.join(', ')}.` : '')
        await store.save(d)
        throw new DraftError(base.status, base.code, d.lastError)
      }

      // Rifiniture: categoria "Claude" sulle creazioni, automazioni create disattivate se richiesto.
      for (const p of d.parts) {
        const a = p.applied!
        if (p.kind !== 'create') continue
        if (p.object === 'automation') a.enabled = opts.enabled
        if (!a.entityId) continue
        try {
          const scope = SCOPE[p.object]
          await writer.setCategory(a.entityId, await writer.ensureCategory(CATEGORY_NAME, CATEGORY_ICON, scope), scope)
        } catch (err) {
          log.warn('Categoria "Claude" non assegnata', errorText(err))
        }
        if (p.object === 'automation' && !opts.enabled) {
          try {
            await writer.setEnabled(a.entityId, false)
          } catch {
            warning = 'Creata ma non è stato possibile disattivarla: fallo dall’elenco delle automazioni.'
          }
        }
      }

      d.status = 'applied'
      d.applied = { at: ts, by: opts.by, ...(warning ? { warning } : {}) }
      delete d.lastError
      await store.save(d)
      for (const p of d.parts) {
        const a = p.applied!
        await store.record({ ts, by: opts.by, action: p.kind === 'create' ? 'creata' : 'modificata', object: p.object, ...(p.domain ? { domain: p.domain } : {}), automationId: a.key, entityId: a.entityId, alias: p.alias, draftId: d.id, conversationId: d.conversationId, backupFile: a.backupFile })
      }
      log.info(`Bozza ${d.id} applicata da ${opts.by}: ${d.parts.map((p) => `${p.kind === 'create' ? 'creato' : 'modificato'} ${p.applied!.entityId ?? p.applied!.key}`).join(', ')}`)
      await this.event(d.conversationId, this.appliedText(d, opts.enabled))
      return d
    })
  }

  private appliedText(d: Draft, enabled: boolean): string {
    const only = d.parts.length === 1 ? d.parts[0]! : null
    if (only?.object === 'automation') {
      const a = only.applied!
      return only.kind === 'create'
        ? `L'utente ha creato l'automazione "${only.alias}" dalla bozza ${d.id}: ${a.entityId ?? 'entity_id non ancora disponibile'}, id ${a.key}, ${enabled ? 'attiva' : 'disattivata'}.`
        : `L'utente ha applicato la bozza ${d.id}: l'automazione "${only.alias}" (${a.entityId}) è stata modificata.`
    }
    const items = d.parts.map((p) => {
      const a = p.applied!
      const id = a.entityId ?? 'entity_id non ancora disponibile'
      if (p.kind === 'update') return `modificato ${partLabel(p)} "${p.alias}" (${id})`
      return `creato ${partLabel(p)} "${p.alias}" (${id}${p.object === 'automation' ? `, id ${a.key}, ${enabled ? 'attiva' : 'disattivata'}` : ''})`
    })
    return `L'utente ha applicato la bozza ${d.id}: ${items.join('; ')}.`
  }

  undo(id: string, opts: { force: boolean; by: string }): Promise<Draft> {
    return this.serialize(async () => {
      const { store, writer } = this.deps
      const d = this.require(id, 'applied')
      const ts = this.now().toISOString()
      const applied = d.parts.filter((p) => p.applied)
      const currents = new Map<DraftPart, Record<string, unknown> | null>()
      const changed: string[] = []
      for (const p of applied) {
        const current = await this.readCurrent(p, p.applied!.key)
        currents.set(p, current)
        if (current && configHash(current) !== p.applied!.writtenHash) changed.push(p.applied!.entityId ?? p.alias)
      }
      const only = d.parts.length === 1 ? d.parts[0]! : null
      if (changed.length && !opts.force) {
        const msg =
          only?.object === 'automation'
            ? "L'automazione è stata modificata dopo che l'hai applicata: annullando perderai anche quelle modifiche."
            : `${changed.join(', ')} ${changed.length > 1 ? 'sono stati modificati' : 'è stato modificato'} dopo che hai applicato la bozza: annullando perderai anche quelle modifiche.`
        throw new DraftError(409, 'modificata_dopo', msg)
      }
      for (const p of applied) {
        if (p.kind !== 'update') continue
        if (!p.applied!.backupFile || !(await store.readBackup(p.applied!.backupFile))) throw new DraftError(500, 'backup_mancante', 'Backup della versione precedente non trovato.')
        if (!currents.get(p)) throw new DraftError(409, 'non_piu_modificabile', `${p.applied!.entityId ?? p.alias} non è più modificabile da qui.`)
      }

      // In ordine inverso: prima chi usa, poi ciò che è usato (automazioni, script, helper).
      for (const p of [...applied].reverse()) {
        const a = p.applied!
        const current = currents.get(p) ?? null
        const common = { ts, by: opts.by, object: p.object, ...(p.domain ? { domain: p.domain } : {}), automationId: a.key, entityId: a.entityId, alias: p.alias, draftId: d.id, conversationId: d.conversationId }
        if (p.kind === 'create') {
          if (current) {
            await store.backup(p.object, a.key, current, ts, d.id, p.domain)
            if (p.object === 'automation') await writer.remove(a.key)
            else if (p.object === 'script') await writer.removeScript(a.key)
            else await writer.removeHelper(p.domain!, a.key)
          }
          await store.record({ ...common, action: 'annullata_creazione' })
        } else {
          const before = (await store.readBackup(a.backupFile!))!
          const safety = await store.backup(p.object, a.key, current, ts, d.id, p.domain)
          if (p.object === 'automation') await writer.save(a.key, before)
          else if (p.object === 'script') await writer.saveScript(a.key, before)
          else await writer.updateHelper(p.domain!, a.key, before)
          await store.record({ ...common, action: 'ripristinata', backupFile: safety })
        }
      }
      d.status = 'undone'
      d.undone = { at: ts, by: opts.by }
      await store.save(d)
      log.info(`Annullata la bozza ${d.id} da ${opts.by}`)
      await this.event(d.conversationId, this.undoneText(d))
      return d
    })
  }

  private undoneText(d: Draft): string {
    const only = d.parts.length === 1 ? d.parts[0]! : null
    if (only?.object === 'automation') {
      return only.kind === 'create'
        ? `L'utente ha annullato la bozza ${d.id}: l'automazione "${only.alias}" è stata eliminata.`
        : `L'utente ha annullato la bozza ${d.id}: l'automazione "${only.alias}" è tornata alla versione precedente.`
    }
    const items = d.parts.map((p) => `${partLabel(p)} "${p.alias}" ${p.kind === 'create' ? 'eliminato' : 'tornato alla versione precedente'}`)
    return `L'utente ha annullato la bozza ${d.id}: ${items.join('; ')}.`
  }

  discard(id: string, by: string): Promise<Draft> {
    return this.serialize(async () => {
      const d = this.require(id, 'pending')
      d.status = 'discarded'
      d.discarded = { at: this.now().toISOString(), by }
      await this.deps.store.save(d)
      await this.event(d.conversationId, `L'utente ha scartato la bozza ${d.id} ("${mainPart(d).alias}") senza applicarla.`)
      return d
    })
  }
}

/** Vista della bozza per l'interfaccia. I campi in cima riassumono la parte principale. */
export function publicDraft(d: Draft) {
  const main = mainPart(d)
  return {
    id: d.id,
    toolUseId: d.toolUseId,
    status: d.status,
    kind: main.kind,
    alias: main.alias,
    explanation: d.explanation,
    yaml: main.yaml,
    fixes: d.fixes,
    warnings: d.warnings,
    checks: d.checks,
    critical: d.critical,
    target: main.target ? { entityId: main.target.entityId, alias: main.target.alias, automationId: main.target.key } : null,
    suggestion: d.suggestion ?? null,
    verification: d.verification ?? null,
    diff: main.diff ?? null,
    parts: d.parts.map((p) => ({
      object: p.object,
      domain: p.domain ?? null,
      kind: p.kind,
      alias: p.alias,
      yaml: p.yaml,
      diff: p.diff ?? null,
      entityId: p.applied?.entityId ?? p.target?.entityId ?? p.entityId ?? null,
      key: p.applied?.key ?? p.target?.key ?? p.key ?? null,
      enabled: p.applied?.enabled ?? null,
    })),
    applied: d.applied
      ? {
          at: d.applied.at,
          by: d.applied.by,
          automationId: main.applied?.key ?? '',
          entityId: main.applied?.entityId ?? null,
          enabled: main.applied?.enabled ?? true,
          warning: d.applied.warning ?? null,
        }
      : null,
    undone: d.undone ?? null,
    discarded: d.discarded ?? null,
    lastError: d.lastError ?? null,
  }
}
