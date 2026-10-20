import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './store/paths.ts'
import { addSecret } from './log.ts'

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

/** Come si paga Claude: API a consumo o crediti API mensili inclusi nei piani Max e Team. */
export const PLANS = ['api', 'pro', 'max_5x', 'max_20x', 'team'] as const
export type Plan = (typeof PLANS)[number]

export interface Options {
  anthropicApiKey: string
  chatModel: string
  chatEffort: Effort
  analysisModel: string
  suggestEffort: Effort
  verifyEffort: Effort
  devicesEffort: Effort
  monthlyBudgetWarnUsd: number
  monthlyBudgetBlockUsd: number
  plan: Plan
  /** Team: credito mensile condiviso (20 $ per posto Standard, 100 $ per Premium, massimo 500 $) */
  teamCreditsUsd: number
  /** giorno del mese in cui si rinnova il piano (e arrivano i crediti); 1 = mese di calendario, 29–31 = ultimo giorno nei mesi più corti */
  billingDay: number
}

export const DEFAULT_OPTIONS: Options = {
  anthropicApiKey: '',
  chatModel: 'claude-sonnet-5-5',
  chatEffort: 'medium',
  analysisModel: 'claude-opus-5-5',
  suggestEffort: 'high',
  verifyEffort: 'medium',
  devicesEffort: 'medium',
  monthlyBudgetWarnUsd: 25,
  monthlyBudgetBlockUsd: 50,
  plan: 'api',
  teamCreditsUsd: 0,
  billingDay: 1,
}

function str(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.trim() ? v.trim() : fallback
}

function effort(v: unknown, fallback: Effort): Effort {
  return (EFFORTS as readonly string[]).includes(v as string) ? (v as Effort) : fallback
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fallback
}

/** Converte le opzioni grezze del Supervisor (/data/options.json) applicando i default. */
export function parseOptions(raw: Record<string, unknown>): Options {
  const d = DEFAULT_OPTIONS
  return {
    anthropicApiKey: typeof raw.anthropic_api_key === 'string' ? raw.anthropic_api_key.trim() : '',
    chatModel: str(raw.chat_model, d.chatModel),
    chatEffort: effort(raw.chat_effort, d.chatEffort),
    analysisModel: str(raw.analysis_model, d.analysisModel),
    suggestEffort: effort(raw.suggest_effort, d.suggestEffort),
    verifyEffort: effort(raw.verify_effort, d.verifyEffort),
    devicesEffort: effort(raw.devices_effort, d.devicesEffort),
    monthlyBudgetWarnUsd: num(raw.monthly_budget_warn_usd, d.monthlyBudgetWarnUsd),
    monthlyBudgetBlockUsd: num(raw.monthly_budget_block_usd, d.monthlyBudgetBlockUsd),
    plan: (PLANS as readonly string[]).includes(raw.claude_plan as string) ? (raw.claude_plan as Plan) : d.plan,
    teamCreditsUsd: Math.min(500, num(raw.team_credits_usd, d.teamCreditsUsd)),
    billingDay: Math.min(31, Math.max(1, Math.round(num(raw.billing_day, d.billingDay)) || 1)),
  }
}

export function loadOptions(env: NodeJS.ProcessEnv = process.env): Options {
  const file = env.ASSISTANT_OPTIONS_FILE || join(DATA_DIR, 'options.json')
  let raw: Record<string, unknown> = {}
  try {
    raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    // In sviluppo le opzioni possono arrivare dall'ambiente (.env.local).
  }
  if (!raw.anthropic_api_key && env.ANTHROPIC_API_KEY) raw.anthropic_api_key = env.ANTHROPIC_API_KEY
  const opts = parseOptions(raw)
  addSecret(opts.anthropicApiKey)
  return opts
}

/** Le opzioni come possono essere mostrate nell'interfaccia: mai la chiave. */
export function publicOptions(o: Options) {
  const { anthropicApiKey, ...rest } = o
  return { ...rest, anthropicConfigured: anthropicApiKey.length > 0 }
}
