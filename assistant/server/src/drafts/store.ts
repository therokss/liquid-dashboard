import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from '../store/atomic.ts'
import type { DiffLine } from './automation.ts'
import type { CriticalRef } from './checks.ts'

// Bozze in /data/drafts/<id>.json e registro delle scritture in /data/history.jsonl (chi,
// cosa, quando, con quale backup). Dalla 0.8 una bozza ha una o più parti (helper, script,
// automazioni) che si applicano e si annullano insieme.

export type DraftStatus = 'pending' | 'applied' | 'discarded' | 'undone'
export type ObjectType = 'automation' | 'script' | 'helper'

export interface DraftCheck {
  label: string
  ok: boolean
  detail?: string
}

export interface DraftPart {
  object: ObjectType
  /** Solo per gli helper: input_boolean, input_select… */
  domain?: string
  kind: 'create' | 'update'
  alias: string
  config: Record<string, unknown>
  yaml: string
  /** Creazione di script e helper: chiave (scripts.yaml) o id previsti, ed entity_id previsto. */
  key?: string
  entityId?: string
  /** Modifica: oggetto esistente (key = id dell'automazione, chiave dello script, id dell'helper). */
  target?: { entityId: string; key: string; alias: string; baseHash: string; beforeYaml: string }
  diff?: DiffLine[]
  applied?: {
    key: string
    entityId: string | null
    /** Solo per le automazioni create. */
    enabled?: boolean
    writtenHash: string
    backupFile: string | null
  }
}

export interface Draft {
  id: string
  /** '' per le bozze nate da Suggerisci o Verifica */
  conversationId: string
  toolUseId: string
  suggestion?: { runId: string; candidateId: string }
  verification?: { runId: string; automation: string }
  createdAt: string
  status: DraftStatus
  /** In ordine di applicazione: helper, script, automazioni. */
  parts: DraftPart[]
  explanation: string
  fixes: string[]
  warnings: string[]
  checks: DraftCheck[]
  critical: CriticalRef[]
  applied?: { at: string; by: string; warning?: string }
  undone?: { at: string; by: string }
  discarded?: { at: string; by: string }
  lastError?: string
}

export interface HistoryEntry {
  ts: string
  by: string
  action: 'creata' | 'modificata' | 'annullata_creazione' | 'ripristinata' | 'rollback_automatico'
  /** Assente nelle voci scritte prima della 0.8: automazione. */
  object?: ObjectType
  domain?: string
  /** Id dell'oggetto: automazione, chiave dello script o id dell'helper (nome storico del campo). */
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

/** La parte principale (l'ultima: l'automazione, se c'è), per le viste compatte. */
export function mainPart(d: Draft): DraftPart {
  return d.parts[d.parts.length - 1]!
}

type LegacyDraft = Omit<Draft, 'parts' | 'applied'> & {
  parts?: DraftPart[]
  kind: 'create' | 'update'
  alias: string
  config: Record<string, unknown>
  yaml: string
  target?: { entityId: string; automationId: string; alias: string; baseHash: string; beforeYaml: string }
  diff?: DiffLine[]
  applied?: { at: string; by: string; automationId: string; entityId: string | null; enabled: boolean; writtenHash: string; backupFile: string | null; warning?: string }
}

/** Bozze salvate fino alla 0.7: una sola automazione con i campi in cima. */
export function migrateDraft(raw: Draft | LegacyDraft): Draft {
  if (Array.isArray(raw.parts)) return raw as Draft
  const { kind, alias, config, yaml, target, diff, applied, ...rest } = raw as LegacyDraft
  const part: DraftPart = {
    object: 'automation',
    kind,
    alias,
    config,
    yaml,
    ...(target ? { target: { entityId: target.entityId, key: target.automationId, alias: target.alias, baseHash: target.baseHash, beforeYaml: target.beforeYaml } } : {}),
    ...(diff ? { diff } : {}),
    ...(applied ? { applied: { key: applied.automationId, entityId: applied.entityId, enabled: applied.enabled, writtenHash: applied.writtenHash, backupFile: applied.backupFile } } : {}),
  }
  return {
    ...rest,
    parts: [part],
    ...(applied ? { applied: { at: applied.at, by: applied.by, ...(applied.warning ? { warning: applied.warning } : {}) } } : {}),
  }
}

const BACKUP_DIRS: Record<ObjectType, string> = { automation: 'automations', script: 'scripts', helper: 'helpers' }

export class DraftStore {
  readonly dir: string
  readonly backupRoot: string
  private readonly historyFile: string
  private readonly drafts = new Map<string, Draft>()

  constructor(readonly dataDir: string) {
    this.dir = join(dataDir, 'drafts')
    this.backupRoot = join(dataDir, 'backups')
    this.historyFile = join(dataDir, 'history.jsonl')
  }

  async load(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    this.drafts.clear()
    for (const f of await fs.readdir(this.dir)) {
      if (!f.endsWith('.json')) continue
      const d = await readJson<Draft | LegacyDraft | null>(join(this.dir, f), null)
      if (d && isDraftId(d.id)) this.drafts.set(d.id, migrateDraft(d))
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

  /** Copia della configurazione prima di una scrittura: /data/backups/<tipo>/<id>/<ora>.json */
  async backup(object: ObjectType, key: string, config: unknown, ts: string, draftId: string, domain?: string): Promise<string> {
    const safeTs = ts.replace(/[:.]/g, '-')
    const dirKey = (domain ? `${domain}.${key}` : key).replace(/[^A-Za-z0-9_.-]/g, '_')
    const file = join(this.backupRoot, BACKUP_DIRS[object], dirKey, `${safeTs}.json`)
    await writeJsonAtomic(file, { object, ...(domain ? { domain } : {}), key, ...(object === 'automation' ? { automationId: key } : {}), draftId, savedAt: ts, config })
    return file
  }

  async readBackup(file: string): Promise<Record<string, unknown> | null> {
    if (!file.startsWith(this.backupRoot + '/') || file.includes('..')) return null
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
