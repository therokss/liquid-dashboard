import { readJsonBody, sendJson, HttpError, type Route } from '../http/server.ts'
import { openSse } from '../http/sse.ts'
import { ChatError, type ChatService } from './service.ts'
import { isConversationId, type ConversationStore } from './store.ts'
import { toView } from './view.ts'
import { TOOLSET_VERSION } from '../claude/tools/registry.ts'
import { buildHomeSnapshot } from '../inventory/snapshot.ts'
import { DEFAULT_CONSENTS, parseConsents, PRIVACY_LABELS } from '../inventory/privacy.ts'
import type { HAReader } from '../ha/data.ts'
import type { SettingsStore } from '../store/settings.ts'
import type { UsageLedger } from '../claude/usage.ts'
import type { Options } from '../options.ts'

export interface ChatRouteDeps {
  chat: ChatService
  store: ConversationStore
  settings: SettingsStore
  usage: UsageLedger
  options: Options
  ha: HAReader | null
}

function convId(params: Record<string, string>): string {
  const id = params.id ?? ''
  if (!isConversationId(id)) throw new HttpError(400, 'id_non_valido')
  return id
}

async function guard(res: Parameters<Route['handler']>[0]['res'], fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    if (err instanceof ChatError) {
      sendJson(res, err.status, { error: err.code, message: err.message })
      return
    }
    throw err
  }
}

export function chatRoutes(deps: ChatRouteDeps): Route[] {
  const { chat, store, settings, usage, options } = deps
  return [
    {
      method: 'GET',
      path: '/api/chat/conversations',
      auth: true,
      handler: ({ res }) => sendJson(res, 200, { conversations: store.list(), budget: usage.status(options) }),
    },
    {
      method: 'POST',
      path: '/api/chat/conversations',
      auth: true,
      handler: ({ res, user }) =>
        guard(res, async () => {
          const { id } = await chat.create(user?.name ?? user?.id ?? 'admin')
          sendJson(res, 201, { id, summary: store.summary(id) })
        }),
    },
    {
      method: 'GET',
      path: '/api/chat/conversations/:id',
      auth: true,
      async handler({ res, params }) {
        const id = convId(params)
        const conv = await store.get(id)
        if (!conv) return sendJson(res, 404, { error: 'conversazione_inesistente' })
        sendJson(res, 200, {
          summary: store.summary(id),
          model: conv.header.model,
          effort: conv.header.effort,
          inventoryStats: conv.header.inventoryStats,
          readOnly: conv.header.toolsetVersion !== TOOLSET_VERSION,
          running: chat.isRunning(id),
          items: toView(conv),
        })
      },
    },
    {
      // Audit: esattamente ciò che questa chat invia come prefisso (prompt di sistema e tool).
      method: 'GET',
      path: '/api/chat/conversations/:id/payload',
      auth: true,
      async handler({ res, params }) {
        const conv = await store.get(convId(params))
        if (!conv) return sendJson(res, 404, { error: 'conversazione_inesistente' })
        sendJson(res, 200, {
          model: conv.header.model,
          system: conv.header.system.map((b) => b.text).join('\n\n'),
          tools: conv.header.tools.map((t) => ({ name: t.name, description: t.description })),
          messages: conv.messages.length,
        })
      },
    },
    {
      method: 'DELETE',
      path: '/api/chat/conversations/:id',
      auth: true,
      async handler({ res, params }) {
        const id = convId(params)
        if (chat.isRunning(id)) return sendJson(res, 409, { error: 'turno_in_corso' })
        sendJson(res, (await store.remove(id)) ? 200 : 404, { ok: true })
      },
    },
    {
      method: 'POST',
      path: '/api/chat/conversations/:id/messages',
      auth: true,
      handler: ({ req, res, params }) =>
        guard(res, async () => {
          const id = convId(params)
          const body = await readJsonBody<{ text?: unknown }>(req)
          const { turnId } = await chat.send(id, typeof body.text === 'string' ? body.text : '')
          sendJson(res, 202, { turnId })
        }),
    },
    {
      method: 'POST',
      path: '/api/chat/conversations/:id/stop',
      auth: true,
      handler: ({ res, params }) => sendJson(res, 200, { stopped: chat.stop(convId(params)) }),
    },
    {
      method: 'GET',
      path: '/api/chat/conversations/:id/events',
      auth: true,
      handler({ req, res, params, url }) {
        const id = convId(params)
        const sse = openSse(req, res)
        const last = (req.headers['last-event-id'] as string | undefined) ?? url.searchParams.get('after')
        const sub = chat.subscribe(id, last, (e) => {
          sse.send(e.event, e.data, e.id)
          if (e.event === 'done') sse.close()
        })
        if (!sub) {
          sse.send('idle', {})
          sse.close()
          return
        }
        if (sub.done) {
          sse.close()
          return
        }
        sse.onClose(sub.unsubscribe)
      },
    },
    {
      method: 'GET',
      path: '/api/settings',
      auth: true,
      handler: ({ res }) => {
        const s = settings.get()
        sendJson(res, 200, {
          consents: s.consents,
          consentsDefault: DEFAULT_CONSENTS,
          consentLabels: PRIVACY_LABELS,
          consentsChangedBy: s.consentsChangedBy ?? null,
          consentsChangedAt: s.consentsChangedAt ?? null,
          models: { chat: options.chatModel, chatEffort: options.chatEffort, analysis: options.analysisModel },
          budget: usage.status(options),
        })
      },
    },
    {
      method: 'PUT',
      path: '/api/settings/privacy',
      auth: true,
      async handler({ req, res, user }) {
        const body = await readJsonBody<{ consents?: unknown }>(req)
        const s = await settings.setConsents(parseConsents(body.consents), user?.name ?? user?.id ?? 'admin')
        sendJson(res, 200, { consents: s.consents, consentsChangedAt: s.consentsChangedAt })
      },
    },
    {
      method: 'GET',
      path: '/api/inventory/preview',
      auth: true,
      async handler({ res }) {
        if (!deps.ha) return sendJson(res, 503, { error: 'ha_non_configurato' })
        try {
          const snap = await buildHomeSnapshot(deps.ha, settings.consents())
          sendJson(res, 200, { stats: snap.stats, text: snap.inventoryText, chars: snap.inventoryText.length })
        } catch {
          sendJson(res, 503, { error: 'ha_non_raggiungibile', message: 'Home Assistant non risponde in questo momento' })
        }
      },
    },
  ]
}
