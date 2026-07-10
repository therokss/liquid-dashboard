// Preferenze per-utente sincronizzate lato addon (legate all'ID utente ingress),
// così seguono l'utente su tutti i suoi dispositivi invece di restare nel browser.
//
// Escludono: la connessione (hassUrl/setupComplete) e le impostazioni di dispositivo
// (kioskMode → dipende dal singolo schermo, es. tablet a muro).
//
// Degrada in sicurezza: senza gli endpoint /api/user-config (o fuori da ingress),
// le fetch falliscono e si continua con il solo localStorage.
import { useStore } from '../store'

// Solo preferenze PERSONALI (tema, sfondi, visibilità…). La config "della casa"
// (rifiuti, meteo, energia, aree) è condivisa e gestita via /api/prefs (permissions.ts).
const SYNC_KEYS = [
  'wallpapers', 'theme', 'pinnedEntities', 'userHiddenEntities', 'visibilityReviewed',
  'onboardingDone', 'serverExtraEntities', 'language',
] as const

function apiBase(): string {
  const { origin, pathname } = window.location
  const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname.replace(/\/[^/]*$/, '')
  return origin + base
}

type StoreState = ReturnType<typeof useStore.getState>

export function extractSyncConfig(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of SYNC_KEYS) out[k] = state[k]
  return out
}

export function applyUserConfig(config: Record<string, unknown>): void {
  // Applica solo le chiavi definite: una config remota priva di una chiave non
  // deve azzerarla in locale (es. sfondi non presenti nel payload dell'altro device).
  const patch: Record<string, unknown> = {}
  for (const k of Object.keys(config)) if (config[k] !== undefined) patch[k] = config[k]
  useStore.setState(patch as Partial<StoreState>)
}

export interface UserConfigResult { config: Record<string, unknown> | null; hasUser: boolean }

export async function loadUserConfig(): Promise<UserConfigResult> {
  try {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), 4000)
    const r = await fetch(apiBase() + '/api/user-config', { signal: c.signal })
    clearTimeout(t)
    if (!r.ok) return { config: null, hasUser: false }
    const d = await r.json()
    return { config: (d?.config as Record<string, unknown>) ?? null, hasUser: Boolean(d?.user) }
  } catch {
    return { config: null, hasUser: false }
  }
}

export async function saveUserConfig(config: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch(apiBase() + '/api/user-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config }),
    })
    return r.ok
  } catch {
    return false
  }
}

let syncStarted = false
let lastSerialized = ''
let timer: ReturnType<typeof setTimeout> | null = null

// Avvia il salvataggio automatico (debounced) quando cambiano le preferenze.
// Va chiamata DOPO aver applicato l'eventuale config dal server.
export function startUserConfigSync(): void {
  if (syncStarted) return
  syncStarted = true
  lastSerialized = JSON.stringify(extractSyncConfig(useStore.getState() as unknown as Record<string, unknown>))
  useStore.subscribe((state) => {
    const cfg = extractSyncConfig(state as unknown as Record<string, unknown>)
    const s = JSON.stringify(cfg)
    if (s === lastSerialized) return
    lastSerialized = s
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { void saveUserConfig(cfg) }, 800)
  })
}

// Ricarica la config per-utente dal backend e la applica SOLO se è cambiata da
// remoto (un altro dispositivo). Se c'è una modifica locale non ancora salvata,
// vince quella locale. Aggiorna la baseline per non ri-salvarla (niente echo).
export async function pullUserConfig(): Promise<void> {
  if (!syncStarted) return
  const res = await loadUserConfig()
  if (!res.config) return
  const incoming = extractSyncConfig(res.config)
  const remoteStr = JSON.stringify(incoming)
  const currentStr = JSON.stringify(extractSyncConfig(useStore.getState() as unknown as Record<string, unknown>))
  if (remoteStr === currentStr) { lastSerialized = remoteStr; return }
  if (currentStr !== lastSerialized) return // modifica locale in sospeso → non sovrascrivere
  lastSerialized = remoteStr
  applyUserConfig(incoming)
}
