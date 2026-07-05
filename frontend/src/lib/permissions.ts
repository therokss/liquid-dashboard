// Preferenze condivise lato addon (/api/prefs):
//  - permissions: cosa possono modificare i non-admin
//  - house: configurazione "della casa" (rifiuti, meteo, energia, aree) impostata
//    dall'admin e vista da TUTTI gli utenti (non è una preferenza personale).
import { useStore } from '../store'

export interface Capability {
  key: string
  label: string
  desc: string
}

export const CAPABILITIES: Capability[] = [
  { key: 'rooms', label: 'Assegna stanze', desc: 'Spostare i dispositivi tra le stanze' },
  { key: 'visibility', label: 'Visibilità dispositivi', desc: 'Mostrare o nascondere le entità' },
  { key: 'appearance', label: 'Aspetto', desc: 'Tema ed effetto vetro' },
  { key: 'wallpapers', label: 'Sfondi', desc: 'Caricare gli sfondi' },
  { key: 'reset', label: 'Riconfigura dashboard', desc: 'Azzerare e riconfigurare la dashboard' },
]

// Config della casa (condivisa fra tutti gli utenti, gestita dall'admin)
export const HOUSE_KEYS = [
  'enabledAreas',
  'weatherEnabled', 'weatherEntity', 'externalTempSource', 'calendarEnabled', 'calendarEntities',
  'energyEnabled', 'energyPowerEntity',
  'wasteEnabled', 'wasteSchedule', 'wasteInterval', 'wasteAnchor',
] as const

type StoreState = ReturnType<typeof useStore.getState>

export function canModify(cap: string, isAdmin: boolean, perms: Record<string, boolean>): boolean {
  if (isAdmin) return true
  return perms[cap] !== false
}

function apiBase(): string {
  const { origin, pathname } = window.location
  const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname.replace(/\/[^/]*$/, '')
  return origin + base
}

export interface Prefs {
  permissions: Record<string, boolean> | null
  house: Record<string, unknown> | null
}

export async function loadPrefs(): Promise<Prefs> {
  try {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), 4000)
    const r = await fetch(apiBase() + '/api/prefs', { signal: c.signal })
    clearTimeout(t)
    if (!r.ok) return { permissions: null, house: null }
    const d = await r.json()
    return {
      permissions: (d?.permissions as Record<string, boolean>) ?? null,
      house: (d?.house as Record<string, unknown>) ?? null,
    }
  } catch {
    return { permissions: null, house: null }
  }
}

// Salva permessi e/o config casa (il server accetta solo dagli amministratori).
export async function savePrefs(body: { permissions?: Record<string, boolean>; house?: Record<string, unknown> }): Promise<Prefs | null> {
  try {
    const r = await fetch(apiBase() + '/api/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) return null
    const d = await r.json()
    return {
      permissions: (d?.permissions as Record<string, boolean>) ?? null,
      house: (d?.house as Record<string, unknown>) ?? null,
    }
  } catch {
    return null
  }
}

export async function savePermissions(permissions: Record<string, boolean>): Promise<Record<string, boolean> | null> {
  const res = await savePrefs({ permissions })
  return res?.permissions ?? null
}

export function extractHouse(state: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of HOUSE_KEYS) out[k] = state[k]
  return out
}

export function applyHouse(house: Record<string, unknown>): void {
  // applica solo le chiavi note della casa
  const patch: Record<string, unknown> = {}
  for (const k of HOUSE_KEYS) if (k in house) patch[k] = house[k]
  useStore.setState(patch as Partial<StoreState>)
}

let houseSyncStarted = false
let lastHouse = ''
let houseTimer: ReturnType<typeof setTimeout> | null = null

// Salvataggio automatico della config casa (solo admin: il server rifiuta gli altri).
export function startHouseSync(): void {
  if (houseSyncStarted) return
  houseSyncStarted = true
  lastHouse = JSON.stringify(extractHouse(useStore.getState() as unknown as Record<string, unknown>))
  useStore.subscribe((state) => {
    if (!useStore.getState().isAdmin) return
    const house = extractHouse(state as unknown as Record<string, unknown>)
    const s = JSON.stringify(house)
    if (s === lastHouse) return
    lastHouse = s
    if (houseTimer) clearTimeout(houseTimer)
    houseTimer = setTimeout(() => { void savePrefs({ house }) }, 800)
  })
}
