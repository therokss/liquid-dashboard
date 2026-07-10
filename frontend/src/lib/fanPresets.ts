// Punti predefiniti (orizzontale/verticale) per i ventilatori con doppio angolo,
// condivisi lato addon (/api/fan-presets): stessa lista su tutti i dispositivi,
// chiave = entity_id del number orizzontale. Chiunque può crearli, non solo admin.

export interface FanPreset {
  id: string
  name: string
  h: number
  v: number
}

function apiBase(): string {
  const { origin, pathname } = window.location
  const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname.replace(/\/[^/]*$/, '')
  return origin + base
}

export async function loadFanPresets(entityId: string): Promise<FanPreset[]> {
  try {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), 4000)
    const r = await fetch(`${apiBase()}/api/fan-presets?entityId=${encodeURIComponent(entityId)}`, { signal: c.signal })
    clearTimeout(t)
    if (!r.ok) return []
    const d = await r.json()
    return Array.isArray(d?.presets) ? (d.presets as FanPreset[]) : []
  } catch {
    return []
  }
}

export async function saveFanPresets(entityId: string, presets: FanPreset[]): Promise<boolean> {
  try {
    const r = await fetch(`${apiBase()}/api/fan-presets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entityId, presets }),
    })
    return r.ok
  } catch {
    return false
  }
}
