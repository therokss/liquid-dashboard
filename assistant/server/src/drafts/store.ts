import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from '../store/atomic.ts'
import type { AutomationConfig, DiffLine } from './automation.ts'
import type { CriticalRef } from './checks.ts'

// Bozze di automazione in /data/drafts/<id>.json e registro delle scritture in
// /data/history.jsonl (chi, cosa, quando, con quale backup).

export type DraftStatus = 'pending' | 'applied' | 'discarded' | 'undone'

export interface DraftCheck {
  label: string
  ok: boolean
  detail?: string
}

export interface Draft {
  id: string
  conversationId: string
  toolUseId: string
  createdAt: string
  status: DraftStatus
  kind: 'create' | 'update'
  alias: string
  explanation: string
  config: AutomationConfig
  yaml: string
  fixes: string[]
  warnings: string[]
  checks: DraftCheck[]
  critical: CriticalRef[]
  target?: { entityId: string; automationId: string; alias: string; baseHash: string; beforeYaml: string }
  diff?: DiffLine[]
  applied?: {
    at: string
    by: string
    automationId: string
    entityId: string | null
    enabled: boolean
    writtenHash: string
    backupFile: string | null
    warning?: string
  }
  undone?: { at: string; by: string }
  discarded?: { at: string; by: string }
  lastError?: string
}

export interface HistoryEntry {
  ts: string
  by: string
  action: 'creata' | 'modificata' | 'annullata_creazione' | 'ripristinata' | 'rollback_automatico'
  automationId: string
  entityId: string | null
  alias: string
  draftId: string
  conversationId: string
  backupFile?: string | null
}

const ID_RE = /^d[a-z0-9]{8,40}$/

export function isDraftId(id: string): boolean {
  return ID_RE.test(id)
}

export class DraftStore {
  readonly dir: string
  readonly backupDir: string
  private readonly historyFile: string
  private readonly drafts = new Map<string, Draft>()

  constructor(readonly dataDir: string) {
    this.dir = join(dataDir, 'drafts')
    this.backupDir = join(dataDir, 'backups', 'automations')
    this.historyFile = join(dataDir, 'history.jsonl')
  }

  async load(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    this.drafts.clear()
    for (const f of await fs.readdir(this.dir)) {
      if (!f.endsWith('.json')) continue
      const d = await readJson<Draft | null>(join(this.dir, f), null)
      if (d && isDraftId(d.id)) this.drafts.set(d.id, d)
    }
  }

  newId(now = Date.now()): string {
    return `d${now.toString(36)}${randomBytes(4).toString('hex')}`
  }

  get(id: string): Draft | undefined {
    return this.drafts.get(id)
  }

  byConversation(conversationId: string): Draft[] {
    return [...this.drafts.values()].filter((d) => d.conversationId === conversationId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
  }

  async save(d: Draft): Promise<void> {
    if (!isDraftId(d.id)) throw new Error('id di bozza non valido')
    this.drafts.set(d.id, d)
    await writeJsonAtomic(join(this.dir, `${d.id}.json`), d)
  }

  async backup(automationId: string, config: unknown, ts: string, draftId: string): Promise<string> {
    const safeTs = ts.replace(/[:.]/g, '-')
    const file = join(this.backupDir, automationId.replace(/[^A-Za-z0-9_-]/g, '_'), `${safeTs}.json`)
    await writeJsonAtomic(file, { automationId, draftId, savedAt: ts, config })
    return file
  }

  async readBackup(file: string): Promise<Record<string, unknown> | null> {
    if (!file.startsWith(this.backupDir)) return null
    const b = await readJson<{ config?: Record<string, unknown> } | null>(file, null)
    return b?.config ?? null
  }

  async record(entry: HistoryEntry): Promise<void> {
    await appendJsonl(this.historyFile, entry)
  }

  async history(limit = 100): Promise<HistoryEntry[]> {
    return (await readJsonl<HistoryEntry>(this.historyFile)).slice(-limit).reverse()
  }
}
