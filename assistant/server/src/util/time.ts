// Orari nel fuso della casa. Si usa formatToParts con 'en-US' perché nel container Alpine
// i dati ICU completi possono mancare: i nomi dei giorni si traducono qui.

const GIORNI: Record<string, string> = {
  Mon: 'lunedì', Tue: 'martedì', Wed: 'mercoledì', Thu: 'giovedì', Fri: 'venerdì', Sat: 'sabato', Sun: 'domenica',
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz)
  if (!f) {
    try {
      f = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
        weekday: 'short', hourCycle: 'h23',
      })
    } catch {
      f = formatter('UTC')
    }
    formatters.set(tz, f)
  }
  return f
}

/** Date | epoch (secondi o millisecondi) | ISO → Date, o null se non interpretabile. */
export function toDate(v: unknown): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === 'number' && Number.isFinite(v)) return new Date(v > 1e12 ? v : v * 1000)
  if (typeof v === 'string' && v) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

export interface LocalParts {
  year: string
  month: string
  day: string
  hour: string
  minute: string
  second: string
  weekday: string
}

export function localParts(d: Date, tz: string): LocalParts {
  const p: Record<string, string> = {}
  for (const part of formatter(tz).formatToParts(d)) p[part.type] = part.value
  return {
    year: p.year ?? '', month: p.month ?? '', day: p.day ?? '',
    hour: p.hour ?? '', minute: p.minute ?? '', second: p.second ?? '',
    weekday: GIORNI[p.weekday ?? ''] ?? p.weekday ?? '',
  }
}

/** "2026-10-14 15:30:12" nel fuso indicato; null se l'input non è un orario. */
export function formatLocal(v: unknown, tz: string, withSeconds = true): string | null {
  const d = toDate(v)
  if (!d) return null
  const p = localParts(d, tz)
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}${withSeconds ? `:${p.second}` : ''}`
}

/** Testo del blocco <contesto> nei messaggi dell'utente. */
export function describeNow(now: Date, tz: string): string {
  const p = localParts(now, tz)
  return `${p.weekday} ${p.day}/${p.month}/${p.year}, ore ${p.hour}:${p.minute} (${tz})`
}

/** Chiave del mese "2026-10" nel fuso indicato (per il budget). */
export function monthKey(d: Date, tz: string): string {
  return periodKey(d, tz, 1)
}

/**
 * Periodo di spesa: il mese di calendario (startDay 1) o il ciclo di fatturazione che parte il
 * giorno `startDay` (crediti dei piani Max e Team). Nei mesi più corti un ciclo dal 29, 30 o 31
 * parte l'ultimo giorno del mese. La chiave è il mese in cui il periodo inizia.
 */
export function periodKey(d: Date, tz: string, startDay: number): string {
  const p = localParts(d, tz)
  let year = Number(p.year)
  let month = Number(p.month)
  if (Number(p.day) < cycleDay(year, month, startDay)) [year, month] = addMonth(year, month, -1)
  return `${year}-${String(month).padStart(2, '0')}`
}

/** Giorno in cui è partito il periodo in corso, "2026-09-30" (data locale). */
export function periodStart(d: Date, tz: string, startDay: number): string {
  const [year, month] = periodKey(d, tz, startDay).split('-').map(Number)
  return isoDay(year!, month!, startDay)
}

/** Giorno in cui parte il periodo successivo, "2026-11-15" (data locale). */
export function nextPeriodStart(d: Date, tz: string, startDay: number): string {
  const [y, m] = periodKey(d, tz, startDay).split('-').map(Number)
  const [year, month] = addMonth(y!, m!, 1)
  return isoDay(year, month, startDay)
}

function isoDay(year: number, month: number, startDay: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(cycleDay(year, month, startDay)).padStart(2, '0')}`
}

function cycleDay(year: number, month: number, startDay: number): number {
  return Math.min(startDay, new Date(Date.UTC(year, month, 0)).getUTCDate())
}

function addMonth(year: number, month: number, delta: 1 | -1): [number, number] {
  const m = month + delta
  return m === 0 ? [year - 1, 12] : m === 13 ? [year + 1, 1] : [year, m]
}

/** Durata leggibile: "2 h 15 min", "45 s". */
export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  if (h < 48) return rest ? `${h} h ${rest} min` : `${h} h`
  const g = Math.floor(h / 24)
  const hr = h % 24
  return hr ? `${g} g ${hr} h` : `${g} g`
}
