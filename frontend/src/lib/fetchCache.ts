// Cache in memoria (a livello di modulo) per le fetch "pesanti" delle card: storico,
// previsioni meteo, eventi calendario, statistiche energia. Sopravvive allo smontaggio
// dei componenti, così tornando sulla Home il dato compare subito (anche se scaduto)
// e viene aggiornato in background solo quando supera il TTL (stale-while-revalidate).

interface Entry { at: number; value: unknown }

const entries = new Map<string, Entry>()
const inflight = new Map<string, Promise<unknown>>()

export const CACHE_TTL = 5 * 60 * 1000

// Ultimo valore noto (anche scaduto), per l'inizializzazione sincrona dello stato.
export function peekCache<T>(key: string): T | undefined {
  return entries.get(key)?.value as T | undefined
}

// Ritorna il valore in cache se ancora fresco, altrimenti esegue fetcher (una sola
// richiesta in volo per chiave) e salva il risultato. Gli errori non vengono salvati,
// né i risultati scartati da shouldCache (es. vuoti perché la connessione non c'era).
export function cachedFetch<T>(
  key: string,
  fetcher: () => Promise<T>,
  opts: { ttlMs?: number; shouldCache?: (v: T) => boolean } = {},
): Promise<T> {
  const ttlMs = opts.ttlMs ?? CACHE_TTL
  const e = entries.get(key)
  if (e && Date.now() - e.at < ttlMs) return Promise.resolve(e.value as T)
  const running = inflight.get(key)
  if (running) return running as Promise<T>
  const p = fetcher()
    .then((value) => {
      if (!opts.shouldCache || opts.shouldCache(value)) entries.set(key, { at: Date.now(), value })
      return value
    })
    .finally(() => { inflight.delete(key) })
  inflight.set(key, p)
  return p
}
