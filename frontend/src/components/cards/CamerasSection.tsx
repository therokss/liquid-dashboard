import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Video, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '../../store'
import { artworkUrl } from '../../lib/media'
import { DeviceControls } from '../DeviceDetailModal'
import { WebRTCPlayer } from '../WebRTCPlayer'
import { useT } from '../../i18n'
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
function streamType(e: HassEntity): string | undefined {
  return (e.attributes as Record<string, unknown>).frontend_stream_type as string | undefined
}

export function CamerasSection() {
  const t = useT()
  const [full, setFull] = useState<HassEntity | null>(null)

  // Solo le videocamere (useShallow): niente render a ogni evento di altre entità.
  const cams = useStore(useShallow((s) => Object.values(s.entities).filter(
    (e) => e.entity_id.startsWith('camera.') && e.state !== 'unavailable' && !s.hiddenEntities[e.entity_id] && !s.userHiddenEntities[e.entity_id],
  )))
  if (cams.length === 0) return null

  return (
    <div style={{ marginBottom: 'var(--space-xl)' }}>
      <div className="text-caption on-wall-dim" style={{ marginBottom: 10 }}>{t('Videocamere')}</div>
      <div className="grid-fluid-lg">
        {cams.map((c) => (
          <button key={c.entity_id} onClick={() => setFull(c)}
            style={{ position: 'relative', padding: 0, border: 'none', borderRadius: 'var(--radius-lg)', overflow: 'hidden', cursor: 'pointer', aspectRatio: '16/9', background: '#0a1622', boxShadow: '0 6px 20px rgba(0,0,0,0.25)' }}>
            {/* Griglia: solo snapshot periodici (niente WebRTC per ogni camera); il video
                live parte nella vista a schermo intero. Col modal aperto la griglia si ferma. */}
            <CameraSnapshot entity={c} paused={full !== null} />
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

const SNAPSHOT_MS = 10000

// Anteprima leggera per la griglia: un'immagine statica ricaricata ogni SNAPSHOT_MS
// (in pausa a scheda nascosta o col modal aperto). In add-on passa dal proxy; in app
// usa entity_picture (URL firmato con token) di HA.
function CameraSnapshot({ entity, paused }: { entity: HassEntity; paused: boolean }) {
  const t = useT()
  const [tick, setTick] = useState(() => Date.now())
  const [err, setErr] = useState(false)

  useEffect(() => {
    if (paused) return
    const i = setInterval(() => {
      if (document.hidden) return
      setErr(false) // riprova al giro successivo anche dopo un errore
      setTick(Date.now())
    }, SNAPSHOT_MS)
    return () => clearInterval(i)
  }, [paused])

  const pic = entity.attributes.entity_picture as string | undefined
  const proxied = localStorage.getItem('ha-ll-use-proxy') === '1'
  const base = proxied ? snapUrl(entity.entity_id, tick) : artworkUrl(pic)
  const src = base && !proxied ? `${base}${base.includes('?') ? '&' : '?'}_t=${tick}` : base

  if (!src || err) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--text-tertiary)' }}>
        <Video size={26} strokeWidth={1.5} />
        <span style={{ fontSize: 12 }}>{t('Anteprima non disponibile')}</span>
      </div>
    )
  }
  return <img src={src} alt="" decoding="async" onError={() => setErr(true)} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
}

// Cascata: WebRTC (video fluido, P2P) → stream MJPEG (via proxy) → snapshot → placeholder.
// Le camere che espongono frontend_stream_type 'hls' partono direttamente da MJPEG.
function CameraView({ entityId, streamType: st }: { entityId: string; streamType?: string }) {
  const t = useT()
  const preferWebRTC = st !== 'hls'
  const [mode, setMode] = useState<'webrtc' | 'mjpeg' | 'snap' | 'err'>(preferWebRTC ? 'webrtc' : 'mjpeg')
  const [tick, setTick] = useState(Date.now())

  useEffect(() => {
    if (mode !== 'snap') return
    const i = setInterval(() => setTick(Date.now()), 5000)
    return () => clearInterval(i)
  }, [mode])

  if (mode === 'webrtc') return <WebRTCPlayer entityId={entityId} onFail={() => setMode('mjpeg')} />
  if (mode === 'err') {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, color: 'var(--text-tertiary)' }}>
        <Video size={26} strokeWidth={1.5} />
        <span style={{ fontSize: 12 }}>{t('Anteprima non disponibile')}</span>
      </div>
    )
  }
  const src = mode === 'mjpeg' ? streamUrl(entityId) : snapUrl(entityId, tick)
  return <img src={src} alt="" onError={() => setMode(mode === 'mjpeg' ? 'snap' : 'err')} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
}

function CameraModal({ entity, onClose }: { entity: HassEntity; onClose: () => void }) {
  const t = useT()
  return (
    <motion.div
      data-theme="dark"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3400, display: 'flex', flexDirection: 'column', overflowY: 'auto', background: 'rgba(3,8,16,0.92)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
    >
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 720, margin: '0 auto', padding: 'calc(env(safe-area-inset-top, 0px) + var(--space-lg)) var(--space-lg) calc(env(safe-area-inset-bottom, 0px) + var(--space-lg))', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Video size={18} color="var(--accent)" />
          <span style={{ flex: 1, color: 'white', fontSize: 17, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{camName(entity)}</span>
          <button onClick={onClose} aria-label={t('Chiudi')} style={{ width: 36, height: 36, borderRadius: 11, cursor: 'pointer', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>
        <div style={{ width: '100%', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: '#0a1622', aspectRatio: '16/9' }}>
          <CameraView entityId={entity.entity_id} streamType={streamType(entity)} />
        </div>
        {/* Controlli del dispositivo videocamera (privacy, luce IR, rilevamenti…) */}
        <DeviceControls entityId={entity.entity_id} />
      </div>
    </motion.div>
  )
}
