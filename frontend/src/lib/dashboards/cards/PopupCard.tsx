// Card "popup": versione compatta che al tocco apre un modale di dettaglio.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useStore } from '../../../store'
import { useHA } from '../../../hooks/useHA'
import { getDomain } from '../../../types/ha'
import { GlassCard } from '../../../components/glass/GlassCard'
import { LightDetailModal } from '../../../components/LightDetailModal'

export function PopupCard({ entityId, title }: { entityId?: string; title?: string }) {
  const [open, setOpen] = useState(false)
  const entity = useStore((s) => (entityId ? s.entities[entityId] : undefined))
  if (!entityId) return null

  const name = title || (entity?.attributes.friendly_name as string) || entityId
  const state = entity?.state ?? '—'
  const unit = entity?.attributes.unit_of_measurement as string | undefined
  const isOn = state === 'on'
  const domain = getDomain(entityId)
  const display = state === 'on' ? 'Acceso' : state === 'off' ? 'Spento' : unit ? `${state} ${unit}` : state

  return (
    <>
      <GlassCard
        active={isOn}
        size="sm"
        style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center', cursor: 'pointer' }}
        onClick={() => setOpen(true)}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>{display}</div>
      </GlassCard>

      {open && entity && (
        domain === 'light'
          ? <LightDetailModal entity={entity} onClose={() => setOpen(false)} />
          : <GenericDetailModal entityId={entityId} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function GenericDetailModal({ entityId, onClose }: { entityId: string; onClose: () => void }) {
  const { callService } = useHA()
  const entity = useStore((s) => s.entities[entityId])
  const domain = getDomain(entityId)
  const name = (entity?.attributes.friendly_name as string) || entityId
  const state = entity?.state ?? 'unavailable'
  const toggleable = state === 'on' || state === 'off'
  const isOn = state === 'on'

  const attrs = Object.entries(entity?.attributes || {})
    .filter(([k]) => !['friendly_name', 'icon', 'supported_features', 'device_class', 'entity_picture'].includes(k))
    .slice(0, 10)

  const toggle = () => {
    const d = domain === 'switch' ? 'switch' : 'homeassistant'
    callService(d, isOn ? 'turn_off' : 'turn_on', { entity_id: entityId })
  }

  return createPortal(
    <motion.div
      data-theme="dark"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3400, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(3,10,20,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#08192b', borderTop: '1px solid var(--glass-border)', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxWidth: 640, width: '100%', margin: '0 auto', maxHeight: '80vh', overflowY: 'auto', padding: 'var(--space-lg) var(--space-lg) calc(env(safe-area-inset-bottom, 0px) + var(--space-lg))' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)' }}>{name}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{entityId}</div>
          </div>
          {toggleable && (
            <label className="glass-toggle" style={{ flexShrink: 0 }}>
              <input type="checkbox" checked={isOn} onChange={toggle} />
              <div className="glass-toggle-track" />
              <div className="glass-toggle-thumb" style={{ transform: isOn ? 'translateX(20px)' : 'translateX(0)' }} />
            </label>
          )}
          <button onClick={onClose} aria-label="Chiudi" style={{ width: 32, height: 32, borderRadius: 10, cursor: 'pointer', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={16} />
          </button>
        </div>
        <div className="glass-panel" style={{ padding: '2px var(--space-lg)' }}>
          {attrs.map(([k, v], i) => (
            <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '10px 0', borderBottom: i < attrs.length - 1 ? '1px solid var(--glass-border-dim)' : 'none' }}>
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>{k}</span>
              <span style={{ fontSize: 13.5, color: 'var(--text-primary)', fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{String(v)}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
