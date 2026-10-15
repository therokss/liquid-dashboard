import { createHash, randomBytes } from 'node:crypto'
import type { HAReader } from '../ha/data.ts'
import type { HAState } from '../ha/types.ts'
import type { AutomationWriter } from '../ha/writer.ts'
import { WriteError } from '../ha/writer.ts'
import { buildPrivacyIndex, classifyPrivacy, domainOf } from '../inventory/privacy.ts'
import { entityName } from '../inventory/inventory.ts'
import type { ConversationStore } from '../chat/store.ts'
import { lineDiff, normalizeAutomation, parseYaml, stableJson, toYaml, type AutomationConfig } from './automation.ts'
import { checkAutomation, walkSteps, type CheckContext, type CheckResult } from './checks.ts'
import type { Draft, DraftStore } from './store.ts'
import { log } from '../log.ts'

// Ciclo di vita di una bozza: proposta (Claude) → controlli → scheda in chat → tap
// dell'amministratore → ricontrollo, backup, scrittura, verifica del caricamento →
// categoria "Claude" → eventuale "Annulla". Claude non scrive mai: scrive questo servizio.

export class DraftError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export interface ProposeInput {
  yaml: string
  spiegazione: string
  sostituisce?: string
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
  writer: AutomationWriter
  conversations: ConversationStore
  now?: () => Date
  sleep?: (ms: number) => Promise<void>
  pollMs?: number
  pollTimeoutMs?: number
}

export const CATEGORY_NAME = 'Claude'
const CATEGORY_ICON = 'mdi:robot-outline'
const KEY_ORDER = ['id', 'alias', 'description', 'triggers', 'trigger', 'conditions', 'condition', 'actions', 'action', 'mode']

export function configHash(config: unknown): string {
  const c = config && typeof config === 'object' ? { ...(config as Record<string, unknown>) } : config
  if (c && typeof c === 'object') delete (c as Record<string, unknown>).id
  return createHash('sha256').update(stableJson(c)).digest('hex')
}

function orderedForDisplay(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of KEY_ORDER) if (k !== 'id' && config[k] !== undefined) out[k] = config[k]
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
      services,
      triggerTypes: catalog ? new Set(Object.keys(catalog)) : null,
      registryIds: new Set(reg.entities.filter((e) => !e.disabled_by && e.registry_id).map((e) => e.registry_id!)),
    }
  }

  /**
   * Controlli della bozza. Per una modifica, i problemi che la versione attuale ha già (un
   * riferimento rotto non ancora corretto, un servizio che l'assistente non introdurrebbe)
   * non bloccano: la bozza non peggiora nulla. Tornano come avvisi.
   */
  checkAgainst(config: AutomationConfig, ctx: CheckContext, current: Record<string, unknown> | null): CheckResult & { inherited: string[] } {
    if (!current) return { ...checkAutomation(config, ctx), inherited: [] }
    const before = normalizeAutomation(current).config
    const allowed = new Set<string>()
    if (before) for (const { step } of walkSteps(before.actions, 'actions')) if (typeof step.action === 'string') allowed.add(step.action)
    const res = checkAutomation(config, ctx, { allowedServices: allowed })
    const old = new Set(before ? checkAutomation(before, ctx, { allowedServices: allowed }).errors : [])
    return { ...res, errors: res.errors.filter((e) => !old.has(e)), inherited: res.errors.filter((e) => old.has(e)) }
  }

  /** validate_config di Home Assistant su trigger, condizioni e azioni. */
  async validateWithHA(config: AutomationConfig): Promise<string[]> {
    const msg: Record<string, unknown> = { type: 'validate_config', triggers: config.triggers, actions: config.actions }
    if (Array.isArray(config.conditions) && config.conditions.length) msg.conditions = config.conditions
    let r: Record<string, { valid: boolean; error: string | null }>
    try {
      r = await this.deps.ha.call(msg, 30_000)
    } catch (err) {
      return [`Validazione di Home Assistant non disponibile: ${err instanceof Error ? err.message : String(err)}`]
    }
    const label: Record<string, string> = { triggers: 'i trigger', conditions: 'le condizioni', actions: 'le azioni' }
    return Object.entries(r)
      .filter(([, v]) => v && !v.valid)
      .map(([k, v]) => `Home Assistant rifiuta ${label[k] ?? k}: ${v.error ?? 'errore sconosciuto'}`)
  }

  private async resolveTarget(ref: string): Promise<{ entityId: string; automationId: string } | string> {
    const states = await this.deps.ha.states()
    let state: HAState | undefined
    if (ref.startsWith('automation.')) state = states.get(ref)
    else for (const s of states.values()) if (domainOf(s.entity_id) === 'automation' && s.attributes.id === ref) state = s
    if (!state) return `L'automazione "${ref}" non esiste: usa elenca_automazioni per l'entity_id giusto.`
    const id = state.attributes.id
    if (typeof id !== 'string' || !id) return `${state.entity_id} non ha un id: è definita in YAML o nei packages e non si può modificare dall'editor. Proponi all'utente lo YAML da copiare.`
    return { entityId: state.entity_id, automationId: id }
  }

  async propose(input: ProposeInput, origin: DraftOrigin): Promise<ProposeResult> {
    const parsed = parseYaml(input.yaml)
    if (parsed.errors.length) return { ok: false, errors: parsed.errors, warnings: [], fixes: [] }
    const norm = normalizeAutomation(parsed.value)
    if (!norm.config) return { ok: false, errors: norm.errors, warnings: norm.warnings, fixes: norm.fixes }
    const config = norm.config

    let target: Draft['target']
    let current: Record<string, unknown> | null = null
    if (input.sostituisce) {
      const t = await this.resolveTarget(input.sostituisce.trim())
      if (typeof t === 'string') return { ok: false, errors: [t], warnings: norm.warnings, fixes: norm.fixes }
      current = await this.deps.writer.getConfig(t.automationId)
      if (!current) return { ok: false, errors: [`${t.entityId} non è in automations.yaml (packages o YAML): non si può modificare da qui.`], warnings: norm.warnings, fixes: norm.fixes }
      if ('use_blueprint' in current) return { ok: false, errors: [`${t.entityId} è creata da una blueprint: si modifica dall'editor di Home Assistant.`], warnings: norm.warnings, fixes: norm.fixes }
      if (configHash(current) === configHash(config)) return { ok: false, errors: ['La proposta è identica alla configurazione attuale: nessuna modifica.'], warnings: norm.warnings, fixes: norm.fixes }
      const states = await this.deps.ha.states()
      target = {
        entityId: t.entityId,
        automationId: t.automationId,
        alias: entityName(t.entityId, undefined, states.get(t.entityId)),
        baseHash: configHash(current),
        beforeYaml: toYaml(orderedForDisplay(current)),
      }
    }

    const ctx = await this.checkContext()
    const checked = this.checkAgainst(config, ctx, current)
    const haErrors = checked.errors.length ? [] : await this.validateWithHA(config)
    const errors = [...checked.errors, ...haErrors]
    const warnings = [...norm.warnings, ...checked.warnings, ...checked.inherited.map((e) => `Già presente nella versione attuale: ${e}`)]
    if (errors.length) return { ok: false, errors, warnings, fixes: norm.fixes }

    const yaml = toYaml(config)
    const draft: Draft = {
      id: this.deps.store.newId(this.now().getTime()),
      conversationId: 'conversationId' in origin ? origin.conversationId : '',
      toolUseId: 'toolUseId' in origin ? origin.toolUseId : '',
      ...('suggestion' in origin ? { suggestion: origin.suggestion } : {}),
      ...('verification' in origin ? { verification: origin.verification } : {}),
      createdAt: this.now().toISOString(),
      status: 'pending',
      kind: target ? 'update' : 'create',
      alias: String(config.alias),
      explanation: input.spiegazione.trim(),
      config,
      yaml,
      fixes: norm.fixes,
      warnings,
      checks: [
        { label: 'YAML valido, sintassi attuale', ok: true, ...(norm.fixes.length ? { detail: `corretto: ${norm.fixes.join(', ')}` } : {}) },
        { label: 'Entità, aree e dispositivi esistenti', ok: true, detail: `${checked.entities.length} entità` },
        { label: 'Servizi esistenti e consentiti', ok: true, ...(checked.services.length ? { detail: checked.services.join(', ') } : {}) },
        { label: 'Validazione di Home Assistant', ok: true },
      ],
      critical: checked.critical,
      ...(target ? { target, diff: lineDiff(target.beforeYaml, yaml) } : {}),
    }
    await this.deps.store.save(draft)
    return { ok: true, draft }
  }

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

  private async findEntity(automationId: string, alias: string, fullScan: boolean): Promise<string | null> {
    for (const candidate of slugCandidates(alias)) {
      const s = await this.deps.writer.getState(candidate)
      if (s?.attributes.id === automationId) return candidate
    }
    if (!fullScan) return null
    const list = await this.deps.ha.call<HAState[]>({ type: 'get_states' }, 60_000).catch(() => [] as HAState[])
    return list.find((s) => domainOf(s.entity_id) === 'automation' && s.attributes.id === automationId)?.entity_id ?? null
  }

  /** Attende che HA ricarichi l'automazione con la configurazione appena scritta. */
  private async waitLoaded(automationId: string, alias: string, knownEntity: string | null, config: AutomationConfig): Promise<{ entityId: string | null; state: HAState | null }> {
    const pollMs = this.deps.pollMs ?? 500
    const deadline = Date.now() + (this.deps.pollTimeoutMs ?? 12_000)
    const want = configHash(config)
    let entityId = knownEntity
    let attempts = 0
    while (Date.now() < deadline) {
      attempts += 1
      if (!entityId) entityId = await this.findEntity(automationId, alias, attempts % 6 === 0)
      if (entityId) {
        const loaded = await this.deps.writer.loadedConfig(entityId)
        if (loaded && configHash(loaded) === want) return { entityId, state: await this.deps.writer.getState(entityId) }
      }
      await this.sleep(pollMs)
    }
    return { entityId, state: null }
  }

  private async event(conversationId: string, text: string): Promise<void> {
    if (!conversationId) return // bozza nata da Suggerisci: nessuna chat da avvisare
    await this.deps.conversations
      .append(conversationId, { type: 'event', id: `e${this.now().getTime().toString(36)}${randomBytes(3).toString('hex')}`, ts: this.now().toISOString(), text })
      .catch((err) => log.warn('Evento della bozza non registrato nella chat', err instanceof Error ? err.message : err))
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
        throw new DraftError(400, 'conferma_richiesta', 'Questa automazione comanda entità critiche: conferma esplicitamente prima di procedere.')
      }
      // La casa può essere cambiata dalla proposta: si ricontrolla tutto.
      const before = d.kind === 'update' ? await writer.getConfig(d.target!.automationId) : null
      const recheck = this.checkAgainst(d.config, await this.checkContext(), before)
      const errors = [...recheck.errors, ...(recheck.errors.length ? [] : await this.validateWithHA(d.config))]
      if (errors.length) {
        d.lastError = errors.join(' ')
        await store.save(d)
        throw new DraftError(409, 'controlli_falliti', `La bozza non supera più i controlli: ${errors.join(' ')}`)
      }

      const ts = this.now().toISOString()
      let automationId: string
      let backupFile: string | null = null
      if (d.kind === 'update') {
        automationId = d.target!.automationId
        const current = await writer.getConfig(automationId)
        if (!current) throw new DraftError(409, 'non_piu_modificabile', "L'automazione non è più nell'editor di Home Assistant.")
        if (configHash(current) !== d.target!.baseHash) {
          throw new DraftError(409, 'modificata_nel_frattempo', "L'automazione è stata modificata dopo la proposta: chiedi a Claude una nuova bozza aggiornata.")
        }
        backupFile = await store.backup(automationId, current, ts, d.id)
      } else {
        automationId = await this.newAutomationId()
      }

      try {
        await writer.save(automationId, { id: automationId, ...d.config })
      } catch (err) {
        d.lastError = err instanceof Error ? err.message : String(err)
        await store.save(d)
        throw new DraftError(err instanceof WriteError && err.status === 400 ? 400 : 502, 'scrittura_rifiutata', `Home Assistant ha rifiutato il salvataggio: ${d.lastError}`)
      }
      const written = await writer.getConfig(automationId)
      const writtenHash = configHash(written ?? d.config)

      const loaded = await this.waitLoaded(automationId, d.alias, d.target?.entityId ?? null, d.config)
      if (loaded.state?.state === 'unavailable') {
        // Configurazione accettata ma non caricabile: si torna subito allo stato precedente.
        if (d.kind === 'create') await writer.remove(automationId).catch(() => undefined)
        else if (backupFile) {
          const before = await store.readBackup(backupFile)
          if (before) await writer.save(automationId, before).catch(() => undefined)
        }
        await store.record({ ts, by: opts.by, action: 'rollback_automatico', automationId, entityId: loaded.entityId, alias: d.alias, draftId: d.id, conversationId: d.conversationId, backupFile })
        d.lastError = 'Home Assistant non è riuscito a caricare l’automazione: modifica annullata automaticamente.'
        await store.save(d)
        throw new DraftError(502, 'non_caricata', d.lastError)
      }

      let warning: string | undefined
      if (!loaded.state) warning = 'Home Assistant non ha ancora ricaricato l’automazione: controlla tra qualche secondo.'
      if (d.kind === 'create' && loaded.entityId) {
        try {
          await writer.setCategory(loaded.entityId, await writer.ensureCategory(CATEGORY_NAME, CATEGORY_ICON))
        } catch (err) {
          log.warn('Categoria "Claude" non assegnata', err instanceof Error ? err.message : err)
        }
        if (!opts.enabled) {
          try {
            await writer.setEnabled(loaded.entityId, false)
          } catch {
            warning = 'Creata ma non è stato possibile disattivarla: fallo dall’elenco delle automazioni.'
          }
        }
      }

      d.status = 'applied'
      d.applied = { at: ts, by: opts.by, automationId, entityId: loaded.entityId, enabled: d.kind === 'create' ? opts.enabled : true, writtenHash, backupFile, ...(warning ? { warning } : {}) }
      delete d.lastError
      await store.save(d)
      await store.record({ ts, by: opts.by, action: d.kind === 'create' ? 'creata' : 'modificata', automationId, entityId: loaded.entityId, alias: d.alias, draftId: d.id, conversationId: d.conversationId, backupFile })
      log.info(`Automazione ${d.kind === 'create' ? 'creata' : 'modificata'}: ${d.alias} (${loaded.entityId ?? automationId}) da ${opts.by}`)
      await this.event(
        d.conversationId,
        d.kind === 'create'
          ? `L'utente ha creato l'automazione "${d.alias}" dalla bozza ${d.id}: ${loaded.entityId ?? 'entity_id non ancora disponibile'}, id ${automationId}, ${opts.enabled ? 'attiva' : 'disattivata'}.`
          : `L'utente ha applicato la bozza ${d.id}: l'automazione "${d.alias}" (${loaded.entityId}) è stata modificata.`,
      )
      return d
    })
  }

  undo(id: string, opts: { force: boolean; by: string }): Promise<Draft> {
    return this.serialize(async () => {
      const { store, writer } = this.deps
      const d = this.require(id, 'applied')
      const a = d.applied!
      const ts = this.now().toISOString()
      const current = await writer.getConfig(a.automationId)
      if (current && configHash(current) !== a.writtenHash && !opts.force) {
        throw new DraftError(409, 'modificata_dopo', "L'automazione è stata modificata dopo che l'hai applicata: annullando perderai anche quelle modifiche.")
      }
      if (d.kind === 'create') {
        if (current) {
          await store.backup(a.automationId, current, ts, d.id)
          await writer.remove(a.automationId)
        }
        await store.record({ ts, by: opts.by, action: 'annullata_creazione', automationId: a.automationId, entityId: a.entityId, alias: d.alias, draftId: d.id, conversationId: d.conversationId })
      } else {
        const before = a.backupFile ? await store.readBackup(a.backupFile) : null
        if (!before) throw new DraftError(500, 'backup_mancante', 'Backup della versione precedente non trovato.')
        if (!current) throw new DraftError(409, 'non_piu_modificabile', "L'automazione non è più nell'editor di Home Assistant.")
        const safety = await store.backup(a.automationId, current, ts, d.id)
        await writer.save(a.automationId, before)
        await store.record({ ts, by: opts.by, action: 'ripristinata', automationId: a.automationId, entityId: a.entityId, alias: d.alias, draftId: d.id, conversationId: d.conversationId, backupFile: safety })
      }
      d.status = 'undone'
      d.undone = { at: ts, by: opts.by }
      await store.save(d)
      log.info(`Annullata la bozza ${d.id} (${d.alias}) da ${opts.by}`)
      await this.event(
        d.conversationId,
        d.kind === 'create'
          ? `L'utente ha annullato la bozza ${d.id}: l'automazione "${d.alias}" è stata eliminata.`
          : `L'utente ha annullato la bozza ${d.id}: l'automazione "${d.alias}" è tornata alla versione precedente.`,
      )
      return d
    })
  }

  discard(id: string, by: string): Promise<Draft> {
    return this.serialize(async () => {
      const d = this.require(id, 'pending')
      d.status = 'discarded'
      d.discarded = { at: this.now().toISOString(), by }
      await this.deps.store.save(d)
      await this.event(d.conversationId, `L'utente ha scartato la bozza ${d.id} ("${d.alias}") senza applicarla.`)
      return d
    })
  }
}

/** Vista della bozza per l'interfaccia. */
export function publicDraft(d: Draft) {
  return {
    id: d.id,
    toolUseId: d.toolUseId,
    status: d.status,
    kind: d.kind,
    alias: d.alias,
    explanation: d.explanation,
    yaml: d.yaml,
    fixes: d.fixes,
    warnings: d.warnings,
    checks: d.checks,
    critical: d.critical,
    target: d.target ? { entityId: d.target.entityId, alias: d.target.alias, automationId: d.target.automationId } : null,
    suggestion: d.suggestion ?? null,
    verification: d.verification ?? null,
    diff: d.diff ?? null,
    applied: d.applied ? { at: d.applied.at, by: d.applied.by, automationId: d.applied.automationId, entityId: d.applied.entityId, enabled: d.applied.enabled, warning: d.applied.warning ?? null } : null,
    undone: d.undone ?? null,
    discarded: d.discarded ?? null,
    lastError: d.lastError ?? null,
  }
}
