import { randomBytes } from 'node:crypto'
import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { ConversationStore, newConversationId, type Conversation, type HeaderLine } from './store.ts'
import { runTurn, type Features, type StreamFn, type TurnEvent } from '../claude/loop.ts'
import { buildSystemPrompt, contextBlock, PROMPT_VERSION } from '../claude/prompt.ts'
import { executeTool, SUPPORTED_TOOLSETS, toolDefinitions, toolLabel, TOOLSET_VERSION } from '../claude/tools/registry.ts'
import type { DeviceKnowledge, DraftProposer, ToolContext } from '../claude/tools/common.ts'
import { describeClaudeError } from '../claude/client.ts'
import { buildHomeSnapshot } from '../inventory/snapshot.ts'
import type { HAReader } from '../ha/data.ts'
import type { UsageLedger } from '../claude/usage.ts'
import type { SettingsStore } from '../store/settings.ts'
import type { Options } from '../options.ts'
import { log } from '../log.ts'

// Un turno di chat è un job lato server: prosegue anche se il browser si disconnette, e chi
// si ricollega (stessa pagina, reload, altro dispositivo) rivede gli eventi da dove era rimasto.

export class ChatError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

export interface JobEvent {
  id: string
  event: string
  data: unknown
}

interface Job {
  turnId: string
  conversationId: string
  events: JobEvent[]
  listeners: Set<(e: JobEvent) => void>
  done: boolean
  controller: AbortController
  seq: number
}

export interface ChatServiceDeps {
  store: ConversationStore
  ha: HAReader | null
  settings: SettingsStore
  usage: UsageLedger
  options: Options
  /** null se manca la chiave API. */
  stream: StreamFn | null
  /** Bozze di automazione (dalla 0.3). */
  drafts?: DraftProposer
  /** Schede dei dispositivi (dalla 0.6): indice nel prompt e tool. */
  devices?: DeviceKnowledge & { index(): string }
  now?: () => Date
}

const MAX_USER_CHARS = 8_000
const JOB_RETENTION_MS = 2 * 60_000

export class ChatService {
  private readonly jobs = new Map<string, Job>()
  /** Funzionalità opzionali per modello (si spengono se un modello le rifiuta). */
  private readonly features = new Map<string, Features>()
  private readonly now: () => Date

  constructor(private readonly deps: ChatServiceDeps) {
    this.now = deps.now ?? (() => new Date())
  }

  private requireHA(): HAReader {
    if (!this.deps.ha) throw new ChatError(503, 'ha_non_configurato', 'Home Assistant non è raggiungibile da questo processo')
    return this.deps.ha
  }

  /** Nuova conversazione: fotografa la casa e congela prompt di sistema e tool. */
  async create(createdBy: string): Promise<{ id: string }> {
    const ha = this.requireHA()
    let snapshot
    try {
      snapshot = await buildHomeSnapshot(ha, this.deps.settings.consents())
    } catch (err) {
      log.warn('Inventario della casa non disponibile', err instanceof Error ? err.message : err)
      throw new ChatError(503, 'ha_non_raggiungibile', 'Home Assistant non risponde in questo momento: riprova tra qualche secondo.')
    }
    const header: HeaderLine = {
      type: 'header',
      v: 1,
      id: newConversationId(this.now().getTime()),
      createdAt: this.now().toISOString(),
      createdBy,
      model: this.deps.options.chatModel,
      effort: this.deps.options.chatEffort,
      toolsetVersion: TOOLSET_VERSION,
      promptVersion: PROMPT_VERSION,
      haVersion: snapshot.config.version,
      timeZone: snapshot.config.time_zone,
      system: buildSystemPrompt(snapshot, this.deps.devices?.index() ?? ''),
      tools: toolDefinitions(),
      inventoryStats: snapshot.stats,
    }
    await this.deps.store.create(header)
    return { id: header.id }
  }

  isRunning(conversationId: string): boolean {
    const job = this.jobs.get(conversationId)
    return Boolean(job && !job.done)
  }

  /** Avvia un turno; il risultato arriva come eventi (subscribe). */
  async send(conversationId: string, text: string): Promise<{ turnId: string }> {
    const clean = text.trim()
    if (!clean) throw new ChatError(400, 'messaggio_vuoto', 'Scrivi un messaggio')
    if (clean.length > MAX_USER_CHARS) throw new ChatError(400, 'messaggio_troppo_lungo', `Massimo ${MAX_USER_CHARS} caratteri`)
    if (!this.deps.stream) throw new ChatError(503, 'chiave_mancante', "Chiave API Anthropic non configurata nelle opzioni dell'add-on")
    if (this.isRunning(conversationId)) throw new ChatError(409, 'turno_in_corso', 'Attendi la fine della risposta in corso')
    const budget = this.deps.usage.status(this.deps.options)
    if (budget.level === 'bloccato') {
      throw new ChatError(429, 'budget_superato', `Budget mensile raggiunto ($${budget.spentUsd.toFixed(2)} su $${budget.blockUsd}): l'add-on non chiama Claude fino al mese prossimo. Puoi alzare la soglia nelle opzioni.`)
    }
    const conv = await this.deps.store.get(conversationId)
    if (!conv) throw new ChatError(404, 'conversazione_inesistente', 'Conversazione non trovata')
    if (!SUPPORTED_TOOLSETS.has(conv.header.toolsetVersion)) {
      throw new ChatError(409, 'conversazione_vecchia', 'Questa chat è di una versione precedente dell\'add-on: aprine una nuova per continuare.')
    }

    // Eventi non ancora comunicati a Claude (bozze applicate, scartate, annullate).
    const delivered = new Set<string>()
    for (const m of conv.messages) {
      if (m.role !== 'user' || typeof m.content === 'string') continue
      for (const b of m.content) if (b.type === 'text') for (const x of b.text.matchAll(/<evento id="([^"]+)">/g)) delivered.add(x[1]!)
    }
    const events = conv.lines.filter((l) => l.type === 'event' && !delivered.has(l.id)) as Array<{ id: string; text: string }>
    const userMessage: BetaMessageParam = {
      role: 'user',
      content: [
        { type: 'text', text: contextBlock(this.now(), conv.header.timeZone) },
        ...events.map((e) => ({ type: 'text' as const, text: `<evento id="${e.id}">${e.text}</evento>` })),
        { type: 'text', text: clean },
      ],
    }
    await this.deps.store.append(conversationId, { type: 'message', ts: this.now().toISOString(), message: userMessage })
    if (conv.title === 'Nuova conversazione') {
      const title = clean.replace(/\s+/g, ' ').slice(0, 60) + (clean.length > 60 ? '…' : '')
      await this.deps.store.append(conversationId, { type: 'title', title })
    }
    conv.messages.push(userMessage)

    const job: Job = {
      turnId: `t${this.now().getTime().toString(36)}${randomBytes(3).toString('hex')}`,
      conversationId,
      events: [],
      listeners: new Set(),
      done: false,
      controller: new AbortController(),
      seq: 0,
    }
    this.jobs.set(conversationId, job)
    this.publish(job, 'start', { turnId: job.turnId })
    if (budget.level === 'avviso') {
      this.publish(job, 'warning', { message: `Spesa del mese: $${budget.spentUsd.toFixed(2)}, oltre la soglia di avviso ($${budget.warnUsd}).` })
    }
    void this.execute(job, conv)
    return { turnId: job.turnId }
  }

  private async execute(job: Job, conv: Conversation): Promise<void> {
    const { header } = conv
    const ha = this.requireHA()
    const toolCtx: ToolContext = { ha, consents: () => this.deps.settings.consents(), now: this.now, drafts: this.deps.drafts, devices: this.deps.devices }
    let features = this.features.get(header.model)
    if (!features) this.features.set(header.model, (features = { fallbacks: true, blockBinding: true }))
    try {
      const result = await runTurn(
        { model: header.model, effort: header.effort, system: header.system, tools: header.tools },
        conv.messages,
        {
          stream: this.deps.stream!,
          features,
          persist: (message) => this.deps.store.append(job.conversationId, { type: 'message', ts: this.now().toISOString(), message }),
          executeTool: (name, input, toolUseId) => executeTool(name, input, { ...toolCtx, call: { conversationId: job.conversationId, toolUseId } }),
          beforeRequest: () => {
            if (this.deps.usage.status(this.deps.options).level === 'bloccato') {
              throw new ChatError(429, 'budget_superato', 'Budget mensile raggiunto durante la risposta: interrotta.')
            }
          },
          onUsage: (u) =>
            this.deps.usage.record({
              kind: 'chat',
              conversationId: job.conversationId,
              model: u.model,
              input: u.input,
              output: u.output,
              cacheRead: u.cacheRead,
              cacheWrite: u.cacheWrite,
              costUsd: u.costUsd,
              ...(u.fallback ? { fallback: true } : {}),
            }),
          emit: (e) => this.publishTurnEvent(job, e),
        },
        job.controller.signal,
      )
      await this.deps.store.append(job.conversationId, {
        type: 'turn',
        ts: this.now().toISOString(),
        turnId: job.turnId,
        stopReason: result.stopReason,
        costUsd: result.usage.costUsd,
        model: result.usage.model,
        input: result.usage.input,
        output: result.usage.output,
        cacheRead: result.usage.cacheRead,
        cacheWrite: result.usage.cacheWrite,
        steps: result.steps,
        ...(result.usage.fallback ? { fallback: true } : {}),
        ...(result.aborted ? { aborted: true } : {}),
        ...(result.notice ? { error: result.notice } : {}),
      })
      log.info(
        `Chat ${job.conversationId}: turno ${result.aborted ? 'interrotto' : 'concluso'} (${result.stopReason ?? '—'}, ${result.steps} passi, ` +
          `$${result.usage.costUsd.toFixed(4)}, cache letti ${result.usage.cacheRead} / scritti ${result.usage.cacheWrite})`,
      )
      if (result.notice) this.publish(job, 'warning', { message: result.notice })
      this.publish(job, 'done', { stopReason: result.stopReason, aborted: result.aborted, costUsd: result.usage.costUsd })
    } catch (err) {
      const message = err instanceof ChatError ? err.message : describeClaudeError(err)
      log.warn(`Chat ${job.conversationId}: errore nel turno`, message)
      await this.deps.store
        .append(job.conversationId, { type: 'turn', ts: this.now().toISOString(), turnId: job.turnId, stopReason: null, costUsd: 0, error: message })
        .catch(() => undefined)
      this.publish(job, 'error', { message })
      this.publish(job, 'done', { stopReason: null, aborted: false, costUsd: 0, error: true })
    } finally {
      job.done = true
      job.listeners.clear()
      setTimeout(() => {
        if (this.jobs.get(job.conversationId) === job) this.jobs.delete(job.conversationId)
      }, JOB_RETENTION_MS).unref()
    }
  }

  private publishTurnEvent(job: Job, e: TurnEvent): void {
    switch (e.type) {
      case 'text':
        return this.publish(job, 'text', { delta: e.delta })
      case 'thinking':
        return this.publish(job, 'thinking', {})
      case 'fallback':
        return this.publish(job, 'fallback', {})
      case 'tool_pending':
        return this.publish(job, 'tool_pending', { name: e.name })
      case 'tool':
        return this.publish(job, 'tool', { id: e.id, name: e.name, label: toolLabel(e.name, e.input) })
      case 'tool_done':
        return this.publish(job, 'tool_done', { id: e.id, ok: e.ok })
      case 'step':
        return this.publish(job, 'step', { costUsd: e.usage.costUsd, cacheRead: e.usage.cacheRead })
    }
  }

  private publish(job: Job, event: string, data: unknown): void {
    job.seq += 1
    const e: JobEvent = { id: `${job.turnId}:${job.seq}`, event, data }
    job.events.push(e)
    for (const l of job.listeners) l(e)
  }

  stop(conversationId: string): boolean {
    const job = this.jobs.get(conversationId)
    if (!job || job.done) return false
    job.controller.abort()
    return true
  }

  /**
   * Eventi del turno corrente (o appena concluso) dopo `lastEventId`, poi quelli nuovi.
   * Ritorna null se non c'è nessun turno da seguire.
   */
  subscribe(conversationId: string, lastEventId: string | null, listener: (e: JobEvent) => void): { done: boolean; unsubscribe: () => void } | null {
    const job = this.jobs.get(conversationId)
    if (!job) return null
    let start = 0
    if (lastEventId) {
      const [turnId, seq] = lastEventId.split(':')
      if (turnId === job.turnId) start = Number(seq) || 0
    }
    for (const e of job.events.slice(start)) listener(e)
    if (job.done) return { done: true, unsubscribe: () => undefined }
    job.listeners.add(listener)
    return { done: false, unsubscribe: () => job.listeners.delete(listener) }
  }
}
