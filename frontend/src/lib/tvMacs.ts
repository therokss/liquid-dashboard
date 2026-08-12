// MAC delle TV per il Wake-on-LAN, condivisi lato addon (/api/tv-macs): il MAC è
// una proprietà della TV, non del browser in cui lo hai scritto, quindi vale per
// tutti gli utenti e tutti gli schermi. Chiave = entity_id del media_player.
//
// Il localStorage (store.tvMacs) resta come copia locale: serve da valore iniziale
// mentre la richiesta è in volo e come unica fonte fuori dall'add-on (app, porta
// 8098 senza sessione), dove questi endpoint non rispondono.
import { useStore } from '../store'

function apiBase(): string {
  const { origin, pathname } = window.location
  const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname.replace(/\/[^/]*$/, '')
  return origin + base
}

export async function loadTvMacs(): Promise<Record<string, string> | null> {
  try {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), 4000)
    const r = await fetch(apiBase() + '/api/tv-macs', { signal: c.signal })
    clearTimeout(t)
    if (!r.ok) return null
    const d = await r.json()
    const macs = d?.macs
    return macs && typeof macs === 'object' ? (macs as Record<string, string>) : null
  } catch {
    return null
  }
}

export async function saveTvMac(entityId: string, mac: string): Promise<boolean> {
  try {
    const r = await fetch(apiBase() + '/api/tv-macs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId, mac }),
    })
    return r.ok
  } catch {
    return false
  }
}

// Allinea la copia locale con quella condivisa (senza perdere i MAC che questo
// dispositivo conosce e il server no, es. scritti prima di questa versione).
export async function syncTvMacs(): Promise<void> {
  const remote = await loadTvMacs()
  if (!remote) return
  const local = useStore.getState().tvMacs
  useStore.getState().setTvMacs({ ...local, ...remote })
  for (const [entityId, mac] of Object.entries(local)) {
    if (mac && !remote[entityId]) void saveTvMac(entityId, mac)
  }
}
