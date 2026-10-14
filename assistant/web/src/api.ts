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
  budget: Budget | null
}

export interface Budget {
  month: string
  spentUsd: number
  warnUsd: number
  blockUsd: number
  level: 'ok' | 'avviso' | 'bloccato'
}

export interface ConversationSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  model: string
  costUsd: number
  turns: number
}

export type ViewPart =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; label: string; ok: boolean | null }
  | { type: 'note'; text: string; tone: 'info' | 'warning' | 'error' }

export type ViewItem =
  | { kind: 'user'; text: string; ts: string }
  | { kind: 'assistant'; parts: ViewPart[]; ts: string; costUsd?: number; cacheRead?: number; fallback?: boolean }

export interface InventoryStats {
  totalEntities: number
  included: number
  forcedByAutomations: number
  excludedPrivacy: Record<ConsentKey, number>
  byDomain: Record<string, number>
  automations: number
}

export interface DraftPublic {
  id: string
  toolUseId: string
  status: 'pending' | 'applied' | 'discarded' | 'undone'
  kind: 'create' | 'update'
  alias: string
  explanation: string
  yaml: string
  fixes: string[]
  warnings: string[]
  checks: Array<{ label: string; ok: boolean; detail?: string }>
  critical: Array<{ ref: string; reason: string }>
  target: { entityId: string; alias: string; automationId: string } | null
  diff: Array<{ op: ' ' | '+' | '-'; line: string }> | null
  applied: { at: string; by: string; automationId: string; entityId: string | null; enabled: boolean; warning: string | null } | null
  undone: { at: string; by: string } | null
  discarded: { at: string; by: string } | null
  lastError: string | null
}

export interface HistoryEntry {
  ts: string
  by: string
  action: 'creata' | 'modificata' | 'annullata_creazione' | 'ripristinata' | 'rollback_automatico'
  automationId: string
  entityId: string | null
  alias: string
}

export interface ConversationDetail {
  summary: ConversationSummary
  model: string
  effort: string
  inventoryStats: InventoryStats
  readOnly: boolean
  running: boolean
  items: ViewItem[]
  drafts: Record<string, DraftPublic>
}

export type ConsentKey = 'posizione' | 'telecamere' | 'appMobile'
export type Consents = Record<ConsentKey, boolean>

export interface SettingsData {
  consents: Consents
  consentsDefault: Consents
  consentLabels: Record<ConsentKey, string>
  consentsChangedBy: string | null
  consentsChangedAt: string | null
  models: { chat: string; chatEffort: string; analysis: string }
  budget: Budget
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

export class ApiCallError extends ApiError {
  constructor(status: number, readonly code: string, message: string) {
    super(status, message)
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
      // Le richieste che modificano qualcosa portano questo header: il server rifiuta le altre.
      ...(method === 'GET' ? {} : { 'X-Assistente': '1' }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string }
    throw new ApiCallError(res.status, data.error ?? `HTTP ${res.status}`, data.message ?? data.error ?? `HTTP ${res.status}`)
  }
  return (await res.json()) as T
}

const getJson = <T,>(path: string) => call<T>('GET', path)

export const api = {
  session: () => getJson<Session>('api/session'),
  runProbes: () => getJson<ProbeRun>('api/diag/probes'),
  pingAnthropic: () => getJson<AnthropicPing>('api/diag/anthropic'),
  sseTestUrl: (seconds: number) => `api/diag/sse-test?seconds=${seconds}`,
  conversations: () => getJson<{ conversations: ConversationSummary[]; budget: Budget }>('api/chat/conversations'),
  createConversation: () => call<{ id: string; summary: ConversationSummary }>('POST', 'api/chat/conversations'),
  conversation: (id: string) => getJson<ConversationDetail>(`api/chat/conversations/${id}`),
  deleteConversation: (id: string) => call<{ ok: boolean }>('DELETE', `api/chat/conversations/${id}`),
  send: (id: string, text: string) => call<{ turnId: string }>('POST', `api/chat/conversations/${id}/messages`, { text }),
  stop: (id: string) => call<{ stopped: boolean }>('POST', `api/chat/conversations/${id}/stop`),
  eventsUrl: (id: string) => `api/chat/conversations/${id}/events`,
  payload: (id: string) => getJson<{ model: string; system: string; tools: Array<{ name: string; description: string }> }>(`api/chat/conversations/${id}/payload`),
  settings: () => getJson<SettingsData>('api/settings'),
  setPrivacy: (consents: Consents) => call<{ consents: Consents }>('PUT', 'api/settings/privacy', { consents }),
  applyDraft: (id: string, opts: { enabled: boolean; confirmCritical: boolean }) => call<{ draft: DraftPublic }>('POST', `api/drafts/${id}/apply`, opts),
  undoDraft: (id: string, force = false) => call<{ draft: DraftPublic }>('POST', `api/drafts/${id}/undo`, { force }),
  discardDraft: (id: string) => call<{ draft: DraftPublic }>('POST', `api/drafts/${id}/discard`, {}),
  history: () => getJson<{ entries: HistoryEntry[] }>('api/history'),
  inventoryPreview: () => getJson<{ stats: InventoryStats; text: string; chars: number }>('api/inventory/preview'),
}
