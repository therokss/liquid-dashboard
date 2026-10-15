import { readJsonBody, sendJson, HttpError, type Route, type RouteContext } from '../http/server.ts'
import type { UsageLedger } from '../claude/usage.ts'
import type { Options } from '../options.ts'
import { DEFAULT_DAYS, VerifyError, type VerifyService } from './service.ts'
import type { VerifyStore } from './store.ts'

export interface VerifyRouteDeps {
  service: VerifyService
  store: VerifyStore
  usage: UsageLedger
  options: Options
}

const AUTOMATION_RE = /^automation\.[a-z0-9_]{1,200}$/

function who(user: RouteContext['user']): string {
  return user?.name || user?.id || 'admin'
}

async function guard(res: RouteContext['res'], fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    if (err instanceof VerifyError) sendJson(res, err.status, { error: err.code, message: err.message })
    else throw err
  }
}

export function verifyRoutes(deps: VerifyRouteDeps): Route[] {
  const { service, store, usage, options } = deps
  const runId = (params: Record<string, string>): string => {
    const id = params.id ?? ''
    if (!store.isId(id)) throw new HttpError(400, 'id_non_valido')
    return id
  }
  const findingId = (params: Record<string, string>): string => {
    const id = params.fid ?? ''
    if (!/^f\d{1,5}$/.test(id)) throw new HttpError(400, 'id_non_valido')
    return id
  }
  const automation = (v: unknown): string => {
    if (typeof v !== 'string' || !AUTOMATION_RE.test(v)) throw new HttpError(400, 'automazione_non_valida')
    return v
  }
  const view = (id: string) => {
    const run = store.get(id)
    if (!run) throw new VerifyError(404, 'verifica_inesistente', 'Verifica non trovata')
    return service.view(run)
  }
  return [
    {
      method: 'GET',
      path: '/api/verify',
      auth: true,
      handler: ({ res }) =>
        sendJson(res, 200, {
          runs: service.summaries(),
          active: service.activeRunId(),
          ignored: [...store.ignoredSignatures()].map(([signature, d]) => ({ signature, ...d })),
          budget: usage.status(options),
          model: options.analysisModel,
          effort: options.verifyEffort,
          configured: options.anthropicApiKey.length > 0,
        }),
    },
    {
      method: 'POST',
      path: '/api/verify/runs',
      auth: true,
      handler: ({ req, res, user }) =>
        guard(res, async () => {
          const body = await readJsonBody<{ days?: unknown }>(req)
          const run = await service.start(who(user), typeof body.days === 'number' ? body.days : DEFAULT_DAYS)
          sendJson(res, 202, { run: service.view(run) })
        }),
    },
    {
      method: 'GET',
      path: '/api/verify/runs/:id',
      auth: true,
      handler: ({ res, params }) => guard(res, async () => sendJson(res, 200, { run: view(runId(params)) })),
    },
    {
      method: 'POST',
      path: '/api/verify/runs/:id/analyze',
      auth: true,
      handler: ({ req, res, params }) =>
        guard(res, async () => {
          const body = await readJsonBody<{ automations?: unknown }>(req)
          if (!Array.isArray(body.automations)) throw new HttpError(400, 'automazioni_mancanti')
          const run = await service.analyze(runId(params), body.automations.map(automation))
          sendJson(res, 202, { run: service.view(run) })
        }),
    },
    {
      method: 'POST',
      path: '/api/verify/runs/:id/stop',
      auth: true,
      handler: ({ res, params }) => sendJson(res, 200, { stopped: service.stop(runId(params)) }),
    },
    {
      method: 'POST',
      path: '/api/verify/runs/:id/fix',
      auth: true,
      handler: ({ req, res, params, user }) =>
        guard(res, async () => {
          const id = runId(params)
          const body = await readJsonBody<{ automation?: unknown; findings?: unknown }>(req)
          if (!Array.isArray(body.findings) || !body.findings.every((f) => typeof f === 'string' && /^f\d{1,5}$/.test(f))) throw new HttpError(400, 'correzioni_non_valide')
          await service.fix(id, automation(body.automation), body.findings as string[], who(user))
          sendJson(res, 200, { run: view(id) })
        }),
    },
    {
      method: 'POST',
      path: '/api/verify/runs/:id/findings/:fid/ignore',
      auth: true,
      handler: ({ res, params, user }) =>
        guard(res, async () => {
          const id = runId(params)
          await service.ignore(id, findingId(params), who(user))
          sendJson(res, 200, { run: view(id) })
        }),
    },
    {
      method: 'POST',
      path: '/api/verify/runs/:id/findings/:fid/unignore',
      auth: true,
      handler: ({ res, params }) =>
        guard(res, async () => {
          const id = runId(params)
          await service.unignore(id, findingId(params))
          sendJson(res, 200, { run: view(id) })
        }),
    },
    {
      method: 'POST',
      path: '/api/verify/runs/:id/chat',
      auth: true,
      handler: ({ req, res, params, user }) =>
        guard(res, async () => {
          const body = await readJsonBody<{ automation?: unknown }>(req)
          try {
            sendJson(res, 201, await service.discuss(runId(params), automation(body.automation), who(user)))
          } catch (err) {
            // Errori della chat (budget, chiave mancante…) con lo stesso formato.
            const e = err as { status?: unknown; code?: unknown; message?: unknown }
            if (!(err instanceof HttpError) && typeof e.status === 'number' && typeof e.code === 'string') sendJson(res, e.status, { error: e.code, message: String(e.message) })
            else throw err
          }
        }),
    },
    {
      method: 'POST',
      path: '/api/verify/ignored/clear',
      auth: true,
      handler: async ({ res }) => sendJson(res, 200, { cleared: await store.clearIgnored() }),
    },
  ]
}
