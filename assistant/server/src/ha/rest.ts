import type { Endpoints } from './env.ts'

export interface RestResponse<T = unknown> {
  status: number
  ok: boolean
  data: T | null
}

// REST di Home Assistant (via proxy del Supervisor nell'add-on). Serve solo dove non c'è
// un comando WebSocket equivalente, es. /api/config/automation/config/<id>.
export class HARest {
  constructor(private readonly endpoints: Endpoints) {}

  async request<T = unknown>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, timeoutMs = 15_000): Promise<RestResponse<T>> {
    if (this.endpoints.mode === 'none') return { status: 0, ok: false, data: null }
    const res = await fetch(this.endpoints.restBase + path, {
      method,
      headers: {
        Authorization: `Bearer ${this.endpoints.token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    let data: T | null = null
    const text = await res.text()
    if (text) {
      try { data = JSON.parse(text) as T } catch { data = text as unknown as T }
    }
    return { status: res.status, ok: res.ok, data }
  }

  get<T = unknown>(path: string, timeoutMs?: number) {
    return this.request<T>('GET', path, undefined, timeoutMs)
  }
}

/** API del Supervisor per l'add-on stesso (slug, versione). Solo in modalità add-on. */
export async function supervisorSelfInfo(token: string): Promise<{ slug: string; version: string } | null> {
  try {
    const res = await fetch('http://supervisor/addons/self/info', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { data?: { slug?: string; version?: string } }
    return { slug: body.data?.slug ?? '', version: body.data?.version ?? '' }
  } catch {
    return null
  }
}
