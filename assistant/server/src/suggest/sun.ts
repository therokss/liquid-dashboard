// Alba e tramonto calcolati in locale (equazione dell'alba, errore di 1–2 minuti): le
// coordinate della casa servono solo qui e non lasciano mai l'add-on.

const RAD = Math.PI / 180

export interface SunTimes {
  rise: number
  set: number
}

/** Alba e tramonto (epoch ms) del giorno `day` ("2026-10-14"); null se sole di mezzanotte o notte polare. */
export function sunTimes(day: string, lat: number, lon: number): SunTimes | null {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  // Data giuliana della mezzanotte UTC (x,5): con ceil dà il numero del giorno giusto.
  const jDate = Date.UTC(y, m - 1, d) / 86_400_000 + 2_440_587.5
  const n = Math.ceil(jDate - 2_451_545 + 0.0008)
  const jStar = n - lon / 360
  const M = (357.5291 + 0.98560028 * jStar) % 360
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD)
  const lambda = (M + C + 180 + 102.9372) % 360
  const jTransit = 2_451_545 + jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD)
  const sinDecl = Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD)
  const cosDecl = Math.cos(Math.asin(sinDecl))
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * sinDecl) / (Math.cos(lat * RAD) * cosDecl)
  if (cosW < -1 || cosW > 1) return null
  const w = Math.acos(cosW) / RAD
  const toMs = (j: number) => Math.round((j - 2_440_587.5) * 86_400_000)
  return { rise: toMs(jTransit - w / 360), set: toMs(jTransit + w / 360) }
}

/** Memo per giorno: lo stesso giorno serve migliaia di volte. */
export class SunCalendar {
  private readonly cache = new Map<string, SunTimes | null>()

  constructor(private readonly loc: { lat: number; lon: number } | null) {}

  get available(): boolean {
    return this.loc !== null
  }

  of(day: string): SunTimes | null {
    if (!this.loc) return null
    if (!this.cache.has(day)) this.cache.set(day, sunTimes(day, this.loc.lat, this.loc.lon))
    return this.cache.get(day) ?? null
  }

  /** true col buio (prima dell'alba o dopo il tramonto), null se non calcolabile. */
  isDark(day: string, t: number): boolean | null {
    const s = this.of(day)
    return s ? t < s.rise || t > s.set : null
  }
}
