import { useCallback, useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { Thermometer, Wind, ChevronUp, ChevronDown, Flame, Snowflake, Minus } from 'lucide-react'
import { GlassCard } from '../glass/GlassCard'
import { MiniChart } from '../charts/MiniChart'
import { useStore } from '../../store'
import { useHA } from '../../hooks/useHA'
import { getDomain } from '../../types/ha'
import type { HassEntity, ClimateAttributes } from '../../types/ha'

interface ClimateCardProps {
  entity: HassEntity
}

const MODE_ICONS: Record<string, React.ReactNode> = {
  heat: <Flame size={16} color="#ff6b35" />,
  cool: <Snowflake size={16} color="#4fc3f7" />,
  heat_cool: <Wind size={16} color="#ab47bc" />,
  auto: <Wind size={16} color="var(--accent)" />,
  fan_only: <Wind size={16} color="var(--text-secondary)" />,
  off: <Minus size={16} color="var(--text-tertiary)" />,
  dry: <Wind size={16} color="#ffca28" />,
}

const MODE_COLORS: Record<string, string> = {
  heat: '#ff6b35',
  cool: '#4fc3f7',
  heat_cool: '#ab47bc',
  auto: '#00dbe7',
  fan_only: '#8b90a0',
  off: '#8b90a0',
  dry: '#ffca28',
}

const MODE_LABELS: Record<string, string> = {
  off: 'Spento',
  heat: 'Riscaldamento',
  cool: 'Raffredda',
  heat_cool: 'Auto',
  auto: 'Auto',
  dry: 'Deumidifica',
  fan_only: 'Ventola',
}

export function ClimateCard({ entity }: ClimateCardProps) {
  const { callService, getEntityHistory } = useHA()
  const entities = useStore((s) => s.entities)
  const entityAreas = useStore((s) => s.entityAreas)
  const attrs = entity.attributes as ClimateAttributes
  const isOff = entity.state === 'off'
  const name = attrs.friendly_name ?? entity.entity_id
  const currentTemp = attrs.current_temperature
  const targetTemp = attrs.temperature ?? 20
  const hvacAction = attrs.hvac_action ?? entity.state
  const modes = attrs.hvac_modes ?? []
  const unit = attrs.unit_of_measurement ?? '°C'

  const [localTarget, setLocalTarget] = useState<number | null>(null)
  const displayTarget = localTarget ?? targetTemp

  // Media temperatura della stanza in cui si trova il clima
  const roomAvg = useMemo(() => {
    const areaId = entityAreas[entity.entity_id]
    if (!areaId) return null
    let sum = 0
    let count = 0
    for (const [id, aId] of Object.entries(entityAreas)) {
      if (aId !== areaId) continue
      const e = entities[id]
      if (!e || getDomain(id) !== 'sensor') continue
      if ((e.attributes as Record<string, unknown>).device_class !== 'temperature') continue
      const v = parseFloat(e.state)
      if (isNaN(v)) continue
      sum += v
      count += 1
    }
    return count ? sum / count : null
  }, [entities, entityAreas, entity.entity_id])

  // Storico: temperatura stanza (current) vs impostata (target)
  const [history, setHistory] = useState<{ current: number[]; target: number[] }>({ current: [], target: [] })
  useEffect(() => {
    let cancelled = false
    getEntityHistory(entity.entity_id, 24)
      .then((h) => {
        if (cancelled) return
        const current: number[] = []
        const target: number[] = []
        for (const item of h) {
          const c = parseFloat(String((item.attributes as Record<string, unknown>).current_temperature ?? ''))
          const t = parseFloat(String((item.attributes as Record<string, unknown>).temperature ?? ''))
          if (!isNaN(c) && !isNaN(t)) { current.push(c); target.push(t) }
        }
        setHistory({ current, target })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [entity.entity_id, getEntityHistory])

  const r1 = (n: number) => Math.round(n * 10) / 10

  const modeColor = MODE_COLORS[hvacAction] ?? MODE_COLORS[entity.state] ?? 'var(--accent)'
  const glowColor = !isOff ? `${modeColor}44` : undefined

  const setTemperature = useCallback(
    (temp: number) => {
      const clamped = Math.max(attrs.min_temp ?? 5, Math.min(attrs.max_temp ?? 35, temp))
      setLocalTarget(clamped)
      callService('climate', 'set_temperature', {
        entity_id: entity.entity_id,
        temperature: clamped,
      })
    },
    [callService, entity.entity_id, attrs.min_temp, attrs.max_temp]
  )

  const setMode = useCallback(
    (mode: string) => {
      callService('climate', 'set_hvac_mode', {
        entity_id: entity.entity_id,
        hvac_mode: mode,
      })
    },
    [callService, entity.entity_id]
  )

  return (
    <GlassCard glowColor={glowColor} active={!isOff} size="md">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-lg)' }}>
        <div>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: isOff ? 'rgba(255,255,255,0.08)' : `${modeColor}22`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 10,
              border: `1px solid ${isOff ? 'transparent' : `${modeColor}44`}`,
            }}
          >
            <Thermometer size={22} color={isOff ? 'var(--text-tertiary)' : modeColor} />
          </div>
          <div style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {name}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
            {isOff ? 'Spento' : (attrs.hvac_action ?? entity.state)}
            {roomAvg !== null ? ` · Media stanza ${r1(roomAvg)}°` : ''}
          </div>
        </div>

        {/* Temperatura corrente grande */}
        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 48,
              fontWeight: 300,
              letterSpacing: '-0.04em',
              color: isOff ? 'var(--text-tertiary)' : 'var(--text-primary)',
              lineHeight: 1,
            }}
          >
            {currentTemp !== undefined ? `${currentTemp}` : '--'}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 13, textAlign: 'right' }}>
            {unit} attuale
          </div>
        </div>
      </div>

      {/* Target temperature control */}
      {!isOff && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(255,255,255,0.06)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            marginBottom: 'var(--space-md)',
          }}
        >
          <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Target</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <motion.button
              whileTap={{ scale: 0.85 }}
              onClick={() => setTemperature(displayTarget - 0.5)}
              style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer', display: 'flex' }}
            >
              <ChevronDown size={16} color="var(--text-primary)" />
            </motion.button>
            <span
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 28,
                fontWeight: 600,
                color: modeColor,
                letterSpacing: '-0.03em',
                minWidth: 60,
                textAlign: 'center',
              }}
            >
              {displayTarget}{unit}
            </span>
            <motion.button
              whileTap={{ scale: 0.85 }}
              onClick={() => setTemperature(displayTarget + 0.5)}
              style={{ background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 8, padding: 8, cursor: 'pointer', display: 'flex' }}
            >
              <ChevronUp size={16} color="var(--text-primary)" />
            </motion.button>
          </div>
        </div>
      )}

      {/* Mode selector */}
      {modes.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {modes.map((mode) => {
            const isActive = mode === entity.state
            return (
              <motion.button
                key={mode}
                whileTap={{ scale: 0.9 }}
                onClick={() => setMode(mode)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-pill)',
                  border: `1px solid ${isActive ? (MODE_COLORS[mode] ?? 'var(--accent)') : 'var(--glass-border)'}`,
                  background: isActive ? `${MODE_COLORS[mode] ?? 'var(--accent)'}22` : 'rgba(255,255,255,0.05)',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  color: isActive ? (MODE_COLORS[mode] ?? 'var(--accent)') : 'var(--text-secondary)',
                }}
              >
                {MODE_ICONS[mode] ?? null}
                <span>{MODE_LABELS[mode] ?? mode}</span>
              </motion.button>
            )
          })}
        </div>
      )}

      {/* Grafico 24h: temperatura stanza vs impostata */}
      {history.current.length > 1 && (
        <div style={{ marginTop: 'var(--space-md)' }}>
          <div style={{ height: 56 }}>
            <MiniChart series={[
              { values: history.target, color: '#00dbe7', dashed: true },
              { values: history.current, color: '#ff6b6b', fill: true },
            ]} />
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 11, color: 'var(--text-secondary)' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, borderTop: '2px dashed #00dbe7', display: 'inline-block' }} /> Impostata
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 2, background: '#ff6b6b', display: 'inline-block', borderRadius: 1 }} /> Stanza
            </span>
          </div>
        </div>
      )}
    </GlassCard>
  )
}
