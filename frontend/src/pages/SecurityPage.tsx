import { useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  DoorOpen, DoorClosed, Blinds, Warehouse, Shield, ShieldCheck, ShieldAlert, ShieldOff,
  Lock, Unlock, Activity, Flame, Droplets, Wind, AlertTriangle, ShieldQuestion,
} from 'lucide-react'
import { useStore } from '../store'
import { useHA } from '../hooks/useHA'
import { CamerasSection } from '../components/cards/CamerasSection'
import type { HassEntity } from '../types/ha'

const dom = (id: string) => id.split('.')[0]
const dc = (e: HassEntity) => (e.attributes as Record<string, unknown>).device_class as string | undefined
const nameOf = (e: HassEntity) => ((e.attributes as Record<string, unknown>).friendly_name as string) || e.entity_id

const OPEN_DC = new Set(['door', 'window', 'garage_door', 'opening'])
const MOTION_DC = new Set(['motion', 'occupancy', 'presence', 'moving'])
// Nota: niente 'problem' — è troppo generico e catturerebbe sensori di "salute"
// (es. VM/dischi di Proxmox) che non c'entrano con la sicurezza.
const DETECT_DC = new Set(['smoke', 'gas', 'carbon_monoxide', 'moisture', 'safety', 'tamper'])

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 'var(--space-xl)' }}>
      <div className="text-caption" style={{ marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  )
}

// ---- Allarme -----------------------------------------------------------------
const ALARM: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  disarmed: { label: 'Disattivato', color: 'var(--text-secondary)', icon: <ShieldOff size={22} /> },
  armed_home: { label: 'Attivo · In casa', color: '#34d399', icon: <ShieldCheck size={22} /> },
  armed_away: { label: 'Attivo · Fuori casa', color: '#34d399', icon: <ShieldCheck size={22} /> },
  armed_night: { label: 'Attivo · Notte', color: '#34d399', icon: <ShieldCheck size={22} /> },
  armed_vacation: { label: 'Attivo · Vacanza', color: '#34d399', icon: <ShieldCheck size={22} /> },
  arming: { label: 'In attivazione…', color: '#fbbf24', icon: <Shield size={22} /> },
  pending: { label: 'In attesa…', color: '#fbbf24', icon: <Shield size={22} /> },
  triggered: { label: 'ALLARME!', color: '#ff5a5f', icon: <ShieldAlert size={22} /> },
}

function AlarmCard({ e }: { e: HassEntity }) {
  const { callService } = useHA()
  const info = ALARM[e.state] ?? { label: e.state, color: 'var(--text-secondary)', icon: <ShieldQuestion size={22} /> }
  const call = (service: string) => callService('alarm_control_panel', service, { entity_id: e.entity_id })
  const isArmed = e.state.startsWith('armed') || e.state === 'triggered'
  const btn = (label: string, service: string, accent?: boolean) => (
    <button className={accent ? 'glass-btn glass-btn-accent' : 'glass-btn'} style={{ flex: 1, padding: '9px 8px', fontSize: 13 }} onClick={() => call(service)}>
      {label}
    </button>
  )
  return (
    <div className="glass-card" style={{ padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ color: info.color, flexShrink: 0 }}>{info.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(e)}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: info.color }}>{info.label}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {isArmed
          ? btn('Disattiva', 'alarm_disarm', true)
          : (<>{btn('In casa', 'alarm_arm_home')}{btn('Fuori casa', 'alarm_arm_away', true)}</>)}
      </div>
    </div>
  )
}

// ---- Liste stato (porte/finestre, movimento, rilevatori) ---------------------
interface StatusItem { id: string; name: string; room?: string; state: string; alert: boolean; icon: React.ReactNode }

function StatusList({ items }: { items: StatusItem[] }) {
  return (
    <div className="glass-panel" style={{ padding: '2px var(--space-lg)' }}>
      {items.map((it, i) => (
        <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: i < items.length - 1 ? '1px solid var(--glass-border-dim)' : 'none' }}>
          <div style={{ color: it.alert ? '#ff5a5f' : 'var(--text-tertiary)', flexShrink: 0, display: 'flex' }}>{it.icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</div>
            {it.room && <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{it.room}</div>}
          </div>
          <span style={{ fontSize: 12.5, fontWeight: 700, flexShrink: 0, color: it.alert ? '#ff5a5f' : 'var(--text-secondary)', background: it.alert ? 'rgba(255,90,95,0.14)' : 'var(--glass-bg)', border: `1px solid ${it.alert ? 'rgba(255,90,95,0.3)' : 'var(--glass-border)'}`, borderRadius: 'var(--radius-pill)', padding: '3px 10px' }}>{it.state}</span>
        </div>
      ))}
    </div>
  )
}

function LockRow({ e, last }: { e: HassEntity; last: boolean }) {
  const { callService } = useHA()
  const locked = e.state === 'locked'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: last ? 'none' : '1px solid var(--glass-border-dim)' }}>
      <div style={{ color: locked ? '#34d399' : '#ff5a5f', flexShrink: 0, display: 'flex' }}>{locked ? <Lock size={19} /> : <Unlock size={19} />}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14.5, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOf(e)}</div>
        <div style={{ fontSize: 12, color: locked ? '#34d399' : '#ff5a5f' }}>{locked ? 'Bloccata' : 'Sbloccata'}</div>
      </div>
      <button className={locked ? 'glass-btn' : 'glass-btn glass-btn-accent'} style={{ padding: '8px 16px', fontSize: 13, flexShrink: 0 }}
        onClick={() => callService('lock', locked ? 'unlock' : 'lock', { entity_id: e.entity_id })}>
        {locked ? 'Sblocca' : 'Blocca'}
      </button>
    </div>
  )
}

export function SecurityPage() {
  const entities = useStore((s) => s.entities)
  const areas = useStore((s) => s.areas)
  const entityAreas = useStore((s) => s.entityAreas)
  const hidden = useStore((s) => s.hiddenEntities)
  const userHidden = useStore((s) => s.userHiddenEntities)

  const roomName = useMemo(() => {
    const byId: Record<string, string> = {}
    for (const a of areas) byId[a.area_id] = a.name
    return (id: string) => byId[entityAreas[id]] || undefined
  }, [areas, entityAreas])

  const visible = useMemo(
    () => Object.values(entities).filter((e) => !hidden[e.entity_id] && !userHidden[e.entity_id]),
    [entities, hidden, userHidden],
  )

  const alarms = visible.filter((e) => e.entity_id.startsWith('alarm_control_panel.'))
  const locks = visible.filter((e) => dom(e.entity_id) === 'lock').sort((a, b) => nameOf(a).localeCompare(nameOf(b)))

  const openables = useMemo(() => {
    const openIcon = (klass?: string, on?: boolean) => {
      if (klass === 'window') return <Blinds size={19} />
      if (klass === 'garage_door') return <Warehouse size={19} />
      return on ? <DoorOpen size={19} /> : <DoorClosed size={19} />
    }
    return visible
      .filter((e) => dom(e.entity_id) === 'binary_sensor' && OPEN_DC.has(dc(e) || ''))
      .map((e): StatusItem => ({ id: e.entity_id, name: nameOf(e), room: roomName(e.entity_id), alert: e.state === 'on', state: e.state === 'on' ? 'Aperto' : 'Chiuso', icon: openIcon(dc(e), e.state === 'on') }))
      .sort((a, b) => Number(b.alert) - Number(a.alert) || a.name.localeCompare(b.name))
  }, [visible, roomName])

  const motionSensors = useMemo(() =>
    visible
      .filter((e) => dom(e.entity_id) === 'binary_sensor' && MOTION_DC.has(dc(e) || ''))
      .map((e): StatusItem => ({ id: e.entity_id, name: nameOf(e), room: roomName(e.entity_id), alert: e.state === 'on', state: e.state === 'on' ? 'Rilevato' : 'Libero', icon: <Activity size={19} /> }))
      .sort((a, b) => Number(b.alert) - Number(a.alert) || a.name.localeCompare(b.name)),
  [visible, roomName])

  const detectors = useMemo(() => {
    const dIcon = (klass?: string) => {
      if (klass === 'smoke') return <Flame size={19} />
      if (klass === 'gas' || klass === 'carbon_monoxide') return <Wind size={19} />
      if (klass === 'moisture') return <Droplets size={19} />
      return <AlertTriangle size={19} />
    }
    const label = (on: boolean, klass?: string) => {
      if (!on) return 'Ok'
      if (klass === 'smoke') return 'Fumo!'
      if (klass === 'gas') return 'Gas!'
      if (klass === 'carbon_monoxide') return 'CO!'
      if (klass === 'moisture') return 'Perdita!'
      return 'Allerta'
    }
    return visible
      .filter((e) => dom(e.entity_id) === 'binary_sensor' && DETECT_DC.has(dc(e) || ''))
      .map((e): StatusItem => ({ id: e.entity_id, name: nameOf(e), room: roomName(e.entity_id), alert: e.state === 'on', state: label(e.state === 'on', dc(e)), icon: dIcon(dc(e)) }))
      .sort((a, b) => Number(b.alert) - Number(a.alert) || a.name.localeCompare(b.name))
  }, [visible, roomName])

  const cams = visible.filter((e) => e.entity_id.startsWith('camera.') && e.state !== 'unavailable')
  const openCount = openables.filter((o) => o.alert).length
  const hasAny = alarms.length || cams.length || openables.length || motionSensors.length || locks.length || detectors.length

  return (
    <div className="page">
      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 34, fontWeight: 800, color: 'var(--on-wallpaper)', letterSpacing: '-0.04em' }}>
          Sicurezza
        </h1>
        {openables.length > 0 && (
          <p style={{ color: openCount > 0 ? '#ff5a5f' : 'var(--text-secondary)', fontSize: 14, marginTop: 2, fontWeight: openCount > 0 ? 600 : 400 }}>
            {openCount === 0 ? 'Tutto chiuso' : `${openCount} ${openCount === 1 ? 'apertura' : 'aperture'} da controllare`}
          </p>
        )}
      </div>

      {alarms.length > 0 && (
        <Section title="Allarme">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {alarms.map((e) => <AlarmCard key={e.entity_id} e={e} />)}
          </div>
        </Section>
      )}

      {/* Videocamere (live) */}
      <CamerasSection />

      {openables.length > 0 && <Section title="Porte e finestre"><StatusList items={openables} /></Section>}

      {locks.length > 0 && (
        <Section title="Serrature">
          <div className="glass-panel" style={{ padding: '2px var(--space-lg)' }}>
            {locks.map((e, i) => <LockRow key={e.entity_id} e={e} last={i === locks.length - 1} />)}
          </div>
        </Section>
      )}

      {motionSensors.length > 0 && <Section title="Movimento"><StatusList items={motionSensors} /></Section>}

      {detectors.length > 0 && <Section title="Rilevatori"><StatusList items={detectors} /></Section>}

      {!hasAny && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)' }}>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>
            <Shield size={40} strokeWidth={1.5} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Nessun dispositivo di sicurezza</div>
          <div style={{ fontSize: 14 }}>Videocamere, sensori porte/finestre e allarmi compariranno qui.</div>
        </motion.div>
      )}
    </div>
  )
}
