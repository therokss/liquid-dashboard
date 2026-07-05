import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronLeft, Home, BedDouble, Utensils, Sofa, Bath, Car, TreePine, PackageOpen, Thermometer, Droplets, DoorOpen, DoorClosed, Zap, Blinds, Warehouse, Fan, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import { useHA } from '../hooks/useHA'
import { LightCard } from '../components/cards/LightCard'
import { ClimateCard } from '../components/cards/ClimateCard'
import { AppliancesSection } from '../components/cards/ApplianceCard'
import { HueSyncSection } from '../components/cards/HueSyncCard'
import { DeviceDetailModal } from '../components/DeviceDetailModal'
import { getDomain } from '../types/ha'
import type { HassArea, HassEntity } from '../types/ha'

const AREA_ICONS: Record<string, React.ReactNode> = {
  soggiorno: <Sofa size={24} />,
  sala: <Sofa size={24} />,
  cucina: <Utensils size={24} />,
  camera: <BedDouble size={24} />,
  bagno: <Bath size={24} />,
  garage: <Car size={24} />,
  giardino: <TreePine size={24} />,
  default: <Home size={24} />,
}

function getAreaIcon(name: string): React.ReactNode {
  const lower = name.toLowerCase()
  for (const [key, icon] of Object.entries(AREA_ICONS)) {
    if (lower.includes(key)) return icon
  }
  return AREA_ICONS.default
}

const AREA_GRADIENTS = [
  ['#667eea', '#764ba2'],
  ['#f093fb', '#f5576c'],
  ['#4facfe', '#00f2fe'],
  ['#43e97b', '#38f9d7'],
  ['#fa709a', '#fee140'],
  ['#a18cd1', '#fbc2eb'],
  ['#ff9a9e', '#fecfef'],
  ['#a1c4fd', '#c2e9fb'],
]

// Dispositivi "controllabili" (per il conteggio nelle card stanza)
const CONTROLLABLE = new Set(['light', 'switch', 'climate', 'media_player', 'cover', 'fan', 'lock', 'vacuum', 'humidifier'])

interface AreaDetailProps {
  area: HassArea
  onBack: () => void
  gradientColors: string[]
}

function AreaDetail({ area, onBack, gradientColors }: AreaDetailProps) {
  const entities = useStore((s) => s.entities)
  const entityAreas = useStore((s) => s.entityAreas)
  const entityDevices = useStore((s) => s.entityDevices)
  const hiddenEntities = useStore((s) => s.hiddenEntities)
  const userHidden = useStore((s) => s.userHiddenEntities)
  const powerSel = useStore((s) => s.energyPowerEntity)
  const { callService } = useHA()
  const [openBadge, setOpenBadge] = useState<string | null>(null)

  const areaEntities = useMemo(
    () =>
      Object.values(entities).filter(
        (e) =>
          entityAreas[e.entity_id] === area.area_id &&
          !hiddenEntities[e.entity_id] &&
          !userHidden[e.entity_id]
      ),
    [entities, entityAreas, hiddenEntities, userHidden, area.area_id]
  )

  const lights = areaEntities.filter((e) => getDomain(e.entity_id) === 'light')
  const climates = areaEntities.filter((e) => getDomain(e.entity_id) === 'climate')
  const fans = areaEntities.filter((e) => getDomain(e.entity_id) === 'fan')

  // Device già gestiti da card/schermate dedicate (ventilatore, Hue Sync Box,
  // videocamera): i loro interruttori non vanno ripetuti nella sezione generica
  // "Interruttori" — quelli della videocamera stanno dentro alla videocamera (Sicurezza).
  const managedDevices = new Set<string>()
  for (const e of areaEntities) {
    const d = entityDevices[e.entity_id]
    if (!d) continue
    if (getDomain(e.entity_id) === 'fan') managedDevices.add(d)
    if (e.entity_id.startsWith('camera.')) managedDevices.add(d)
    if (e.entity_id.startsWith('select.') && e.entity_id.endsWith('_hdmi_input')) managedDevices.add(d)
  }
  const switches = areaEntities.filter((e) => getDomain(e.entity_id) === 'switch' && !managedDevices.has(entityDevices[e.entity_id]))

  // Badge di stato in cima alla stanza
  const dc = (e: HassEntity) => (e.attributes as Record<string, unknown>).device_class as string | undefined
  const num = (s: string) => { const n = parseFloat(s); return isNaN(n) ? null : n }
  const nameOf = (e: HassEntity) => ((e.attributes as Record<string, unknown>).friendly_name as string) || e.entity_id
  const unitOf = (e: HassEntity) => ((e.attributes as Record<string, unknown>).unit_of_measurement as string) || ''
  const toW = (e: HassEntity) => {
    const n = num(e.state); if (n === null) return 0
    return unitOf(e) === 'kW' ? n * 1000 : n
  }
  const fmtW = (w: number) => (w >= 1000 ? `${(w / 1000).toLocaleString('it-IT', { maximumFractionDigits: 2 })} kW` : `${Math.round(w)} W`)
  const round1 = (n: number) => Math.round(n * 10) / 10

  const tempSensors = areaEntities.filter((e) => getDomain(e.entity_id) === 'sensor' && dc(e) === 'temperature' && num(e.state) !== null)
  const humSensors = areaEntities.filter((e) => getDomain(e.entity_id) === 'sensor' && dc(e) === 'humidity' && num(e.state) !== null)
  const doors = areaEntities.filter((e) => getDomain(e.entity_id) === 'binary_sensor' && (dc(e) === 'door' || dc(e) === 'opening'))
  const windows = areaEntities.filter((e) => getDomain(e.entity_id) === 'binary_sensor' && dc(e) === 'window')
  const garages = areaEntities.filter((e) => getDomain(e.entity_id) === 'binary_sensor' && dc(e) === 'garage_door')
  const areaPowerSensors = areaEntities.filter((e) => getDomain(e.entity_id) === 'sensor' && dc(e) === 'power')
  const areaW = areaPowerSensors.reduce((s, e) => s + toW(e), 0)
  const houseEnt = (powerSel && entities[powerSel]) ? entities[powerSel] : Object.values(entities).find((e) => getDomain(e.entity_id) === 'sensor' && dc(e) === 'power')
  const houseW = houseEnt ? toW(houseEnt) : null

  type BadgeItem = { name: string; value: string }
  const badges: Array<{ key: string; icon: React.ReactNode; label: string; value: string; list?: BadgeItem[] }> = []

  if (tempSensors.length) {
    const avg = tempSensors.reduce((s, e) => s + num(e.state)!, 0) / tempSensors.length
    badges.push({
      key: 'temp', icon: <Thermometer size={16} />, label: 'Temperatura', value: `${round1(avg)}°`,
      list: tempSensors.map((e) => ({ name: nameOf(e), value: `${round1(num(e.state)!)}${unitOf(e) || '°'}` })),
    })
  }
  if (humSensors.length) {
    const avg = humSensors.reduce((s, e) => s + num(e.state)!, 0) / humSensors.length
    badges.push({
      key: 'hum', icon: <Droplets size={16} />, label: 'Umidità', value: `${Math.round(avg)}%`,
      list: humSensors.map((e) => ({ name: nameOf(e), value: `${round1(num(e.state)!)}${unitOf(e) || '%'}` })),
    })
  }
  const pushOpenables = (
    key: string, list: HassEntity[], one: string, many: string,
    openW: string, openN: string, closedW: string, IconO: typeof DoorOpen, IconC: typeof DoorClosed,
  ) => {
    if (!list.length) return
    const open = list.filter((e) => e.state === 'on').length
    const Icon = open > 0 ? IconO : IconC
    badges.push({
      key, icon: <Icon size={16} />, label: list.length === 1 ? one : many,
      value: open === 0 ? closedW : open === 1 ? openW : `${open} ${openN}`,
      list: list.map((e) => ({ name: nameOf(e), value: e.state === 'on' ? 'Aperto' : 'Chiuso' })),
    })
  }
  pushOpenables('doors', doors, 'Porta', 'Porte', 'Aperta', 'aperte', 'Chiusa', DoorOpen, DoorClosed)
  pushOpenables('windows', windows, 'Finestra', 'Finestre', 'Aperta', 'aperte', 'Chiusa', Blinds, Blinds)
  pushOpenables('garage', garages, 'Garage', 'Garage', 'Aperto', 'aperti', 'Chiuso', Warehouse, Warehouse)

  if (areaPowerSensors.length) badges.push({
    key: 'areaP', icon: <Zap size={16} />, label: 'Corrente area', value: fmtW(areaW),
    list: areaPowerSensors.map((e) => ({ name: nameOf(e), value: fmtW(toW(e)) })),
  })
  if (houseW !== null) badges.push({ key: 'houseP', icon: <Zap size={16} />, label: 'Corrente casa', value: fmtW(houseW) })

  const openBadgeList = badges.find((b) => b.key === openBadge && b.list && b.list.length)?.list

  return (
    <motion.div
      initial={{ x: '100%' }}
      animate={{ x: 0 }}
      exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        overflowY: 'auto',
        background: 'var(--overlay-scrim)',
        backdropFilter: 'blur(32px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(32px) saturate(1.4)',
      }}
      className="page"
    >
      {/* Header area */}
      <div
        style={{
          background: `linear-gradient(135deg, ${gradientColors[0]}, ${gradientColors[1]})`,
          borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-lg)',
          marginBottom: 'var(--space-lg)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.18)', borderRadius: 'inherit' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'var(--glass-specular)', borderRadius: 'inherit' }} />
        <div style={{ position: 'relative' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 'var(--space-md)' }}>
            <button
              onClick={onBack}
              style={{
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.28)',
                borderRadius: 'var(--radius-pill)',
                color: 'white',
                padding: '6px 14px 6px 10px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              <ChevronLeft size={16} />
              Stanze
            </button>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 11,
                background: 'rgba(255,255,255,0.2)',
                border: '1px solid rgba(255,255,255,0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                flexShrink: 0,
              }}
            >
              {getAreaIcon(area.name)}
            </div>
          </div>
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 30,
              fontWeight: 800,
              color: 'white',
              letterSpacing: '-0.04em',
            }}
          >
            {area.name}
          </h2>
          <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, marginTop: 2 }}>
            {areaEntities.length} {areaEntities.length === 1 ? 'elemento' : 'elementi'}
          </p>
        </div>
      </div>

      {/* Badge di stato */}
      {badges.length > 0 && (
        <div style={{ marginBottom: 'var(--space-lg)' }}>
          <div className="glass-scroll" style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 4 }}>
            {badges.map((b) => {
              const clickable = Boolean(b.list && b.list.length)
              const active = openBadge === b.key
              return (
                <button
                  key={b.key}
                  onClick={() => clickable && setOpenBadge(active ? null : b.key)}
                  style={{
                    flexShrink: 0, minWidth: 108, display: 'flex', alignItems: 'center', gap: 10,
                    padding: '12px 14px', borderRadius: 'var(--radius-md)', textAlign: 'left',
                    background: active ? 'var(--accent-glow)' : 'var(--glass-bg)',
                    border: active ? '1px solid var(--accent)' : '1px solid var(--glass-border)',
                    cursor: clickable ? 'pointer' : 'default',
                  }}
                >
                  <span style={{ color: 'var(--accent)', flexShrink: 0 }}>{b.icon}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', fontWeight: 600, whiteSpace: 'nowrap' }}>{b.label}</div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{b.value}</div>
                  </div>
                </button>
              )
            })}
          </div>
          <AnimatePresence initial={false}>
            {openBadgeList && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                style={{ overflow: 'hidden' }}
              >
                <div className="glass-card" style={{ padding: '4px var(--space-md)', marginTop: 10 }}>
                  {openBadgeList.map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderBottom: i < openBadgeList.length - 1 ? '1px solid var(--glass-border-dim)' : 'none' }}>
                      <span style={{ fontSize: 14, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', flexShrink: 0 }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Contenuto */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}>
        {lights.length > 0 && (
          <div>
            <div className="text-caption" style={{ marginBottom: 10 }}>Luci</div>
            {lights.length === 1 ? (
              <LightCard entity={lights[0]} />
            ) : (
              <div className="grid-fluid">
                {lights.map((e) => <LightCard key={e.entity_id} entity={e} compact />)}
              </div>
            )}
          </div>
        )}

        {climates.length > 0 && (
          <div>
            <div className="text-caption" style={{ marginBottom: 10 }}>Clima</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {climates.map((e) => <ClimateCard key={e.entity_id} entity={e} />)}
            </div>
          </div>
        )}

        <AppliancesSection areaEntities={areaEntities} />

        <HueSyncSection areaEntities={areaEntities} />

        {fans.length > 0 && (
          <div>
            <div className="text-caption" style={{ marginBottom: 10 }}>Ventilatori</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {fans.map((e) => <FanCard key={e.entity_id} entity={e} onToggle={() => callService('homeassistant', e.state === 'on' ? 'turn_off' : 'turn_on', { entity_id: e.entity_id })} />)}
            </div>
          </div>
        )}

        {switches.length > 0 && (
          <div>
            <div className="text-caption" style={{ marginBottom: 10 }}>Interruttori</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {switches.map((e) => (
                <SwitchCard
                  key={e.entity_id}
                  entity={e}
                  onToggle={() => callService('switch', e.state === 'on' ? 'turn_off' : 'turn_on', { entity_id: e.entity_id })}
                />
              ))}
            </div>
          </div>
        )}


        {areaEntities.length === 0 && (
          <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)' }}>
            <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}>
              <PackageOpen size={32} strokeWidth={1.5} />
            </div>
            <div>Nessun dispositivo assegnato a questa stanza</div>
          </div>
        )}
      </div>
    </motion.div>
  )
}

function SwitchCard({ entity, onToggle }: { entity: { entity_id: string; state: string; attributes: Record<string, unknown> }; onToggle: () => void }) {
  const isOn = entity.state === 'on'
  const name = (entity.attributes.friendly_name as string) ?? entity.entity_id

  return (
    <div className="glass-card" style={{ padding: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>{isOn ? 'Acceso' : 'Spento'}</div>
      </div>
      <label className="glass-toggle">
        <input type="checkbox" checked={isOn} onChange={onToggle} />
        <div className="glass-toggle-track" />
        <div className="glass-toggle-thumb" style={{ transform: isOn ? 'translateX(20px)' : 'translateX(0)' }} />
      </label>
    </div>
  )
}

function FanCard({ entity, onToggle }: { entity: HassEntity; onToggle: () => void }) {
  const [detail, setDetail] = useState(false)
  const isOn = entity.state === 'on'
  const name = (entity.attributes.friendly_name as string) ?? entity.entity_id
  const pct = entity.attributes.percentage as number | undefined
  return (
    <>
      <div className="glass-card" style={{ padding: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }} onClick={() => setDetail(true)}>
        <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, background: isOn ? 'var(--accent-glow)' : 'var(--glass-bg-active)', border: '1px solid var(--glass-border)', color: isOn ? 'var(--accent)' : 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Fan size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>{isOn ? (typeof pct === 'number' ? `${pct}%` : 'Acceso') : 'Spento'} · tocca per i controlli</div>
        </div>
        <label className="glass-toggle" style={{ flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={isOn} onChange={onToggle} />
          <div className="glass-toggle-track" />
          <div className="glass-toggle-thumb" style={{ transform: isOn ? 'translateX(20px)' : 'translateX(0)' }} />
        </label>
        <ChevronRight size={18} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
      </div>
      {detail && <DeviceDetailModal entityId={entity.entity_id} onClose={() => setDetail(false)} />}
    </>
  )
}

interface AreaStat { devices: number; total: number; lightsOn: number; windowsOpen: number }

function RoomCard({ area, gradient, stat, onClick, index }: {
  area: HassArea
  gradient: string[]
  stat: AreaStat | undefined
  onClick: () => void
  index: number
}) {
  const [c1, c2] = gradient
  const total = stat?.total ?? 0
  const devices = stat?.devices ?? 0
  const lightsOn = stat?.lightsOn ?? 0
  const windowsOpen = stat?.windowsOpen ?? 0
  const subtitle = total === 0
    ? 'Vuota'
    : devices > 0
      ? `${devices} ${devices === 1 ? 'dispositivo' : 'dispositivi'}`
      : `${total} ${total === 1 ? 'sensore' : 'sensori'}`

  return (
    <motion.button
      className="anim-scale-in"
      style={{ animationDelay: `${index * 45}ms`, border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
    >
      <div
        style={{
          background: `linear-gradient(140deg, ${c1}, ${c2})`,
          borderRadius: 'var(--radius-lg)',
          aspectRatio: '1',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 'var(--space-lg)',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        }}
      >
        {/* Livelli vetro */}
        <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.12)', borderRadius: 'inherit' }} />
        <div style={{ position: 'absolute', inset: 0, background: 'var(--glass-specular)', borderRadius: 'inherit' }} />
        {/* Bagliore radiale in basso */}
        <div style={{ position: 'absolute', right: -30, bottom: -30, width: 120, height: 120, background: 'radial-gradient(circle, rgba(255,255,255,0.25), transparent 70%)', borderRadius: '50%' }} />

        {/* Top: icona + badge luci accese */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 14,
              background: 'rgba(255,255,255,0.22)',
              border: '1px solid rgba(255,255,255,0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'white',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
            }}
          >
            {getAreaIcon(area.name)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            {lightsOn > 0 && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, background: 'rgba(0,0,0,0.28)', borderRadius: 'var(--radius-pill)', padding: '4px 9px', fontSize: 12, fontWeight: 700, color: 'white' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ffd400', boxShadow: '0 0 8px #ffd400' }} />
                {lightsOn}
              </div>
            )}
            {windowsOpen > 0 && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(0,0,0,0.28)', borderRadius: 'var(--radius-pill)', padding: '4px 9px', fontSize: 12, fontWeight: 700, color: 'white' }}>
                <Blinds size={12} />
                {windowsOpen}
              </div>
            )}
          </div>
        </div>

        {/* Bottom: nome + sottotitolo */}
        <div style={{ position: 'relative', textAlign: 'left' }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: 'white', letterSpacing: '-0.02em', lineHeight: 1.15 }}>
            {area.name}
          </div>
          <div style={{ fontSize: 12.5, fontWeight: 500, color: 'rgba(255,255,255,0.8)', marginTop: 3 }}>
            {subtitle}
          </div>
        </div>
      </div>
    </motion.button>
  )
}

export function RoomsPage() {
  const areas = useStore((s) => s.areas)
  const enabledAreas = useStore((s) => s.enabledAreas)
  const entities = useStore((s) => s.entities)
  const entityAreas = useStore((s) => s.entityAreas)
  const hiddenEntities = useStore((s) => s.hiddenEntities)
  const userHidden = useStore((s) => s.userHiddenEntities)
  const [selectedArea, setSelectedArea] = useState<HassArea | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Se l'utente non ha configurato aree specifiche (es. setup saltato in modalità
  // proxy automatica), mostriamo tutte le aree caricate da Home Assistant.
  const visibleAreas = useMemo(
    () =>
      enabledAreas.length > 0
        ? areas.filter((a) => enabledAreas.includes(a.area_id))
        : areas,
    [areas, enabledAreas]
  )

  // Statistiche per area (conteggio dispositivi controllabili, totale, luci accese)
  const areaStats = useMemo(() => {
    const stats: Record<string, AreaStat> = {}
    for (const [entityId, areaId] of Object.entries(entityAreas)) {
      if (hiddenEntities[entityId] || userHidden[entityId]) continue
      const e = entities[entityId]
      if (!e) continue
      const s = stats[areaId] ?? (stats[areaId] = { devices: 0, total: 0, lightsOn: 0, windowsOpen: 0 })
      s.total++
      const domain = getDomain(entityId)
      if (CONTROLLABLE.has(domain)) s.devices++
      if (domain === 'light' && e.state === 'on') s.lightsOn++
      if (domain === 'binary_sensor' && (e.attributes as Record<string, unknown>).device_class === 'window' && e.state === 'on') s.windowsOpen++
    }
    return stats
  }, [entities, entityAreas, hiddenEntities, userHidden])

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <div className="page" style={{ visibility: selectedArea ? 'hidden' : 'visible' }}>
        {/* Header */}
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 34,
              fontWeight: 800,
              color: 'var(--text-primary)',
              letterSpacing: '-0.04em',
            }}
          >
            Stanze
          </h1>
        </div>

        {/* Grid stanze */}
        <div className="grid-fluid-lg">
          {visibleAreas.map((area, index) => (
            <RoomCard
              key={area.area_id}
              area={area}
              index={index}
              gradient={AREA_GRADIENTS[index % AREA_GRADIENTS.length]}
              stat={areaStats[area.area_id]}
              onClick={() => { setSelectedArea(area); setSelectedIndex(index) }}
            />
          ))}
        </div>

        {visibleAreas.length === 0 && (
          <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)' }}>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>
              <Home size={40} strokeWidth={1.5} />
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Nessuna stanza trovata
            </div>
            <div style={{ fontSize: 14 }}>Assegna delle aree ai dispositivi in Home Assistant</div>
          </div>
        )}
      </div>

      {/* Area detail overlay */}
      <AnimatePresence>
        {selectedArea && (
          <AreaDetail
            area={selectedArea}
            gradientColors={AREA_GRADIENTS[selectedIndex % AREA_GRADIENTS.length]}
            onBack={() => setSelectedArea(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
