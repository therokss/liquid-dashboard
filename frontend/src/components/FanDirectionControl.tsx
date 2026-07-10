import { useEffect, useRef, useState } from 'react'
import { Fan, Plus, X } from 'lucide-react'
import type { HassEntity } from '../types/ha'
import { loadFanPresets, saveFanPresets, type FanPreset } from '../lib/fanPresets'

type CS = (domain: string, service: string, data: Record<string, unknown>) => Promise<void>

interface Props {
  hEntity: HassEntity
  vEntity: HassEntity
  callService: CS
}

function numRange(e: HassEntity, fallbackMin: number, fallbackMax: number): { min: number; max: number } {
  const a = e.attributes as Record<string, unknown>
  return { min: (a.min as number) ?? fallbackMin, max: (a.max as number) ?? fallbackMax }
}

// Controllo di direzione per ventilatori con doppio angolo (es. Dreo): pad
// trascinabile che orienta una ventola in prospettiva 3D (CSS rotateX/rotateY,
// nessuna libreria) più punti predefiniti salvabili/richiamabili con un tap.
export function FanDirectionControl({ hEntity, vEntity, callService }: Props) {
  const hRange = numRange(hEntity, -60, 60)
  const vRange = numRange(vEntity, 0, 90)
  const [h, setH] = useState(Number(hEntity.state) || 0)
  const [v, setV] = useState(Number(vEntity.state) || 0)
  const [presets, setPresets] = useState<FanPreset[]>([])
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const padRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const lastSend = useRef(0)

  // Riallinea al valore reale quando lo stato HA cambia da fuori (o cambia device),
  // ma non mentre l'utente sta trascinando (altrimenti l'eco della rete "scatta" il dito).
  useEffect(() => { if (!dragging.current) setH(Number(hEntity.state) || 0) }, [hEntity.entity_id, hEntity.state])
  useEffect(() => { if (!dragging.current) setV(Number(vEntity.state) || 0) }, [vEntity.entity_id, vEntity.state])

  useEffect(() => {
    let alive = true
    void loadFanPresets(hEntity.entity_id).then((p) => { if (alive) setPresets(p) })
    return () => { alive = false }
  }, [hEntity.entity_id])

  function send(nh: number, nv: number, force?: boolean) {
    const now = Date.now()
    if (!force && now - lastSend.current < 120) return
    lastSend.current = now
    void callService('number', 'set_value', { entity_id: hEntity.entity_id, value: nh })
    void callService('number', 'set_value', { entity_id: vEntity.entity_id, value: nv })
  }

  function fromPointer(clientX: number, clientY: number) {
    const el = padRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const px = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    const py = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height))
    const nh = Math.round(hRange.min + px * (hRange.max - hRange.min))
    const nv = Math.round(vRange.min + (1 - py) * (vRange.max - vRange.min))
    setH(nh); setV(nv)
    send(nh, nv)
  }

  function capturePointer(ev: React.PointerEvent<HTMLDivElement>) {
    // iOS Safari a volte non supporta setPointerCapture su alcuni target: il drag
    // funziona comunque via pointermove sul contenitore, quindi l'eccezione si ignora.
    try { (ev.target as Element).setPointerCapture(ev.pointerId) } catch { /* no-op */ }
  }
  function onPointerDown(ev: React.PointerEvent<HTMLDivElement>) {
    dragging.current = true
    capturePointer(ev)
    fromPointer(ev.clientX, ev.clientY)
  }
  function onPointerMove(ev: React.PointerEvent<HTMLDivElement>) {
    if (!dragging.current) return
    fromPointer(ev.clientX, ev.clientY)
  }
  function onPointerUp() {
    if (!dragging.current) return
    dragging.current = false
    send(h, v, true)
  }

  const px = hRange.max > hRange.min ? (h - hRange.min) / (hRange.max - hRange.min) : 0.5
  const py = vRange.max > vRange.min ? 1 - (v - vRange.min) / (vRange.max - vRange.min) : 0.5
  const rotY = (px - 0.5) * 50 // ±25°: inclinazione ottica, non una lettura precisa del grado reale
  const rotX = (py - 0.5) * -40 // ±20°

  function applyPreset(p: FanPreset) {
    setH(p.h); setV(p.v)
    send(p.h, p.v, true)
  }

  async function savePreset() {
    const n = name.trim()
    if (!n) return
    const preset: FanPreset = { id: `${Date.now()}`, name: n, h, v }
    const next = [...presets, preset]
    setPresets(next)
    setAdding(false); setName('')
    await saveFanPresets(hEntity.entity_id, next)
  }

  async function removePreset(id: string) {
    const next = presets.filter((p) => p.id !== id)
    setPresets(next)
    await saveFanPresets(hEntity.entity_id, next)
  }

  return (
    <div className="glass-panel" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span className="text-caption">Direzione</span>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{h}° / {v}°</span>
      </div>

      <div
        ref={padRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'relative', height: 150, borderRadius: 14, touchAction: 'none',
          background: 'radial-gradient(circle at 50% 30%, rgba(255,255,255,0.10), rgba(255,255,255,0.02))',
          border: '1px solid var(--glass-border-dim)', overflow: 'hidden', cursor: 'grab',
          perspective: 400,
        }}
      >
        {presets.map((p) => {
          const mx = hRange.max > hRange.min ? (p.h - hRange.min) / (hRange.max - hRange.min) : 0.5
          const my = vRange.max > vRange.min ? 1 - (p.v - vRange.min) / (vRange.max - vRange.min) : 0.5
          return (
            <div
              key={p.id}
              onPointerDown={(ev) => ev.stopPropagation()}
              onClick={() => (editing ? void removePreset(p.id) : applyPreset(p))}
              title={p.name}
              style={{
                position: 'absolute', left: `${mx * 100}%`, top: `${my * 100}%`, transform: 'translate(-50%, -50%)',
                width: 10, height: 10, borderRadius: '50%',
                background: editing ? '#ff5470' : 'var(--accent)',
                boxShadow: '0 0 0 3px rgba(255,255,255,0.18)', cursor: 'pointer', zIndex: 2,
              }}
            />
          )
        })}
        <div style={{
          position: 'absolute', left: `${px * 100}%`, top: `${py * 100}%`,
          transform: `translate(-50%, -50%) rotateY(${rotY}deg) rotateX(${rotX}deg)`,
          transformStyle: 'preserve-3d',
          transition: dragging.current ? 'none' : 'left 0.25s var(--ease-out), top 0.25s var(--ease-out), transform 0.25s var(--ease-out)',
          width: 42, height: 42, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--accent)', boxShadow: '0 6px 16px rgba(0,0,0,0.35)', pointerEvents: 'none', zIndex: 3,
        }}>
          <Fan size={20} color="white" />
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, alignItems: 'center' }}>
        {presets.map((p) => {
          const active = !editing && p.h === h && p.v === v
          return (
            <button
              key={p.id}
              className={`ld-chip${active ? ' ld-chip-on' : ''}`}
              style={{ display: 'flex', alignItems: 'center', gap: 5 }}
              onClick={() => (editing ? void removePreset(p.id) : applyPreset(p))}
            >
              {p.name}{editing && <X size={12} />}
            </button>
          )
        })}

        {adding ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              autoFocus
              value={name}
              onChange={(ev) => setName(ev.target.value)}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') void savePreset()
                if (ev.key === 'Escape') { setAdding(false); setName('') }
              }}
              placeholder="Nome posizione"
              style={{
                fontSize: 13, padding: '6px 12px', width: 130, borderRadius: 'var(--radius-pill)',
                border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)',
                outline: 'none', fontFamily: 'var(--font-text)',
              }}
            />
            <button className="ld-chip" onClick={() => void savePreset()}>OK</button>
          </div>
        ) : (
          <button className="ld-chip" style={{ display: 'flex', alignItems: 'center', gap: 4 }} onClick={() => setAdding(true)}>
            <Plus size={12} /> Salva
          </button>
        )}

        {presets.length > 0 && (
          <button className="ld-chip" style={{ opacity: 0.75 }} onClick={() => setEditing((e) => !e)}>
            {editing ? 'Fatto' : 'Modifica'}
          </button>
        )}
      </div>
    </div>
  )
}
