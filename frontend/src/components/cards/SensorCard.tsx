import { useMemo } from 'react'
import { TrendingUp, TrendingDown, Minus, Thermometer, Droplets, Wind, Zap, Eye } from 'lucide-react'
import { GlassCard } from '../glass/GlassCard'
import { useT } from '../../i18n'
import type { HassEntity, SensorAttributes } from '../../types/ha'

interface SensorCardProps {
  entity: HassEntity
  compact?: boolean
}

const DEVICE_CLASS_ICONS: Record<string, React.ReactNode> = {
  temperature: <Thermometer size={18} />,
  humidity: <Droplets size={18} />,
  pressure: <Wind size={18} />,
  power: <Zap size={18} />,
  energy: <Zap size={18} />,
  illuminance: <Eye size={18} />,
  carbon_dioxide: <Wind size={18} />,
  volatile_organic_compounds: <Wind size={18} />,
}

const DEVICE_CLASS_COLORS: Record<string, string> = {
  temperature: '#ff6b6b',
  humidity: '#4fc3f7',
  pressure: '#ab47bc',
  power: '#ffca28',
  energy: '#66bb6a',
  illuminance: '#ffd54f',
  carbon_dioxide: '#ff7043',
}

interface SparklineProps {
  values: number[]
  color: string
  height?: number
}

function Sparkline({ values, color, height = 32 }: SparklineProps) {
  const points = useMemo(() => {
    if (values.length < 2) return ''
    const min = Math.min(...values)
    const max = Math.max(...values)
    const range = max - min || 1
    const w = 80
    const h = height

    return values
      .map((v, i) => {
        const x = (i / (values.length - 1)) * w
        const y = h - ((v - min) / range) * h
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }, [values, height])

  if (!points) return null

  return (
    <svg width="80" height={height} viewBox={`0 0 80 ${height}`} fill="none">
      <path d={points} stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Arrotonda a max 2 decimali, senza zeri finali (3.258178 → 3.26, 225.6 → 225.6, 1080.0 → 1080)
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function parseTrend(values: number[]): 'up' | 'down' | 'flat' {
  if (values.length < 2) return 'flat'
  const last = values[values.length - 1]
  const prev = values[Math.max(0, values.length - 4)]
  const diff = last - prev
  if (Math.abs(diff) < 0.5) return 'flat'
  return diff > 0 ? 'up' : 'down'
}

export function SensorCard({ entity, compact }: SensorCardProps) {
  const t = useT()
  const attrs = entity.attributes as SensorAttributes
  const name = attrs.friendly_name ?? entity.entity_id
  const value = entity.state
  const unit = attrs.unit_of_measurement ?? ''
  const deviceClass = attrs.device_class ?? ''

  const color = DEVICE_CLASS_COLORS[deviceClass] ?? 'var(--accent)'
  const icon = DEVICE_CLASS_ICONS[deviceClass] ?? <Minus size={18} />

  const numValue = parseFloat(value)
  const isNumeric = !isNaN(numValue)

  // Placeholder sparkline data (verrà sostituita con dati reali dall'history hook)
  const sparkValues = useMemo(() => {
    if (!isNumeric) return []
    const noise = () => numValue + (Math.random() - 0.5) * (numValue * 0.1)
    return Array.from({ length: 12 }, noise)
  }, [isNumeric, numValue])

  const trend = parseTrend(sparkValues)

  if (compact) {
    return (
      <GlassCard size="sm" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 10,
            background: `${color}22`,
            border: `1px solid ${color}44`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color,
            flexShrink: 0,
          }}
        >
          {icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            {isNumeric ? round2(numValue) : value}{unit && <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginLeft: 2 }}>{unit}</span>}
          </div>
        </div>
        {trend !== 'flat' && (
          trend === 'up'
            ? <TrendingUp size={16} color="#66bb6a" />
            : <TrendingDown size={16} color="#ef5350" />
        )}
      </GlassCard>
    )
  }

  return (
    <GlassCard size="md">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-md)' }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: `${color}22`,
            border: `1px solid ${color}44`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color,
          }}
        >
          {icon}
        </div>
        {trend !== 'flat' && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 12,
              color: trend === 'up' ? '#66bb6a' : '#ef5350',
              background: trend === 'up' ? 'rgba(102,187,106,0.12)' : 'rgba(239,83,80,0.12)',
              border: `1px solid ${trend === 'up' ? 'rgba(102,187,106,0.25)' : 'rgba(239,83,80,0.25)'}`,
              borderRadius: 'var(--radius-pill)',
              padding: '3px 8px',
            }}
          >
            {trend === 'up' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {trend === 'up' ? t('In salita') : t('In discesa')}
          </div>
        )}
      </div>

      {/* Valore */}
      <div style={{ marginBottom: 'var(--space-sm)' }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 42,
            fontWeight: 300,
            letterSpacing: '-0.04em',
            color: 'var(--text-primary)',
            lineHeight: 1,
          }}
        >
          {isNumeric ? round2(numValue) : value}
          {unit && (
            <span style={{ fontSize: 18, fontWeight: 400, color: 'var(--text-secondary)', marginLeft: 4 }}>
              {unit}
            </span>
          )}
        </div>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 4 }}>{name}</div>
      </div>

      {/* Sparkline */}
      {sparkValues.length > 1 && (
        <div style={{ marginTop: 'var(--space-md)', opacity: 0.7 }}>
          <Sparkline values={sparkValues} color={color} />
        </div>
      )}
    </GlassCard>
  )
}
