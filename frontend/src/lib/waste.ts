import { Trash2, Recycle, Newspaper, Wine, Apple } from 'lucide-react'

export type WasteIcon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>

export interface WasteType {
  id: string
  label: string
  color: string
  Icon: WasteIcon
}

export const WASTE_TYPES: WasteType[] = [
  { id: 'indifferenziato', label: 'Indifferenziato', color: '#78909c', Icon: Trash2 },
  { id: 'plastica', label: 'Plastica e lattine', color: '#fbc02d', Icon: Recycle },
  { id: 'carta', label: 'Carta e cartone', color: '#42a5f5', Icon: Newspaper },
  { id: 'vetro', label: 'Vetro', color: '#66bb6a', Icon: Wine },
  { id: 'organico', label: 'Organico', color: '#a1887f', Icon: Apple },
]

// index = valore di Date.getDay() (0 = Domenica)
export const WEEKDAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato']
export const WEEKDAYS_SHORT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab']
// Ordine di visualizzazione dei selettori: Lun → Dom
export const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
export const WEEKDAY_INITIALS: Record<number, string> = {
  1: 'L', 2: 'M', 3: 'M', 4: 'G', 5: 'V', 6: 'S', 0: 'D',
}

export const INTERVAL_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: 'Ogni settimana' },
  { value: 2, label: 'Ogni 2 settimane' },
  { value: 3, label: 'Ogni 3 settimane' },
  { value: 4, label: 'Ogni 4 settimane' },
]

// Lunedì della settimana della data (per confrontare le settimane)
export function weekStartMon(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const dow = (x.getDay() + 6) % 7 // Lun=0 … Dom=6
  x.setDate(x.getDate() - dow)
  return x
}

// Vero se in quella data passa la raccolta, tenendo conto di giorni, intervallo e riferimento
export function isCollectionDay(date: Date, days: number[], interval: number, anchorISO?: string): boolean {
  if (!days.includes(date.getDay())) return false
  if (interval <= 1 || !anchorISO) return true
  const a = weekStartMon(new Date(anchorISO))
  const w = weekStartMon(date)
  const weeks = Math.round((w.getTime() - a.getTime()) / (7 * 86400000))
  return (((weeks % interval) + interval) % interval) === 0
}

export interface Collection {
  date: Date
  diff: number // giorni da oggi (0 = oggi)
  types: WasteType[]
}

// Raccolte dei prossimi `days` giorni (oggi compreso), raggruppate per data
export function upcomingCollections(
  schedule: Record<string, number[]>,
  intervals: Record<string, number>,
  anchors: Record<string, string>,
  days: number,
): Collection[] {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const out: Collection[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() + i)
    const types = WASTE_TYPES.filter((t) => {
      const ds = schedule[t.id] ?? []
      return ds.length > 0 && isCollectionDay(d, ds, intervals[t.id] ?? 1, anchors[t.id])
    })
    if (types.length) out.push({ date: d, diff: i, types })
  }
  return out
}

// Nome del giorno della settimana nella lingua indicata (0 = Domenica)
export function weekdayName(day: number, locale: string, style: 'long' | 'short' = 'short'): string {
  return new Date(2025, 0, 5 + day).toLocaleDateString(locale, { weekday: style }) // 5/1/2025 è domenica
}
