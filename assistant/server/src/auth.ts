import type { IncomingHttpHeaders } from 'node:http'
import type { Mode } from './ha/env.ts'

// Accesso solo tramite l'ingress di Home Assistant e solo per gli amministratori.
// Gli header X-Remote-User-* sono affidabili SOLO se la richiesta arriva dal proxy
// ingress del Supervisor (172.30.32.2): da qualunque altro indirizzo si possono falsificare.

export const INGRESS_ADDRESS = '172.30.32.2'

export interface AccessUser {
  id: string
  name: string
  displayName: string
  admin: boolean
}

export type AccessResult =
  | { ok: true; user: AccessUser }
  | { ok: false; status: 401 | 403 | 503; reason: string }

export function normalizeAddress(address: string | undefined): string {
  if (!address) return ''
  return address.startsWith('::ffff:') ? address.slice(7) : address
}

export function isIngressAddress(address: string | undefined): boolean {
  return normalizeAddress(address) === INGRESS_ADDRESS
}

export function isLoopback(address: string | undefined): boolean {
  const a = normalizeAddress(address)
  return a === '127.0.0.1' || a === '::1'
}

function header(headers: IncomingHttpHeaders, name: string): string {
  const v = headers[name]
  return (Array.isArray(v) ? v[0] : v)?.trim() ?? ''
}

export interface AccessDeps {
  mode: Mode
  isAdmin: (userId: string) => Promise<boolean | null>
}

/** Solo l'indirizzo: per i file statici dell'interfaccia (nessun dato di HA). */
export function checkAddress(remoteAddress: string | undefined, mode: Mode): boolean {
  return mode === 'addon' ? isIngressAddress(remoteAddress) : isLoopback(remoteAddress)
}

export async function checkAccess(
  req: { remoteAddress: string | undefined; headers: IncomingHttpHeaders },
  deps: AccessDeps,
): Promise<AccessResult> {
  if (deps.mode !== 'addon') {
    // Sviluppo dal Mac: solo localhost, utente fittizio amministratore.
    if (!isLoopback(req.remoteAddress)) return { ok: false, status: 403, reason: 'solo_localhost' }
    return { ok: true, user: { id: 'dev', name: 'dev', displayName: 'Sviluppo', admin: true } }
  }
  if (!isIngressAddress(req.remoteAddress)) return { ok: false, status: 403, reason: 'non_da_ingress' }
  const id = header(req.headers, 'x-remote-user-id')
  if (!id) return { ok: false, status: 401, reason: 'utente_mancante' }
  const admin = await deps.isAdmin(id)
  if (admin === null) return { ok: false, status: 503, reason: 'verifica_admin_non_disponibile' }
  if (!admin) return { ok: false, status: 403, reason: 'non_admin' }
  return {
    ok: true,
    user: {
      id,
      name: header(req.headers, 'x-remote-user-name'),
      displayName: header(req.headers, 'x-remote-user-display-name') || header(req.headers, 'x-remote-user-name'),
      admin: true,
    },
  }
}
