import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Video, X } from 'lucide-react'
import { useStore } from '../../store'
import { DeviceControls } from '../DeviceDetailModal'
import type { HassEntity } from '../../types/ha'

function apiBase(): string {
  const { origin, pathname } = window.location
  const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname.replace(/\/[^/]*$/, '')
  return origin + base
}
function streamUrl(entityId: string): string {
  return `${apiBase()}/media-proxy?url=${encodeURIComponent('/api/camera_proxy_stream/' + entityId)}`
}
function snapUrl(entityId: string, t: number): string {
  return `${apiBase()}/media-proxy?url=${encodeURIComponent('/api/camera_proxy/' + entityId)}&_t=${t}`
}
function camName(e: HassEntity): string {
  return (e.attributes.friendly_name as string) ?? e.entity_id
}

export function CamerasSection() {
  const entities = useStore((s) => s.entities)
  const hidden = useStore((s) => s.hiddenEntities)
  const userHidden = useStore((s) => s.userHiddenEntities)
  const [full, setFull] = useState<HassEntity | null>(null)

  const cams = Object.values(entities).filter(
    (e) => e.entity_id.startsWith('camera.') && e.state !== 'unavailable' && !hidden[e.entity_id] && !userHidden[e.entity_id],
  )
  if (cams.length === 0) return null

  return (
    <div style={{ marginBottom: 'var(--space-xl)' }}>
      <div className="text-caption" style={{ marginBottom: 10 }}>Videocamere</div>
      <div className="grid-fluid-lg">
        {cams.map((c) => (
          <button key={c.entity_id} onClick={() => setFull(c)}
            style={{ position: 'relative', padding: 0, border: 'none', borderRadius: 'var(--radius-lg)', overflow: 'hidden', cursor: 'pointer', aspectRatio: '16/9', background: '#0a1622', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
            <CameraImg entityId={c.entity_id} live />
            <div style={{ position: 'absolute', top: 8, left: 8, display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(0,0,0,0.45)', borderRadius: 'var(--radius-pill)', padding: '3px 8px' }}>
              <span className="ld-live-dot" />
              <span style={{ color: 'white', fontSize: 10, fontWeight: 800, letterSpacing: '0.06em' }}>LIVE</span>
            </div>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '18px 12px 8px', background: 'linear-gradient(to top, rgba(0,0,0,0.7), transparent)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Video size={13} color="white" style={{ flexShrink: 0 }} />
              <span style={{ color: 'white', fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{camName(c)}</span>
            </div>
          </button>
        ))}
      </div>

      {createPortal(
        <AnimatePresence>
          {full && <CameraModal entity={full} onClose={() => setFull(null)} />}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

// Prova prima lo stream MJPEG live; se fallisce ripiega sullo snapshot (refresh 5s),
// e solo se anche quello fallisce mostra il placeholder.
function CameraImg({ entityId, live }: { entityId: string; live?: boolean }) {
  const [mode, setMode] = useState<'live' | 'snap' | 'err'>(live ? 'live' : 'snap')
  const [tick, setTick] = useState(Date.now())

  useEffect(() => {
    if (mode !== 'snap') return
    const i = setInterval(() => setTick(Date.now()), 5000)
    return () => clearInterval(i)
  }, [mode])

  if (mode === 'err') {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--text-tertiary)' }}>
        <Video size={26} strokeWidth={1.5} />
        <span style={{ fontSize: 12 }}>Anteprima non disponibile</span>
      </div>
    )
  }
  const src = mode === 'live' ? streamUrl(entityId) : snapUrl(entityId, tick)
  return <img src={src} alt="" onError={() => setMode(mode === 'live' ? 'snap' : 'err')} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
}

function CameraModal({ entity, onClose }: { entity: HassEntity; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3400, display: 'flex', flexDirection: 'column', overflowY: 'auto', background: 'rgba(3,8,16,0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
    >
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 720, margin: '0 auto', padding: 'calc(env(safe-area-inset-top, 0px) + var(--space-lg)) var(--space-lg) calc(env(safe-area-inset-bottom, 0px) + var(--space-lg))', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Video size={18} color="var(--accent)" />
          <span style={{ flex: 1, color: 'white', fontSize: 17, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{camName(entity)}</span>
          <button onClick={onClose} aria-label="Chiudi" style={{ width: 36, height: 36, borderRadius: 11, cursor: 'pointer', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ width: '100%', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: '#0a1622', aspectRatio: '16/9' }}>
          <CameraImg entityId={entity.entity_id} live />
        </div>
        {/* Controlli del dispositivo videocamera (privacy, luce IR, rilevamenti…) */}
        <DeviceControls entityId={entity.entity_id} />
      </div>
    </motion.div>
  )
}
