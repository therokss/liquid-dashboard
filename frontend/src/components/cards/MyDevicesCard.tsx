import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Smartphone, Watch, Laptop, Tablet, Zap, MapPin, Wifi, Signal, Battery,
  ChevronRight, X, HardDrive, Activity, Clock, Info, type LucideIcon,
} from 'lucide-react'
import { useStore } from '../../store'
import { GlassCard } from '../glass/GlassCard'
import { useT } from '../../i18n'
import type { HassEntity } from '../../types/ha'

type Kind = 'phone' | 'watch' | 'laptop' | 'tablet'
const KIND_ICON: Record<Kind, LucideIcon> = { phone: Smartphone, watch: Watch, laptop: Laptop, tablet: Tablet }

interface MobileDevice {
  key: string
  name: string
  kind: Kind
  battery: number
  charging: boolean
  batteryState: string | null
  location: string | null
  connection: string | null
  ssid: string | null
  storage: string | null
  activity: string | null
  appVersion: string | null
  lastUpdate: string | null
  ts: number // timestamp dell'ultimo aggiornamento (per il merge di device doppi)
}

// Nome "base" per raggruppare lo stesso telefono fisico registrato più volte
// (es. la nostra app "Mattia · iPhone" e l'app HA ufficiale "iPhone di Mattia").
function groupName(name: string, first: string): string {
  let n = name.toLowerCase()
  if (first) n = n.replace(new RegExp(`\\b${first}\\b`, 'g'), '')
  return n.replace(/\bdi\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}
function displayName(name: string, first: string): string {
  const n = name.replace(new RegExp(`^\\s*${first}\\s*[·・|\\-]\\s*`, 'i'), '').trim()
  return n || name
}

// Unisce i device che sono lo stesso telefono: sui campi presenti in più device
// vince quello aggiornato più di recente; i campi mancanti si riempiono con l'altro.
function mergeDevices(list: MobileDevice[], first: string): MobileDevice[] {
  const groups = new Map<string, MobileDevice[]>()
  for (const d of list) {
    const key = d.kind + '|' + groupName(d.name, first)
    const arr = groups.get(key)
    if (arr) arr.push(d)
    else groups.set(key, [d])
  }
  const out: MobileDevice[] = []
  for (const g of groups.values()) {
    if (g.length === 1) { out.push(g[0]); continue }
    g.sort((a, b) => b.ts - a.ts) // più recente primo
    const merged: MobileDevice = { ...g[0], name: displayName(g[0].name, first) }
    for (const d of g.slice(1)) {
      for (const k of ['batteryState', 'location', 'connection', 'ssid', 'storage', 'activity', 'appVersion', 'lastUpdate'] as const) {
        if (merged[k] == null && d[k] != null) merged[k] = d[k]
      }
    }
    out.push(merged)
  }
  return out
}

function kindOf(name: string): Kind {
  const n = name.toLowerCase()
  if (/watch/.test(n)) return 'watch'
  if (/(macbook|imac|laptop|desktop|windows|linux|\bpc\b)/.test(n)) return 'laptop'
  if (/(ipad|tablet)/.test(n)) return 'tablet'
  return 'phone'
}
function batteryColor(v: number): string {
  return v <= 20 ? '#ff6b6b' : v <= 50 ? '#ffb300' : 'var(--accent)'
}
function locationLabel(state: string): string | null {
  if (!state || state === 'unknown' || state === 'unavailable') return null
  if (state === 'home') return 'A casa'
  if (state === 'not_home') return 'Fuori'
  return state.charAt(0).toUpperCase() + state.slice(1)
}
function cleanName(friendly: string): string {
  return friendly.replace(/\s*(internal\s+)?(battery\s*level|livello\s*batteria)\s*$/i, '').trim()
}
function shortName(name: string, first: string): string {
  let n = name
  if (first && first.length >= 3) n = n.replace(new RegExp(`\\s+di\\s+${first}\\b`, 'ig'), '')
  n = n.replace(/\s+/g, ' ').trim()
  if (/\bwatch\b/i.test(n)) return 'Apple Watch'
  return n || name
}
function prettyConn(e?: HassEntity): string | null {
  if (!e) return null
  const tech = e.attributes['Cellular Technology'] as string | undefined
  const s = (e.state || '').toLowerCase()
  if (s.includes('wifi') || s.includes('wi-fi')) return 'Wi-Fi'
  if (s.includes('cellular') || s.includes('mobile')) return tech || 'Cellulare'
  if (!s || s === 'unknown' || s === 'unavailable') return null
  return e.state
}
const BATTERY_STATE: Record<string, string> = {
  charging: 'In carica', discharging: 'In uso', full: 'Carica', 'not charging': 'Non in carica', unplugged: 'Scollegato',
}
const ACTIVITY: Record<string, string> = {
  stationary: 'Fermo', walking: 'A piedi', running: 'Corsa', automotive: 'In auto', cycling: 'In bici',
}
function tr(map: Record<string, string>, v?: string | null): string | null {
  if (!v) return null
  const s = v.trim().toLowerCase()
  if (!s || s === 'unknown' || s === 'unavailable') return null
  return map[s] ?? v
}
function timeOf(iso?: string): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : null
}

export function MyDevicesSection() {
  const t = useT()
  const entities = useStore((s) => s.entities)
  const entityDevices = useStore((s) => s.entityDevices)
  const currentUserId = useStore((s) => s.currentUserId)
  const [selected, setSelected] = useState<MobileDevice | null>(null)

  const devices = useMemo<MobileDevice[]>(() => {
    if (!currentUserId) return []
    const person = Object.values(entities).find(
      (e) => e.entity_id.startsWith('person.') && (e.attributes as Record<string, unknown>).user_id === currentUserId
    )
    if (!person) return []
    const first = ((person.attributes.friendly_name as string) || '').trim().split(/\s+/)[0]?.toLowerCase() || ''
    if (first.length < 3) return []
    const belongs = (friendlyLower: string) => {
      const words = friendlyLower.split(/[^a-zàéèìòùç0-9]+/i)
      return words.some((w) => w.length >= 3 && (first.startsWith(w) || w.startsWith(first)))
    }
    const byDevice: Record<string, string[]> = {}
    for (const [eid, dev] of Object.entries(entityDevices)) (byDevice[dev] ??= []).push(eid)

    const location = locationLabel(person.state)
    const out: MobileDevice[] = []

    for (const e of Object.values(entities)) {
      const id = e.entity_id
      if (!id.startsWith('sensor.') || !id.endsWith('_battery_level')) continue
      if ((e.attributes as Record<string, unknown>).device_class !== 'battery') continue
      const friendly = (e.attributes.friendly_name as string) || id
      if (!belongs(friendly.toLowerCase())) continue
      const lvl = parseFloat(e.state)
      if (!Number.isFinite(lvl)) continue

      const base = id.slice(0, -'_battery_level'.length)
      const rel = new Set<string>()
      const devId = entityDevices[id]
      if (devId && byDevice[devId]) byDevice[devId].forEach((x) => rel.add(x))
      for (const suf of ['_battery_state', '_battery_charging', '_connection_type', '_ssid', '_storage', '_activity', '_app_version']) rel.add(`${base}${suf}`)
      const relArr = [...rel]
      const findRel = (suf: string) => relArr.find((x) => x.startsWith('sensor.') && x.endsWith(suf))
      const st = (sufOrId?: string) => (sufOrId ? entities[sufOrId]?.state ?? null : null)

      const stateE = entities[`${base}_battery_state`]
      const bs = (stateE?.state || '').toLowerCase()
      const charging = bs === 'charging' || bs === 'full' || entities[`${base}_battery_charging`]?.state === 'on'
      const name = shortName(cleanName(friendly), first)

      const connE = findRel('_connection_type') || findRel('_wifi_connection')
      const storE = findRel('_storage')

      out.push({
        key: id,
        name,
        kind: kindOf(name),
        battery: Math.round(lvl),
        charging,
        batteryState: tr(BATTERY_STATE, stateE?.state),
        location,
        connection: connE ? prettyConn(entities[connE]) : null,
        ssid: st(findRel('_ssid')),
        storage: storE ? `${st(storE)}${(entities[storE]?.attributes.unit_of_measurement as string) || ''}` : null,
        activity: tr(ACTIVITY, st(findRel('_activity'))),
        appVersion: st(findRel('_app_version')),
        lastUpdate: timeOf(e.last_changed),
        ts: Date.parse(e.last_changed) || 0,
      })
    }
    const grouped = mergeDevices(out, first)
    grouped.sort((a, b) => (a.kind === 'phone' ? 0 : 1) - (b.kind === 'phone' ? 0 : 1) || a.name.localeCompare(b.name))
    return grouped
  }, [entities, entityDevices, currentUserId])

  if (devices.length === 0) return null

  return (
    <div style={{ marginBottom: 'var(--space-xl)' }}>
      <div className="text-caption" style={{ marginBottom: 10 }}>{t('I miei dispositivi')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {devices.map((d) => <DeviceRow key={d.key} d={d} onOpen={() => setSelected(d)} />)}
      </div>

      {createPortal(
        <AnimatePresence>
          {selected && <DeviceModal d={selected} onClose={() => setSelected(null)} />}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  )
}

function DeviceRow({ d, onOpen }: { d: MobileDevice; onOpen: () => void }) {
  const t = useT()
  const Icon = KIND_ICON[d.kind]
  const bcol = batteryColor(d.battery)
  return (
    <GlassCard size="md" style={{ cursor: 'pointer' }} onClick={onOpen}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 42, height: 42, borderRadius: 12, flexShrink: 0, background: 'var(--glass-bg-active)', border: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
          <Icon size={21} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--glass-border)', overflow: 'hidden', minWidth: 40 }}>
              <div style={{ height: '100%', width: `${Math.max(2, Math.min(100, d.battery))}%`, background: bcol, borderRadius: 3 }} />
            </div>
            {d.location && <span style={{ fontSize: 12, color: 'var(--text-tertiary)', flexShrink: 0 }}>{t(d.location)}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0, color: bcol, fontWeight: 700, fontSize: 15 }}>
          {d.charging ? <Zap size={14} fill={bcol} /> : <Battery size={15} />}
          {d.battery}%
        </div>
        <ChevronRight size={18} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
      </div>
    </GlassCard>
  )
}

function DeviceModal({ d, onClose }: { d: MobileDevice; onClose: () => void }) {
  const t = useT()
  const Icon = KIND_ICON[d.kind]
  const bcol = batteryColor(d.battery)
  const rows: Array<{ icon: LucideIcon; label: string; value: string }> = []
  if (d.batteryState) rows.push({ icon: Battery, label: t('Batteria'), value: `${d.battery}% · ${t(d.batteryState)}` })
  if (d.location) rows.push({ icon: MapPin, label: t('Posizione'), value: t(d.location) })
  if (d.connection) rows.push({ icon: d.connection === 'Wi-Fi' ? Wifi : Signal, label: t('Connessione'), value: d.ssid && d.connection === 'Wi-Fi' ? `${t(d.connection)} · ${d.ssid}` : t(d.connection) })
  if (d.storage) rows.push({ icon: HardDrive, label: t('Spazio'), value: d.storage })
  if (d.activity) rows.push({ icon: Activity, label: t('Attività'), value: t(d.activity) })
  if (d.appVersion) rows.push({ icon: Info, label: t('App'), value: d.appVersion })
  if (d.lastUpdate) rows.push({ icon: Clock, label: t('Aggiornato'), value: d.lastUpdate })

  return (
    <motion.div
      data-theme="dark"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3400, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(3,10,20,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        onClick={(ev) => ev.stopPropagation()}
        style={{ background: '#08192b', borderTop: '1px solid var(--glass-border)', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxWidth: 640, width: '100%', margin: '0 auto', padding: 'var(--space-lg) var(--space-lg) calc(env(safe-area-inset-bottom, 0px) + var(--space-lg))' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <div style={{ width: 46, height: 46, borderRadius: 13, flexShrink: 0, background: 'var(--accent-glow)', border: '1px solid var(--glass-border)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon size={24} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</h3>
          </div>
          <button onClick={onClose} aria-label={t('Chiudi')} style={{ width: 32, height: 32, borderRadius: 10, cursor: 'pointer', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={17} />
          </button>
        </div>

        {/* Batteria grande */}
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 }}>
            {d.charging ? <Zap size={20} fill={bcol} color={bcol} /> : <Battery size={20} color={bcol} />}
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 40, fontWeight: 300, color: 'var(--text-primary)', letterSpacing: '-0.03em', lineHeight: 1 }}>{d.battery}</span>
            <span style={{ fontSize: 18, color: 'var(--text-secondary)' }}>%</span>
            {d.batteryState && <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-secondary)', alignSelf: 'center' }}>{t(d.batteryState)}</span>}
          </div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--glass-border)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.max(2, Math.min(100, d.battery))}%`, background: bcol, borderRadius: 4, boxShadow: `0 0 10px ${bcol}` }} />
          </div>
        </div>

        {/* Dettagli */}
        <div className="glass-panel" style={{ padding: '2px var(--space-lg)' }}>
          {rows.map((r, i) => (
            <div key={r.label} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 0', borderBottom: i < rows.length - 1 ? '1px solid var(--glass-border-dim)' : 'none' }}>
              <r.icon size={17} color="var(--accent)" style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 14, color: 'var(--text-secondary)' }}>{r.label}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{r.value}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}
