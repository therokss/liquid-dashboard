import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './http/server.ts'
import { buildRoutes } from './routes.ts'
import { chatRoutes } from './chat/routes.ts'
import { ChatService } from './chat/service.ts'
import { ConversationStore } from './chat/store.ts'
import { HAData } from './ha/data.ts'
import { UsageLedger } from './claude/usage.ts'
import { createClaudeClient } from './claude/client.ts'
import { sdkStreamer } from './claude/loop.ts'
import { SettingsStore } from './store/settings.ts'
import { DATA_DIR } from './store/paths.ts'
import { resolveEndpoints } from './ha/env.ts'
import { HAConnection } from './ha/connection.ts'
import { HARest, supervisorSelfInfo } from './ha/rest.ts'
import { AdminDirectory } from './ha/users.ts'
import { loadOptions } from './options.ts'
import { addSecret, log } from './log.ts'
import { VERSION } from './version.ts'

const here = dirname(fileURLToPath(import.meta.url))

// Nel container il bundle è /app/app/server.mjs e l'interfaccia /app/www;
// in sviluppo (tsx src/index.ts) si usa la build di assistant/web.
function findWwwDir(): string {
  const candidates = [process.env.ASSISTANT_WWW_DIR, resolve(here, '../www'), resolve(here, '../../web/dist')]
  return candidates.find((p): p is string => Boolean(p) && existsSync(resolve(p!, 'index.html'))) ?? resolve(here, '../www')
}

async function main(): Promise<void> {
  const endpoints = resolveEndpoints()
  addSecret(endpoints.token)
  const options = loadOptions()

  const conn = endpoints.mode === 'none' ? null : new HAConnection({ url: endpoints.wsUrl, token: endpoints.token })
  conn?.onState((s) => log.info(`Home Assistant: ${s}`, s === 'connected' ? { versione: conn.haVersion } : undefined))
  conn?.start()

  const rest = new HARest(endpoints)
  const admins = new AdminDirectory(conn)
  const addon = endpoints.mode === 'addon' ? await supervisorSelfInfo(endpoints.token) : null

  const ha = conn ? new HAData(conn) : null
  ha?.watch()
  const settings = new SettingsStore(DATA_DIR)
  await settings.load()
  let tz = process.env.TZ || 'UTC'
  const usage = new UsageLedger(DATA_DIR, () => tz)
  conn?.onState((s) => {
    if (s === 'connected') ha?.config().then((c) => (tz = c.time_zone)).catch(() => undefined)
  })
  await usage.load()
  const store = new ConversationStore(DATA_DIR)
  await store.load()
  const client = createClaudeClient(options)
  const chat = new ChatService({ store, ha, settings, usage, options, stream: client ? sdkStreamer(client) : null })

  const server = createApp({
    routes: [
      ...buildRoutes({ mode: endpoints.mode, conn, rest, options, addon, usage }),
      ...chatRoutes({ chat, store, settings, usage, options, ha }),
    ],
    wwwDir: findWwwDir(),
    access: { mode: endpoints.mode, isAdmin: (id) => admins.isAdmin(id) },
  })

  const port = Number(process.env.PORT) || 8099
  const host = endpoints.mode === 'addon' ? '0.0.0.0' : '127.0.0.1'
  server.listen(port, host, () => {
    log.info(
      `Assistente Claude ${VERSION} avviato su ${host}:${port} — modalità ${endpoints.mode}` +
        (addon?.slug ? `, slug ${addon.slug}` : '') +
        `, chiave Anthropic ${options.anthropicApiKey ? 'configurata' : 'non configurata'}`,
    )
  })

  const shutdown = () => {
    log.info('Arresto in corso')
    conn?.stop()
    server.close(() => process.exit(0))
    setTimeout(() => process.exit(0), 5_000).unref()
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  log.error('Avvio fallito', err)
  process.exit(1)
})
