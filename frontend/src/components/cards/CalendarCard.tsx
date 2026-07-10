import { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Clock } from 'lucide-react'
import { GlassCard } from '../glass/GlassCard'
import { useStore } from '../../store'
import { useHA } from '../../hooks/useHA'
import { useT } from '../../i18n'
import type { CalendarEvent } from '../../types/ha'

interface EventItem extends CalendarEvent {
  calendar: string
}

function fmtWhen(t: (key: string, vars?: Record<string, string | number>) => string, start: string): string {
  const allDay = !start.includes('T')
  const d = new Date(start)
  const now = new Date()
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate())
  const days = Math.round((startOfDay(d).getTime() - startOfDay(now).getTime()) / 86400000)
  const dayLabel =
    days === 0 ? t('Oggi')
    : days === 1 ? t('Domani')
    : d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' })
  if (allDay) return dayLabel
  const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  return `${dayLabel} · ${time}`
}

export function CalendarCard() {
  const t = useT()
  const entities = useStore((s) => s.entities)
  const selected = useStore((s) => s.calendarEntities)
  const { callServiceResponse } = useHA()
  const [events, setEvents] = useState<EventItem[]>([])

  const calendarIds = useMemo(() => {
    const all = Object.keys(entities).filter((id) => id.startsWith('calendar.'))
    return selected.length > 0 ? selected.filter((id) => all.includes(id)) : all
  }, [entities, selected])

  // Chiave primitiva per non rifare la fetch a ogni aggiornamento di stato
  const calKey = calendarIds.join(',')

  useEffect(() => {
    const ids = calKey ? calKey.split(',') : []
    if (ids.length === 0) { setEvents([]); return }
    let cancelled = false
    const start = new Date()
    const end = new Date(start.getTime() + 7 * 86400000)
    callServiceResponse<Record<string, { events: CalendarEvent[] }>>(
      'calendar', 'get_events',
      { entity_id: ids, start_date_time: start.toISOString(), end_date_time: end.toISOString() }
    )
      .then((resp) => {
        if (cancelled || !resp) return
        const merged: EventItem[] = []
        for (const [cal, val] of Object.entries(resp)) {
          for (const ev of val.events ?? []) merged.push({ ...ev, calendar: cal })
        }
        merged.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
        setEvents(merged.slice(0, 5))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [calKey, callServiceResponse])

  if (calendarIds.length === 0) return null

  if (events.length === 0) {
    return (
      <GlassCard size="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-secondary)' }}>
          <CalendarDays size={18} />
          <span style={{ fontSize: 14 }}>{t('Nessun evento nei prossimi 7 giorni')}</span>
        </div>
      </GlassCard>
    )
  }

  return (
    <GlassCard size="md">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {events.map((ev, i) => (
          <div key={`${ev.calendar}-${i}`} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <div
              style={{
                width: 38, height: 38, borderRadius: 10,
                background: 'var(--accent-glow)', border: '1px solid var(--glass-border)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--accent)', flexShrink: 0,
              }}
            >
              <CalendarDays size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {ev.summary || t('Evento')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Clock size={11} /> {fmtWhen(t, ev.start)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  )
}
