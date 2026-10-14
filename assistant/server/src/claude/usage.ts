import { join } from 'node:path'
import { appendJsonl, readJsonl } from '../store/atomic.ts'
import { monthKey } from '../util/time.ts'
import type { Options } from '../options.ts'

// Registro dei consumi (append-only in /data/usage.jsonl) e controllo del budget mensile.

export interface UsageRecord {
  ts: string
  kind: 'chat' | 'suggest'
  /** conversazione (chat) o analisi (Suggerisci) */
  conversationId: string
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  costUsd: number
  fallback?: boolean
}

export interface BudgetStatus {
  month: string
  spentUsd: number
  warnUsd: number
  blockUsd: number
  level: 'ok' | 'avviso' | 'bloccato'
}

export class UsageLedger {
  private readonly file: string
  private readonly byMonth = new Map<string, number>()

  constructor(
    dataDir: string,
    private readonly tz: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.file = join(dataDir, 'usage.jsonl')
  }

  async load(): Promise<void> {
    this.byMonth.clear()
    for (const r of await readJsonl<UsageRecord>(this.file)) this.add(r)
  }

  private add(r: UsageRecord): void {
    const d = new Date(r.ts)
    if (Number.isNaN(d.getTime()) || typeof r.costUsd !== 'number') return
    const key = monthKey(d, this.tz())
    this.byMonth.set(key, (this.byMonth.get(key) ?? 0) + r.costUsd)
  }

  async record(r: Omit<UsageRecord, 'ts'>): Promise<void> {
    const rec: UsageRecord = { ts: this.now().toISOString(), ...r }
    this.add(rec)
    await appendJsonl(this.file, rec)
  }

  monthSpent(): number {
    return this.byMonth.get(monthKey(this.now(), this.tz())) ?? 0
  }

  status(options: Pick<Options, 'monthlyBudgetWarnUsd' | 'monthlyBudgetBlockUsd'>): BudgetStatus {
    const spent = this.monthSpent()
    const block = options.monthlyBudgetBlockUsd
    const warn = options.monthlyBudgetWarnUsd
    // Soglia 0 = disattivata.
    const level = block > 0 && spent >= block ? 'bloccato' : warn > 0 && spent >= warn ? 'avviso' : 'ok'
    return { month: monthKey(this.now(), this.tz()), spentUsd: Math.round(spent * 10_000) / 10_000, warnUsd: warn, blockUsd: block, level }
  }
}
