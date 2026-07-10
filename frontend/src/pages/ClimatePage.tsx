import { motion } from 'framer-motion'
import { ChevronLeft, Thermometer, Home } from 'lucide-react'
import { useStore } from '../store'
import { ClimateCard } from '../components/cards/ClimateCard'
import { AreaTempCard } from '../components/cards/AreaTempCard'
import { GlassCard } from '../components/glass/GlassCard'
import { MasonryColumns } from '../components/MasonryColumns'
import { useT } from '../i18n'
import { getDomain } from '../types/ha'

export function ClimatePage({ onBack }: { onBack: () => void }) {
  const t = useT()
  const entities = useStore((s) => s.entities)
  const entityAreas = useStore((s) => s.entityAreas)
  const areas = useStore((s) => s.areas)
  const hiddenEntities = useStore((s) => s.hiddenEntities)
  const userHidden = useStore((s) => s.userHiddenEntities)

  // Medie temperatura per area + media casa (tutti i sensori temperatura)
  const agg: Record<string, { sum: number; count: number; sensorId: string }> = {}
  let houseSum = 0
  let houseCount = 0
  for (const [id, areaId] of Object.entries(entityAreas)) {
    if (hiddenEntities[id] || userHidden[id]) continue
    const e = entities[id]
    if (!e || getDomain(id) !== 'sensor') continue
    if ((e.attributes as Record<string, unknown>).device_class !== 'temperature') continue
    const v = parseFloat(e.state)
    if (isNaN(v)) continue
    const g = agg[areaId] ?? (agg[areaId] = { sum: 0, count: 0, sensorId: id })
    g.sum += v
    g.count += 1
    houseSum += v
    houseCount += 1
  }
  const areaTemps = areas
    .filter((a) => agg[a.area_id]?.count)
    .map((a) => ({ id: a.area_id, name: a.name, avg: agg[a.area_id].sum / agg[a.area_id].count, sensorId: agg[a.area_id].sensorId }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const houseAvg = houseCount > 0 ? houseSum / houseCount : null
  const r1 = (n: number) => Math.round(n * 10) / 10

  const climates = Object.values(entities).filter(
    (e) => getDomain(e.entity_id) === 'climate' && !hiddenEntities[e.entity_id] && !userHidden[e.entity_id]
  )

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
          <ChevronLeft size={16} /> {t('Indietro')}
        </button>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
          {t('Clima')}
        </h2>
      </div>

      <MasonryColumns rowGap="0px">
      {/* Media casa */}
      {houseAvg !== null && (
        <GlassCard size="lg" style={{ marginBottom: 'var(--space-xl)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: 'rgba(255,107,107,0.14)', border: '1px solid rgba(255,107,107,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff6b6b', flexShrink: 0 }}>
              <Home size={26} />
            </div>
            <div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{t('Media casa')}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 44, fontWeight: 300, lineHeight: 1, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>
                {r1(houseAvg)}<span style={{ fontSize: 20, fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 4 }}>°C</span>
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Media per ambiente */}
      {areaTemps.length > 0 && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="text-caption" style={{ marginBottom: 10 }}>{t('Media per ambiente')}</div>
          <div className="grid-fluid">
            {areaTemps.map((a) => (
              <AreaTempCard key={a.id} name={a.name} avg={a.avg} sensorId={a.sensorId} />
            ))}
          </div>
        </div>
      )}

      {/* Termostati / Climatizzatori */}
      {climates.length > 0 ? (
        <div>
          <div className="text-caption" style={{ marginBottom: 10 }}>{t('Termostati e climatizzatori')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {climates.map((e) => <ClimateCard key={e.entity_id} entity={e} />)}
          </div>
        </div>
      ) : (
        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)' }}>
          <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center' }}><Thermometer size={32} strokeWidth={1.5} /></div>
          <div>{t('Nessun termostato o climatizzatore')}</div>
        </div>
      )}
      </MasonryColumns>
    </motion.div>
  )
}
