import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Lightbulb, Moon } from 'lucide-react'
import { useStore } from '../store'
import { ClimatePage } from './ClimatePage'
import { AreaTempCard } from '../components/cards/AreaTempCard'
import { LightCard } from '../components/cards/LightCard'
import { ClimateCard } from '../components/cards/ClimateCard'
import { MediaCard } from '../components/cards/MediaCard'
import { WeatherCard } from '../components/cards/WeatherCard'
import { CalendarCard } from '../components/cards/CalendarCard'
import { WasteCard } from '../components/cards/WasteCard'
import { EnergyCard } from '../components/cards/EnergyCard'
import { MyDevicesSection } from '../components/cards/MyDevicesCard'
import { usePinnedEntities } from '../hooks/useEntities'
import { getDomain } from '../types/ha'

function useGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Buongiorno'
  if (hour < 18) return 'Buon pomeriggio'
  if (hour < 22) return 'Buona sera'
  return 'Buonanotte'
}

function formatDate(): string {
  return new Date().toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
}

export function HomePage() {
  const connected = useStore((s) => s.connected)
  const entities = useStore((s) => s.entities)
  const hiddenEntities = useStore((s) => s.hiddenEntities)
  const userHidden = useStore((s) => s.userHiddenEntities)
  const areas = useStore((s) => s.areas)
  const entityAreas = useStore((s) => s.entityAreas)
  const enabledAreas = useStore((s) => s.enabledAreas)
  const weatherEnabled = useStore((s) => s.weatherEnabled)
  const calendarEnabled = useStore((s) => s.calendarEnabled)
  const wasteEnabled = useStore((s) => s.wasteEnabled)
  const wasteSchedule = useStore((s) => s.wasteSchedule)
  const energyEnabled = useStore((s) => s.energyEnabled)
  const greeting = useGreeting()
  const pinnedEntities = usePinnedEntities()
  const [showClimate, setShowClimate] = useState(false)

  // Entità attive da mostrare nella home (luci accese, media in play, clima attivo)
  const activeEntities = useMemo(() => {
    return Object.values(entities).filter((e) => {
      if (hiddenEntities[e.entity_id] || userHidden[e.entity_id]) return false
      const domain = getDomain(e.entity_id)
      if (domain === 'light') return e.state === 'on'
      if (domain === 'climate') return e.state !== 'off'
      // i media in riproduzione sono già mostrati nella sezione "In riproduzione"
      return false
    }).slice(0, 6)
  }, [entities, hiddenEntities, userHidden])

  // Temperatura media per ambiente (media dei sensori temperatura di ogni area)
  const areaTemps = useMemo(() => {
    const agg: Record<string, { sum: number; count: number; sensorId: string }> = {}
    for (const [entityId, areaId] of Object.entries(entityAreas)) {
      if (hiddenEntities[entityId] || userHidden[entityId]) continue
      const e = entities[entityId]
      if (!e || getDomain(entityId) !== 'sensor') continue
      if ((e.attributes as Record<string, unknown>).device_class !== 'temperature') continue
      const v = parseFloat(e.state)
      if (isNaN(v)) continue
      const g = agg[areaId] ?? (agg[areaId] = { sum: 0, count: 0, sensorId: entityId })
      g.sum += v
      g.count += 1
    }
    return areas
      .filter((a) => agg[a.area_id]?.count && (enabledAreas.length === 0 || enabledAreas.includes(a.area_id)))
      .map((a) => ({ id: a.area_id, name: a.name, avg: agg[a.area_id].sum / agg[a.area_id].count, sensorId: agg[a.area_id].sensorId }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [entities, entityAreas, hiddenEntities, userHidden, areas, enabledAreas])

  // Media player attivo
  const featuredMedia = useMemo(() => {
    return Object.values(entities).find(
      (e) => getDomain(e.entity_id) === 'media_player' && e.state === 'playing' &&
        !hiddenEntities[e.entity_id] && !userHidden[e.entity_id]
    )
  }, [entities, hiddenEntities, userHidden])

  const enabledAreasData = useMemo(
    () => areas.filter((a) => enabledAreas.includes(a.area_id)),
    [areas, enabledAreas]
  )

  const totalLightsOn = useMemo(
    () =>
      Object.values(entities).filter(
        (e) =>
          getDomain(e.entity_id) === 'light' &&
          e.state === 'on' &&
          !hiddenEntities[e.entity_id] &&
          !userHidden[e.entity_id]
      ).length,
    [entities, hiddenEntities, userHidden]
  )

  const hasWeather = useMemo(() => Object.keys(entities).some((id) => id.startsWith('weather.')), [entities])
  const hasCalendar = useMemo(() => Object.keys(entities).some((id) => id.startsWith('calendar.')), [entities])
  const hasWaste = useMemo(() => Object.values(wasteSchedule).some((d) => d.length > 0), [wasteSchedule])

  return (
    <div className="page">
      {/* Header */}
      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <h1
          className="on-wall"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 34,
            fontWeight: 800,
            letterSpacing: '-0.04em',
            marginBottom: 4,
          }}
        >
          {greeting}
        </h1>
        <p className="on-wall-dim" style={{ fontSize: 14, textTransform: 'capitalize' }}>
          {formatDate()}
        </p>
      </div>

      {/* Quick stats */}
      {(totalLightsOn > 0 || enabledAreasData.length > 0) && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 'var(--space-xl)', overflowX: 'auto', paddingBottom: 4 }}>
          {totalLightsOn > 0 && (
            <div
              style={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                background: 'rgba(255,212,0,0.12)',
                border: '1px solid rgba(255,212,0,0.25)',
                borderRadius: 'var(--radius-pill)',
                padding: '8px 16px',
                fontSize: 13,
                color: '#ffd400',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              <Lightbulb size={14} />
              {totalLightsOn} {totalLightsOn === 1 ? 'luce accesa' : 'luci accese'}
            </div>
          )}
          {enabledAreasData.slice(0, 3).map((area) => (
            <div
              key={area.area_id}
              style={{
                flexShrink: 0,
                background: 'var(--glass-bg)',
                border: '1px solid var(--glass-border)',
                borderRadius: 'var(--radius-pill)',
                padding: '8px 16px',
                fontSize: 13,
                color: 'var(--text-secondary)',
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {area.name}
            </div>
          ))}
        </div>
      )}

      {/* Sezioni: su schermi larghi vanno su più colonne (masonry) per usare lo spazio */}
      <div className="page-grid">
      {/* Meteo */}
      {weatherEnabled && hasWeather && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="text-caption on-wall-dim" style={{ marginBottom: 10 }}>Meteo</div>
          <WeatherCard />
        </div>
      )}

      {/* Elettricità (si auto-nasconde se la dashboard Energia non è configurata) */}
      {energyEnabled && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <EnergyCard />
        </div>
      )}

      {/* Calendario */}
      {calendarEnabled && hasCalendar && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="text-caption on-wall-dim" style={{ marginBottom: 10 }}>Calendario</div>
          <CalendarCard />
        </div>
      )}

      {/* Rifiuti */}
      {wasteEnabled && hasWaste && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="text-caption on-wall-dim" style={{ marginBottom: 10 }}>Rifiuti</div>
          <WasteCard />
        </div>
      )}

      {/* I miei dispositivi (telefono/watch dell'utente corrente) — sotto Rifiuti */}
      <MyDevicesSection />

      {/* Featured media player */}
      {featuredMedia && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="text-caption on-wall-dim" style={{ marginBottom: 10 }}>In riproduzione</div>
          <motion.div className="anim-slide-up">
            <MediaCard entity={featuredMedia} featured />
          </motion.div>
        </div>
      )}

      {/* Entità attive */}
      {activeEntities.length > 0 && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="text-caption on-wall-dim" style={{ marginBottom: 10 }}>Attivo ora</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }} className="stagger-grid">
            {activeEntities.map((entity, i) => {
              const domain = getDomain(entity.entity_id)
              return (
                <motion.div key={entity.entity_id} className="anim-slide-up" style={{ animationDelay: `${i * 60}ms` }}>
                  {domain === 'light' && <LightCard entity={entity} compact />}
                  {domain === 'climate' && <ClimateCard entity={entity} />}
                  {domain === 'media_player' && <MediaCard entity={entity} />}
                </motion.div>
              )
            })}
          </div>
        </div>
      )}

      {/* Ambienti — temperatura media per stanza */}
      {areaTemps.length > 0 && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="text-caption on-wall-dim" style={{ marginBottom: 10 }}>Ambienti</div>
          <div className="grid-fluid stagger-grid">
            {areaTemps.map((a, i) => (
              <motion.div key={a.id} className="anim-scale-in" style={{ animationDelay: `${i * 60}ms`, minWidth: 0 }}>
                <AreaTempCard name={a.name} avg={a.avg} sensorId={a.sensorId} onClick={() => setShowClimate(true)} />
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Placeholder quando tutto è spento */}
      {activeEntities.length === 0 && areaTemps.length === 0 && connected && (
        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)' }}>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
            <Moon size={40} strokeWidth={1.5} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
            Tutto spento
          </div>
          <div style={{ fontSize: 14 }}>
            Vai in <strong style={{ color: 'var(--text-secondary)' }}>Stanze</strong> per controllare i dispositivi
          </div>
        </div>
      )}
      </div>

      {createPortal(
        <AnimatePresence>
          {showClimate && <ClimatePage onBack={() => setShowClimate(false)} />}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}
