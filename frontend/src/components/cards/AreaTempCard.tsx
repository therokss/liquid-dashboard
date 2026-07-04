import { useEffect, useState } from 'react'
import { Thermometer } from 'lucide-react'
import { GlassCard } from '../glass/GlassCard'
import { MiniChart } from '../charts/MiniChart'
import { useHA } from '../../hooks/useHA'

export function AreaTempCard({ name, avg, sensorId, onClick }: {
  name: string
  avg: number
  sensorId?: string
  onClick?: () => void
}) {
  const { getHistoryForEntity } = useHA()
  const [values, setValues] = useState<number[]>([])

  useEffect(() => {
    if (!sensorId) return
    let cancelled = false
    getHistoryForEntity(sensorId, 24)
      .then((h) => { if (!cancelled) setValues(h.map((x) => parseFloat(x.state)).filter((v) => !isNaN(v))) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [sensorId, getHistoryForEntity])

  const r1 = (n: number) => Math.round(n * 10) / 10

  return (
    <GlassCard size="sm" onClick={onClick} style={{ position: 'relative', overflow: 'hidden', cursor: onClick ? 'pointer' : 'default' }}>
      {values.length > 1 && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '78%', zIndex: 0, opacity: 0.45, pointerEvents: 'none' }}>
          <MiniChart series={[{ values, color: '#ff6b6b', fill: true }]} strokeWidth={1.5} />
        </div>
      )}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: 'rgba(255,107,107,0.14)', border: '1px solid rgba(255,107,107,0.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff6b6b', flexShrink: 0 }}>
          <Thermometer size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            {r1(avg)}<span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)', marginLeft: 2 }}>°C</span>
          </div>
        </div>
      </div>
    </GlassCard>
  )
}
