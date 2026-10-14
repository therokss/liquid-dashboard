import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { readJson, writeJsonAtomic } from '../store/atomic.ts'
import type { ActivityStats, Candidate, Deferred } from './types.ts'

// Analisi di "Suggerisci" in /data/suggest/runs/<id>.json (le ultime 10) e firme scartate
// dall'utente in /data/suggest/dismissed.json (dimenticate dopo 60 giorni).

export type RunStatus = 'raccolta' | 'pronta' | 'generazione' | 'completata' | 'errore' | 'annullata' | 'interrotta'

export interface CandidateResult {
  esito: 'proponi' | 'scarta'
  titolo: string
  spiegazione: string
  confidenza: 'alta' | 'media' | 'bassa'
  rischi: string
  yaml: string
  draftId?: string
  /** Errori rimasti dopo la correzione: la proposta va completata a mano o in chat. */
  errors?: string[]
  repaired?: boolean
}

export interface RunEstimate {
  model: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  /** true se i token di input vengono da countTokens, false se stimati dai caratteri */
  counted: boolean
}

export interface SuggestRun {
  id: string
  createdAt: string
  by: string
  days: number
  status: RunStatus
  progress: { phase: string; done: number; total: number } | null
  window?: { from: string; to: string; firstDay: string | null; observedDays: number; feriali: number; festivi: number }
  stats?: ActivityStats
  candidates: Candidate[]
  deferred: Deferred[]
  estimate?: RunEstimate
  results: Record<string, CandidateResult>
  usage?: { model: string; costUsd: number; input: number; output: number; fallback: boolean }
  error?: string
  finishedAt?: string
}

export interface Dismissed {
  at: string
  by: string
  title: string
}

const ID_RE = /^s[a-z0-9]{8,40}$/
const KEEP_RUNS = 10
export const DISMISS_DAYS = 60

export function isRunId(id: string): boolean {
  return ID_RE.test(id)
}

export class SuggestStore {
  private readonly dir: string
  private readonly dismissedFile: string
  private readonly runs = new Map<string, SuggestRun>()
  private dismissed: Record<string, Dismissed> = {}

  constructor(dataDir: string, private readonly now: () => Date = () => new Date()) {
    this.dir = join(dataDir, 'suggest', 'runs')
    this.dismissedFile = join(dataDir, 'suggest', 'dismissed.json')
  }

  async load(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    this.runs.clear()
    for (const f of await fs.readdir(this.dir)) {
      if (!f.endsWith('.json')) continue
      const r = await readJson<SuggestRun | null>(join(this.dir, f), null)
      if (!r || !isRunId(r.id)) continue
      // Un riavvio a metà analisi la lascia a metà: si segnala, i risultati parziali restano.
      if (r.status === 'raccolta' || r.status === 'generazione') {
        r.status = 'interrotta'
        r.progress = null
        r.error = "L'add-on si è riavviato durante l'analisi."
        await writeJsonAtomic(join(this.dir, `${r.id}.json`), r)
      }
      this.runs.set(r.id, r)
    }
    this.dismissed = await readJson<Record<string, Dismissed>>(this.dismissedFile, {})
  }

  newId(): string {
    return `s${this.now().getTime().toString(36)}${randomBytes(4).toString('hex')}`
  }

  get(id: string): SuggestRun | undefined {
    return this.runs.get(id)
  }

  list(): SuggestRun[] {
    return [...this.runs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  async save(run: SuggestRun): Promise<void> {
    if (!isRunId(run.id)) throw new Error('id di analisi non valido')
    this.runs.set(run.id, run)
    await writeJsonAtomic(join(this.dir, `${run.id}.json`), run)
    const old = this.list().slice(KEEP_RUNS)
    for (const r of old) {
      if (r.status === 'raccolta' || r.status === 'generazione') continue
      this.runs.delete(r.id)
      await fs.rm(join(this.dir, `${r.id}.json`), { force: true })
    }
  }

  /** Firme scartate ancora valide (meno di 60 giorni). */
  dismissedSignatures(): Map<string, Dismissed> {
    const limit = this.now().getTime() - DISMISS_DAYS * 86_400_000
    return new Map(Object.entries(this.dismissed).filter(([, d]) => new Date(d.at).getTime() >= limit))
  }

  async dismiss(signature: string, d: Dismissed): Promise<void> {
    const keep = Object.fromEntries(this.dismissedSignatures())
    this.dismissed = { ...keep, [signature]: d }
    await writeJsonAtomic(this.dismissedFile, this.dismissed)
  }

  async undismiss(signature: string): Promise<void> {
    const { [signature]: _gone, ...rest } = this.dismissed
    this.dismissed = rest
    await writeJsonAtomic(this.dismissedFile, this.dismissed)
  }

  async clearDismissed(): Promise<number> {
    const n = this.dismissedSignatures().size
    this.dismissed = {}
    await writeJsonAtomic(this.dismissedFile, this.dismissed)
    return n
  }
}
