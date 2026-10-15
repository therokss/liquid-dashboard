// Entità simili a un riferimento rotto (es. switch.pompa_giardino → l'uscita del relè che
// si chiama "Pompa giardino"): stesso dominio, confronto su nome e object_id. Prudente: ogni
// parola del riferimento rotto deve ritrovarsi nel candidato e i numeri devono coincidere, così
// "telefono_di_ugo" non diventa il telefono di un'altra persona né la zona 6 la zona 1.

function normalize(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>()
  const t = ` ${s} `
  for (let i = 0; i < t.length - 1; i++) {
    const g = t.slice(i, i + 2)
    out.set(g, (out.get(g) ?? 0) + 1)
  }
  return out
}

/** Coefficiente di Dice sui bigrammi (0–1). */
export function dice(a: string, b: string): number {
  const A = bigrams(normalize(a))
  const B = bigrams(normalize(b))
  let inter = 0
  let total = 0
  for (const [g, n] of A) {
    inter += Math.min(n, B.get(g) ?? 0)
    total += n
  }
  for (const n of B.values()) total += n
  return total ? (2 * inter) / total : 0
}

const STOPWORDS = new Set(['di', 'da', 'del', 'della', 'dello', 'dei', 'delle', 'de', 'la', 'il', 'lo', 'le', 'the', 'of', 'e', 'and', 'a'])

function tokens(s: string): string[] {
  return normalize(s).split(' ').filter((t) => t && !STOPWORDS.has(t))
}

/** Quota delle parole di `missing` ritrovate in `candidate`; -1 se un numero non coincide. */
export function coverage(missing: string[], candidate: Set<string>): number {
  if (!missing.length) return 0
  let hit = 0
  for (const t of missing) {
    if (candidate.has(t)) {
      hit += 1
      continue
    }
    if (/\d/.test(t)) return -1
    // Dice ≥ 0.8 richiede lunghezze simili: si evitano i confronti inutili (migliaia di sensori).
    const near = (c: string) => Math.min(c.length, t.length) / Math.max(c.length, t.length) >= 2 / 3
    if ([...candidate].some((c) => !/\d/.test(c) && near(c) && dice(t, c) >= 0.8)) hit += 1
  }
  return hit / missing.length
}

export interface SimilarEntity {
  entityId: string
  name: string
  score: number
}

export class SimilarityIndex {
  private readonly byDomain = new Map<string, Array<{ id: string; object: string; name: string; tokens: Set<string> }>>()

  constructor(entities: Iterable<[entityId: string, name: string]>) {
    for (const [id, name] of entities) {
      const dot = id.indexOf('.')
      const domain = id.slice(0, dot)
      let list = this.byDomain.get(domain)
      if (!list) this.byDomain.set(domain, (list = []))
      const object = id.slice(dot + 1).replace(/_/g, ' ')
      list.push({ id, object, name, tokens: new Set([...tokens(object), ...tokens(name)]) })
    }
  }

  /** Le entità esistenti più simili a un entity_id che non esiste più. */
  similar(missing: string, limit = 3): SimilarEntity[] {
    const dot = missing.indexOf('.')
    const domain = missing.slice(0, dot)
    const object = missing.slice(dot + 1).replace(/_/g, ' ')
    const words = tokens(object)
    const out: SimilarEntity[] = []
    for (const c of this.byDomain.get(domain) ?? []) {
      if (c.id === missing) continue
      if (coverage(words, c.tokens) < 1) continue
      const score = Math.max(dice(object, c.object), dice(object, c.name))
      if (score >= 0.5) out.push({ entityId: c.id, name: c.name, score: Math.round(score * 100) / 100 })
    }
    return out.sort((a, b) => b.score - a.score || (a.entityId < b.entityId ? -1 : 1)).slice(0, limit)
  }

  /** Stesso object_id in un altro dominio (es. switch.x diventato light.x con "Mostra come"). */
  otherDomain(missing: string): string[] {
    const object = missing.slice(missing.indexOf('.') + 1)
    const out: string[] = []
    for (const list of this.byDomain.values()) for (const c of list) if (c.id.endsWith(`.${object}`) && c.id !== missing) out.push(c.id)
    return out
  }
}

/** Sostituzione da proporre: "certa" solo se il migliore è netto. */
export function replacement(similar: SimilarEntity[]): { to: string; name: string; certain: boolean } | null {
  const best = similar[0]
  if (!best) return null
  const certain = best.score >= 0.9 && (!similar[1] || similar[1].score < best.score - 0.1)
  return { to: best.entityId, name: best.name, certain }
}
