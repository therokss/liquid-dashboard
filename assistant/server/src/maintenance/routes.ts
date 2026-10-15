import { readJsonBody, sendJson, HttpError, type Route, type RouteContext } from '../http/server.ts'
import { WriteError } from '../ha/writer.ts'
import { log } from '../log.ts'
import { MaintenanceError, type MaintenanceService } from './service.ts'

const ISSUE_RE = /^m\d{1,5}$/
const CHANGE_RE = /^c[a-z0-9]{6,40}$/
const SIGNATURE_MAX = 4000

function who(user: RouteContext['user']): string {
  return user?.name || user?.id || 'admin'
}

async function guard(res: RouteContext['res'], fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    if (err instanceof MaintenanceError) return sendJson(res, err.status, { error: err.code, message: err.message })
    if (err instanceof HttpError) throw err
    // Errori di Home Assistant (es. integrazione che non permette di eliminare il dispositivo).
    const message = err instanceof Error ? err.message : String(err)
    log.warn(`Manutenzione: errore da Home Assistant: ${message}`)
    sendJson(res, err instanceof WriteError ? err.status : 502, { error: 'errore_ha', message: `Home Assistant: ${message}` })
  }
}

export function maintenanceRoutes(service: MaintenanceService): Route[] {
  const param = (params: Record<string, string>, key: string, re: RegExp): string => {
    const v = params[key] ?? ''
    if (!re.test(v)) throw new HttpError(400, 'id_non_valido')
    return v
  }
  return [
    {
      method: 'GET',
      path: '/api/maintenance',
      auth: true,
      handler: ({ res }) => sendJson(res, 200, service.overview()),
    },
    {
      method: 'POST',
      path: '/api/maintenance/check',
      auth: true,
      handler: ({ res, user }) =>
        guard(res, async () => {
          await service.check(who(user))
          sendJson(res, 200, service.overview())
        }),
    },
    {
      method: 'POST',
      path: '/api/maintenance/issues/:id/apply',
      auth: true,
      handler: ({ req, res, params, user }) =>
        guard(res, async () => {
          const id = param(params, 'id', ISSUE_RE)
          const body = await readJsonBody<{ action?: unknown; confirm?: unknown }>(req)
          if (typeof body.action !== 'number' || !Number.isInteger(body.action) || body.action < 0 || body.action > 20) throw new HttpError(400, 'azione_non_valida')
          const change = await service.apply(id, body.action, who(user), body.confirm === true)
          sendJson(res, 200, { change, ...service.overview() })
        }),
    },
    {
      method: 'POST',
      path: '/api/maintenance/changes/:id/undo',
      auth: true,
      handler: ({ res, params, user }) =>
        guard(res, async () => {
          const change = await service.undo(param(params, 'id', CHANGE_RE), who(user))
          sendJson(res, 200, { change, ...service.overview() })
        }),
    },
    {
      method: 'POST',
      path: '/api/maintenance/issues/:id/ignore',
      auth: true,
      handler: ({ res, params, user }) =>
        guard(res, async () => {
          await service.ignore(param(params, 'id', ISSUE_RE), who(user))
          sendJson(res, 200, service.overview())
        }),
    },
    {
      method: 'POST',
      path: '/api/maintenance/unignore',
      auth: true,
      handler: ({ req, res }) =>
        guard(res, async () => {
          const body = await readJsonBody<{ signature?: unknown }>(req)
          if (typeof body.signature !== 'string' || !body.signature || body.signature.length > SIGNATURE_MAX) throw new HttpError(400, 'firma_non_valida')
          await service.unignore(body.signature)
          sendJson(res, 200, service.overview())
        }),
    },
  ]
}
