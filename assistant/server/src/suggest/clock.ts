import { localParts } from '../util/time.ts'

// Orologio locale per l'analisi: decine di migliaia di eventi, quindi l'ora locale si calcola
// una volta per ogni quarto d'ora UTC (tutti i fusi reali sono multipli di 15 minuti, quindi
// dentro un quarto d'ora non si attraversa mai la mezzanotte locale né un cambio d'ora).

const DOW: Record<string, number> = { lunedì: 1, martedì: 2, mercoledì: 3, giovedì: 4, venerdì: 5, sabato: 6, domenica: 7 }
const QUARTER = 900_000

export interface LocalTime {
  /** Giorno locale "2026-10-14". */
  day: string
  /** 1 = lunedì … 7 = domenica. */
  dow: number
  /** Minuti dalla mezzanotte locale, con i decimali. */
  min: number
}

export type DayType = 'feriale' | 'festivo'

/** Pasqua (calendario gregoriano, algoritmo anonimo): [mese, giorno]. */
function easter(year: number): [number, number] {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return [month, day]
}

// Il 4 ottobre (San Francesco) è di nuovo festa nazionale dal 2026.
const IT_FIXED = new Set(['01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '10-04', '11-01', '12-08', '12-25', '12-26'])

/** Festività nazionali italiane (fisse + Pasquetta). */
export function isItalianHoliday(day: string): boolean {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  if (IT_FIXED.has(day.slice(5))) return true
  const [em, ed] = easter(y)
  const monday = new Date(Date.UTC(y, em - 1, ed + 1))
  return monday.getUTCMonth() + 1 === m && monday.getUTCDate() === d
}

export class LocalClock {
  private readonly cache = new Map<number, { day: string; dow: number; base: number }>()

  constructor(
    readonly tz: string,
    private readonly country: string | null = null,
  ) {}

  at(t: number): LocalTime {
    const q = Math.floor(t / QUARTER)
    let c = this.cache.get(q)
    if (!c) {
      const p = localParts(new Date(q * QUARTER), this.tz)
      c = { day: `${p.year}-${p.month}-${p.day}`, dow: DOW[p.weekday] ?? 1, base: Number(p.hour) * 60 + Number(p.minute) }
      this.cache.set(q, c)
    }
    return { day: c.day, dow: c.dow, min: c.base + (t - q * QUARTER) / 60_000 }
  }

  dayType(day: string, dow: number): DayType {
    if (dow >= 6) return 'festivo'
    if (this.country === 'IT' && isItalianHoliday(day)) return 'festivo'
    return 'feriale'
  }

  /** Istante UTC della mezzanotte locale che apre il giorno di `t`. */
  startOfDay(t: number): number {
    const { min } = this.at(t)
    let s = t - Math.round(min * 60_000)
    // Nei giorni del cambio d'ora la mezzanotte può distare un'ora: si corregge.
    for (let i = 0; i < 2 && this.at(s).min > 30; i++) s -= this.at(s).min * 60_000
    return s
  }
}

/** "07:05" da minuti dalla mezzanotte (anche negativi o oltre le 24, si normalizza). */
export function hhmm(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}
