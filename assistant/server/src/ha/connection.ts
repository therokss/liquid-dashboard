import { log } from '../log.ts'

// Una sola WebSocket persistente verso Home Assistant: risposte associate per id,
// sottoscrizioni, ping periodico e riconnessione con backoff. Sostituisce le connessioni
// "apri-comanda-chiudi" di liquid_dashboard/server.js (haCommandsSequential).

export type ConnState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'auth_failed'

type Json = Record<string, unknown>

interface WsLike {
  send(data: string): void
  close(): void
  addEventListener(type: string, listener: (ev: any) => void): void
}

export type WebSocketCtor = new (url: string) => WsLike

export class HAError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

export interface HAConnectionOptions {
  url: string
  token: string
  WebSocketImpl?: WebSocketCtor
  requestTimeoutMs?: number
  minBackoffMs?: number
  maxBackoffMs?: number
  pingIntervalMs?: number
}

export class HAConnection {
  state: ConnState = 'idle'
  haVersion: string | null = null
  lastError: string | null = null

  private readonly opts: Required<Omit<HAConnectionOptions, 'WebSocketImpl'>> & { WebSocketImpl: WebSocketCtor }
  private ws: WsLike | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly subs = new Map<number, (event: unknown) => void>()
  private readonly listeners = new Set<(s: ConnState) => void>()
  private backoff: number
  private stopped = true
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null

  constructor(options: HAConnectionOptions) {
    const Impl = options.WebSocketImpl ?? (globalThis.WebSocket as unknown as WebSocketCtor | undefined)
    if (!Impl) throw new Error('WebSocket non disponibile: serve Node 22 o superiore')
    this.opts = {
      url: options.url,
      token: options.token,
      WebSocketImpl: Impl,
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
      minBackoffMs: options.minBackoffMs ?? 1_000,
      maxBackoffMs: options.maxBackoffMs ?? 60_000,
      pingIntervalMs: options.pingIntervalMs ?? 30_000,
    }
    this.backoff = this.opts.minBackoffMs
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    this.teardown(new HAError('stopped', 'Connessione chiusa'))
    this.setState('idle')
  }

  onState(fn: (s: ConnState) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Attende la connessione autenticata (o fallisce dopo timeoutMs). */
  waitReady(timeoutMs = 10_000): Promise<void> {
    if (this.state === 'connected') return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off()
        reject(new HAError('not_connected', `Home Assistant non raggiungibile (${this.lastError ?? this.state})`))
      }, timeoutMs)
      const off = this.onState((s) => {
        if (s === 'connected') {
          clearTimeout(timer)
          off()
          resolve()
        }
      })
    })
  }

  /** Invia un comando e restituisce il campo result della risposta. */
  sendMessage<T = unknown>(msg: Json, timeoutMs = this.opts.requestTimeoutMs): Promise<T> {
    if (this.state !== 'connected' || !this.ws) {
      return Promise.reject(new HAError('not_connected', 'Home Assistant non connesso'))
    }
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new HAError('timeout', `Nessuna risposta a ${String(msg.type)} entro ${timeoutMs} ms`))
      }, timeoutMs)
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer })
      this.ws!.send(JSON.stringify({ ...msg, id }))
    })
  }

  /** Sottoscrizione: restituisce la funzione che la chiude (unsubscribe_events). */
  async subscribe(msg: Json, onEvent: (event: unknown) => void, timeoutMs?: number): Promise<() => Promise<void>> {
    if (this.state !== 'connected' || !this.ws) throw new HAError('not_connected', 'Home Assistant non connesso')
    const id = this.nextId
    this.subs.set(id, onEvent)
    try {
      await this.sendMessage(msg, timeoutMs)
    } catch (err) {
      this.subs.delete(id)
      throw err
    }
    return async () => {
      if (!this.subs.delete(id)) return
      if (this.state === 'connected') {
        await this.sendMessage({ type: 'unsubscribe_events', subscription: id }).catch(() => undefined)
      }
    }
  }

  private setState(s: ConnState): void {
    if (this.state === s) return
    this.state = s
    for (const fn of this.listeners) {
      try { fn(s) } catch { /* listener difettoso: si ignora */ }
    }
  }

  private connect(): void {
    if (this.stopped) return
    this.setState('connecting')
    let ws: WsLike
    try {
      ws = new this.opts.WebSocketImpl(this.opts.url)
    } catch (err) {
      this.lastError = (err as Error).message
      this.scheduleReconnect()
      return
    }
    this.ws = ws
    ws.addEventListener('message', (ev) => this.handleMessage(ws, ev.data))
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return
      this.teardown(new HAError('connection_lost', 'Connessione a Home Assistant persa'))
      if (this.state !== 'auth_failed') this.setState('disconnected')
      this.scheduleReconnect()
    })
    ws.addEventListener('error', (ev) => {
      this.lastError = ev?.message ?? 'errore WebSocket'
    })
  }

  private handleMessage(ws: WsLike, data: unknown): void {
    let msg: Json
    try {
      msg = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer)) as Json
    } catch {
      return
    }
    switch (msg.type) {
      case 'auth_required':
        ws.send(JSON.stringify({ type: 'auth', access_token: this.opts.token }))
        return
      case 'auth_ok':
        this.haVersion = typeof msg.ha_version === 'string' ? msg.ha_version : null
        this.lastError = null
        this.backoff = this.opts.minBackoffMs
        this.setState('connected')
        this.startPing()
        return
      case 'auth_invalid':
        this.lastError = typeof msg.message === 'string' ? msg.message : 'token rifiutato'
        log.error('Home Assistant ha rifiutato il token', this.lastError)
        this.setState('auth_failed')
        ws.close()
        return
      case 'result':
      case 'pong': {
        const p = this.pending.get(msg.id as number)
        if (!p) return
        this.pending.delete(msg.id as number)
        clearTimeout(p.timer)
        if (msg.type === 'pong' || msg.success) {
          p.resolve(msg.result)
        } else {
          const e = (msg.error ?? {}) as Json
          p.reject(new HAError(String(e.code ?? 'unknown_error'), String(e.message ?? 'Errore di Home Assistant')))
        }
        return
      }
      case 'event':
        this.subs.get(msg.id as number)?.(msg.event)
        return
    }
  }

  private startPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = setInterval(() => {
      this.sendMessage({ type: 'ping' }, 10_000).catch(() => {
        // Nessun pong: la connessione è morta senza close, la si forza.
        this.ws?.close()
      })
    }, this.opts.pingIntervalMs)
  }

  private teardown(reason: HAError): void {
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.pingTimer = null
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(reason)
    }
    this.pending.clear()
    this.subs.clear()
    const ws = this.ws
    this.ws = null
    try { ws?.close() } catch { /* già chiusa */ }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return
    // Con il token rifiutato non serve insistere: si riprova al ritmo minimo.
    const delay = this.state === 'auth_failed' ? this.opts.maxBackoffMs : this.backoff
    this.backoff = Math.min(this.backoff * 2, this.opts.maxBackoffMs)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }
}
