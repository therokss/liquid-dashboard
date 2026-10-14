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
}

export interface Route {
  method: 'GET' | 'POST'
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
      const route = routes.find((r) => r.path === url.pathname && r.method === req.method)
      if (route) {
        let user: AccessUser | null = null
        if (route.auth) {
          const result = await checkAccess({ remoteAddress: req.socket.remoteAddress, headers: req.headers }, access)
          if (!result.ok) {
            sendJson(res, result.status, { error: result.reason })
            return
          }
          user = result.user
        }
        await route.handler({ req, res, url, user })
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
