import { AlertCircle, Trash2 } from 'lucide-react'
import { GlassCard } from '../glass/GlassCard'
import { useStore } from '../../store'
import { useT } from '../../i18n'
import { WASTE_TYPES, WEEKDAYS, isCollectionDay } from '../../lib/waste'
import type { WasteType } from '../../lib/waste'

interface Upcoming { type: WasteType; diff: number }

export function WasteCard() {
  const t = useT()
  const schedule = useStore((s) => s.wasteSchedule)
  const intervals = useStore((s) => s.wasteInterval)
  const anchors = useStore((s) => s.wasteAnchor)

  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // Per ogni tipo configurato trova quanti giorni mancano alla prossima raccolta
  const withDiff: Upcoming[] = []
  for (const t of WASTE_TYPES) {
    const days = schedule[t.id] ?? []
    if (!days.length) continue
    const interval = intervals[t.id] ?? 1
    const anchor = anchors[t.id]
    for (let i = 0; i <= 34; i++) {
      const d = new Date(today)
      d.setDate(d.getDate() + i)
      if (isCollectionDay(d, days, interval, anchor)) {
        withDiff.push({ type: t, diff: i })
        break
      }
    }
  }

  if (withDiff.length === 0) return null

  const tomorrow = withDiff.filter((x) => x.diff === 1)
  const todayItems = withDiff.filter((x) => x.diff === 0)

  let mode: 'expose' | 'today' | 'next'
  let items: Upcoming[]
  if (tomorrow.length) { mode = 'expose'; items = tomorrow }
  else if (todayItems.length) { mode = 'today'; items = todayItems }
  else {
    const minDiff = Math.min(...withDiff.map((x) => x.diff))
    items = withDiff.filter((x) => x.diff === minDiff)
    mode = 'next'
  }

  const nextDate = new Date(today)
  nextDate.setDate(nextDate.getDate() + items[0].diff)
  const highlight = mode === 'expose'
  const accent = highlight ? '#ffb300' : 'var(--accent)'

  const title = mode === 'expose' ? t('Esponi stasera') : mode === 'today' ? t('Raccolta oggi') : t('Prossima raccolta')
  const subtitle = mode === 'expose'
    ? t('Domani passa la raccolta')
    : mode === 'today'
      ? t('Oggi passa la raccolta')
      : items[0].diff <= 7
        ? WEEKDAYS[nextDate.getDay()]
        : nextDate.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' })

  return (
    <GlassCard
      size="md"
      style={highlight ? { border: '1px solid rgba(255,179,0,0.5)', boxShadow: 'var(--glass-shadow), 0 0 24px rgba(255,179,0,0.25)' } : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <div
          style={{
            width: 44, height: 44, borderRadius: 12,
            background: `${accent}22`, border: `1px solid ${accent}44`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: accent, flexShrink: 0,
          }}
        >
          {mode === 'expose' ? <AlertCircle size={22} /> : <Trash2 size={22} />}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2, textTransform: 'capitalize' }}>{subtitle}</div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {items.map(({ type }) => {
          const Icon = type.Icon
          return (
            <div
              key={type.id}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 7,
                padding: '7px 12px', borderRadius: 'var(--radius-pill)',
                background: `${type.color}1f`, border: `1px solid ${type.color}55`,
              }}
            >
              <Icon size={15} color={type.color} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{type.label}</span>
            </div>
          )
        })}
      </div>
    </GlassCard>
  )
}
