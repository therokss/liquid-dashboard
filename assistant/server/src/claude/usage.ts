import { join } from 'node:path'
import { appendJsonl, readJsonl } from '../store/atomic.ts'
import { nextPeriodStart, periodKey, periodStart } from '../util/time.ts'
import { DEFAULT_OPTIONS, type Options, type Plan } from '../options.ts'
import type { UsageTotals } from './pricing.ts'

// Registro dei consumi (append-only in /data/usage.jsonl) e controllo del budget del periodo
// (mese di calendario o ciclo di fatturazione del piano).

export interface UsageRecord {
  ts: string
  kind: 'chat' | 'suggest' | 'verify' | 'devices'
  /** conversazione (chat), analisi (Suggerisci, Verifica) o modello studiato (Dispositivi) */
  conversationId: string
  model: string
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  costUsd: number
  fallback?: boolean
  searches?: number
  /** passo del flusso (es. "turno", "generazione", "correzione", "analisi", "studio") */
  step?: string
  effort?: string
  /** di cui scritture in cache da 1 h */
  cacheWrite1h?: number
}

/** Una voce del registro da una risposta (o da un gruppo di risposte) dell'API. */
export function usageRecord(kind: UsageRecord['kind'], conversationId: string, u: UsageTotals, extra: { step?: string; effort?: string } = {}): Omit<UsageRecord, 'ts'> {
  return {
    kind,
    conversationId,
    model: u.model,
    input: u.input,
    output: u.output,
    cacheRead: u.cacheRead,
    cacheWrite: u.cacheWrite,
    costUsd: u.costUsd,
    ...(u.cacheWrite1h ? { cacheWrite1h: u.cacheWrite1h } : {}),
    ...(u.fallback ? { fallback: true } : {}),
    ...(u.searches ? { searches: u.searches } : {}),
    ...(extra.step ? { step: extra.step } : {}),
    ...(extra.effort ? { effort: extra.effort } : {}),
  }
}

export interface BudgetStatus {
  /** periodo di spesa: mese di calendario o ciclo di fatturazione ("2026-10") */
  month: string
  spentUsd: number
  warnUsd: number
  blockUsd: number
  level: 'ok' | 'avviso' | 'bloccato'
  plan: Plan
  /** crediti API inclusi nel piano per ogni ciclo (0 = nessuno) */
  creditUsd: number
  /** soglie automatiche (crediti del piano) invece di quelle delle opzioni */
  warnFromCredits: boolean
  blockFromCredits: boolean
  /** giorno del mese in cui inizia il periodo (opzione billing_day) */
  startDay: number
  /** inizio del periodo in corso ("2026-09-30": nei mesi corti l'ultimo giorno) */
  startsOn: string
  /** inizio del periodo successivo, quando un blocco si toglie da solo ("2026-11-15") */
  resetsOn: string
}

export interface UsageSlice {
  kind: UsageRecord['kind']
  model: string
  requests: number
  costUsd: number
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

type BudgetOptions = Pick<Options, 'monthlyBudgetWarnUsd' | 'monthlyBudgetBlockUsd' | 'plan' | 'teamCreditsUsd' | 'billingDay'>

const PLAN_CREDITS: Record<Plan, number> = { api: 0, pro: 0, max_5x: 100, max_20x: 200, team: 0 }

/** Crediti API mensili inclusi nel piano (Max 5x 100 $, Max 20x 200 $, Team fino a 500 $). */
export function planCreditUsd(o: Pick<Options, 'plan' | 'teamCreditsUsd'>): number {
  return o.plan === 'team' ? Math.min(500, o.teamCreditsUsd) : PLAN_CREDITS[o.plan]
}

/**
 * Soglie del budget. Con un piano che include crediti, una soglia lasciata al valore
 * predefinito diventa automatica: il blocco quando i crediti finiscono, l'avviso all'80% del
 * blocco (o dei crediti, se il blocco è spento). Così l'add-on non spende oltre quanto il
 * piano già paga. Le due soglie si decidono una per una: cambiarne una non tocca l'altra.
 */
export function budgetThresholds(o: BudgetOptions): { warn: number; block: number; warnFromCredits: boolean; blockFromCredits: boolean } {
  const credit = planCreditUsd(o)
  if (credit <= 0) return { warn: o.monthlyBudgetWarnUsd, block: o.monthlyBudgetBlockUsd, warnFromCredits: false, blockFromCredits: false }
  const blockFromCredits = o.monthlyBudgetBlockUsd === DEFAULT_OPTIONS.monthlyBudgetBlockUsd
  const warnFromCredits = o.monthlyBudgetWarnUsd === DEFAULT_OPTIONS.monthlyBudgetWarnUsd
  const block = blockFromCredits ? credit : o.monthlyBudgetBlockUsd
  const warn = warnFromCredits ? Math.round((block > 0 ? block : credit) * 80) / 100 : o.monthlyBudgetWarnUsd
  return { warn, block, warnFromCredits, blockFromCredits }
}

/** "Budget raggiunto ($52.10 su $50): l'add-on torna a chiamare Claude il 15/11/2026." */
export function budgetBlockedMessage(b: BudgetStatus): string {
  const [y, m, d] = b.resetsOn.split('-')
  return `Budget raggiunto ($${b.spentUsd.toFixed(2)} su $${b.blockUsd}): l'add-on torna a chiamare Claude il ${d}/${m}/${y}.`
}

/** Come sbloccare subito: con il blocco automatico serve una soglia oltre i crediti del piano. */
export function budgetRaiseHint(b: BudgetStatus): string {
  if (!b.blockFromCredits) return 'Puoi alzare la soglia nelle opzioni.'
  return `La soglia è automatica, sui crediti del piano: per continuare imposta monthly_budget_block_usd oltre $${b.blockUsd} (servono crediti acquistati o la ricarica automatica).`
}

export class UsageLedger {
  private readonly file: string
  private records: UsageRecord[] = []
  /** periodo di ogni voce, calcolato una volta sola per fuso e giorno di inizio */
  private keys: { tz: string; startDay: number; list: string[] } = { tz: '', startDay: 0, list: [] }

  constructor(
    dataDir: string,
    private readonly tz: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.file = join(dataDir, 'usage.jsonl')
  }

  async load(): Promise<void> {
    this.records = (await readJsonl<UsageRecord>(this.file)).filter((r) => typeof r.costUsd === 'number' && !Number.isNaN(new Date(r.ts).getTime()))
    this.keys = { tz: '', startDay: 0, list: [] }
  }

  async record(r: Omit<UsageRecord, 'ts'>): Promise<void> {
    const rec: UsageRecord = { ts: this.now().toISOString(), ...r }
    this.records.push(rec)
    await appendJsonl(this.file, rec)
  }

  /** Voci del periodo in corso (mese di calendario o ciclo di fatturazione). */
  private current(startDay: number): UsageRecord[] {
    const tz = this.tz()
    if (this.keys.tz !== tz || this.keys.startDay !== startDay) this.keys = { tz, startDay, list: [] }
    const list = this.keys.list
    for (let i = list.length; i < this.records.length; i++) list.push(periodKey(new Date(this.records[i]!.ts), tz, startDay))
    const key = periodKey(this.now(), tz, startDay)
    return this.records.filter((_, i) => list[i] === key)
  }

  monthSpent(startDay = 1): number {
    return this.current(startDay).reduce((sum, r) => sum + r.costUsd, 0)
  }

  status(options: BudgetOptions): BudgetStatus {
    const spent = this.monthSpent(options.billingDay)
    const { warn, block, warnFromCredits, blockFromCredits } = budgetThresholds(options)
    // Soglia 0 = disattivata.
    const level = block > 0 && spent >= block ? 'bloccato' : warn > 0 && spent >= warn ? 'avviso' : 'ok'
    return {
      month: periodKey(this.now(), this.tz(), options.billingDay),
      spentUsd: Math.round(spent * 10_000) / 10_000,
      warnUsd: warn,
      blockUsd: block,
      level,
      plan: options.plan,
      creditUsd: planCreditUsd(options),
      warnFromCredits,
      blockFromCredits,
      startDay: options.billingDay,
      startsOn: periodStart(this.now(), this.tz(), options.billingDay),
      resetsOn: nextPeriodStart(this.now(), this.tz(), options.billingDay),
    }
  }

  /** Spesa del periodo per funzione e modello, la più cara prima. */
  breakdown(startDay = 1): UsageSlice[] {
    const slices = new Map<string, UsageSlice>()
    for (const r of this.current(startDay)) {
      const key = `${r.kind}|${r.model}`
      const s = slices.get(key) ?? { kind: r.kind, model: r.model, requests: 0, costUsd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      s.requests += 1
      s.costUsd += r.costUsd
      s.input += r.input
      s.output += r.output
      s.cacheRead += r.cacheRead
      s.cacheWrite += r.cacheWrite
      slices.set(key, s)
    }
    return [...slices.values()].map((s) => ({ ...s, costUsd: Math.round(s.costUsd * 10_000) / 10_000 })).sort((a, b) => b.costUsd - a.costUsd)
  }
}
