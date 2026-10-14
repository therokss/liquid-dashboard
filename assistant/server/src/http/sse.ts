import type { IncomingMessage, ServerResponse } from 'node:http'

export interface SseChannel {
  send(event: string, data: unknown, id?: string | number): void
  close(): void
  readonly closed: boolean
  onClose(fn: () => void): void
}

// Server-Sent Events attraverso l'ingress: niente Content-Length, niente cache né
// trasformazioni, heartbeat periodico perché proxy intermedi non chiudano la connessione.
export function openSse(req: IncomingMessage, res: ServerResponse, heartbeatMs = 15_000): SseChannel {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders()
  res.write('retry: 3000\n: aperto\n\n')

  let closed = false
  const closeHandlers: Array<() => void> = []
  const heartbeat = setInterval(() => {
    if (!closed) res.write(': ping\n\n')
  }, heartbeatMs)

  const finish = () => {
    if (closed) return
    closed = true
    clearInterval(heartbeat)
    for (const fn of closeHandlers) {
      try { fn() } catch { /* ignorato */ }
    }
  }
  req.on('close', finish)
  res.on('close', finish)

  return {
    send(event, data, id) {
      if (closed) return
      let frame = ''
      if (id !== undefined) frame += `id: ${id}\n`
      frame += `event: ${event}\n`
      for (const line of JSON.stringify(data).split('\n')) frame += `data: ${line}\n`
      res.write(frame + '\n')
    },
    close() {
      if (closed) return
      finish()
      res.end()
    },
    get closed() {
      return closed
    },
    onClose(fn) {
      if (closed) fn()
      else closeHandlers.push(fn)
    },
  }
}
