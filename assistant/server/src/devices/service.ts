import type { HAReader } from '../ha/data.ts'
import type { Options } from '../options.ts'
import type { SettingsStore } from '../store/settings.ts'
import type { UsageLedger } from '../claude/usage.ts'
import type { StreamFn } from '../claude/loop.ts'
import type { UsageTotals } from '../claude/pricing.ts'
import { describeClaudeError } from '../claude/client.ts'
import type { DeviceKnowledge } from '../claude/tools/common.ts'
import { log } from '../log.ts'
import { buildCatalog, catalogDomains, loadManifests, manufacturerKey, modelKey, modelLabel, normalizeText, type CatalogEntry, type Manifest } from './catalog.ts'
import { cardIndex, cardSlug, cardSummary, type Card, type CardSummary, type KbStore } from './kb.ts'
import { runStudy, studySubject, StudyError, type StudyProgress } from './study.ts'

// Pagina Dispositivi e strumenti della chat: catalogo dei modelli presenti in casa, schede KB
// e studio sul web di un modello alla volta (in memoria: un riavvio interrompe lo studio).

export class DevicesError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export interface ActiveStudy {
  key: string
  slug: string
  manufacturer: string
  model: string
  by: string
  origin: 'pagina' | 'chat'
  startedAt: string
  progress: StudyProgress
  costUsd: number
}

export interface StudyFailure {
  at: string
  message: string
  costUsd: number
}

export interface DevicesServiceDeps {
  kb: KbStore
  ha: HAReader | null
  settings: SettingsStore
  usage: UsageLedger
  options: Options
  stream: StreamFn | null
  now?: () => Date
  /** Sostituibile nei test. */
  study?: typeof runStudy
}

const CATALOG_TTL_MS = 5 * 60_000
/** Studi che Claude può avviare in una conversazione (solo su richiesta esplicita). */
export const CHAT_STUDY_CAP = 2
const DEFAULT_ESTIMATE_USD = 0.3

export class DevicesService implements DeviceKnowledge {
  private cache: { at: number; consents: string; entries: CatalogEntry[] } | null = null
  private readonly manifests = new Map<string, Manifest>()
  private active: { info: ActiveStudy; controller: AbortController; done: Promise<Card> } | null = null
  private readonly failures = new Map<string, StudyFailure>()
  private readonly chatStudies = new Map<string, number>()
  private readonly features = { fallbacks: true }
  private readonly now: () => Date

  constructor(private readonly deps: DevicesServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  private requireHA(): HAReader {
    if (!this.deps.ha) throw new DevicesError(503, 'ha_non_configurato', 'Home Assistant non è raggiungibile da questo processo')
    return this.deps.ha
  }

  async catalog(force = false): Promise<CatalogEntry[]> {
    const ha = this.requireHA()
    const consents = this.deps.settings.consents()
    const ck = JSON.stringify(consents)
    const t = this.now().getTime()
    if (!force && this.cache && this.cache.consents === ck && t - this.cache.at < CATALOG_TTL_MS) return this.cache.entries
    const [registries, states] = await Promise.all([ha.registries(), ha.states()])
    const missing = catalogDomains(registries).filter((d) => !this.manifests.has(d))
    if (missing.length) for (const [d, m] of await loadManifests(ha, missing)) this.manifests.set(d, m)
    const entries = buildCatalog({ registries, states, consents, manifests: this.manifests })
    this.cache = { at: t, consents: ck, entries }
    return entries
  }

  activeStudy(): ActiveStudy | null {
    return this.active?.info ?? null
  }

  /** Costo atteso di uno studio: media degli ultimi studi, o un valore prudente. */
  estimateUsd(): number {
    const costs = this.deps.kb
      .list()
      .map((c) => c.study.costUsd)
      .filter((x) => x > 0)
      .slice(-10)
    return costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : DEFAULT_ESTIMATE_USD
  }

  /** Indice compatto delle schede per il prompt della chat. */
  index(): string {
    return cardIndex(this.deps.kb.list())
  }

  async overview() {
    const entries = await this.catalog()
    const keys = new Set(entries.map((e) => e.key))
    const card = (key: string): CardSummary | null => {
      const c = this.deps.kb.get(key)
      return c ? cardSummary(c) : null
    }
    return {
      entries: entries.map((e) => ({ ...e, slug: cardSlug(e.key), card: card(e.key), failure: this.failures.get(e.key) ?? null })),
      // Schede di modelli non più presenti (dispositivo rimosso o escluso per privacy).
      orphans: this.deps.kb
        .list()
        .filter((c) => !keys.has(c.key))
        .map((c) => ({ key: c.key, manufacturer: c.manufacturer, model: c.model, card: cardSummary(c) })),
      active: this.activeStudy(),
      estimateUsd: Math.round(this.estimateUsd() * 100) / 100,
    }
  }

  card(slug: string): Card | undefined {
    return this.deps.kb.bySlug(slug)
  }

  async approve(slug: string, by: string): Promise<Card> {
    const c = this.deps.kb.bySlug(slug)
    if (!c) throw new DevicesError(404, 'scheda_inesistente', 'Scheda non trovata')
    const next: Card = { ...c, status: 'approvata', approved: { at: this.now().toISOString(), by } }
    await this.deps.kb.save(next)
    return next
  }

  async remove(slug: string): Promise<void> {
    const c = this.deps.kb.bySlug(slug)
    if (!c) throw new DevicesError(404, 'scheda_inesistente', 'Scheda non trovata')
    if (this.active?.info.key === c.key) throw new DevicesError(409, 'studio_in_corso', 'Lo studio di questo modello è in corso.')
    await this.deps.kb.remove(c.key)
  }

  stop(): boolean {
    if (!this.active) return false
    this.active.controller.abort()
    return true
  }

  /** Avvia lo studio di un modello del catalogo; `done` si risolve con la scheda salvata. */
  async start(key: string, by: string, origin: ActiveStudy['origin']): Promise<{ info: ActiveStudy; done: Promise<Card>; joined: boolean }> {
    if (!this.deps.stream) throw new DevicesError(503, 'chiave_mancante', "Chiave API Anthropic non configurata nelle opzioni dell'add-on")
    const ha = this.requireHA()
    if (this.active) {
      if (this.active.info.key === key) return { info: this.active.info, done: this.active.done, joined: true }
      throw new DevicesError(409, 'studio_in_corso', `È già in corso lo studio di ${modelLabel(this.active.info.manufacturer, this.active.info.model)}: attendi che finisca.`)
    }
    const budget = this.deps.usage.status(this.deps.options)
    if (budget.level === 'bloccato') {
      throw new DevicesError(429, 'budget_superato', `Budget mensile raggiunto ($${budget.spentUsd.toFixed(2)} su $${budget.blockUsd}): lo studio non parte.`)
    }
    const entry = (await this.catalog()).find((e) => e.key === key)
    if (!entry) throw new DevicesError(404, 'modello_inesistente', 'Modello non trovato tra i dispositivi della casa')

    const info: ActiveStudy = {
      key,
      slug: cardSlug(key),
      manufacturer: entry.manufacturer,
      model: entry.model,
      by,
      origin,
      startedAt: this.now().toISOString(),
      progress: { phase: 'ragionamento', searches: 0, fetches: 0, queries: [] },
      costUsd: 0,
    }
    const controller = new AbortController()
    const done = this.execute(info, entry, ha, controller.signal)
    this.active = { info, controller, done }
    this.failures.delete(key)
    return { info, done, joined: false }
  }

  private async triggerTypes(ha: HAReader, entry: CatalogEntry): Promise<string[]> {
    // Basta un esemplare: quello servito dall'integrazione preferita (locale, se c'è).
    const preferred = entry.integrations[0]?.domain
    const device = entry.devices.find((d) => d.integration === preferred) ?? entry.devices[0]
    if (!device) return []
    try {
      const list = await ha.call<Array<Record<string, unknown>>>({ type: 'device_automation/trigger/list', device_id: device.id })
      const out = new Set<string>()
      for (const t of list) {
        const parts = [t.domain, t.type, t.subtype].filter((x): x is string => typeof x === 'string' && /^[\w .-]{1,60}$/.test(x))
        if (parts.length >= 2) out.add(parts.join(':'))
      }
      return [...out].sort()
    } catch {
      return []
    }
  }

  private async record(slug: string, u: UsageTotals): Promise<void> {
    await this.deps.usage.record({
      kind: 'devices',
      conversationId: slug,
      model: u.model,
      input: u.input,
      output: u.output,
      cacheRead: u.cacheRead,
      cacheWrite: u.cacheWrite,
      costUsd: u.costUsd,
      ...(u.fallback ? { fallback: true } : {}),
      ...(u.searches ? { searches: u.searches } : {}),
    })
  }

  private async execute(info: ActiveStudy, entry: CatalogEntry, ha: HAReader, signal: AbortSignal): Promise<Card> {
    const started = Date.now()
    const { options } = this.deps
    try {
      const subject = studySubject(entry, await this.triggerTypes(ha, entry))
      const result = await (this.deps.study ?? runStudy)(
        { model: options.analysisModel, effort: options.devicesEffort, subject },
        {
          stream: this.deps.stream!,
          signal,
          features: this.features,
          onProgress: (p) => (info.progress = p),
          onUsage: async (u) => {
            info.costUsd += u.costUsd
            await this.record(info.slug, u)
          },
        },
      )
      const card: Card = {
        ...result.content,
        key: entry.key,
        manufacturer: entry.manufacturer,
        model: entry.model,
        modelIds: entry.modelIds,
        status: 'bozza',
        createdAt: this.now().toISOString(),
        studiedBy: info.by,
        study: {
          model: result.usage.model,
          effort: options.devicesEffort,
          costUsd: Math.round(result.usage.costUsd * 10_000) / 10_000,
          searches: result.searches,
          fetches: result.fetches,
          queries: result.queries,
          durationMs: Date.now() - started,
        },
      }
      await this.deps.kb.save(card)
      log.info(`Studio di ${modelLabel(entry.manufacturer, entry.model)}: scheda salvata ($${card.study.costUsd.toFixed(4)}, ${result.searches} ricerche, ${result.fetches} pagine)`)
      return card
    } catch (err) {
      const message = err instanceof StudyError || err instanceof DevicesError ? err.message : describeClaudeError(err)
      this.failures.set(info.key, { at: this.now().toISOString(), message, costUsd: Math.round(info.costUsd * 10_000) / 10_000 })
      log.warn(`Studio di ${modelLabel(entry.manufacturer, entry.model)} non riuscito`, message)
      throw new DevicesError(502, err instanceof StudyError ? err.code : 'studio_fallito', message)
    } finally {
      // Prima di risolvere: chi attende la scheda trova già libero il posto per un altro studio.
      if (this.active?.info === info) this.active = null
    }
  }

  // --- Chat ------------------------------------------------------------------------------------

  async find(q: { produttore?: string; modello?: string; deviceId?: string }): Promise<{ entry: CatalogEntry | null; card: Card | null; candidates: CatalogEntry[] }> {
    const entries = await this.catalog()
    if (q.deviceId) {
      const entry = entries.find((e) => e.devices.some((d) => d.id === q.deviceId)) ?? null
      return { entry, card: entry ? (this.deps.kb.get(entry.key) ?? null) : null, candidates: [] }
    }
    const manu = q.produttore ? manufacturerKey(q.produttore) : null
    const raw = normalizeText(q.modello ?? '')
    const scored: Array<{ e: CatalogEntry; score: number }> = []
    for (const e of entries) {
      const [eManu, eModel] = e.key.split('|') as [string, string]
      if (manu && eManu !== manu) continue
      if (!raw) {
        scored.push({ e, score: 1 })
        continue
      }
      const mk = modelKey(q.modello!, eManu)
      const name = normalizeText(e.model)
      let score = 0
      if (eModel === mk || e.modelIds.some((id) => normalizeText(id) === raw)) score = 3
      else if (name.includes(raw) || eModel.includes(mk)) score = 2
      else if (raw.includes(eModel) && eModel.length >= 3) score = 1
      if (score) scored.push({ e, score })
    }
    scored.sort((a, b) => b.score - a.score)
    const top = scored[0]
    const unique = top && (scored.length === 1 || scored[1]!.score < top.score)
    if (top && unique) return { entry: top.e, card: this.deps.kb.get(top.e.key) ?? null, candidates: [] }
    // Nessun modello in casa corrispondente: può esistere ancora una scheda di un modello rimosso.
    if (!top && manu && raw) {
      const card = this.deps.kb.list().find((c) => c.key.startsWith(`${manu}|`) && (c.key.endsWith(`|${modelKey(q.modello!, manu)}`) || c.modelIds.some((id) => normalizeText(id) === raw)))
      if (card) return { entry: null, card, candidates: [] }
    }
    return { entry: null, card: null, candidates: scored.slice(0, 8).map((s) => s.e) }
  }

  async study(key: string, call: { conversationId: string }): Promise<Card> {
    const used = this.chatStudies.get(call.conversationId) ?? 0
    if (used >= CHAT_STUDY_CAP && this.active?.info.key !== key) {
      throw new DevicesError(429, 'limite_chat', `In questa conversazione sono già stati avviati ${CHAT_STUDY_CAP} studi: gli altri si avviano dalla pagina Dispositivi.`)
    }
    const { done, joined } = await this.start(key, 'chat', 'chat')
    if (!joined) this.chatStudies.set(call.conversationId, used + 1)
    return done
  }
}
