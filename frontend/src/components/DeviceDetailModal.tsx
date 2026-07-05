import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { useStore } from '../store'
import { useHA } from '../hooks/useHA'
import type { HassEntity } from '../types/ha'

const dom = (id: string) => id.split('.')[0]

const CONTROL_DOMAINS = new Set([
  'light', 'switch', 'fan', 'cover', 'lock', 'number', 'select',
  'input_boolean', 'input_number', 'input_select', 'button', 'input_button', 'siren', 'humidifier',
])
const SENSOR_DOMAINS = new Set(['sensor', 'binary_sensor'])
const IGNORE = new Set(['update', 'device_tracker', 'event', 'scene', 'automation', 'script'])

function commonPrefix(names: string[]): string {
  if (names.length === 0) return ''
  let p = names[0]
  for (const n of names.slice(1)) {
    let i = 0
    while (i < p.length && i < n.length && p[i] === n[i]) i++
    p = p.slice(0, i)
  }
  return p.replace(/[\s\-–—:]+$/, '').trim()
}

export function DeviceDetailModal({ entityId, onClose }: { entityId: string; onClose: () => void }) {
  const entities = useStore((s) => s.entities)
  const entityDevices = useStore((s) => s.entityDevices)
  const { callService } = useHA()

  const { title, controls, sensors } = useMemo(() => {
    const devId = entityDevices[entityId]
    let ids: string[]
    if (devId) ids = Object.entries(entityDevices).filter(([, d]) => d === devId).map(([e]) => e)
    else ids = [entityId]
    const list = ids.map((id) => entities[id]).filter(Boolean) as HassEntity[]
    const usable = list.filter((e) => !IGNORE.has(dom(e.entity_id)))
    const nm = (e: HassEntity) => (e.attributes.friendly_name as string) || e.entity_id
    const prefix = commonPrefix(usable.map(nm))
    const strip = (e: HassEntity) => {
      const n = nm(e)
      const s = prefix && n.startsWith(prefix) ? n.slice(prefix.length).replace(/^[\s\-–—:]+/, '') : n
      return s || n
    }
    const controls = usable.filter((e) => CONTROL_DOMAINS.has(dom(e.entity_id)))
      .map((e) => ({ e, label: strip(e) }))
      .sort((a, b) => a.label.localeCompare(b.label))
    const sensors = usable.filter((e) => SENSOR_DOMAINS.has(dom(e.entity_id)))
      .map((e) => ({ e, label: strip(e) }))
      .sort((a, b) => a.label.localeCompare(b.label))
    return { title: prefix || nm(entities[entityId] ?? ({} as HassEntity)) || 'Dispositivo', controls, sensors }
  }, [entityId, entities, entityDevices])

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
        style={{ background: '#08192b', borderTop: '1px solid var(--glass-border)', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxWidth: 640, width: '100%', margin: '0 auto', maxHeight: '85vh', display: 'flex', flexDirection: 'column', padding: 'var(--space-lg) var(--space-lg) calc(env(safe-area-inset-bottom, 0px) + var(--space-lg))' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</h3>
          <button onClick={onClose} aria-label="Chiudi" style={{ width: 32, height: 32, borderRadius: 10, cursor: 'pointer', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={17} />
          </button>
        </div>

        <div className="glass-scroll" style={{ overflowY: 'auto' }}>
          {controls.length > 0 && (
            <>
              <div className="text-caption" style={{ marginBottom: 8 }}>Controlli</div>
              <div className="glass-panel" style={{ padding: '2px var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
                {controls.map(({ e, label }, i) => (
                  <ControlRow key={e.entity_id} e={e} label={label} callService={callService} last={i === controls.length - 1} />
                ))}
              </div>
            </>
          )}
          {sensors.length > 0 && (
            <>
              <div className="text-caption" style={{ marginBottom: 8 }}>Sensori</div>
              <div className="glass-panel" style={{ padding: '2px var(--space-lg)' }}>
                {sensors.map(({ e, label }, i) => (
                  <div key={e.entity_id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderBottom: i < sensors.length - 1 ? '1px solid var(--glass-border-dim)' : 'none' }}>
                    <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>{label}</span>
                    <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{fmtState(e)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}

type CS = (domain: string, service: string, data: Record<string, unknown>) => Promise<void>

function fmtState(e: HassEntity): string {
  const unit = e.attributes.unit_of_measurement as string | undefined
  const map: Record<string, string> = { on: 'Acceso', off: 'Spento', open: 'Aperto', closed: 'Chiuso', home: 'A casa', not_home: 'Fuori', unavailable: 'Non disp.', unknown: '—' }
  if (unit) { const n = Number(e.state); return `${Number.isFinite(n) ? Math.round(n * 100) / 100 : e.state} ${unit}` }
  return map[e.state] ?? e.state
}

function Row({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: last ? 'none' : '1px solid var(--glass-border-dim)' }}>
      <span style={{ flex: 1, minWidth: 0, fontSize: 14.5, color: 'var(--text-primary)' }}>{label}</span>
      {children}
    </div>
  )
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <label className="glass-toggle" style={{ flexShrink: 0 }}>
      <input type="checkbox" checked={on} onChange={onToggle} />
      <div className="glass-toggle-track" />
      <div className="glass-toggle-thumb" style={{ transform: on ? 'translateX(20px)' : 'translateX(0)' }} />
    </label>
  )
}

function ControlRow({ e, label, callService, last }: { e: HassEntity; label: string; callService: CS; last: boolean }) {
  const domain = dom(e.entity_id)
  const on = e.state === 'on' || e.state === 'locked' || e.state === 'open'

  if (domain === 'number' || domain === 'input_number') {
    const a = e.attributes as Record<string, unknown>
    const min = (a.min as number) ?? 0, max = (a.max as number) ?? 100, step = (a.step as number) ?? 1
    const val = Number(e.state)
    const pct = max > min ? ((val - min) / (max - min)) * 100 : 0
    return (
      <Row label={label} last={last}>
        <input type="range" className="glass-slider" min={min} max={max} step={step} defaultValue={Number.isFinite(val) ? val : min}
          onChange={(ev) => callService(domain, 'set_value', { entity_id: e.entity_id, value: Number(ev.target.value) })}
          style={{ width: 130, background: `linear-gradient(to right, var(--accent) ${pct}%, rgba(255,255,255,0.18) ${pct}%)` }} />
        <span style={{ width: 34, textAlign: 'right', fontSize: 13, color: 'var(--text-secondary)', flexShrink: 0 }}>{Number.isFinite(val) ? val : '—'}</span>
      </Row>
    )
  }
  if (domain === 'select' || domain === 'input_select') {
    const opts = (e.attributes.options as string[] | undefined) ?? []
    return (
      <Row label={label} last={last}>
        <select className="ld-select" value={e.state} onChange={(ev) => callService(domain, 'select_option', { entity_id: e.entity_id, option: ev.target.value })}>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </Row>
    )
  }
  if (domain === 'button' || domain === 'input_button') {
    return (
      <Row label={label} last={last}>
        <button className="glass-btn" style={{ padding: '7px 16px', fontSize: 13 }} onClick={() => callService(domain, 'press', { entity_id: e.entity_id })}>Premi</button>
      </Row>
    )
  }
  if (domain === 'cover') {
    return (
      <Row label={label} last={last}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['open_cover', 'stop_cover', 'close_cover'] as const).map((act, i) => (
            <button key={act} className="glass-btn" style={{ padding: '7px 12px', fontSize: 13 }} onClick={() => callService('cover', act, { entity_id: e.entity_id })}>{['▲', '■', '▼'][i]}</button>
          ))}
        </div>
      </Row>
    )
  }
  if (domain === 'lock') {
    return <Row label={label} last={last}><Toggle on={e.state === 'locked'} onToggle={() => callService('lock', e.state === 'locked' ? 'unlock' : 'lock', { entity_id: e.entity_id })} /></Row>
  }
  if (domain === 'fan') {
    const pct = (e.attributes.percentage as number) ?? null
    return (
      <Row label={label} last={last}>
        {on && pct !== null && (
          <input type="range" className="glass-slider" min={0} max={100} step={(e.attributes.percentage_step as number) ?? 1} defaultValue={pct}
            onChange={(ev) => callService('fan', 'set_percentage', { entity_id: e.entity_id, percentage: Number(ev.target.value) })}
            style={{ width: 110, background: `linear-gradient(to right, var(--accent) ${pct}%, rgba(255,255,255,0.18) ${pct}%)` }} />
        )}
        <Toggle on={on} onToggle={() => callService('homeassistant', on ? 'turn_off' : 'turn_on', { entity_id: e.entity_id })} />
      </Row>
    )
  }
  if (domain === 'light') {
    const bri = (e.attributes.brightness as number) ?? null
    const briPct = bri !== null ? Math.round((bri / 255) * 100) : null
    return (
      <Row label={label} last={last}>
        {on && briPct !== null && (
          <input type="range" className="glass-slider" min={1} max={100} defaultValue={briPct}
            onChange={(ev) => callService('light', 'turn_on', { entity_id: e.entity_id, brightness_pct: Number(ev.target.value) })}
            style={{ width: 110, background: `linear-gradient(to right, var(--accent) ${briPct}%, rgba(255,255,255,0.18) ${briPct}%)` }} />
        )}
        <Toggle on={on} onToggle={() => callService('homeassistant', on ? 'turn_off' : 'turn_on', { entity_id: e.entity_id })} />
      </Row>
    )
  }
  // switch, input_boolean, siren, humidifier → toggle on/off
  return <Row label={label} last={last}><Toggle on={on} onToggle={() => callService('homeassistant', on ? 'turn_off' : 'turn_on', { entity_id: e.entity_id })} /></Row>
}
