// Tutte le chiamate usano percorsi RELATIVI: la pagina vive sotto /api/hassio_ingress/<token>/,
// quindi 'api/session' risolve dentro l'ingress dell'add-on e non verso HA.

export interface Session {
  version: string
  mode: 'addon' | 'dev' | 'none'
  addonSlug: string | null
  user: { id: string; name: string; displayName: string; admin: boolean } | null
  ha: { state: string; version: string | null; error: string | null }
  options: {
    chatModel: string
    chatEffort: string
    analysisModel: string
    suggestEffort: string
    verifyEffort: string
    monthlyBudgetWarnUsd: number
    monthlyBudgetBlockUsd: number
    anthropicConfigured: boolean
  }
}

export type ProbeStatus = 'ok' | 'avviso' | 'errore' | 'saltata'

export interface ProbeResult {
  id: string
  label: string
  status: ProbeStatus
  summary: string
  ms: number
  details?: unknown
}

export interface ProbeRun {
  startedAt: string
  durationMs: number
  results: ProbeResult[]
}

export interface AnthropicPing {
  configured: boolean
  models: Array<{ role: string; model: string; ok: boolean; displayName?: string; maxInputTokens?: number; error?: string }>
  countTokens?: { model: string; inputTokens: number } | { model: string; error: string }
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

export const api = {
  session: () => getJson<Session>('api/session'),
  runProbes: () => getJson<ProbeRun>('api/diag/probes'),
  pingAnthropic: () => getJson<AnthropicPing>('api/diag/anthropic'),
  sseTestUrl: (seconds: number) => `api/diag/sse-test?seconds=${seconds}`,
}
