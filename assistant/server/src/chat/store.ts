import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { BetaMessageParam, BetaTextBlockParam, BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from '../store/atomic.ts'
import type { InventoryStats } from '../inventory/inventory.ts'
import type { Effort } from '../options.ts'

// Conversazioni in /data/conversations/<id>.jsonl, SOLO in aggiunta: la prima riga congela
// modello, prompt di sistema e tool; poi i messaggi esattamente come scambiati con l'API.
// Riscrivere righe già inviate invaliderebbe la prompt cache e i blocchi di thinking.

export interface HeaderLine {
  type: 'header'
  v: 1
  id: string
  createdAt: string
  createdBy: string
  model: string
  effort: Effort
  toolsetVersion: number
  promptVersion: number
  haVersion: string
  timeZone: string
  system: BetaTextBlockParam[]
  tools: BetaTool[]
  inventoryStats: InventoryStats
}

export interface MessageLine {
  type: 'message'
  ts: string
  message: BetaMessageParam
}

export interface TurnLine {
  type: 'turn'
  ts: string
  turnId: string
  stopReason: string | null
  costUsd: number
  model?: string
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  steps?: number
  fallback?: boolean
  error?: string
  aborted?: boolean
}

export interface TitleLine {
  type: 'title'
  title: string
}

export type Line = HeaderLine | MessageLine | TurnLine | TitleLine

export interface Conversation {
  header: HeaderLine
  title: string
  messages: BetaMessageParam[]
  lines: Line[]
}

export interface ConversationSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  model: string
  costUsd: number
  turns: number
}

const ID_RE = /^c[a-z0-9]{8,40}$/

export function isConversationId(id: string): boolean {
  return ID_RE.test(id)
}

export function newConversationId(now = Date.now()): string {
  return `c${now.toString(36)}${randomBytes(5).toString('hex')}`
}

export class ConversationStore {
  readonly dir: string
  private readonly indexFile: string
  private index = new Map<string, ConversationSummary>()

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'conversations')
    this.indexFile = join(this.dir, 'index.json')
  }

  private file(id: string): string {
    if (!isConversationId(id)) throw new Error('id di conversazione non valido')
    return join(this.dir, `${id}.jsonl`)
  }

  /** Carica l'indice; se manca o è rovinato lo ricostruisce leggendo i file. */
  async load(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    const saved = await readJson<ConversationSummary[] | null>(this.indexFile, null)
    const files = (await fs.readdir(this.dir)).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6)).filter(isConversationId)
    if (saved && Array.isArray(saved) && saved.length === files.length && saved.every((s) => files.includes(s.id))) {
      this.index = new Map(saved.map((s) => [s.id, s]))
      return
    }
    this.index.clear()
    for (const id of files) {
      const conv = await this.load1(id)
      if (conv) this.index.set(id, summarize(conv))
    }
    await this.saveIndex()
  }

  private saveIndex(): Promise<void> {
    return writeJsonAtomic(this.indexFile, this.list())
  }

  list(): ConversationSummary[] {
    return [...this.index.values()].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
  }

  summary(id: string): ConversationSummary | undefined {
    return this.index.get(id)
  }

  async create(header: HeaderLine): Promise<ConversationSummary> {
    await appendJsonl(this.file(header.id), header)
    const s: ConversationSummary = {
      id: header.id,
      title: 'Nuova conversazione',
      createdAt: header.createdAt,
      updatedAt: header.createdAt,
      model: header.model,
      costUsd: 0,
      turns: 0,
    }
    this.index.set(header.id, s)
    await this.saveIndex()
    return s
  }

  private async load1(id: string): Promise<Conversation | null> {
    const lines = await readJsonl<Line>(this.file(id))
    const header = lines[0]
    if (!header || header.type !== 'header') return null
    let title = 'Nuova conversazione'
    const messages: BetaMessageParam[] = []
    for (const l of lines) {
      if (l.type === 'message') messages.push(l.message)
      else if (l.type === 'title') title = l.title
    }
    return { header, title, messages, lines }
  }

  async get(id: string): Promise<Conversation | null> {
    if (!this.index.has(id)) return null
    return this.load1(id)
  }

  async append(id: string, line: MessageLine | TurnLine | TitleLine): Promise<void> {
    await appendJsonl(this.file(id), line)
    const s = this.index.get(id)
    if (!s) return
    const ts = 'ts' in line ? line.ts : new Date().toISOString()
    s.updatedAt = ts
    if (line.type === 'title') s.title = line.title
    if (line.type === 'turn') {
      s.turns += 1
      s.costUsd = Math.round((s.costUsd + line.costUsd) * 1_000_000) / 1_000_000
    }
    if (line.type !== 'message') await this.saveIndex()
  }

  async remove(id: string): Promise<boolean> {
    if (!this.index.has(id)) return false
    await fs.rm(this.file(id), { force: true })
    this.index.delete(id)
    await this.saveIndex()
    return true
  }
}

function summarize(c: Conversation): ConversationSummary {
  let updatedAt = c.header.createdAt
  let cost = 0
  let turns = 0
  for (const l of c.lines) {
    if ((l.type === 'message' || l.type === 'turn') && l.ts > updatedAt) updatedAt = l.ts
    if (l.type === 'turn') {
      cost += l.costUsd
      turns += 1
    }
  }
  return { id: c.header.id, title: c.title, createdAt: c.header.createdAt, updatedAt, model: c.header.model, costUsd: Math.round(cost * 1_000_000) / 1_000_000, turns }
}
