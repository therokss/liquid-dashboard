import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft, Cpu, MemoryStick, HardDrive, Network, Clock, Activity,
  Plus, X, Search, Server, Thermometer, type LucideIcon,
} from 'lucide-react'
import { useStore } from '../store'
import { useHA } from '../hooks/useHA'
import type { HassEntity } from '../types/ha'

interface EntReg { entity_id: string; platform: string; disabled_by: string | null }

type CatKey = 'cpu' | 'memory' | 'disk' | 'network' | 'system' | 'other'
const CATS: Array<{ key: CatKey; label: string; Icon: LucideIcon }> = [
  { key: 'cpu', label: 'Processore', Icon: Cpu },
  { key: 'memory', label: 'Memoria', Icon: MemoryStick },
  { key: 'disk', label: 'Disco', Icon: HardDrive },
  { key: 'network', label: 'Rete', Icon: Network },
  { key: 'system', label: 'Sistema', Icon: Clock },
  { key: 'other', label: 'Altro', Icon: Activity },
]

function categorize(id: string): CatKey {
  const s = id.slice(id.indexOf('.') + 1)
  if (s.includes('last_boot') || s.includes('uptime')) return 'system'
  if (/(network|throughput|packet|ipv4|ipv6)/.test(s)) return 'network'
  if (s.includes('memory') || s.includes('swap')) return 'memory'
  if (s.includes('disk')) return 'disk'
  if (/(processor|load|cpu|temperature)/.test(s)) return 'cpu'
  return 'other'
}

function cleanName(e: HassEntity): string {
  const n = (e.attributes.friendly_name as string) ?? e.entity_id
  return n.replace(/^System Monitor\s+/i, '')
}

function unitOf(e: HassEntity): string | undefined {
  return e.attributes.unit_of_measurement as string | undefined
}

function fmtVal(e: HassEntity): string {
  const unit = unitOf(e)
  const n = Number(e.state)
  const v = Number.isFinite(n) ? (Math.round(n * 100) / 100).toString() : e.state
  return unit ? `${v} ${unit}` : e.state
}

function pctColor(v: number): string {
  return v >= 85 ? '#ff6b6b' : v >= 60 ? '#ffb300' : 'var(--accent)'
}

function uptimeFrom(iso: string): string | null {
  const ms = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(ms) || ms < 0) return null
  const d = Math.floor(ms / 86400000)
  const h = Math.floor((ms % 86400000) / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  return d > 0 ? `${d}g ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`
}

export function ServerPage({ onBack }: { onBack: () => void }) {
  const { sendMessage } = useHA()
  const entities = useStore((s) => s.entities)
  const areas = useStore((s) => s.areas)
  const entityAreas = useStore((s) => s.entityAreas)
  const extra = useStore((s) => s.serverExtraEntities)
  const toggleServerEntity = useStore((s) => s.toggleServerEntity)

  const [sysmonIds, setSysmonIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [pickerOpen, setPickerOpen] = useState(false)

  useEffect(() => {
    let alive = true
    sendMessage<EntReg[]>({ type: 'config/entity_registry/list' })
      .then((reg) => {
        if (!alive || !reg) return
        setSysmonIds(reg.filter((r) => r.platform === 'systemmonitor' && !r.disabled_by).map((r) => r.entity_id))
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [sendMessage])

  const areaName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const a of areas) m[a.area_id] = a.name
    return m
  }, [areas])

  const groups = useMemo(() => {
    const cats: Record<CatKey, HassEntity[]> = { cpu: [], memory: [], disk: [], network: [], system: [], other: [] }
    for (const id of sysmonIds) {
      const e = entities[id]
      if (!e) continue
      cats[categorize(id)].push(e)
    }
    for (const l of Object.values(cats)) l.sort((a, b) => cleanName(a).localeCompare(cleanName(b)))
    return cats
  }, [sysmonIds, entities])

  // Statistiche principali
  const stats = useMemo(() => {
    const find = (pred: (id: string, e: HassEntity) => boolean) => {
      for (const id of sysmonIds) {
        const e = entities[id]
        if (e && pred(id, e)) return e
      }
      return null
    }
    const cpu = find((id, e) => id.includes('processor_use') && unitOf(e) === '%')
    const mem = find((id, e) => (id.includes('memory_use_percent') || (id.includes('memory') && unitOf(e) === '%')))
    const disk = find((id, e) => (id.includes('disk_use_percent') || (id.includes('disk') && unitOf(e) === '%')))
    const temp = find((id) => id.includes('processor_temperature'))
    return { cpu, mem, disk, temp }
  }, [sysmonIds, entities])

  const hasSysmon = sysmonIds.length > 0

  return createPortal(
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 3200, overflowY: 'auto',
        background: '#051424',
        backgroundImage:
          'radial-gradient(circle at 12% 6%, rgba(0,219,231,0.12), transparent 42%), radial-gradient(circle at 88% 96%, rgba(74,142,255,0.12), transparent 46%)',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 'calc(env(safe-area-inset-top, 0px) + 20px) var(--space-lg) calc(env(safe-area-inset-bottom, 0px) + 32px)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--space-lg)' }}>
          <button
            onClick={onBack}
            style={{
              background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-pill)',
              color: 'var(--text-primary)', padding: '6px 12px 6px 8px', display: 'inline-flex', alignItems: 'center',
              gap: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600,
            }}
          >
            <ChevronLeft size={16} /> Indietro
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Server size={24} color="var(--accent)" />
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
              Server
            </h2>
          </div>
        </div>

        {loading ? (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 14, padding: '24px 0' }}>Lettura sensori…</div>
        ) : (
          <>
            {/* Riepilogo */}
            {hasSysmon && (
              <div className="grid-fluid" style={{ marginBottom: 'var(--space-xl)' }}>
                {stats.cpu && <StatBig Icon={Cpu} label="CPU" e={stats.cpu} />}
                {stats.mem && <StatBig Icon={MemoryStick} label="Memoria" e={stats.mem} />}
                {stats.disk && <StatBig Icon={HardDrive} label="Disco" e={stats.disk} />}
                {stats.temp && <StatBig Icon={Thermometer} label="Temp. CPU" e={stats.temp} />}
              </div>
            )}

            {/* Categorie System Monitor */}
            {hasSysmon ? (
              CATS.map(({ key, label, Icon }) =>
                groups[key].length > 0 ? (
                  <div key={key} style={{ marginBottom: 'var(--space-lg)' }}>
                    <div className="text-caption" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Icon size={14} /> {label}
                    </div>
                    <div className="glass-panel" style={{ padding: '2px var(--space-lg)' }}>
                      {groups[key].map((e) => <SensorRow key={e.entity_id} e={e} />)}
                    </div>
                  </div>
                ) : null
              )
            ) : (
              <div className="glass-panel" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <Server size={20} color="var(--text-tertiary)" style={{ flexShrink: 0, marginTop: 2 }} />
                <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Integrazione <b style={{ color: 'var(--text-primary)' }}>System Monitor</b> non rilevata.
                  Aggiungila da Home Assistant (Impostazioni → Dispositivi e servizi) per vedere CPU, memoria, disco e rete.
                  Nel frattempo puoi aggiungere manualmente qualsiasi sensore qui sotto.
                </div>
              </div>
            )}

            {/* Sensori personalizzati */}
            <div style={{ marginBottom: 'var(--space-lg)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div className="text-caption" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: 0 }}>
                  <Plus size={14} /> Altri sensori
                </div>
                <button
                  onClick={() => setPickerOpen(true)}
                  className="glass-btn glass-btn-accent"
                  style={{ padding: '7px 14px', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}
                >
                  <Plus size={15} /> Aggiungi
                </button>
              </div>
              {extra.length === 0 ? (
                <div className="glass-panel" style={{ padding: 'var(--space-lg)', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13.5 }}>
                  Aggiungi sensori UniFi, NAS, temperature o qualsiasi altra entità da tenere d'occhio.
                </div>
              ) : (
                <div className="glass-panel" style={{ padding: '2px var(--space-lg)' }}>
                  {extra.map((id) => {
                    const e = entities[id]
                    return (
                      <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--glass-border-dim)' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14.5, color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {e ? cleanName(e) : id}
                          </div>
                          {e && entityAreas[id] && areaName[entityAreas[id]] && (
                            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{areaName[entityAreas[id]]}</div>
                          )}
                        </div>
                        <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>
                          {e ? fmtVal(e) : '—'}
                        </span>
                        <button
                          onClick={() => toggleServerEntity(id)}
                          aria-label="Rimuovi"
                          style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 9, cursor: 'pointer', background: 'rgba(255,107,107,0.12)', border: '1px solid rgba(255,107,107,0.28)', color: '#ff8f8f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                        >
                          <X size={15} />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <AnimatePresence>
        {pickerOpen && <EntityPicker onClose={() => setPickerOpen(false)} />}
      </AnimatePresence>
    </motion.div>,
    document.body,
  )
}

function StatBig({ Icon, label, e }: { Icon: LucideIcon; label: string; e: HassEntity }) {
  const unit = unitOf(e)
  const n = Number(e.state)
  const isPct = unit === '%'
  const color = isPct && Number.isFinite(n) ? pctColor(n) : 'var(--accent)'
  const val = Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : e.state
  return (
    <div className="glass-panel" style={{ padding: 'var(--space-md) var(--space-lg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-secondary)', fontSize: 12.5, marginBottom: 8 }}>
        <Icon size={15} /> {label}
      </div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 300, lineHeight: 1, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
        {val}<span style={{ fontSize: 15, fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 3 }}>{unit}</span>
      </div>
      {isPct && Number.isFinite(n) && (
        <div style={{ height: 6, borderRadius: 3, background: 'var(--glass-border)', overflow: 'hidden', marginTop: 10 }}>
          <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, n))}%`, background: color, borderRadius: 3, boxShadow: `0 0 10px ${color}` }} />
        </div>
      )}
    </div>
  )
}

function SensorRow({ e }: { e: HassEntity }) {
  const unit = unitOf(e)
  const n = Number(e.state)
  const isPct = unit === '%'
  const isBoot = e.entity_id.includes('last_boot') || (e.attributes.device_class as string) === 'timestamp'
  const up = isBoot ? uptimeFrom(e.state) : null

  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid var(--glass-border-dim)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cleanName(e)}
        </span>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--text-primary)', flexShrink: 0 }}>
          {up ? up : fmtVal(e)}
        </span>
      </div>
      {isPct && Number.isFinite(n) && (
        <div style={{ height: 5, borderRadius: 3, background: 'var(--glass-border)', overflow: 'hidden', marginTop: 8 }}>
          <div style={{ height: '100%', width: `${Math.min(100, Math.max(0, n))}%`, background: pctColor(n), borderRadius: 3 }} />
        </div>
      )}
    </div>
  )
}

function EntityPicker({ onClose }: { onClose: () => void }) {
  const entities = useStore((s) => s.entities)
  const extra = useStore((s) => s.serverExtraEntities)
  const toggleServerEntity = useStore((s) => s.toggleServerEntity)
  const [q, setQ] = useState('')

  const list = useMemo(() => {
    const term = q.trim().toLowerCase()
    const arr = Object.values(entities)
      .filter((e) => {
        const d = e.entity_id.split('.')[0]
        return d !== 'automation' && d !== 'script' && d !== 'scene' && d !== 'zone'
      })
      .map((e) => ({ e, name: (e.attributes.friendly_name as string) ?? e.entity_id }))
    const filtered = term
      ? arr.filter((x) => x.name.toLowerCase().includes(term) || x.e.entity_id.toLowerCase().includes(term))
      : arr
    return filtered.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 120)
  }, [entities, q])

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, zIndex: 3400, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(3,10,20,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        onClick={(ev) => ev.stopPropagation()}
        style={{
          background: '#08192b', borderTop: '1px solid var(--glass-border)',
          borderTopLeftRadius: 22, borderTopRightRadius: 22, maxWidth: 720, width: '100%', margin: '0 auto',
          maxHeight: '82vh', display: 'flex', flexDirection: 'column',
          padding: 'var(--space-lg) var(--space-lg) calc(env(safe-area-inset-bottom, 0px) + var(--space-lg))',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>Aggiungi sensore</h3>
          <button onClick={onClose} aria-label="Chiudi" style={{ width: 32, height: 32, borderRadius: 10, cursor: 'pointer', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={17} />
          </button>
        </div>

        <div style={{ position: 'relative', marginBottom: 12 }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <input
            className="glass-input"
            autoFocus
            placeholder="Cerca (es. unifi, temperatura, disco)…"
            value={q}
            onChange={(ev) => setQ(ev.target.value)}
            style={{ width: '100%', paddingLeft: 36 }}
          />
        </div>

        <div className="glass-scroll" style={{ overflowY: 'auto', flex: 1 }}>
          {list.map(({ e, name }) => {
            const added = extra.includes(e.entity_id)
            const unit = unitOf(e)
            return (
              <button
                key={e.entity_id}
                onClick={() => toggleServerEntity(e.entity_id)}
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer', background: 'none',
                  border: 'none', borderBottom: '1px solid var(--glass-border-dim)',
                  display: 'flex', alignItems: 'center', gap: 12, padding: '11px 2px',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.entity_id}</div>
                </div>
                <span style={{ fontSize: 13, color: 'var(--text-secondary)', flexShrink: 0 }}>
                  {Number.isFinite(Number(e.state)) || unit ? fmtVal(e) : ''}
                </span>
                <span
                  style={{
                    flexShrink: 0, width: 30, height: 30, borderRadius: 9,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: added ? 'var(--accent)' : 'var(--glass-bg)',
                    border: added ? 'none' : '1px solid var(--glass-border)',
                    color: added ? '#04121e' : 'var(--text-secondary)',
                  }}
                >
                  {added ? <X size={15} /> : <Plus size={15} />}
                </span>
              </button>
            )
          })}
          {list.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 14, padding: '24px 0' }}>Nessun risultato</div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
