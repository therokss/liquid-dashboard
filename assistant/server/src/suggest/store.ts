import { join } from 'node:path'
import { RunStore, SignatureStore, type Marked } from '../store/runs.ts'
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

export type Dismissed = Marked

const ID_RE = /^s[a-z0-9]{8,40}$/
export const DISMISS_DAYS = 60

export function isRunId(id: string): boolean {
  return ID_RE.test(id)
}

export class SuggestStore {
  private readonly runs: RunStore<SuggestRun>
  private readonly dismissed: SignatureStore

  constructor(dataDir: string, now: () => Date = () => new Date()) {
    this.runs = new RunStore<SuggestRun>(join(dataDir, 'suggest', 'runs'), { prefix: 's', keep: 10, running: ['raccolta', 'generazione'] }, now)
    this.dismissed = new SignatureStore(join(dataDir, 'suggest', 'dismissed.json'), DISMISS_DAYS, now)
  }

  async load(): Promise<void> {
    await this.runs.load()
    await this.dismissed.load()
  }

  newId(): string {
    return this.runs.newId()
  }

  get(id: string): SuggestRun | undefined {
    return this.runs.get(id)
  }

  list(): SuggestRun[] {
    return this.runs.list()
  }

  save(run: SuggestRun): Promise<void> {
    return this.runs.save(run)
  }

  /** Firme scartate ancora valide (meno di 60 giorni). */
  dismissedSignatures(): Map<string, Dismissed> {
    return this.dismissed.active()
  }

  dismiss(signature: string, d: Dismissed): Promise<void> {
    return this.dismissed.add(signature, d)
  }

  undismiss(signature: string): Promise<void> {
    return this.dismissed.remove(signature)
  }

  clearDismissed(): Promise<number> {
    return this.dismissed.clear()
  }
}
