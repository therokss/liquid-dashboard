// Persistenza delle dashboard custom + assegnazione per-schermo (versione dashboard/ingress).
// Usa l'API same-origin dell'add-on (in ingress è sempre disponibile).
import type { CustomDashboard } from './types'

function apiBase(): string {
  const { origin, pathname } = window.location
  const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname.replace(/\/[^/]*$/, '')
  return origin + base
}

export interface DashboardsData {
  dashboards: CustomDashboard[]
  deviceMap: Record<string, string>
}

const EMPTY: DashboardsData = { dashboards: [], deviceMap: {} }

export async function loadDashboards(): Promise<DashboardsData> {
  try {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), 4000)
    const r = await fetch(apiBase() + '/api/dashboards', { signal: c.signal })
    clearTimeout(t)
    if (r.ok) {
      const d = await r.json()
      return { dashboards: d.dashboards || [], deviceMap: d.deviceMap || {} }
    }
  } catch { /* non raggiungibile */ }
  return EMPTY
}

async function persist(data: DashboardsData): Promise<boolean> {
  try {
    const r = await fetch(apiBase() + '/api/dashboards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    return r.ok
  } catch {
    return false
  }
}

export async function saveDashboard(d: CustomDashboard): Promise<boolean> {
  const data = await loadDashboards()
  const updated = { ...d, updatedAt: Date.now() }
  const idx = data.dashboards.findIndex((x) => x.id === d.id)
  if (idx >= 0) data.dashboards[idx] = updated
  else data.dashboards.push(updated)
  return persist(data)
}

export async function deleteDashboard(id: string): Promise<boolean> {
  const data = await loadDashboards()
  data.dashboards = data.dashboards.filter((x) => x.id !== id)
  for (const k of Object.keys(data.deviceMap)) if (data.deviceMap[k] === id) delete data.deviceMap[k]
  return persist(data)
}

export async function setDeviceAssignment(screenId: string, dashboardId: string | null): Promise<boolean> {
  const data = await loadDashboards()
  if (dashboardId) data.deviceMap[screenId] = dashboardId
  else delete data.deviceMap[screenId]
  return persist(data)
}
