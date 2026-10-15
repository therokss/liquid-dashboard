import { readJsonBody, sendJson, HttpError, type Route, type RouteContext } from '../http/server.ts'
import type { UsageLedger } from '../claude/usage.ts'
import type { Options } from '../options.ts'
import { DevicesError, MAX_BATCH, type DevicesService } from './service.ts'
import { SLUG_RE } from './kb.ts'

export interface DevicesRouteDeps {
  service: DevicesService
  usage: UsageLedger
  options: Options
}

const KEY_RE = /^[a-z0-9 ?]{1,80}\|[a-z0-9 ?]{1,160}$/

function who(user: RouteContext['user']): string {
  return user?.name || user?.id || 'admin'
}

async function guard(res: RouteContext['res'], fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    if (err instanceof DevicesError) sendJson(res, err.status, { error: err.code, message: err.message })
    else throw err
  }
}

export function devicesRoutes(deps: DevicesRouteDeps): Route[] {
  const { service, usage, options } = deps
  const slug = (params: Record<string, string>): string => {
    const s = params.slug ?? ''
    if (!SLUG_RE.test(s)) throw new HttpError(400, 'id_non_valido')
    return s
  }
  return [
    {
      method: 'GET',
      path: '/api/devices',
      auth: true,
      handler: ({ res }) =>
        guard(res, async () =>
          sendJson(res, 200, {
            ...(await service.overview()),
            budget: usage.status(options),
            model: options.analysisModel,
            effort: options.devicesEffort,
            configured: options.anthropicApiKey.length > 0,
          }),
        ),
    },
    {
      method: 'GET',
      path: '/api/devices/cards/:slug',
      auth: true,
      handler: ({ res, params }) => {
        const card = service.card(slug(params))
        if (!card) return sendJson(res, 404, { error: 'scheda_inesistente', message: 'Scheda non trovata' })
        sendJson(res, 200, { card })
      },
    },
    {
      method: 'POST',
      path: '/api/devices/study',
      auth: true,
      handler: ({ req, res, user }) =>
        guard(res, async () => {
          const body = await readJsonBody<{ key?: unknown }>(req)
          if (typeof body.key !== 'string' || !KEY_RE.test(body.key)) throw new HttpError(400, 'modello_non_valido')
          const { info, done } = await service.start(body.key, who(user), 'pagina')
          // L'esito si legge da GET /api/devices (polling): qui basta non lasciare il rifiuto pendente.
          done.catch(() => undefined)
          sendJson(res, 202, { active: info })
        }),
    },
    {
      method: 'POST',
      path: '/api/devices/study-all',
      auth: true,
      handler: ({ req, res, user }) =>
        guard(res, async () => {
          const body = await readJsonBody<{ keys?: unknown }>(req)
          const keys = body.keys
          if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_BATCH || !keys.every((k) => typeof k === 'string' && KEY_RE.test(k))) {
            throw new HttpError(400, 'modelli_non_validi')
          }
          sendJson(res, 202, { batch: await service.startBatch(keys as string[], who(user)) })
        }),
    },
    {
      method: 'POST',
      path: '/api/devices/study/stop',
      auth: true,
      handler: ({ res }) => sendJson(res, 200, { stopped: service.stop() }),
    },
    {
      method: 'POST',
      path: '/api/devices/cards/:slug/approve',
      auth: true,
      handler: ({ res, params, user }) => guard(res, async () => sendJson(res, 200, { card: await service.approve(slug(params), who(user)) })),
    },
    {
      method: 'POST',
      path: '/api/devices/approve-all',
      auth: true,
      handler: ({ req, res, user }) =>
        guard(res, async () => {
          const body = await readJsonBody<{ slugs?: unknown }>(req)
          const slugs = body.slugs
          if (!Array.isArray(slugs) || slugs.length > MAX_BATCH || !slugs.every((x) => typeof x === 'string' && SLUG_RE.test(x))) throw new HttpError(400, 'schede_non_valide')
          sendJson(res, 200, { approved: await service.approveAll(slugs as string[], who(user)) })
        }),
    },
    {
      method: 'POST',
      path: '/api/devices/cards/:slug/chat',
      auth: true,
      handler: ({ res, params, user }) =>
        guard(res, async () => {
          try {
            sendJson(res, 201, await service.ideas(slug(params), who(user)))
          } catch (err) {
            // Errori della chat (budget, chiave mancante…) con lo stesso formato.
            const e = err as { status?: unknown; code?: unknown; message?: unknown }
            if (!(err instanceof HttpError) && !(err instanceof DevicesError) && typeof e.status === 'number' && typeof e.code === 'string') sendJson(res, e.status, { error: e.code, message: String(e.message) })
            else throw err
          }
        }),
    },
    {
      method: 'DELETE',
      path: '/api/devices/cards/:slug',
      auth: true,
      handler: ({ res, params }) =>
        guard(res, async () => {
          await service.remove(slug(params))
          sendJson(res, 200, { removed: true })
        }),
    },
  ]
}
