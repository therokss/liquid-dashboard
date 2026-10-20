import type { HAReader } from '../ha/data.ts'
import type { Options } from '../options.ts'
import type { SettingsStore } from '../store/settings.ts'
import type { UsageLedger } from '../claude/usage.ts'
import type { StreamFn } from '../claude/loop.ts'
import { describeClaudeError } from '../claude/client.ts'
import { priceOf, type UsageTotals } from '../claude/pricing.ts'
import { requestStructured, StructuredError, type StructuredRequest } from '../claude/structured.ts'
import type { DraftService } from '../drafts/service.ts'
import { publicDraft } from '../drafts/service.ts'
import type { DraftStore } from '../drafts/store.ts'
import { log } from '../log.ts'
import { collectActivity, type CollectOptions } from './collect.ts'
import { mine } from './miner.ts'
import { PROPOSALS_SCHEMA, Proposals, repairUserMessage, REPAIR_SCHEMA, Repairs, suggestSystem, suggestUserMessage, type RepairItem } from './prompt.ts'
import type { CandidateResult, SuggestRun, SuggestStore } from './store.ts'
import type { Activity, Candidate } from './types.ts'
import { FeatureMemory } from '../claude/models.ts'
import { budgetBlockedMessage, usageRecord } from '../claude/usage.ts'

// "Suggerisci" in due tempi, entrambi job lato server seguiti dall'interfaccia:
// 1. raccolta + analisi locale (gratis): candidati con i numeri e la stima del costo;
// 2. su richiesta, UNA chiamata al modello di analisi con output strutturato, poi ogni YAML
//    passa dalla stessa pipeline delle bozze della chat (al più una correzione).

export class SuggestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export type CountFn = (params: Record<string, unknown>) => Promise<number>

export interface ChatStarter {
  create(by: string): Promise<{ id: string }>
  send(id: string, text: string): Promise<unknown>
}

export interface SuggestServiceDeps {
  store: SuggestStore
  ha: HAReader | null
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
  collect?: (ha: HAReader, opts: CollectOptions) => Promise<Activity>
}

const MAX_TOKENS = 64_000
const REPAIR_MAX_TOKENS = 32_000
const EFFORT_FACTOR: Record<string, number> = { low: 0.4, medium: 0.7, high: 1, xhigh: 1.5, max: 2 }
export const MIN_DAYS = 3
export const MAX_DAYS = 30

export class SuggestService {
  private readonly controllers = new Map<string, AbortController>()
  private readonly features = new FeatureMemory()
  /** Salvataggi in fila: un progresso lento non deve sovrascrivere lo stato finale. */
  private saving: Promise<void> = Promise.resolve()
  private readonly now: () => Date

  constructor(private readonly deps: SuggestServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  activeRunId(): string | null {
    return [...this.controllers.keys()][0] ?? null
  }

  private requireRun(id: string): SuggestRun {
    const run = this.deps.store.get(id)
    if (!run) throw new SuggestError(404, 'analisi_inesistente', 'Analisi non trovata')
    return run
  }

  private persist(run: SuggestRun): Promise<void> {
    const next = this.saving.then(() => this.deps.store.save(run))
    this.saving = next.catch((err) => log.warn('Salvataggio dell\'analisi non riuscito', err instanceof Error ? err.message : err))
    return next
  }

  /** Attende i salvataggi in corso (test e arresto). */
  idle(): Promise<void> {
    return this.saving
  }

  private progress(run: SuggestRun, phase: string, done = 0, total = 0): Promise<void> {
    run.progress = { phase, done, total }
    return this.persist(run)
  }

  private release(id: string, controller: AbortController): void {
    if (this.controllers.get(id) === controller) this.controllers.delete(id)
  }

  /** Fine del job: il controller si toglie PRIMA di pubblicare lo stato finale. */
  private finish(run: SuggestRun): Promise<void> {
    this.controllers.delete(run.id)
    run.progress = null
    return this.persist(run)
  }

  /** Avvia raccolta e analisi locale. */
  async start(by: string, days: number): Promise<SuggestRun> {
    const ha = this.deps.ha
    if (!ha) throw new SuggestError(503, 'ha_non_configurato', 'Home Assistant non è raggiungibile da questo processo')
    if (this.activeRunId()) throw new SuggestError(409, 'analisi_in_corso', "C'è già un'analisi in corso: attendi che finisca.")
    const d = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(days) || MAX_DAYS))
    const run: SuggestRun = {
      id: this.deps.store.newId(),
      createdAt: this.now().toISOString(),
      by,
      days: d,
      status: 'raccolta',
      progress: { phase: 'Avvio', done: 0, total: 0 },
      candidates: [],
      deferred: [],
      results: {},
    }
    await this.persist(run)
    const controller = new AbortController()
    this.controllers.set(run.id, controller)
    void this.collectAndMine(run, ha, controller.signal).finally(() => this.release(run.id, controller))
    return run
  }

  private async collectAndMine(run: SuggestRun, ha: HAReader, signal: AbortSignal): Promise<void> {
    const started = Date.now()
    try {
      let last = 0
      const activity = await (this.deps.collect ?? collectActivity)(ha, {
        days: run.days,
        now: this.now(),
        consents: this.deps.settings.consents(),
        userKinds: this.deps.settings.get().userKinds,
        signal,
        onProgress: (p) => {
          // Salvataggi diradati: la UI interroga ogni secondo, il disco non serve di più.
          if (Date.now() - last < 700 && p.done !== p.total) {
            run.progress = p
            return
          }
          last = Date.now()
          void this.progress(run, p.phase, p.done, p.total)
        },
      })
      await this.progress(run, 'Ricerca delle abitudini')
      const result = mine(activity, { now: this.now().getTime(), dismissed: new Set(this.deps.store.dismissedSignatures().keys()) })
      run.candidates = result.candidates
      run.deferred = result.deferred
      run.stats = activity.stats
      run.window = {
        from: new Date(activity.from).toISOString(),
        to: new Date(activity.to).toISOString(),
        firstDay: activity.stats.firstDay,
        observedDays: result.observedDays,
        feriali: result.dayCounts.feriale,
        festivi: result.dayCounts.festivo,
      }
      if (run.candidates.length) {
        await this.progress(run, 'Stima del costo')
        run.estimate = await this.estimate(run, activity)
      }
      run.status = 'pronta'
      await this.finish(run)
      log.info(`Suggerisci ${run.id}: ${activity.stats.events} eventi, ${run.candidates.length} candidati, ${run.deferred.length} rimandati (${Math.round((Date.now() - started) / 1000)} s)`)
    } catch (err) {
      run.status = signal.aborted ? 'annullata' : 'errore'
      run.error = signal.aborted ? 'Analisi annullata.' : `Raccolta dei dati non riuscita: ${err instanceof Error ? err.message : String(err)}`
      run.finishedAt = this.now().toISOString()
      await this.finish(run)
      if (!signal.aborted) log.warn(`Suggerisci ${run.id}: errore`, err instanceof Error ? err.message : err)
    }
  }

  private request(run: SuggestRun, activity: { tz: string } | null): StructuredRequest {
    const tz = activity?.tz ?? 'UTC'
    return {
      model: this.deps.options.analysisModel,
      effort: this.deps.options.suggestEffort,
      system: suggestSystem({ locationName: this.locationName, haVersion: this.haVersion, timeZone: tz }),
      user: suggestUserMessage(run.candidates, {
        now: this.now(),
        tz,
        observedDays: run.window?.observedDays ?? 0,
        feriali: run.window?.feriali ?? 0,
        festivi: run.window?.festivi ?? 0,
      }),
      schema: PROPOSALS_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: MAX_TOKENS,
    }
  }

  private locationName = 'Casa'
  private haVersion = ''
  private timeZone = 'UTC'

  private async loadHomeInfo(): Promise<void> {
    if (!this.deps.ha) return
    try {
      const c = await this.deps.ha.config()
      this.locationName = c.location_name
      this.haVersion = c.version
      this.timeZone = c.time_zone
    } catch {
      /* si usano i valori precedenti */
    }
  }

  /** Preventivo: token di input contati (o stimati) + uscita attesa per candidato. */
  private async estimate(run: SuggestRun, activity: Activity): Promise<SuggestRun['estimate']> {
    await this.loadHomeInfo()
    const req = this.request(run, activity)
    const { price } = priceOf(req.model)
    let inputTokens = Math.ceil((req.system.map((b) => b.text).join('').length + req.user.length) / 3) + 400
    let counted = false
    if (this.deps.count) {
      try {
        inputTokens = await this.deps.count({
          model: req.model,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
          thinking: { type: 'adaptive' },
          output_config: { effort: req.effort, format: { type: 'json_schema', schema: req.schema } },
        })
        counted = true
      } catch (err) {
        log.warn('countTokens non disponibile, stima dai caratteri', err instanceof Error ? err.message : err)
      }
    }
    const outputTokens = Math.round((6_000 + 450 * run.candidates.length) * (EFFORT_FACTOR[req.effort] ?? 1))
    const costUsd = ((inputTokens * price.input + outputTokens * price.output) / 1_000_000) * 1.1
    return { model: req.model, inputTokens, outputTokens, costUsd: Math.round(costUsd * 1000) / 1000, counted }
  }

  /** Seconda fase: Claude scrive le proposte per i candidati. */
  async generate(id: string): Promise<SuggestRun> {
    const run = this.requireRun(id)
    if (!this.deps.stream) throw new SuggestError(503, 'chiave_mancante', "Chiave API Anthropic non configurata nelle opzioni dell'add-on")
    if (!this.deps.drafts) throw new SuggestError(503, 'ha_non_configurato', 'Home Assistant non è raggiungibile da questo processo')
    if (this.activeRunId()) throw new SuggestError(409, 'analisi_in_corso', "C'è già un'analisi in corso: attendi che finisca.")
    if (run.status !== 'pronta' && run.status !== 'interrotta' && run.status !== 'errore') throw new SuggestError(409, 'stato_non_valido', 'Questa analisi non è pronta per le proposte.')
    const todo = run.candidates.filter((c) => !run.results[c.id] && !this.deps.store.dismissedSignatures().has(c.signature))
    if (todo.length === 0) throw new SuggestError(400, 'niente_da_proporre', 'Nessun candidato da proporre.')
    const budget = this.deps.usage.status(this.deps.options)
    if (budget.level === 'bloccato') {
      throw new SuggestError(429, 'budget_superato', budgetBlockedMessage(budget))
    }
    run.status = 'generazione'
    delete run.error
    run.progress = { phase: 'Claude sta valutando i candidati', done: 0, total: 0 }
    await this.persist(run)
    const controller = new AbortController()
    this.controllers.set(run.id, controller)
    void this.runGeneration(run, todo, controller.signal).finally(() => this.release(run.id, controller))
    return run
  }

  private async record(run: SuggestRun, u: UsageTotals, step: string, effort: string): Promise<void> {
    await this.deps.usage.record(usageRecord('suggest', run.id, u, { step, effort }))
    const prev = run.usage ?? { model: u.model, costUsd: 0, input: 0, output: 0, fallback: false }
    run.usage = { model: u.model, costUsd: prev.costUsd + u.costUsd, input: prev.input + u.input, output: prev.output + u.output, fallback: prev.fallback || u.fallback }
  }

  private async runGeneration(run: SuggestRun, todo: Candidate[], signal: AbortSignal): Promise<void> {
    const stream = this.deps.stream!
    const drafts = this.deps.drafts!
    try {
      await this.loadHomeInfo()
      const req = this.request({ ...run, candidates: todo }, { tz: this.timeZone })
      let lastSave = 0
      const res = await requestStructured(stream, req, this.features.for(req.model), signal, (chars) => {
        if (Date.now() - lastSave < 1500) return
        lastSave = Date.now()
        void this.progress(run, 'Claude sta scrivendo le proposte', chars, 0)
      }).catch(async (err) => {
        if (err instanceof StructuredError && err.usage) await this.record(run, err.usage, 'generazione', req.effort)
        throw err
      })
      await this.record(run, res.usage, 'generazione', req.effort)
      const parsed = Proposals.safeParse(res.value)
      if (!parsed.success) throw new StructuredError('json_non_valido', 'La risposta del modello non rispetta lo schema.')
      const byId = new Map(todo.map((c) => [c.id, c]))

      const failed: RepairItem[] = []
      let i = 0
      for (const p of parsed.data.proposte) {
        const cand = byId.get(p.candidato)
        if (!cand || run.results[cand.id]) continue
        i += 1
        await this.progress(run, 'Controllo delle proposte', i, todo.length)
        const result: CandidateResult = { esito: p.esito, titolo: p.titolo.trim() || cand.title, spiegazione: p.spiegazione.trim(), confidenza: p.confidenza, rischi: p.rischi.trim(), yaml: p.yaml.trim() }
        run.results[cand.id] = result
        if (p.esito !== 'proponi') continue
        if (!result.yaml) {
          result.errors = ['Il modello non ha scritto lo YAML.']
          continue
        }
        const r = await drafts.propose({ yaml: result.yaml, spiegazione: result.spiegazione }, { suggestion: { runId: run.id, candidateId: cand.id } })
        if (r.ok) result.draftId = r.draft.id
        else failed.push({ candidate: cand, yaml: result.yaml, errors: r.errors })
      }
      for (const c of todo) {
        if (!run.results[c.id]) run.results[c.id] = { esito: 'scarta', titolo: c.title, spiegazione: 'Il modello non ha risposto per questo candidato: rilancia le proposte per riprovare.', confidenza: 'bassa', rischi: '', yaml: '', errors: ['Nessuna risposta'] }
      }
      await this.persist(run)

      // Una sola correzione, tutte insieme.
      if (failed.length && !signal.aborted) {
        await this.progress(run, 'Correzione delle proposte non valide', 0, failed.length)
        try {
          const fix = await requestStructured(
            stream,
            { ...req, effort: 'medium', user: repairUserMessage(failed), schema: REPAIR_SCHEMA as unknown as Record<string, unknown>, maxTokens: REPAIR_MAX_TOKENS },
            this.features.for(req.model),
            signal,
          ).catch(async (err) => {
            if (err instanceof StructuredError && err.usage) await this.record(run, err.usage, 'correzione', 'medium')
            throw err
          })
          await this.record(run, fix.usage, 'correzione', 'medium')
          const fixes = Repairs.safeParse(fix.value)
          const fixed = new Map((fixes.success ? fixes.data.correzioni : []).map((c) => [c.candidato, c.yaml.trim()]))
          for (const it of failed) {
            const result = run.results[it.candidate.id]!
            const yaml = fixed.get(it.candidate.id)
            if (!yaml) {
              result.errors = it.errors
              continue
            }
            const r = await drafts.propose({ yaml, spiegazione: result.spiegazione }, { suggestion: { runId: run.id, candidateId: it.candidate.id } })
            if (r.ok) {
              result.draftId = r.draft.id
              result.yaml = yaml
              result.repaired = true
            } else {
              result.yaml = yaml
              result.errors = r.errors
            }
          }
        } catch (err) {
          for (const it of failed) run.results[it.candidate.id]!.errors = it.errors
          if (err instanceof StructuredError && err.code === 'annullata') throw err
          log.warn(`Suggerisci ${run.id}: correzione non riuscita`, err instanceof Error ? err.message : err)
        }
      }
      run.status = 'completata'
      run.finishedAt = this.now().toISOString()
      await this.finish(run)
      const made = Object.values(run.results).filter((r) => r.draftId).length
      log.info(`Suggerisci ${run.id}: ${made} bozze pronte su ${todo.length} candidati ($${(run.usage?.costUsd ?? 0).toFixed(3)})`)
    } catch (err) {
      const aborted = signal.aborted || (err instanceof StructuredError && err.code === 'annullata')
      run.status = aborted ? 'annullata' : 'errore'
      run.error = aborted ? 'Generazione annullata.' : err instanceof StructuredError ? err.message : describeClaudeError(err)
      run.finishedAt = this.now().toISOString()
      await this.finish(run)
      if (!aborted) log.warn(`Suggerisci ${run.id}: errore nella generazione`, run.error)
    }
  }

  stop(id: string): boolean {
    const c = this.controllers.get(id)
    if (!c) return false
    c.abort()
    return true
  }

  async dismiss(id: string, candidateId: string, by: string): Promise<void> {
    const run = this.requireRun(id)
    const cand = run.candidates.find((c) => c.id === candidateId)
    if (!cand) throw new SuggestError(404, 'candidato_inesistente', 'Proposta non trovata')
    await this.deps.store.dismiss(cand.signature, { at: this.now().toISOString(), by, title: run.results[cand.id]?.titolo || cand.title })
    const draftId = run.results[cand.id]?.draftId
    const draft = draftId ? this.deps.draftStore.get(draftId) : undefined
    if (draft?.status === 'pending' && this.deps.drafts) await this.deps.drafts.discard(draft.id, by).catch(() => undefined)
  }

  async undismiss(id: string, candidateId: string): Promise<void> {
    const run = this.requireRun(id)
    const cand = run.candidates.find((c) => c.id === candidateId)
    if (!cand) throw new SuggestError(404, 'candidato_inesistente', 'Proposta non trovata')
    await this.deps.store.undismiss(cand.signature)
  }

  /** Apre una chat già avviata sulla proposta (prima domanda inviata a nome dell'utente). */
  async discuss(id: string, candidateId: string, by: string): Promise<{ conversationId: string }> {
    if (!this.deps.chat) throw new SuggestError(503, 'chat_non_disponibile', 'Chat non disponibile')
    const run = this.requireRun(id)
    const cand = run.candidates.find((c) => c.id === candidateId)
    if (!cand) throw new SuggestError(404, 'candidato_inesistente', 'Proposta non trovata')
    const r = run.results[cand.id]
    // La prima riga diventa il titolo della chat.
    const lines = [
      `Suggerisci: ${r?.titolo || cand.title}`,
      '',
      'Parliamo di questa proposta di automazione trovata nello storico.',
      ...(r?.spiegazione ? ['', r.spiegazione] : []),
      '',
      "Numeri calcolati dall'add-on sullo storico:",
      ...cand.evidence.map((e) => `- ${e.label}: ${e.value}`),
      `- Entità: ${cand.entities.join(', ')}`,
    ]
    if (r?.yaml) lines.push('', 'YAML proposto:', '```yaml', r.yaml, '```')
    if (r?.errors?.length) lines.push('', `Controlli non superati: ${r.errors.join(' ')}`)
    lines.push('', 'Cosa ne pensi? Verifica gli entity_id e, se serve, proponi una versione migliore o più sicura.')
    const { id: conversationId } = await this.deps.chat.create(by)
    await this.deps.chat.send(conversationId, lines.join('\n'))
    return { conversationId }
  }

  /** Vista per l'interfaccia, con le bozze aggiornate. */
  view(run: SuggestRun) {
    const dismissed = this.deps.store.dismissedSignatures()
    return {
      ...run,
      running: this.controllers.has(run.id),
      candidates: run.candidates.map((c) => {
        const r = run.results[c.id]
        const draft = r?.draftId ? this.deps.draftStore.get(r.draftId) : undefined
        return { ...c, dismissed: dismissed.has(c.signature), result: r ? { ...r, draft: draft ? publicDraft(draft) : null } : null }
      }),
    }
  }

  summaries() {
    return this.deps.store.list().map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      by: r.by,
      days: r.days,
      status: r.status,
      candidates: r.candidates.length,
      drafts: Object.values(r.results).filter((x) => x.draftId).length,
      costUsd: r.usage?.costUsd ?? 0,
    }))
  }
}
