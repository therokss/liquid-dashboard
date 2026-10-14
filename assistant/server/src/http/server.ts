import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { createReadStream, promises as fs } from 'node:fs'
import { extname, join, normalize, sep } from 'node:path'
import { checkAccess, checkAddress, type AccessDeps, type AccessUser } from '../auth.ts'
import { log } from '../log.ts'

export interface RouteContext {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  user: AccessUser | null
  /** Segmenti `:nome` del percorso della route. */
  params: Record<string, string>
}

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /** Percorso esatto, con eventuali segmenti `:nome` (es. /api/chat/:id). */
  path: string
  /** false solo per /healthz (watchdog del Supervisor). */
  auth: boolean
  handler: (ctx: RouteContext) => Promise<void> | void
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(text),
  })
  res.end(text)
}

export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
  }
}

/** Corpo JSON della richiesta, con limite di dimensione. */
export async function readJsonBody<T = unknown>(req: IncomingMessage, limitBytes = 64 * 1024): Promise<T> {
  const type = String(req.headers['content-type'] ?? '')
  if (!type.startsWith('application/json')) throw new HttpError(415, 'serve_json')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limitBytes) throw new HttpError(413, 'corpo_troppo_grande')
    chunks.push(chunk as Buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as T
  } catch {
    throw new HttpError(400, 'json_non_valido')
  }
}

function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const a = pattern.split('/')
  const b = pathname.split('/')
  if (a.length !== b.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < a.length; i++) {
    const seg = a[i]!
    if (seg.startsWith(':')) {
      if (!b[i]) return null
      params[seg.slice(1)] = decodeURIComponent(b[i]!)
    } else if (seg !== b[i]) {
      return null
    }
  }
  return params
}

async function serveStatic(wwwDir: string, pathname: string, res: ServerResponse): Promise<void> {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1))
  const file = normalize(join(wwwDir, rel))
  if (!file.startsWith(normalize(wwwDir) + sep) && file !== normalize(join(wwwDir, 'index.html'))) {
    sendJson(res, 400, { error: 'percorso_non_valido' })
    return
  }
  let stat
  try {
    stat = await fs.stat(file)
  } catch {
    sendJson(res, 404, { error: 'non_trovato' })
    return
  }
  if (!stat.isFile()) {
    sendJson(res, 404, { error: 'non_trovato' })
    return
  }
  const isAsset = rel.startsWith('assets/')
  res.writeHead(200, {
    'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    // index.html mai in cache (l'ingress di HA altrimenti mostra la build vecchia dopo un update);
    // gli asset hanno l'hash nel nome e possono restare in cache.
    'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(file).pipe(res)
}

export function createApp(opts: { routes: Route[]; wwwDir: string; access: AccessDeps }): Server {
  const { routes, wwwDir, access } = opts
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      let params: Record<string, string> | null = null
      const route = routes.find((r) => r.method === req.method && (params = matchPath(r.path, url.pathname)) !== null)
      if (route) {
        // Le richieste che cambiano qualcosa devono portare un header personalizzato: un sito
        // esterno non può aggiungerlo senza preflight CORS (che qui non viene mai concesso).
        if (req.method !== 'GET' && req.headers['x-assistente'] !== '1') {
          sendJson(res, 403, { error: 'header_mancante' })
          return
        }
        let user: AccessUser | null = null
        if (route.auth) {
          const result = await checkAccess({ remoteAddress: req.socket.remoteAddress, headers: req.headers }, access)
          if (!result.ok) {
            sendJson(res, result.status, { error: result.reason })
            return
          }
          user = result.user
        }
        try {
          await route.handler({ req, res, url, user, params: params ?? {} })
        } catch (err) {
          if (!(err instanceof HttpError)) throw err
          if (!res.headersSent) sendJson(res, err.status, { error: err.code })
        }
        return
      }
      if (url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { error: 'api_sconosciuta' })
        return
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'metodo_non_ammesso' })
        return
      }
      if (!checkAddress(req.socket.remoteAddress, access.mode)) {
        sendJson(res, 403, { error: 'non_da_ingress' })
        return
      }
      await serveStatic(wwwDir, url.pathname, res)
    } catch (err) {
      log.error('Errore nella richiesta', err)
      if (!res.headersSent) sendJson(res, 500, { error: 'errore_interno' })
      else res.end()
    }
  })
}
