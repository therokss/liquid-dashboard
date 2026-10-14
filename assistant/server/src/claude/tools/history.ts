import { formatDuration, formatLocal, toDate } from '../../util/time.ts'

// Aggregazione degli storici: Claude non riceve mai le serie grezze, solo numeri già calcolati.

export interface Sample {
  t: number // epoch ms
  s: string
}

/** Converte la risposta di history/history_during_period (formato compresso) in campioni. */
export function toSamples(rows: unknown[]): Sample[] {
  const out: Sample[] = []
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const s = o.s ?? o.state
    const d = toDate(o.lc ?? o.lu ?? o.last_changed ?? o.last_updated)
    if (typeof s === 'string' && d) out.push({ t: d.getTime(), s })
  }
  out.sort((a, b) => a.t - b.t)
  return out
}

const UNAVAILABLE = new Set(['unavailable', 'unknown', ''])

function isNumeric(samples: Sample[]): boolean {
  const valid = samples.filter((x) => !UNAVAILABLE.has(x.s))
  if (valid.length === 0) return false
  return valid.filter((x) => Number.isFinite(Number(x.s))).length / valid.length >= 0.8
}

function round(n: number): number {
  return Math.abs(n) >= 100 ? Math.round(n * 10) / 10 : Math.round(n * 100) / 100
}

export interface SummaryOptions {
  startMs: number
  endMs: number
  tz: string
  maxTransitions?: number
  buckets?: number
}

/** Riepilogo di una serie: numerica (min/max/media pesata nel tempo, fasce) o a stati discreti. */
export function summarizeSeries(samples: Sample[], opts: SummaryOptions): Record<string, unknown> {
  const { startMs, endMs, tz } = opts
  const fmt = (t: number) => formatLocal(t, tz, false)
  if (samples.length === 0) return { tipo: 'vuoto', nota: 'Nessun dato registrato nel periodo (entità nuova, esclusa dal recorder o periodo oltre la conservazione).' }

  // Il primo campione può precedere l'inizio (stato in vigore all'inizio del periodo).
  const clipped = samples.map((x) => ({ t: Math.max(x.t, startMs), s: x.s })).filter((x) => x.t <= endMs)
  const segments = clipped.map((x, i) => ({ s: x.s, from: x.t, to: i + 1 < clipped.length ? clipped[i + 1]!.t : endMs }))
  const periodMs = Math.max(endMs - startMs, 1)
  const firstAt = clipped[0]?.t ?? startMs
  const coverage = firstAt > startMs + 60_000 ? { dati_dal: fmt(firstAt) } : {}
  const unavailableMs = segments.filter((g) => UNAVAILABLE.has(g.s)).reduce((a, g) => a + (g.to - g.from), 0)
  const unavailable = unavailableMs > 0 ? { non_disponibile: `${formatDuration(unavailableMs)} (${Math.round((unavailableMs / periodMs) * 100)}%)` } : {}

  if (isNumeric(clipped)) {
    const num = segments.filter((g) => !UNAVAILABLE.has(g.s) && Number.isFinite(Number(g.s)))
    let min = Infinity, max = -Infinity, minAt = 0, maxAt = 0, weighted = 0, total = 0
    for (const g of num) {
      const v = Number(g.s)
      if (v < min) { min = v; minAt = g.from }
      if (v > max) { max = v; maxAt = g.from }
      const w = Math.max(g.to - g.from, 1)
      weighted += v * w
      total += w
    }
    const nb = Math.min(opts.buckets ?? 24, 48)
    const size = periodMs / nb
    const fasce: Array<{ da: string | null; media: number | null; min: number | null; max: number | null }> = []
    for (let i = 0; i < nb; i++) {
      const a = startMs + i * size
      const b = a + size
      let wv = 0, wt = 0, bmin = Infinity, bmax = -Infinity
      for (const g of num) {
        const lo = Math.max(g.from, a), hi = Math.min(g.to, b)
        if (hi <= lo && !(g.from >= a && g.from < b)) continue
        const v = Number(g.s)
        const w = Math.max(hi - lo, 1)
        wv += v * w; wt += w
        bmin = Math.min(bmin, v); bmax = Math.max(bmax, v)
      }
      fasce.push({ da: fmt(a), media: wt ? round(wv / wt) : null, min: Number.isFinite(bmin) ? round(bmin) : null, max: Number.isFinite(bmax) ? round(bmax) : null })
    }
    const last = num[num.length - 1]
    return {
      tipo: 'numerico',
      campioni: clipped.length,
      min: num.length ? { valore: round(min), alle: fmt(minAt) } : null,
      max: num.length ? { valore: round(max), alle: fmt(maxAt) } : null,
      media_nel_tempo: total ? round(weighted / total) : null,
      ultimo: last ? { valore: round(Number(last.s)), dalle: fmt(last.from) } : null,
      ...coverage,
      ...unavailable,
      fasce,
    }
  }

  // Stati discreti: tempo in ciascuno stato, numero di cambi, ultimi passaggi.
  const durations = new Map<string, number>()
  const entries = new Map<string, number>()
  for (const [i, g] of segments.entries()) {
    durations.set(g.s, (durations.get(g.s) ?? 0) + (g.to - g.from))
    if (i > 0 && g.s !== segments[i - 1]!.s) entries.set(g.s, (entries.get(g.s) ?? 0) + 1)
  }
  const changes = segments.filter((g, i) => i > 0 && g.s !== segments[i - 1]!.s)
  const maxT = opts.maxTransitions ?? 15
  const statesSorted = [...durations.entries()].sort((a, b) => b[1] - a[1])
  return {
    tipo: 'stati',
    cambi: changes.length,
    tempo_per_stato: Object.fromEntries(
      statesSorted.slice(0, 12).map(([s, ms]) => [s, `${formatDuration(ms)} (${Math.round((ms / periodMs) * 100)}%)`]),
    ),
    ingressi_per_stato: Object.fromEntries([...entries.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)),
    stato_attuale: segments.length ? { stato: segments[segments.length - 1]!.s, dalle: fmt(segments[segments.length - 1]!.from) } : null,
    ...coverage,
    ...unavailable,
    ultimi_cambi: changes.slice(-maxT).map((g) => ({ alle: fmt(g.from), stato: g.s, durata: formatDuration(g.to - g.from) })),
  }
}

/** Riepilogo delle statistiche giornaliere a lungo termine (recorder/statistics_during_period). */
export function summarizeStatistics(rows: unknown[], tz: string): Record<string, unknown> {
  const days: Array<Record<string, unknown>> = []
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const day = formatLocal(o.start, tz, false)?.slice(0, 10) ?? null
    const pick = (k: string) => (typeof o[k] === 'number' ? round(o[k] as number) : undefined)
    const rec: Record<string, unknown> = { giorno: day }
    for (const k of ['mean', 'min', 'max', 'change']) {
      const v = pick(k)
      if (v !== undefined) rec[{ mean: 'media', min: 'min', max: 'max', change: 'variazione' }[k]!] = v
    }
    days.push(rec)
  }
  return { tipo: 'statistiche_giornaliere', giorni: days.length, valori: days }
}
