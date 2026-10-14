import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR } from './store/paths.ts'
import { addSecret } from './log.ts'

export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export interface Options {
  anthropicApiKey: string
  chatModel: string
  chatEffort: Effort
  analysisModel: string
  suggestEffort: Effort
  verifyEffort: Effort
  monthlyBudgetWarnUsd: number
  monthlyBudgetBlockUsd: number
}

export const DEFAULT_OPTIONS: Options = {
  anthropicApiKey: '',
  chatModel: 'claude-sonnet-5-5',
  chatEffort: 'medium',
  analysisModel: 'claude-opus-5-5',
  suggestEffort: 'high',
  verifyEffort: 'medium',
  monthlyBudgetWarnUsd: 25,
  monthlyBudgetBlockUsd: 50,
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
    monthlyBudgetWarnUsd: num(raw.monthly_budget_warn_usd, d.monthlyBudgetWarnUsd),
    monthlyBudgetBlockUsd: num(raw.monthly_budget_block_usd, d.monthlyBudgetBlockUsd),
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
