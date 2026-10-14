import type { Route } from './http/server.ts'
import { sendJson } from './http/server.ts'
import { openSse } from './http/sse.ts'
import { runProbes } from './diagnostics/probes.ts'
import { pingAnthropic } from './claude/client.ts'
import { publicOptions, type Options } from './options.ts'
import type { HAConnection } from './ha/connection.ts'
import type { HARest } from './ha/rest.ts'
import type { Mode } from './ha/env.ts'
import { VERSION } from './version.ts'
import type { UsageLedger } from './claude/usage.ts'

export interface AppDeps {
  mode: Mode
  conn: HAConnection | null
  rest: HARest
  options: Options
  addon: { slug: string } | null
  usage?: UsageLedger
}

export function buildRoutes(deps: AppDeps): Route[] {
  let probesRunning = false

  return [
    {
      method: 'GET',
      path: '/healthz',
      auth: false,
      handler: ({ res }) => sendJson(res, 200, { status: 'ok', version: VERSION }),
    },
    {
      method: 'GET',
      path: '/api/session',
      auth: true,
      handler: ({ res, user }) =>
        sendJson(res, 200, {
          version: VERSION,
          mode: deps.mode,
          addonSlug: deps.addon?.slug ?? null,
          user,
          ha: { state: deps.conn?.state ?? 'idle', version: deps.conn?.haVersion ?? null, error: deps.conn?.lastError ?? null },
          options: publicOptions(deps.options),
          budget: deps.usage?.status(deps.options) ?? null,
        }),
    },
    {
      method: 'GET',
      path: '/api/diag/probes',
      auth: true,
      async handler({ res }) {
        // Una sola esecuzione alla volta: alcune query (logbook, statistiche) pesano sul DB di HA.
        if (probesRunning) {
          sendJson(res, 409, { error: 'diagnostica_in_corso' })
          return
        }
        probesRunning = true
        const started = Date.now()
        try {
          const results = await runProbes({ conn: deps.conn, rest: deps.rest, mode: deps.mode })
          sendJson(res, 200, { startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, results })
        } finally {
          probesRunning = false
        }
      },
    },
    {
      method: 'GET',
      path: '/api/diag/sse-test',
      auth: true,
      handler({ req, res, url }) {
        // Un evento al secondo: se nel browser arrivano a blocchi, qualcosa lungo la strada bufferizza.
        const seconds = Math.min(Math.max(Number(url.searchParams.get('seconds')) || 20, 1), 120)
        const sse = openSse(req, res, 5_000)
        let n = 0
        const timer = setInterval(() => {
          n += 1
          sse.send('tick', { n, of: seconds, serverTime: Date.now() }, n)
          if (n >= seconds) {
            clearInterval(timer)
            sse.send('done', { n })
            sse.close()
          }
        }, 1_000)
        sse.onClose(() => clearInterval(timer))
      },
    },
    {
      method: 'GET',
      path: '/api/diag/anthropic',
      auth: true,
      async handler({ res }) {
        sendJson(res, 200, await pingAnthropic(deps.options))
      },
    },
  ]
}
