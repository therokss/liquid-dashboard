import { join } from 'node:path'
import { RunStore, SignatureStore, type Marked } from '../store/runs.ts'
import type { AutomationReport, Finding, RuleId, Severity } from './types.ts'

// Verifiche in /data/verify/runs/<id>.json (le ultime 5) e problemi ignorati dall'utente in
// /data/verify/ignored.json (senza scadenza: si riattivano a mano).

export type VerifyStatus = 'raccolta' | 'pronta' | 'analisi' | 'completata' | 'errore' | 'annullata' | 'interrotta'

export interface ReviewResult {
  giudizio: 'ok' | 'da_migliorare' | 'problemi'
  sintesi: string
  problemi: Array<{ titolo: string; spiegazione: string; gravita: 'alta' | 'media' | 'bassa' }>
  yaml: string
  spiegazione: string
  draftId?: string
  /** Errori rimasti dopo la correzione: lo YAML va completato a mano o in chat. */
  errors?: string[]
  repaired?: boolean
}

export interface FixResult {
  findings: string[]
  draftId?: string
  errors?: string[]
}

export interface VerifyEstimate {
  model: string
  /** token del prompt di sistema, ripetuti a ogni lotto */
  systemTokens: number
  /** token di input del dossier di ogni automazione */
  perAutomation: Record<string, number>
  outputPerAutomation: number
  outputPerBatch: number
  batchSize: number
  /** $ per milione di token */
  priceIn: number
  priceOut: number
  counted: boolean
}

export interface VerifyStats {
  automations: number
  editable: number
  withFindings: number
  bySeverity: Record<Severity, number>
  byRule: Partial<Record<RuleId, number>>
  events: number
  logged: number
  durationMs: number
}

export interface VerifyRun {
  id: string
  createdAt: string
  by: string
  /** giorni di Registro attività per le regole dinamiche */
  days: number
  status: VerifyStatus
  progress: { phase: string; done: number; total: number } | null
  stats?: VerifyStats
  reports: AutomationReport[]
  findings: Finding[]
  /** dossier per l'analisi approfondita (JSON compatto per automazione) */
  dossiers: Record<string, string>
  estimate?: VerifyEstimate
  /** automazioni dell'ultima analisi approfondita richiesta */
  selection?: string[]
  reviews: Record<string, ReviewResult>
  fixes: Record<string, FixResult>
  usage?: { model: string; costUsd: number; input: number; output: number; fallback: boolean }
  error?: string
  finishedAt?: string
}

export class VerifyStore {
  private readonly runs: RunStore<VerifyRun>
  private readonly ignored: SignatureStore

  constructor(dataDir: string, now: () => Date = () => new Date()) {
    this.runs = new RunStore<VerifyRun>(join(dataDir, 'verify', 'runs'), { prefix: 'v', keep: 5, running: ['raccolta', 'analisi'] }, now)
    this.ignored = new SignatureStore(join(dataDir, 'verify', 'ignored.json'), null, now)
  }

  async load(): Promise<void> {
    await this.runs.load()
    await this.ignored.load()
  }

  isId(id: string): boolean {
    return this.runs.isId(id)
  }

  newId(): string {
    return this.runs.newId()
  }

  get(id: string): VerifyRun | undefined {
    return this.runs.get(id)
  }

  list(): VerifyRun[] {
    return this.runs.list()
  }

  save(run: VerifyRun): Promise<void> {
    return this.runs.save(run)
  }

  ignoredSignatures(): Map<string, Marked> {
    return this.ignored.active()
  }

  ignore(signature: string, d: Marked): Promise<void> {
    return this.ignored.add(signature, d)
  }

  unignore(signature: string): Promise<void> {
    return this.ignored.remove(signature)
  }

  clearIgnored(): Promise<number> {
    return this.ignored.clear()
  }
}
