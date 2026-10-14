import { readJsonBody, sendJson, HttpError, type Route, type RouteContext } from '../http/server.ts'
import type { HAReader } from '../ha/data.ts'
import type { SettingsStore } from '../store/settings.ts'
import type { UsageLedger } from '../claude/usage.ts'
import type { Options } from '../options.ts'
import { loadUsers } from './collect.ts'
import { SuggestError, type SuggestService } from './service.ts'
import { isRunId, type SuggestStore } from './store.ts'
import type { UserKind } from './types.ts'

export interface SuggestRouteDeps {
  service: SuggestService
  store: SuggestStore
  settings: SettingsStore
  usage: UsageLedger
  options: Options
  ha: HAReader | null
}

function runId(params: Record<string, string>): string {
  const id = params.id ?? ''
  if (!isRunId(id)) throw new HttpError(400, 'id_non_valido')
  return id
}

function candidateId(params: Record<string, string>): string {
  const id = params.cid ?? ''
  if (!/^c\d{1,3}$/.test(id)) throw new HttpError(400, 'id_non_valido')
  return id
}

function who(user: RouteContext['user']): string {
  return user?.name || user?.id || 'admin'
}

async function guard(res: RouteContext['res'], fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    if (err instanceof SuggestError) sendJson(res, err.status, { error: err.code, message: err.message })
    else throw err
  }
}

export function suggestRoutes(deps: SuggestRouteDeps): Route[] {
  const { service, store, settings, usage, options } = deps
  const view = (id: string) => {
    const run = store.get(id)
    if (!run) throw new SuggestError(404, 'analisi_inesistente', 'Analisi non trovata')
    return service.view(run)
  }
  return [
    {
      method: 'GET',
      path: '/api/suggest',
      auth: true,
      handler: ({ res }) =>
        sendJson(res, 200, {
          runs: service.summaries(),
          active: service.activeRunId(),
          dismissed: [...store.dismissedSignatures()].map(([signature, d]) => ({ signature, ...d })),
          budget: usage.status(options),
          model: options.analysisModel,
          effort: options.suggestEffort,
          configured: options.anthropicApiKey.length > 0,
        }),
    },
    {
      method: 'POST',
      path: '/api/suggest/runs',
      auth: true,
      handler: ({ req, res, user }) =>
        guard(res, async () => {
          const body = await readJsonBody<{ days?: unknown }>(req)
          const run = await service.start(who(user), typeof body.days === 'number' ? body.days : 30)
          sendJson(res, 202, { run: service.view(run) })
        }),
    },
    {
      method: 'GET',
      path: '/api/suggest/runs/:id',
      auth: true,
      handler: ({ res, params }) => guard(res, async () => sendJson(res, 200, { run: view(runId(params)) })),
    },
    {
      method: 'POST',
      path: '/api/suggest/runs/:id/generate',
      auth: true,
      handler: ({ res, params }) =>
        guard(res, async () => {
          const run = await service.generate(runId(params))
          sendJson(res, 202, { run: service.view(run) })
        }),
    },
    {
      method: 'POST',
      path: '/api/suggest/runs/:id/stop',
      auth: true,
      handler: ({ res, params }) => sendJson(res, 200, { stopped: service.stop(runId(params)) }),
    },
    {
      method: 'POST',
      path: '/api/suggest/runs/:id/candidates/:cid/dismiss',
      auth: true,
      handler: ({ res, params, user }) =>
        guard(res, async () => {
          const id = runId(params)
          await service.dismiss(id, candidateId(params), who(user))
          sendJson(res, 200, { run: view(id) })
        }),
    },
    {
      method: 'POST',
      path: '/api/suggest/runs/:id/candidates/:cid/undismiss',
      auth: true,
      handler: ({ res, params }) =>
        guard(res, async () => {
          const id = runId(params)
          await service.undismiss(id, candidateId(params))
          sendJson(res, 200, { run: view(id) })
        }),
    },
    {
      method: 'POST',
      path: '/api/suggest/runs/:id/candidates/:cid/chat',
      auth: true,
      handler: ({ res, params, user }) =>
        guard(res, async () => {
          try {
            sendJson(res, 201, await service.discuss(runId(params), candidateId(params), who(user)))
          } catch (err) {
            // Errori della chat (budget, chiave mancante…) con lo stesso formato.
            const e = err as { status?: unknown; code?: unknown; message?: unknown }
            if (typeof e.status === 'number' && typeof e.code === 'string') sendJson(res, e.status, { error: e.code, message: String(e.message) })
            else throw err
          }
        }),
    },
    {
      method: 'POST',
      path: '/api/suggest/dismissed/clear',
      auth: true,
      handler: async ({ res }) => sendJson(res, 200, { cleared: await store.clearDismissed() }),
    },
    {
      method: 'GET',
      path: '/api/suggest/users',
      auth: true,
      async handler({ res }) {
        if (!deps.ha) return sendJson(res, 503, { error: 'ha_non_configurato' })
        sendJson(res, 200, { users: await loadUsers(deps.ha, settings.get().userKinds) })
      },
    },
    {
      method: 'PUT',
      path: '/api/settings/users',
      auth: true,
      async handler({ req, res }) {
        const body = await readJsonBody<{ kinds?: unknown }>(req)
        if (!body.kinds || typeof body.kinds !== 'object') throw new HttpError(400, 'kinds_mancanti')
        await settings.setUserKinds(body.kinds as Record<string, UserKind>)
        sendJson(res, 200, { users: deps.ha ? await loadUsers(deps.ha, settings.get().userKinds) : [] })
      },
    },
  ]
}
