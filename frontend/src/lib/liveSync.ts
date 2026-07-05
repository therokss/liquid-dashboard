// Sync "live" bidirezionale tra i dispositivi (dashboard ⇄ app).
//
// Interroga un endpoint leggerissimo /api/config-version (solo i timestamp dei file
// di config lato addon) ogni POLL_MS e al ritorno in primo piano. Solo quando un
// timestamp CAMBIA si ricarica la config piena — così non riscarichiamo i MB degli
// sfondi a vuoto a ogni giro. Risultato: una modifica su un dispositivo compare
// sull'altro entro pochi secondi, senza ricaricare a mano.
import { pullPrefs } from './permissions'
import { pullUserConfig } from './userConfig'

interface ConfigVersion { prefs: number; userConfig: number }

function apiBase(): string {
  const { origin, pathname } = window.location
  const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname.replace(/\/[^/]*$/, '')
  return origin + base
}

async function fetchVersion(): Promise<ConfigVersion | null> {
  try {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), 4000)
    const r = await fetch(apiBase() + '/api/config-version', { signal: c.signal })
    clearTimeout(t)
    if (!r.ok) return null
    return (await r.json()) as ConfigVersion
  } catch {
    return null
  }
}

let started = false
let lastPrefs = -1
let lastUser = -1
let inFlight = false

async function tick(): Promise<void> {
  if (inFlight) return
  inFlight = true
  try {
    const v = await fetchVersion()
    if (!v) return
    if (lastPrefs < 0) { lastPrefs = v.prefs; lastUser = v.userConfig; return } // baseline iniziale
    if (v.prefs !== lastPrefs) { lastPrefs = v.prefs; await pullPrefs() }
    if (v.userConfig !== lastUser) { lastUser = v.userConfig; await pullUserConfig() }
  } finally {
    inFlight = false
  }
}

const POLL_MS = 10000

export function startLiveSync(): void {
  if (started) return
  started = true
  setInterval(() => { void tick() }, POLL_MS)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void tick() })
  window.addEventListener('focus', () => { void tick() })
}
