import type { HAReader } from '../ha/data.ts'
import type { AutomationWriter } from '../ha/writer.ts'
import type { Options } from '../options.ts'
import type { SettingsStore } from '../store/settings.ts'
import type { UsageLedger } from '../claude/usage.ts'
import type { StreamFn } from '../claude/loop.ts'
import { describeClaudeError } from '../claude/client.ts'
import { priceOf, type UsageTotals } from '../claude/pricing.ts'
import { requestStructured, StructuredError, type StructuredRequest } from '../claude/structured.ts'
import { toYaml } from '../drafts/automation.ts'
import type { DraftService } from '../drafts/service.ts'
import { publicDraft } from '../drafts/service.ts'
import type { DraftStore } from '../drafts/store.ts'
import { buildPrivacyIndex, isAllowed, sanitizeState } from '../inventory/privacy.ts'
import type { ChatStarter, CountFn } from '../suggest/service.ts'
import { describeNow } from '../util/time.ts'
import { log } from '../log.ts'
import { collectVerify, type VerifyCollectOptions, type VerifyData } from './collect.ts'
import { runDynamicRules } from './dynamic.ts'
import { applyFixes, FixError } from './fixes.ts'
import { buildDossier, REPAIR_SCHEMA, Repairs, repairUserMessage, REVIEW_SCHEMA, Reviews, verifySystem, verifyUserMessage, type RepairItem } from './prompt.ts'
import { numberFindings, runStaticRules } from './rules.ts'
import type { ReviewResult, VerifyRun, VerifyStats, VerifyStore } from './store.ts'
import { RULES, type RuleId, type Severity } from './types.ts'
import { FeatureMemory } from '../claude/models.ts'
import { budgetBlockedMessage, usageRecord } from '../claude/usage.ts'

// "Verifica" in due tempi, come Suggerisci:
// 1. controllo rapido gratuito: regole deterministiche su configurazioni, stati, statistiche,
//    tracce e Registro attività; correzioni meccaniche come bozze (un tap, backup, Annulla);
// 2. su richiesta, analisi approfondita delle automazioni scelte, a lotti, con output
//    strutturato; le correzioni proposte passano dalla stessa pipeline delle bozze.

export class VerifyError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export interface VerifyServiceDeps {
  store: VerifyStore
  ha: HAReader | null
  writer: AutomationWriter | null
  settings: SettingsStore
  usage: UsageLedger
  options: Options
  stream: StreamFn | null
  count?: CountFn | null
  drafts: DraftService | null
  draftStore: DraftStore
  chat?: ChatStarter
  now?: () => Date
  /** Sostituibile nei test. */
  collect?: (ha: HAReader, opts: VerifyCollectOptions) => Promise<VerifyData>
}

export const BATCH_SIZE = 5
export const MAX_SELECTION = 60
const MAX_TOKENS = 48_000
const REPAIR_MAX_TOKENS = 32_000
const EFFORT_FACTOR: Record<string, number> = { low: 0.4, medium: 0.7, high: 1, xhigh: 1.5, max: 2 }
export const DEFAULT_DAYS = 7
export const MAX_DAYS = 14

export class VerifyService {
  private readonly controllers = new Map<string, AbortController>()
  private readonly features = new FeatureMemory()
  private saving: Promise<void> = Promise.resolve()
  private readonly now: () => Date
  private locationName = 'Casa'
  private haVersion = ''
  private timeZone = 'UTC'

  constructor(private readonly deps: VerifyServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  activeRunId(): string | null {
    return [...this.controllers.keys()][0] ?? null
  }

  private requireRun(id: string): VerifyRun {
    const run = this.deps.store.get(id)
    if (!run) throw new VerifyError(404, 'verifica_inesistente', 'Verifica non trovata')
    return run
  }

  private persist(run: VerifyRun): Promise<void> {
    const next = this.saving.then(() => this.deps.store.save(run))
    this.saving = next.catch((err) => log.warn('Salvataggio della verifica non riuscito', err instanceof Error ? err.message : err))
    return next
  }

  idle(): Promise<void> {
    return this.saving
  }

  private progress(run: VerifyRun, phase: string, done = 0, total = 0): Promise<void> {
    run.progress = { phase, done, total }
    return this.persist(run)
  }

  private release(id: string, controller: AbortController): void {
    if (this.controllers.get(id) === controller) this.controllers.delete(id)
  }

  private finish(run: VerifyRun): Promise<void> {
    this.controllers.delete(run.id)
    run.progress = null
    return this.persist(run)
  }

  private async loadHomeInfo(): Promise<void> {
    if (!this.deps.ha) return
    try {
      const c = await this.deps.ha.config()
      this.locationName = c.location_name
      this.haVersion = c.version
      this.timeZone = c.time_zone
    } catch {
      /* valori precedenti */
    }
  }

  // --- 1. Controllo rapido --------------------------------------------------------------------

  async start(by: string, days: number): Promise<VerifyRun> {
    const ha = this.deps.ha
    if (!ha || !this.deps.drafts) throw new VerifyError(503, 'ha_non_configurato', 'Home Assistant non è raggiungibile da questo processo')
    if (this.activeRunId()) throw new VerifyError(409, 'verifica_in_corso', "C'è già una verifica in corso: attendi che finisca.")
    const d = Math.min(MAX_DAYS, Math.max(0, Math.round(days)))
    const run: VerifyRun = {
      id: this.deps.store.newId(),
      createdAt: this.now().toISOString(),
      by,
      days: Number.isFinite(d) ? d : DEFAULT_DAYS,
      status: 'raccolta',
      progress: { phase: 'Avvio', done: 0, total: 0 },
      reports: [],
      findings: [],
      dossiers: {},
      reviews: {},
      fixes: {},
    }
    await this.persist(run)
    const controller = new AbortController()
    this.controllers.set(run.id, controller)
    void this.check(run, ha, controller.signal).finally(() => this.release(run.id, controller))
    return run
  }

  private async check(run: VerifyRun, ha: HAReader, signal: AbortSignal): Promise<void> {
    const started = Date.now()
    try {
      let last = 0
      const consents = this.deps.settings.consents()
      const data = await (this.deps.collect ?? collectVerify)(ha, {
        now: this.now(),
        days: run.days,
        consents,
        userKinds: this.deps.settings.get().userKinds,
        checkContext: () => this.deps.drafts!.checkContext(),
        writer: this.deps.writer,
        signal,
        onProgress: (p) => {
          if (Date.now() - last < 700 && p.done !== p.total) {
            run.progress = p
            return
          }
          last = Date.now()
          void this.progress(run, p.phase, p.done, p.total)
        },
      })
      await this.progress(run, 'Controllo delle regole')
      const st = runStaticRules(data.input)
      const keys = new Map(data.input.automations.map((a) => [a.entityId, a.id ?? a.entityId]))
      const names = new Map([...data.input.entities].map(([id, e]) => [id, e.name]))
      const dyn = runDynamicRules(data.events, { now: data.input.now, days: run.days, tz: data.tz, keys, names })
      const findings = numberFindings([...st.findings, ...dyn.findings], st.reports)
      run.reports = st.reports.sort((a, b) => a.alias.localeCompare(b.alias))
      run.findings = findings

      const entries = new Map(data.registries.entities.map((e) => [e.entity_id, e]))
      const privacy = buildPrivacyIndex(data.registries.entities)
      const configs = new Map(data.input.automations.map((a) => [a.entityId, a.config]))
      for (const r of run.reports) {
        run.dossiers[r.entityId] = buildDossier({
          report: r,
          findings: findings.filter((f) => f.automation === r.entityId),
          config: configs.get(r.entityId) ?? null,
          entities: data.input.entities,
          activity: dyn.activity,
          actions: data.logged.length ? (dyn.actions.get(r.entityId) ?? 0) : null,
          stats: data.input.stats,
          allowed: (id) => isAllowed(id, entries.get(id), privacy, consents),
          sanitize: (id, s) => sanitizeState(id, s, consents),
          tz: data.tz,
          days: run.days,
        })
      }
      run.stats = this.stats(run, data, Date.now() - started)
      if (this.deps.stream) {
        await this.progress(run, 'Stima del costo')
        run.estimate = await this.estimate(run)
      }
      run.status = 'pronta'
      run.finishedAt = this.now().toISOString()
      await this.finish(run)
      log.info(`Verifica ${run.id}: ${run.reports.length} automazioni, ${findings.length} problemi, ${data.events.length} eventi (${Math.round((Date.now() - started) / 1000)} s)`)
    } catch (err) {
      run.status = signal.aborted ? 'annullata' : 'errore'
      run.error = signal.aborted ? 'Verifica annullata.' : `Raccolta dei dati non riuscita: ${err instanceof Error ? err.message : String(err)}`
      run.finishedAt = this.now().toISOString()
      await this.finish(run)
      if (!signal.aborted) log.warn(`Verifica ${run.id}: errore`, err instanceof Error ? err.message : err)
    }
  }

  private stats(run: VerifyRun, data: VerifyData, durationMs: number): VerifyStats {
    const bySeverity: Record<Severity, number> = { errore: 0, avviso: 0, info: 0 }
    const byRule: Partial<Record<RuleId, number>> = {}
    for (const f of run.findings) {
      bySeverity[f.severity] += 1
      byRule[f.rule] = (byRule[f.rule] ?? 0) + 1
    }
    return {
      automations: run.reports.length,
      editable: run.reports.filter((r) => r.editable).length,
      withFindings: run.reports.filter((r) => r.findings.length).length,
      bySeverity,
      byRule,
      events: data.events.length,
      logged: data.logged.length,
      durationMs,
    }
  }

  /** Automazioni proposte per l'analisi approfondita: quelle con errori o avvisi non ignorati. */
  defaultSelection(run: VerifyRun): string[] {
    const ignored = this.deps.store.ignoredSignatures()
    const hot = new Set(run.findings.filter((f) => f.severity !== 'info' && !ignored.has(f.signature)).map((f) => f.automation))
    return run.reports.filter((r) => hot.has(r.entityId)).map((r) => r.entityId).slice(0, MAX_SELECTION)
  }

  private request(dossiers: string[], days: number, cacheSystem = false): StructuredRequest {
    return {
      model: this.deps.options.analysisModel,
      effort: this.deps.options.verifyEffort,
      system: verifySystem({ locationName: this.locationName, haVersion: this.haVersion, timeZone: this.timeZone }),
      user: verifyUserMessage(dossiers, { now: describeNow(this.now(), this.timeZone), days }),
      schema: REVIEW_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: MAX_TOKENS,
      // Con più lotti, uno dopo l'altro con lo stesso prompt di sistema, dal secondo si legge dalla
      // cache. La correzione ha un altro schema di output, quindi non la riusa.
      cacheSystem,
    }
  }

  /** Preventivo: token del sistema e di ogni dossier (contati con countTokens su un campione). */
  private async estimate(run: VerifyRun): Promise<VerifyRun['estimate']> {
    await this.loadHomeInfo()
    const base = this.request([], run.days)
    const { price } = priceOf(base.model)
    const preferred = [...this.defaultSelection(run), ...run.reports.map((r) => r.entityId)]
    const sample: string[] = []
    let chars = 0
    for (const id of new Set(preferred)) {
      const d = run.dossiers[id]
      if (!d || chars + d.length > 60_000) continue
      sample.push(d)
      chars += d.length
    }
    let systemTokens = Math.ceil((base.system.map((b) => b.text).join('').length + base.user.length) / 3) + 400
    let ratio = 1 / 3
    let counted = false
    if (this.deps.count && sample.length) {
      try {
        const params = (user: string) => ({
          model: base.model,
          system: base.system,
          messages: [{ role: 'user', content: user }],
          thinking: { type: 'adaptive' },
          output_config: { effort: base.effort, format: { type: 'json_schema', schema: base.schema } },
        })
        systemTokens = await this.deps.count(params(base.user))
        const total = await this.deps.count(params(this.request(sample, run.days).user))
        ratio = Math.max(0.1, (total - systemTokens) / chars)
        counted = true
      } catch (err) {
        log.warn('countTokens non disponibile, stima dai caratteri', err instanceof Error ? err.message : err)
      }
    }
    const factor = EFFORT_FACTOR[base.effort] ?? 1
    return {
      model: base.model,
      systemTokens,
      perAutomation: Object.fromEntries(Object.entries(run.dossiers).map(([id, d]) => [id, Math.ceil(d.length * ratio)])),
      outputPerAutomation: Math.round(1600 * factor),
      outputPerBatch: Math.round(1500 * factor),
      batchSize: BATCH_SIZE,
      priceIn: price.input,
      priceOut: price.output,
      counted,
    }
  }

  // --- 2. Analisi approfondita ----------------------------------------------------------------

  async analyze(id: string, automations: string[]): Promise<VerifyRun> {
    const run = this.requireRun(id)
    if (!this.deps.stream) throw new VerifyError(503, 'chiave_mancante', "Chiave API Anthropic non configurata nelle opzioni dell'add-on")
    if (!this.deps.drafts) throw new VerifyError(503, 'ha_non_configurato', 'Home Assistant non è raggiungibile da questo processo')
    if (this.activeRunId()) throw new VerifyError(409, 'verifica_in_corso', "C'è già una verifica in corso: attendi che finisca.")
    if (!['pronta', 'completata', 'interrotta', 'errore', 'annullata'].includes(run.status) || !run.reports.length) throw new VerifyError(409, 'stato_non_valido', 'Questa verifica non è pronta per l’analisi.')
    const known = new Set(run.reports.map((r) => r.entityId))
    const todo = [...new Set(automations)].filter((a) => known.has(a) && run.dossiers[a])
    if (!todo.length) throw new VerifyError(400, 'niente_da_analizzare', 'Scegli almeno un’automazione da analizzare.')
    if (todo.length > MAX_SELECTION) throw new VerifyError(400, 'troppe_automazioni', `Al massimo ${MAX_SELECTION} automazioni per analisi.`)
    const budget = this.deps.usage.status(this.deps.options)
    if (budget.level === 'bloccato') throw new VerifyError(429, 'budget_superato', budgetBlockedMessage(budget))
    run.status = 'analisi'
    run.selection = todo
    delete run.error
    for (const a of todo) delete run.reviews[a]
    run.progress = { phase: 'Claude sta analizzando le automazioni', done: 0, total: todo.length }
    await this.persist(run)
    const controller = new AbortController()
    this.controllers.set(run.id, controller)
    void this.runAnalysis(run, todo, controller.signal).finally(() => this.release(run.id, controller))
    return run
  }

  private async record(run: VerifyRun, u: UsageTotals, step: string, effort: string): Promise<void> {
    await this.deps.usage.record(usageRecord('verify', run.id, u, { step, effort }))
    const prev = run.usage ?? { model: u.model, costUsd: 0, input: 0, output: 0, fallback: false }
    run.usage = { model: u.model, costUsd: prev.costUsd + u.costUsd, input: prev.input + u.input, output: prev.output + u.output, fallback: prev.fallback || u.fallback }
  }

  private async structured(run: VerifyRun, req: StructuredRequest, step: string, signal: AbortSignal, onText?: (chars: number) => void) {
    const res = await requestStructured(this.deps.stream!, req, this.features.for(req.model), signal, onText).catch(async (err) => {
      if (err instanceof StructuredError && err.usage) await this.record(run, err.usage, step, req.effort)
      throw err
    })
    await this.record(run, res.usage, step, req.effort)
    return res
  }

  private async propose(run: VerifyRun, automation: string, yaml: string, spiegazione: string) {
    return this.deps.drafts!.propose({ yaml, spiegazione, sostituisce: automation }, { verification: { runId: run.id, automation } })
  }

  private async runAnalysis(run: VerifyRun, todo: string[], signal: AbortSignal): Promise<void> {
    try {
      await this.loadHomeInfo()
      const reports = new Map(run.reports.map((r) => [r.entityId, r]))
      const failed: RepairItem[] = []
      const batches: string[][] = []
      for (let i = 0; i < todo.length; i += BATCH_SIZE) batches.push(todo.slice(i, i + BATCH_SIZE))
      let done = 0
      for (const [b, batch] of batches.entries()) {
        if (signal.aborted) throw new StructuredError('annullata', 'Analisi annullata')
        const budget = this.deps.usage.status(this.deps.options)
        if (budget.level === 'bloccato') throw new VerifyError(429, 'budget_superato', `Budget raggiunto dopo ${done} automazioni: analisi fermata.`)
        const phase = batches.length > 1 ? `Claude sta analizzando (lotto ${b + 1} di ${batches.length})` : 'Claude sta analizzando le automazioni'
        await this.progress(run, phase, done, todo.length)
        const res = await this.structured(run, this.request(batch.map((a) => run.dossiers[a]!), run.days, batches.length > 1), 'analisi', signal)
        const parsed = Reviews.safeParse(res.value)
        if (!parsed.success) throw new StructuredError('json_non_valido', 'La risposta del modello non rispetta lo schema.')
        const wanted = new Set(batch)
        for (const v of parsed.data.valutazioni) {
          if (!wanted.has(v.automazione) || run.reviews[v.automazione]) continue
          const report = reports.get(v.automazione)!
          const result: ReviewResult = {
            giudizio: v.giudizio,
            sintesi: v.sintesi.trim(),
            problemi: v.problemi.map((p) => ({ titolo: p.titolo.trim(), spiegazione: p.spiegazione.trim(), gravita: p.gravita })),
            yaml: v.yaml_corretto.trim(),
            spiegazione: v.spiegazione_correzione.trim(),
          }
          run.reviews[v.automazione] = result
          if (result.yaml && report.editable) {
            const r = await this.propose(run, v.automazione, result.yaml, result.spiegazione || result.sintesi)
            if (r.ok) result.draftId = r.draft.id
            else failed.push({ automation: v.automazione, dossier: run.dossiers[v.automazione]!, yaml: result.yaml, errors: r.errors })
          }
        }
        for (const a of batch) {
          if (!run.reviews[a]) run.reviews[a] = { giudizio: 'da_migliorare', sintesi: 'Il modello non ha risposto per questa automazione: rilancia l’analisi per riprovare.', problemi: [], yaml: '', spiegazione: '', errors: ['Nessuna risposta'] }
        }
        done += batch.length
        await this.progress(run, phase, done, todo.length)
      }

      // Una sola correzione, tutte insieme.
      if (failed.length && !signal.aborted) {
        await this.progress(run, 'Correzione delle proposte non valide', 0, failed.length)
        try {
          const base = this.request([], run.days)
          const fix = await this.structured(run, { ...base, effort: 'medium', user: repairUserMessage(failed), schema: REPAIR_SCHEMA as unknown as Record<string, unknown>, maxTokens: REPAIR_MAX_TOKENS }, 'correzione', signal)
          const parsed = Repairs.safeParse(fix.value)
          const fixed = new Map((parsed.success ? parsed.data.correzioni : []).map((c) => [c.automazione, c.yaml.trim()]))
          for (const it of failed) {
            const result = run.reviews[it.automation]!
            const yaml = fixed.get(it.automation)
            if (!yaml) {
              result.errors = it.errors
              continue
            }
            const r = await this.propose(run, it.automation, yaml, result.spiegazione || result.sintesi)
            result.yaml = yaml
            if (r.ok) {
              result.draftId = r.draft.id
              result.repaired = true
            } else result.errors = r.errors
          }
        } catch (err) {
          for (const it of failed) run.reviews[it.automation]!.errors = it.errors
          if (err instanceof StructuredError && err.code === 'annullata') throw err
          log.warn(`Verifica ${run.id}: correzione non riuscita`, err instanceof Error ? err.message : err)
        }
      }
      run.status = 'completata'
      run.finishedAt = this.now().toISOString()
      await this.finish(run)
      const made = todo.filter((a) => run.reviews[a]?.draftId).length
      log.info(`Verifica ${run.id}: ${todo.length} automazioni analizzate, ${made} correzioni pronte ($${(run.usage?.costUsd ?? 0).toFixed(3)})`)
    } catch (err) {
      const aborted = signal.aborted || (err instanceof StructuredError && err.code === 'annullata')
      run.status = aborted ? 'annullata' : 'errore'
      run.error = aborted ? 'Analisi annullata.' : err instanceof StructuredError || err instanceof VerifyError ? err.message : describeClaudeError(err)
      run.finishedAt = this.now().toISOString()
      await this.finish(run)
      if (!aborted) log.warn(`Verifica ${run.id}: errore nell'analisi`, run.error)
    }
  }

  stop(id: string): boolean {
    const c = this.controllers.get(id)
    if (!c) return false
    c.abort()
    return true
  }

  // --- Correzioni meccaniche, problemi ignorati, chat -----------------------------------------

  async fix(id: string, automation: string, findingIds: string[], by: string): Promise<void> {
    const run = this.requireRun(id)
    if (!this.deps.drafts || !this.deps.writer) throw new VerifyError(503, 'ha_non_configurato', 'Home Assistant non è raggiungibile da questo processo')
    if (run.status === 'raccolta') throw new VerifyError(409, 'stato_non_valido', 'La verifica è ancora in corso.')
    const report = run.reports.find((r) => r.entityId === automation)
    if (!report) throw new VerifyError(404, 'automazione_inesistente', 'Automazione non trovata in questa verifica')
    if (!report.editable || !report.id) throw new VerifyError(400, 'non_modificabile', "Questa automazione non è nell'editor di Home Assistant (YAML, packages o blueprint): correggila a mano.")
    const wanted = new Set(findingIds)
    const chosen = run.findings.filter((f) => wanted.has(f.id) && f.automation === automation && f.fix)
    if (!chosen.length) throw new VerifyError(400, 'nessuna_correzione', 'Scegli almeno una correzione.')
    const current = await this.deps.writer.getConfig(report.id)
    if (!current) throw new VerifyError(409, 'non_piu_modificabile', "L'automazione non è più nell'editor di Home Assistant.")
    let config: Record<string, unknown>
    try {
      config = applyFixes(current, chosen.map((f) => f.fix!))
    } catch (err) {
      if (err instanceof FixError) throw new VerifyError(409, 'correzione_non_applicabile', err.message)
      throw err
    }
    const explanation = `Correzioni dalla Verifica:\n${chosen.map((f) => `• ${f.fix!.label}`).join('\n')}`
    // Una bozza di correzione per automazione: la precedente, se ancora in attesa, si scarta.
    const prev = run.fixes[automation]?.draftId ? this.deps.draftStore.get(run.fixes[automation]!.draftId!) : undefined
    const r = await this.propose(run, automation, toYaml(config), explanation)
    if (r.ok && prev?.status === 'pending') await this.deps.drafts.discard(prev.id, by).catch(() => undefined)
    run.fixes[automation] = r.ok ? { findings: chosen.map((f) => f.id), draftId: r.draft.id } : { findings: chosen.map((f) => f.id), errors: r.errors }
    await this.persist(run)
    await this.idle()
  }

  async ignore(id: string, findingId: string, by: string): Promise<void> {
    const run = this.requireRun(id)
    const f = run.findings.find((x) => x.id === findingId)
    if (!f) throw new VerifyError(404, 'problema_inesistente', 'Problema non trovato')
    const alias = run.reports.find((r) => r.entityId === f.automation)?.alias ?? f.automation
    await this.deps.store.ignore(f.signature, { at: this.now().toISOString(), by, title: `${alias}: ${f.title}` })
  }

  async unignore(id: string, findingId: string): Promise<void> {
    const run = this.requireRun(id)
    const f = run.findings.find((x) => x.id === findingId)
    if (!f) throw new VerifyError(404, 'problema_inesistente', 'Problema non trovato')
    await this.deps.store.unignore(f.signature)
  }

  /** Apre una chat già avviata sull'automazione, con i problemi trovati. */
  async discuss(id: string, automation: string, by: string): Promise<{ conversationId: string }> {
    if (!this.deps.chat) throw new VerifyError(503, 'chat_non_disponibile', 'Chat non disponibile')
    const run = this.requireRun(id)
    const report = run.reports.find((r) => r.entityId === automation)
    if (!report) throw new VerifyError(404, 'automazione_inesistente', 'Automazione non trovata in questa verifica')
    const ignored = this.deps.store.ignoredSignatures()
    const findings = run.findings.filter((f) => f.automation === automation && !ignored.has(f.signature))
    const review = run.reviews[automation]
    const lines = [
      `Verifica: ${report.alias}`,
      '',
      `Rivediamo l'automazione "${report.alias}" (${automation}).`,
    ]
    if (findings.length) {
      lines.push('', 'Problemi trovati dai controlli automatici:')
      for (const f of findings) lines.push(`- [${f.severity}, ${f.rule} ${RULES[f.rule]}] ${f.title}: ${f.detail}${f.fix ? ` (correzione proposta: ${f.fix.label})` : ''}`)
    }
    if (review) {
      lines.push('', `Analisi approfondita: ${review.sintesi}`)
      for (const p of review.problemi) lines.push(`- (${p.gravita}) ${p.titolo}: ${p.spiegazione}`)
      if (review.yaml) lines.push('', 'Correzione proposta:', '```yaml', review.yaml, '```')
    }
    if (!report.editable) lines.push('', "Nota: non è modificabile dall'editor (YAML, packages o blueprint).")
    lines.push('', "Leggi l'automazione e le sue ultime esecuzioni, verifica questi punti e, se serve, proponi una versione corretta.")
    const { id: conversationId } = await this.deps.chat.create(by)
    await this.deps.chat.send(conversationId, lines.join('\n'))
    return { conversationId }
  }

  // --- Viste ------------------------------------------------------------------------------------

  view(run: VerifyRun) {
    const ignored = this.deps.store.ignoredSignatures()
    const draft = (draftId?: string) => {
      const d = draftId ? this.deps.draftStore.get(draftId) : undefined
      return d ? publicDraft(d) : null
    }
    const { dossiers: _dossiers, ...rest } = run
    return {
      ...rest,
      running: this.controllers.has(run.id),
      defaultSelection: this.defaultSelection(run),
      findings: run.findings.map((f) => ({ ...f, ignored: ignored.has(f.signature) })),
      reviews: Object.fromEntries(Object.entries(run.reviews).map(([a, r]) => [a, { ...r, draft: draft(r.draftId) }])),
      fixes: Object.fromEntries(Object.entries(run.fixes).map(([a, f]) => [a, { ...f, draft: draft(f.draftId) }])),
    }
  }

  summaries() {
    return this.deps.store.list().map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      by: r.by,
      status: r.status,
      automations: r.reports.length,
      findings: r.findings.length,
      errors: r.findings.filter((f) => f.severity === 'errore').length,
      reviewed: Object.keys(r.reviews).length,
      costUsd: r.usage?.costUsd ?? 0,
    }))
  }
}
