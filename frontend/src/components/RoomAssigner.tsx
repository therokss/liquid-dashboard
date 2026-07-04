import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useStore } from '../store'
import { useHA } from '../hooks/useHA'
import type { HassArea } from '../types/ha'

interface DeviceRow {
  id: string
  name: string
  area_id: string | null
}

interface EntRegItem { entity_id: string; area_id: string | null; device_id: string | null }
interface DevRegItem { id: string; name: string | null; name_by_user: string | null; area_id: string | null }
interface AreaRegItem { area_id: string; name: string }

// Assegna i dispositivi alle stanze (aggiorna il registro dispositivi di HA).
export function RoomAssigner() {
  const { sendMessage } = useHA()
  const areas = useStore((s) => s.areas)
  const [devices, setDevices] = useState<DeviceRow[]>([])
  const [newArea, setNewArea] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const [entReg, devReg, areaReg] = await Promise.all([
      sendMessage<EntRegItem[]>({ type: 'config/entity_registry/list' }),
      sendMessage<DevRegItem[]>({ type: 'config/device_registry/list' }),
      sendMessage<AreaRegItem[]>({ type: 'config/area_registry/list' }),
    ])
    if (areaReg) useStore.getState().setAreas(areaReg as unknown as HassArea[])

    // ricostruisci le mappe per aggiornare la dashboard
    const deviceArea: Record<string, string> = {}
    for (const d of devReg ?? []) if (d.area_id) deviceArea[d.id] = d.area_id
    const areaMap: Record<string, string> = {}
    const entDev: Record<string, string> = {}
    for (const e of entReg ?? []) {
      const area = e.area_id ?? (e.device_id ? deviceArea[e.device_id] : undefined)
      if (area) areaMap[e.entity_id] = area
      if (e.device_id) entDev[e.entity_id] = e.device_id
    }
    useStore.getState().setEntityAreas(areaMap)
    useStore.getState().setEntityDevices(entDev)

    setDevices(
      (devReg ?? [])
        .map((d) => ({ id: d.id, name: d.name_by_user || d.name || d.id, area_id: d.area_id }))
        .sort((a, b) => a.name.localeCompare(b.name))
    )
    setLoading(false)
  }, [sendMessage])

  useEffect(() => { refresh() }, [refresh])

  const assign = async (deviceId: string, areaId: string | null) => {
    setDevices((prev) => prev.map((d) => (d.id === deviceId ? { ...d, area_id: areaId } : d)))
    await sendMessage({ type: 'config/device_registry/update', device_id: deviceId, area_id: areaId }).catch(() => {})
    refresh()
  }

  const createArea = async () => {
    const name = newArea.trim()
    if (!name) return
    setNewArea('')
    await sendMessage({ type: 'config/area_registry/create', name }).catch(() => {})
    refresh()
  }

  const unassignedCount = useMemo(() => devices.filter((d) => !d.area_id).length, [devices])

  return (
    <div>
      {/* Crea nuova stanza */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-md)' }}>
        <input
          className="glass-input"
          placeholder="Nuova stanza…"
          value={newArea}
          onChange={(e) => setNewArea(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') createArea() }}
          style={{ flex: 1 }}
        />
        <button
          onClick={createArea}
          className="glass-btn glass-btn-accent"
          style={{ padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
        >
          <Plus size={16} /> Crea
        </button>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 14, padding: '12px 0' }}>Caricamento dispositivi…</div>
      ) : devices.length === 0 ? (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 14, padding: '12px 0' }}>Nessun dispositivo trovato</div>
      ) : (
        <>
          {unassignedCount > 0 && (
            <div style={{ fontSize: 12, color: '#ffb300', marginBottom: 10 }}>
              {unassignedCount} {unassignedCount === 1 ? 'dispositivo senza stanza' : 'dispositivi senza stanza'}
            </div>
          )}
          <div className="glass-scroll" style={{ maxHeight: 420, overflowY: 'auto' }}>
            {devices.map((d) => (
              <div
                key={d.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  padding: '10px 0', borderBottom: '1px solid var(--glass-border-dim)',
                }}
              >
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.name}
                </span>
                <select
                  className="ld-select"
                  value={d.area_id ?? ''}
                  onChange={(e) => assign(d.id, e.target.value || null)}
                >
                  <option value="">Nessuna</option>
                  {areas.map((a) => (
                    <option key={a.area_id} value={a.area_id}>{a.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
