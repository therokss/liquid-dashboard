import { readFileSync } from 'node:fs'

export type Mode = 'addon' | 'dev' | 'none'

export interface Endpoints {
  mode: Mode
  wsUrl: string
  restBase: string
  token: string
}

// Il token del Supervisor arriva in env o, con l'immagine base s6, nei file di container_environment
// (stessa ricerca di liquid_dashboard/server.js detectSupervisorToken).
export function detectSupervisorToken(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env.SUPERVISOR_TOKEN || env.HASSIO_TOKEN || ''
  if (fromEnv) return fromEnv
  for (const p of [
    '/var/run/s6/container_environment/SUPERVISOR_TOKEN',
    '/run/s6/container_environment/SUPERVISOR_TOKEN',
    '/var/run/s6/container_environment/HASSIO_TOKEN',
  ]) {
    try {
      const v = readFileSync(p, 'utf8').trim()
      if (v) return v
    } catch { /* file assente fuori dal container */ }
  }
  return ''
}

/**
 * add-on: WS e REST passano dal proxy del Supervisor con il suo token (utente di sistema admin).
 * dev: HA_URL + HA_TOKEN (long-lived token) da .env.local, per lavorare dal Mac.
 */
export function resolveEndpoints(env: NodeJS.ProcessEnv = process.env): Endpoints {
  const supervisorToken = detectSupervisorToken(env)
  if (supervisorToken) {
    return {
      mode: 'addon',
      wsUrl: env.HOMEASSISTANT_WEBSOCKET_API || 'ws://supervisor/core/websocket',
      restBase: 'http://supervisor/core/api',
      token: supervisorToken,
    }
  }
  if (env.HA_URL && env.HA_TOKEN) {
    const base = env.HA_URL.replace(/\/+$/, '')
    return {
      mode: 'dev',
      wsUrl: base.replace(/^http/, 'ws') + '/api/websocket',
      restBase: base + '/api',
      token: env.HA_TOKEN,
    }
  }
  return { mode: 'none', wsUrl: '', restBase: '', token: '' }
}
