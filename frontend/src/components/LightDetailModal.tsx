import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, Sun, Palette, Thermometer, Clapperboard } from 'lucide-react'
import { useStore } from '../store'
import { useHA } from '../hooks/useHA'
import type { HassEntity, LightAttributes } from '../types/ha'

const PRESETS: Array<{ c: string; rgb: [number, number, number] }> = [
  { c: '#ff5a5a', rgb: [255, 70, 70] },
  { c: '#ff9f43', rgb: [255, 140, 40] },
  { c: '#ffd84a', rgb: [255, 210, 60] },
  { c: '#4ad07f', rgb: [70, 200, 120] },
  { c: '#3ad6c5', rgb: [50, 210, 200] },
  { c: '#4aa8ff', rgb: [70, 160, 255] },
  { c: '#8b6bff', rgb: [140, 110, 255] },
  { c: '#ff6bd0', rgb: [255, 110, 210] },
  { c: '#ffd9a8', rgb: [255, 220, 180] },
  { c: '#ffffff', rgb: [255, 255, 255] },
]

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function LightDetailModal({ entity, onClose }: { entity: HassEntity; onClose: () => void }) {
  const { callService } = useHA()
  const entities = useStore((s) => s.entities)
  const attrs = entity.attributes as LightAttributes
  const isOn = entity.state === 'on'
  const name = attrs.friendly_name ?? entity.entity_id
  const briPct = attrs.brightness !== undefined ? Math.round((attrs.brightness / 255) * 100) : 100

  const modes = (attrs.supported_color_modes as string[] | undefined) ?? []
  const supportsColor = modes.some((m) => ['hs', 'rgb', 'rgbw', 'rgbww', 'xy'].includes(m))
  const supportsTemp = modes.includes('color_temp')
  const minK = attrs.min_color_temp_kelvin ?? 2000
  const maxK = attrs.max_color_temp_kelvin ?? 6500
  const curK = (attrs as Record<string, unknown>).color_temp_kelvin as number | undefined

  // Scene collegate: scene che includono questa luce
  const scenes = useMemo(
    () => Object.values(entities).filter(
      (e) => e.entity_id.startsWith('scene.') && Array.isArray(e.attributes.entity_id) &&
        (e.attributes.entity_id as string[]).includes(entity.entity_id)
    ),
    [entities, entity.entity_id],
  )

  const call = (data: Record<string, unknown>) => callService('light', 'turn_on', { entity_id: entity.entity_id, ...data })

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3400, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(3,10,20,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        onClick={(ev) => ev.stopPropagation()}
        style={{ background: '#08192b', borderTop: '1px solid var(--glass-border)', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxWidth: 640, width: '100%', margin: '0 auto', maxHeight: '85vh', overflowY: 'auto', padding: 'var(--space-lg) var(--space-lg) calc(env(safe-area-inset-bottom, 0px) + var(--space-lg))' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: isOn ? 'var(--accent-glow)' : 'var(--glass-bg-active)', color: isOn ? 'var(--accent)' : 'var(--text-secondary)', border: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Sun size={21} />
          </div>
          <h3 style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</h3>
          <label className="glass-toggle" style={{ flexShrink: 0 }}>
            <input type="checkbox" checked={isOn} onChange={() => callService('light', isOn ? 'turn_off' : 'turn_on', { entity_id: entity.entity_id })} />
            <div className="glass-toggle-track" />
            <div className="glass-toggle-thumb" style={{ transform: isOn ? 'translateX(20px)' : 'translateX(0)' }} />
          </label>
          <button onClick={onClose} aria-label="Chiudi" style={{ width: 32, height: 32, borderRadius: 10, cursor: 'pointer', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={17} />
          </button>
        </div>

        {isOn && (
          <>
            {/* Luminosità */}
            <Section icon={<Sun size={15} />} title="Luminosità">
              <input type="range" className="glass-slider" min={1} max={100} defaultValue={briPct}
                onChange={(e) => call({ brightness_pct: Number(e.target.value) })}
                style={{ width: '100%', background: `linear-gradient(to right, var(--accent) ${briPct}%, rgba(255,255,255,0.18) ${briPct}%)` }} />
            </Section>

            {/* Colori */}
            {supportsColor && (
              <Section icon={<Palette size={15} />} title="Colore">
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                  {PRESETS.map((p) => (
                    <button key={p.c} onClick={() => call({ rgb_color: p.rgb })}
                      style={{ width: 32, height: 32, borderRadius: '50%', background: p.c, border: '2px solid rgba(255,255,255,0.15)', cursor: 'pointer', boxShadow: `0 2px 8px ${p.c}66` }} />
                  ))}
                  <label style={{ width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', border: '2px solid var(--glass-border)', background: 'conic-gradient(red, orange, yellow, lime, cyan, blue, magenta, red)', display: 'inline-block', position: 'relative' }}>
                    <input type="color" onChange={(e) => call({ rgb_color: hexToRgb(e.target.value) })} style={{ opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }} />
                  </label>
                </div>
              </Section>
            )}

            {/* Temperatura colore */}
            {supportsTemp && (
              <Section icon={<Thermometer size={15} />} title="Temperatura">
                <input type="range" className="glass-slider" min={minK} max={maxK} step={50} defaultValue={curK ?? Math.round((minK + maxK) / 2)}
                  onChange={(e) => call({ color_temp_kelvin: Number(e.target.value) })}
                  style={{ width: '100%', background: 'linear-gradient(to right, #ffb46b, #fff4e0, #cfe6ff)' }} />
              </Section>
            )}
          </>
        )}

        {/* Scene collegate */}
        {scenes.length > 0 && (
          <Section icon={<Clapperboard size={15} />} title="Scene">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {scenes.map((s) => (
                <button key={s.entity_id} onClick={() => callService('scene', 'turn_on', { entity_id: s.entity_id })}
                  style={{ padding: '9px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 13, fontWeight: 600, background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)' }}>
                  {(s.attributes.friendly_name as string) ?? s.entity_id}
                </button>
              ))}
            </div>
          </Section>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  )
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 'var(--space-lg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 10, color: 'var(--text-secondary)', fontSize: 12.5, fontWeight: 600 }}>
        <span style={{ color: 'var(--accent)' }}>{icon}</span> {title}
      </div>
      {children}
    </div>
  )
}
