import { WebSocketServer, type WebSocket } from 'ws'
import type { AddressInfo } from 'node:net'

type Json = Record<string, any>

// Finto Home Assistant per i test: protocollo di auth, risposte per tipo di comando,
// registro di tutti i comandi ricevuti. Solo dati sintetici (il repo è pubblico).
export interface MockHa {
  url: string
  received: Json[]
  sockets: Set<WebSocket>
  handlers: Record<string, (msg: Json, ws: WebSocket) => unknown>
  dropAll(): void
  close(): Promise<void>
}

export async function startMockHa(opts: { token?: string } = {}): Promise<MockHa> {
  const token = opts.token ?? 'token-di-test'
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>((r) => wss.once('listening', () => r()))
  const port = (wss.address() as AddressInfo).port
  const received: Json[] = []
  const sockets = new Set<WebSocket>()
  const handlers: MockHa['handlers'] = {}

  wss.on('connection', (ws) => {
    sockets.add(ws)
    ws.on('close', () => sockets.delete(ws))
    ws.send(JSON.stringify({ type: 'auth_required', ha_version: '2026.9.3' }))
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString()) as Json
      if (msg.type === 'auth') {
        ws.send(JSON.stringify(msg.access_token === token ? { type: 'auth_ok', ha_version: '2026.9.3' } : { type: 'auth_invalid', message: 'Invalid access token' }))
        return
      }
      received.push(msg)
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ id: msg.id, type: 'pong' }))
        return
      }
      const h = handlers[msg.type]
      if (!h) {
        ws.send(JSON.stringify({ id: msg.id, type: 'result', success: false, error: { code: 'unknown_command', message: 'Unknown command.' } }))
        return
      }
      Promise.resolve()
        .then(() => h(msg, ws))
        .then(
          (result) => ws.send(JSON.stringify({ id: msg.id, type: 'result', success: true, result: result ?? null })),
          (err) => ws.send(JSON.stringify({ id: msg.id, type: 'result', success: false, error: { code: 'home_assistant_error', message: (err as Error).message } })),
        )
    })
  })

  return {
    url: `ws://127.0.0.1:${port}`,
    received,
    sockets,
    handlers,
    dropAll() {
      for (const s of sockets) s.terminate()
    },
    close: () =>
      new Promise((r) => {
        for (const s of sockets) s.terminate()
        wss.close(() => r())
      }),
  }
}
