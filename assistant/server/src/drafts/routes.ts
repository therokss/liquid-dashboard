import { readJsonBody, sendJson, HttpError, type Route } from '../http/server.ts'
import { DraftError, publicDraft, type DraftService } from './service.ts'
import { isDraftId, type DraftStore } from './store.ts'

// Azioni dell'amministratore sulle bozze: sono le uniche richieste che scrivono in Home Assistant.

function draftId(params: Record<string, string>): string {
  const id = params.id ?? ''
  if (!isDraftId(id)) throw new HttpError(400, 'id_non_valido')
  return id
}

function who(user: { name?: string; id?: string } | null): string {
  return user?.name || user?.id || 'admin'
}

async function run(res: Parameters<Route['handler']>[0]['res'], fn: () => Promise<unknown>): Promise<void> {
  try {
    sendJson(res, 200, { draft: await fn() })
  } catch (err) {
    if (err instanceof DraftError) sendJson(res, err.status, { error: err.code, message: err.message })
    else throw err
  }
}

export function draftRoutes(deps: { service: DraftService; store: DraftStore }): Route[] {
  const { service, store } = deps
  return [
    {
      method: 'GET',
      path: '/api/drafts/:id',
      auth: true,
      handler({ res, params }) {
        const d = store.get(draftId(params))
        if (!d) return sendJson(res, 404, { error: 'bozza_inesistente' })
        sendJson(res, 200, { draft: publicDraft(d) })
      },
    },
    {
      method: 'POST',
      path: '/api/drafts/:id/apply',
      auth: true,
      async handler({ req, res, params, user }) {
        const id = draftId(params)
        const body = await readJsonBody<{ enabled?: unknown; confirmCritical?: unknown }>(req)
        await run(res, async () => publicDraft(await service.apply(id, { enabled: body.enabled !== false, confirmCritical: body.confirmCritical === true, by: who(user) })))
      },
    },
    {
      method: 'POST',
      path: '/api/drafts/:id/undo',
      auth: true,
      async handler({ req, res, params, user }) {
        const id = draftId(params)
        const body = await readJsonBody<{ force?: unknown }>(req)
        await run(res, async () => publicDraft(await service.undo(id, { force: body.force === true, by: who(user) })))
      },
    },
    {
      method: 'POST',
      path: '/api/drafts/:id/discard',
      auth: true,
      async handler({ res, params, user }) {
        const id = draftId(params)
        await run(res, async () => publicDraft(await service.discard(id, who(user))))
      },
    },
    {
      method: 'GET',
      path: '/api/history',
      auth: true,
      async handler({ res }) {
        sendJson(res, 200, { entries: await store.history(100) })
      },
    },
  ]
}
