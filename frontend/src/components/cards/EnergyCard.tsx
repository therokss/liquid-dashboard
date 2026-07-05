import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Zap, ChevronRight, ChevronLeft, ArrowDownToLine, ArrowUpFromLine,
  Sun, BatteryCharging, Euro,
} from 'lucide-react'
import { GlassCard } from '../glass/GlassCard'
import { MasonryColumns } from '../MasonryColumns'
import { useStore } from '../../store'
import { useHA } from '../../hooks/useHA'
import {
  fetchEnergyPrefs, extractStatIds, hasEnergyConfig, fetchStatsSum, sumOf, kwhFactor,
} from '../../lib/energy'
import type { EnergyPrefs, EnergyStatIds } from '../../lib/energy'
import type { HassEntity } from '../../types/ha'

type Send = <T = unknown>(msg: { type: string } & Record<string, unknown>) => Promise<T | null>

function kwh(n: number): string {
  return (Math.round(n * 100) / 100).toLocaleString('it-IT', { maximumFractionDigits: 2 })
}
function fmtPower(v: number, unit: string): { value: string; unit: string } {
  if (isNaN(v)) return { value: '--', unit }
  if (unit === 'W' && Math.abs(v) >= 1000) return { value: (v / 1000).toLocaleString('it-IT', { maximumFractionDigits: 2 }), unit: 'kW' }
  if (unit === 'kW') return { value: v.toLocaleString('it-IT', { maximumFractionDigits: 2 }), unit: 'kW' }
  return { value: Math.round(v).toLocaleString('it-IT'), unit: unit || 'W' }
}
function startOfToday(): Date { const d = new Date(); d.setHours(0, 0, 0, 0); return d }

const DEVICE_COLORS = ['#00dbe7', '#4a8eff', '#66bb6a', '#ffb300', '#b56eff', '#ff7043', '#ec407a', '#26c6da', '#9ccc65', '#ffa726']

export function EnergyCard() {
  const { sendMessage } = useHA()
  const entities = useStore((s) => s.entities)
  const powerSel = useStore((s) => s.energyPowerEntity)
  const entityDevices = useStore((s) => s.entityDevices)
  const [prefs, setPrefs] = useState<EnergyPrefs | null>(null)
  const [today, setToday] = useState<Record<string, number>>({})
  const [showDetail, setShowDetail] = useState(false)

  const ids = useMemo(() => (prefs ? extractStatIds(prefs) : null), [prefs])

  // Sensori di potenza (W) raggruppati per dispositivo
  const powerByDevice = useMemo(() => {
    const m: Record<string, string[]> = {}
    for (const id of Object.keys(entities)) {
      if (!id.startsWith('sensor.')) continue
      if ((entities[id].attributes as Record<string, unknown>).device_class !== 'power') continue
      const dev = entityDevices[id]
      if (dev) (m[dev] ??= []).push(id)
    }
    return m
  }, [entities, entityDevices])

  // Consumo istantaneo (W): 1) sensore scelto → 2) potenza sullo stesso dispositivo della
  // rete configurata in scheda energia → 3) somma potenze dei dispositivi monitorati → 4) primo
  const livePowerW = useMemo<number | null>(() => {
    const toW = (e?: HassEntity) => {
      if (!e) return NaN
      const v = parseFloat(e.state)
      if (isNaN(v)) return NaN
      const u = ((e.attributes as Record<string, unknown>).unit_of_measurement as string) || 'W'
      return u === 'kW' ? v * 1000 : v
    }
    if (powerSel) { const w = toW(entities[powerSel]); if (!isNaN(w)) return w }
    if (ids) {
      for (const statId of ids.gridFrom) {
        const dev = entityDevices[statId]
        const ps = dev ? powerByDevice[dev]?.[0] : undefined
        const w = toW(ps ? entities[ps] : undefined)
        if (!isNaN(w)) return w
      }
      let sum = 0
      let found = false
      for (const d of ids.devices) {
        const dev = entityDevices[d.id]
        const ps = dev ? powerByDevice[dev]?.[0] : undefined
        const w = toW(ps ? entities[ps] : undefined)
        if (!isNaN(w)) { sum += w; found = true }
      }
      if (found) return sum
    }
    const first = Object.keys(entities).find(
      (k) => k.startsWith('sensor.') && (entities[k].attributes as Record<string, unknown>).device_class === 'power'
    )
    if (first) { const w = toW(entities[first]); if (!isNaN(w)) return w }
    return null
  }, [entities, entityDevices, powerByDevice, ids, powerSel])

  useEffect(() => {
    let cancelled = false
    let attempts = 0
    const load = async () => {
      attempts += 1
      const p = await fetchEnergyPrefs(sendMessage).catch(() => null)
      if (cancelled) return
      if (p && hasEnergyConfig(p)) {
        setPrefs(p)
        const sid = extractStatIds(p)
        fetchStatsSum(
          sendMessage,
          [...sid.gridFrom, ...sid.solar, ...sid.gridCost, ...sid.devices.map((d) => d.id)],
          startOfToday().toISOString(),
          undefined,
          (id) => kwhFactor(useStore.getState().entities[id]?.attributes.unit_of_measurement as string)
        )
          .then((m) => { if (!cancelled) setToday(m) })
          .catch(() => {})
      } else if (attempts < 5) {
        setTimeout(load, 1500)
      }
    }
    load()
    return () => { cancelled = true }
  }, [sendMessage])

  if (!prefs && livePowerW === null) return null

  const consumed = ids ? sumOf(today, ids.gridFrom) : 0
  const solar = ids ? sumOf(today, ids.solar) : 0
  const cost = ids ? sumOf(today, ids.gridCost) : 0
  const devTotalToday = ids ? sumOf(today, ids.devices.map((d) => d.id)) : 0
  // "Oggi": prelievo rete se disponibile, altrimenti (senza solare) il totale dispositivi
  const gridToday = consumed > 0.001 ? consumed : (ids && ids.solar.length === 0 ? devTotalToday : consumed)

  const hasPower = livePowerW !== null
  const pf = fmtPower(livePowerW ?? NaN, 'W')
  const clickable = Boolean(prefs)

  return (
    <>
      <GlassCard size="md" style={{ cursor: clickable ? 'pointer' : 'default' }} onClick={() => clickable && setShowDetail(true)}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 44, height: 44, borderRadius: 12,
              background: 'rgba(255,179,0,0.14)', border: '1px solid rgba(255,179,0,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffb300', flexShrink: 0,
            }}
          >
            <Zap size={22} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{hasPower ? 'Consumo attuale' : 'Consumo oggi'}</div>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              {hasPower ? pf.value : kwh(gridToday)}
              <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginLeft: 4 }}>{hasPower ? pf.unit : 'kWh'}</span>
            </div>
            {hasPower && prefs && (
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>Oggi {kwh(gridToday)} kWh</div>
            )}
          </div>
          <div style={{ textAlign: 'right', marginRight: 4 }}>
            {solar > 0 && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#66bb6a' }}>
                <Sun size={12} /> {kwh(solar)}
              </div>
            )}
            {cost > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                € {cost.toFixed(2)}
              </div>
            )}
          </div>
          {clickable && <ChevronRight size={18} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />}
        </div>
      </GlassCard>

      {createPortal(
        <AnimatePresence>
          {showDetail && ids && <EnergyDetail ids={ids} sendMessage={sendMessage} onBack={() => setShowDetail(false)} />}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
}

function truncateLabel(name: string, width: number): string {
  const max = Math.max(2, Math.floor(width / 4.5))
  return name.length > max ? name.slice(0, Math.max(1, max - 1)) + '…' : name
}

interface SankeyArea {
  name: string
  value: number
  color: string
  devices: Array<{ name: string; value: number }>
}

// Sankey a 4 livelli: Rete elettrica → Casa → Aree → Dispositivi
function Sankey({ areas }: { areas: SankeyArea[] }) {
  const total = areas.reduce((s, a) => s + a.value, 0) || 1
  const W = 360, H = 388
  const reteTop = 14, reteH = 20, reteBottom = reteTop + reteH
  const casaTop = 82, casaH = 20, casaBottom = casaTop + casaH
  const areaTop = 168, areaH = 20, areaBottom = areaTop + areaH
  const devTop = 300, devH = 14

  let ax = 0
  const areaSeg = areas.map((a) => { const w = (a.value / total) * W; const s = { x0: ax, x1: ax + w }; ax += w; return s })
  const devSeg = areas.map((a, ai) => {
    const seg = areaSeg[ai]; const aw = seg.x1 - seg.x0; const at = a.value || 1
    let dx = seg.x0
    return a.devices.map((d) => { const w = (d.value / at) * aw; const s = { x0: dx, x1: dx + w }; dx += w; return s })
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', overflow: 'visible' }}>
      {/* Rete → Casa */}
      <rect x={0} y={reteBottom} width={W} height={casaTop - reteBottom} fill="rgba(255,179,0,0.16)" />
      <rect x={0} y={reteTop} width={W} height={reteH} rx={4} fill="#ffb300" />
      <text x={W / 2} y={reteTop + reteH / 2 + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#3a2600">Rete elettrica</text>
      <rect x={0} y={casaTop} width={W} height={casaH} rx={4} fill="#ffb300" />
      <text x={W / 2} y={casaTop + casaH / 2 + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#3a2600">Casa</text>

      {/* Casa → Aree */}
      {areas.map((a, i) => {
        const s = areaSeg[i]
        return <rect key={i} x={s.x0} y={casaBottom} width={Math.max(1, s.x1 - s.x0)} height={areaTop - casaBottom} fill={a.color} opacity={0.32} />
      })}
      {/* nodi Aree */}
      {areas.map((a, i) => {
        const s = areaSeg[i]; const w = s.x1 - s.x0
        return (
          <g key={i}>
            <rect x={s.x0} y={areaTop} width={Math.max(2, w)} height={areaH} rx={3} fill={a.color} />
            {w > 26 && <text x={(s.x0 + s.x1) / 2} y={areaTop + areaH / 2 + 3.5} textAnchor="middle" fontSize="9" fontWeight="600" fill="#08121e">{truncateLabel(a.name, w)}</text>}
          </g>
        )
      })}

      {/* Aree → Dispositivi */}
      {areas.map((a, ai) => a.devices.map((_dev, di) => {
        const s = devSeg[ai][di]
        return <rect key={`${ai}-${di}`} x={s.x0} y={areaBottom} width={Math.max(0.8, s.x1 - s.x0)} height={devTop - areaBottom} fill={a.color} opacity={0.22} />
      }))}
      {/* nodi Dispositivi */}
      {areas.map((a, ai) => a.devices.map((dev, di) => {
        const s = devSeg[ai][di]; const w = s.x1 - s.x0
        return (
          <g key={`${ai}-${di}`}>
            <rect x={s.x0 + 0.5} y={devTop} width={Math.max(1.5, w - 1)} height={devH} rx={2} fill={a.color} />
            {w > 26 && <text x={(s.x0 + s.x1) / 2} y={devTop + devH + 10} textAnchor="middle" fontSize="8" fill="#c1c6d7">{truncateLabel(dev.name, w)}</text>}
          </g>
        )
      }))}
    </svg>
  )
}

function StatTile({ label, value, unit, color, icon }: {
  label: string; value: string; unit: string; color: string; icon: React.ReactNode
}) {
  return (
    <GlassCard size="sm">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color }}>
        {icon}
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
        {value}<span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-secondary)', marginLeft: 3 }}>{unit}</span>
      </div>
    </GlassCard>
  )
}

function EnergyDetail({ ids, sendMessage, onBack }: { ids: EnergyStatIds; sendMessage: Send; onBack: () => void }) {
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'year' | 'custom'>('today')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [stats, setStats] = useState<Record<string, number>>({})
  const [devices, setDevices] = useState<Array<{ id: string; name?: string; value: number }>>([])
  const entityAreas = useStore((s) => s.entityAreas)
  const areasList = useStore((s) => s.areas)

  useEffect(() => {
    let cancelled = false
    const sod = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
    let startD: Date
    let endD: Date | undefined
    if (period === 'week') { startD = sod(); startD.setDate(startD.getDate() - 6) }
    else if (period === 'month') { startD = sod(); startD.setDate(startD.getDate() - 29) }
    else if (period === 'year') { startD = sod(); startD.setDate(startD.getDate() - 364) }
    else if (period === 'custom') {
      startD = customStart ? new Date(customStart + 'T00:00:00') : sod()
      endD = customEnd ? new Date(customEnd + 'T23:59:59') : new Date()
    } else { startD = sod() }
    const all = [
      ...ids.gridFrom, ...ids.gridTo, ...ids.solar,
      ...ids.batteryFrom, ...ids.batteryTo, ...ids.gridCost,
      ...ids.devices.map((d) => d.id),
    ]
    fetchStatsSum(
      sendMessage, all, startD.toISOString(), endD?.toISOString(),
      (id) => kwhFactor(useStore.getState().entities[id]?.attributes.unit_of_measurement as string)
    )
      .then((m) => {
        if (cancelled) return
        setStats(m)
        setDevices(
          ids.devices
            .map((d) => ({ id: d.id, name: d.name, value: m[d.id] ?? 0 }))
            .filter((d) => d.value > 0.001)
            .sort((a, b) => b.value - a.value)
        )
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [period, customStart, customEnd, ids, sendMessage])

  const consumed = sumOf(stats, ids.gridFrom)
  const returned = sumOf(stats, ids.gridTo)
  const solar = sumOf(stats, ids.solar)
  const battOut = sumOf(stats, ids.batteryFrom)
  const battIn = sumOf(stats, ids.batteryTo)
  const cost = sumOf(stats, ids.gridCost)
  const maxDev = devices.length ? devices[0].value : 1

  const totalDevices = devices.reduce((s, d) => s + d.value, 0)
  const unmonitored = Math.max(0, consumed - totalDevices)
  const homeTotal = totalDevices + unmonitored
  // Fallback: se il sensore "consumo rete" non dà dati E non c'è solare configurato,
  // il prelievo dalla rete equivale al consumo totale di casa. Con il solare invece
  // NON si applica (prelievo ≠ consumo casa) e si usa il valore reale del sensore.
  const gridShown = consumed > 0.001 ? consumed : (ids.solar.length === 0 ? homeTotal : consumed)
  // Gerarchia Aree → Dispositivi per il Sankey
  const areaHierarchy: SankeyArea[] = (() => {
    const map = new Map<string, SankeyArea>()
    for (const d of devices) {
      const areaId = entityAreas[d.id]
      const areaName = (areaId && areasList.find((a) => a.area_id === areaId)?.name) || 'Altro'
      let g = map.get(areaName)
      if (!g) { g = { name: areaName, value: 0, color: '', devices: [] }; map.set(areaName, g) }
      g.value += d.value
      g.devices.push({ name: d.name || d.id, value: d.value })
    }
    const arr = Array.from(map.values()).sort((a, b) => b.value - a.value)
    arr.forEach((a, i) => { a.color = DEVICE_COLORS[i % DEVICE_COLORS.length] })
    if (unmonitored > 0.01) arr.push({ name: 'Consumi non monitorati', value: unmonitored, color: '#5a6b82', devices: [] })
    return arr
  })()

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, overflowY: 'auto',
        background: 'var(--overlay-scrim)',
        backdropFilter: 'blur(32px) saturate(1.4)', WebkitBackdropFilter: 'blur(32px) saturate(1.4)',
      }}
      className="page"
    >
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
          <ChevronLeft size={16} /> Home
        </button>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
          Elettricità
        </h2>
      </div>

      {/* Periodo */}
      <div className="glass-scroll" style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-md)', overflowX: 'auto', paddingBottom: 4 }}>
        {([['today', 'Oggi'], ['week', '7 giorni'], ['month', '30 giorni'], ['year', '1 anno'], ['custom', 'Personalizzato']] as const).map(([val, label]) => {
          const active = period === val
          return (
            <button
              key={val}
              onClick={() => setPeriod(val)}
              style={{
                flexShrink: 0, padding: '9px 14px', borderRadius: 'var(--radius-md)',
                border: active ? '1px solid var(--accent)' : '1px solid var(--glass-border)',
                background: active ? 'var(--accent-glow)' : 'var(--glass-bg)',
                color: active ? 'var(--accent)' : 'var(--text-secondary)',
                fontSize: 13, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {label}
            </button>
          )
        })}
      </div>
      {period === 'custom' && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 'var(--space-lg)', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            Da
            <input type="date" value={customStart} max={customEnd || undefined} onChange={(e) => setCustomStart(e.target.value)}
              style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 13, padding: '7px 10px', outline: 'none' }} />
          </label>
          <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            A
            <input type="date" value={customEnd} min={customStart || undefined} onChange={(e) => setCustomEnd(e.target.value)}
              style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-md)', color: 'var(--text-primary)', fontSize: 13, padding: '7px 10px', outline: 'none' }} />
          </label>
        </div>
      )}

      {/* Tiles */}
      <div className="grid-fluid" style={{ marginBottom: 'var(--space-xl)' }}>
        <StatTile label="Prelievo rete" value={kwh(gridShown)} unit="kWh" color="#ff7043" icon={<ArrowDownToLine size={16} />} />
        {ids.gridTo.length > 0 && (
          <StatTile label="Immesso in rete" value={kwh(returned)} unit="kWh" color="#42a5f5" icon={<ArrowUpFromLine size={16} />} />
        )}
        {ids.solar.length > 0 && (
          <StatTile label="Produzione solare" value={kwh(solar)} unit="kWh" color="#66bb6a" icon={<Sun size={16} />} />
        )}
        {(ids.batteryFrom.length > 0 || ids.batteryTo.length > 0) && (
          <StatTile label="Batteria (carica)" value={kwh(battIn)} unit="kWh" color="#ab47bc" icon={<BatteryCharging size={16} />} />
        )}
        {(ids.batteryFrom.length > 0 || ids.batteryTo.length > 0) && (
          <StatTile label="Batteria (scarica)" value={kwh(battOut)} unit="kWh" color="#7e57c2" icon={<BatteryCharging size={16} />} />
        )}
        {ids.gridCost.length > 0 && (
          <StatTile label="Costo" value={`€ ${cost.toFixed(2)}`} unit="" color="#ffb300" icon={<Euro size={16} />} />
        )}
      </div>

      {/* Su schermi larghi: flusso e consumo per dispositivo affiancati in colonne */}
      <MasonryColumns rowGap="0px">
      {/* Flusso di energia (Rete → Casa → dispositivi) */}
      {homeTotal > 0 && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="text-caption" style={{ marginBottom: 12 }}>Flusso di energia</div>
          <GlassCard size="md">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              <span>Rete <b style={{ color: 'var(--text-primary)' }}>{kwh(gridShown)}</b> kWh</span>
              <span>Casa <b style={{ color: 'var(--text-primary)' }}>{kwh(homeTotal)}</b> kWh</span>
            </div>

            <Sankey areas={areaHierarchy} />

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 14px', marginTop: 16 }}>
              {areaHierarchy.map((a, i) => (
                <div key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: a.color, flexShrink: 0 }} />
                  {a.name} <span style={{ color: 'var(--text-tertiary)' }}>{kwh(a.value)}</span>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      )}

      {/* Consumo per dispositivo */}
      {devices.length > 0 && (
        <div>
          <div className="text-caption" style={{ marginBottom: 12 }}>Consumo per dispositivo</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {devices.slice(0, 8).map((d) => (
              <div key={d.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontSize: 13, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.name || d.id}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', flexShrink: 0 }}>{kwh(d.value)} kWh</span>
                </div>
                <div style={{ height: 6, borderRadius: 3, background: 'var(--glass-border-dim)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${Math.max(3, (d.value / maxDev) * 100)}%`, background: 'var(--accent)', borderRadius: 3 }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      </MasonryColumns>
    </motion.div>
  )
}
