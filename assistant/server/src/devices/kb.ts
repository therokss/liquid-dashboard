import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { readJson, writeJsonAtomic } from '../store/atomic.ts'
import { modelLabel } from './catalog.ts'

// Schede dei modelli di dispositivo in /data/kb/devices/<slug>.json. Le scrive il sotto-agente
// di studio (stato "bozza"); l'utente le approva dalla pagina Dispositivi. In chat Claude vede
// solo l'indice e le legge con leggi_scheda_dispositivo.

const s = (max: number) => z.string().trim().max(max)

/** Contenuto della scheda: è anche lo schema dello strumento salva_scheda. */
export const CardContent = z.object({
  nome_commerciale: s(200).min(1).describe('Nome commerciale completo, es. "Aqara Presence Sensor FP2"'),
  categoria: s(200).min(1).describe('Che cos\'è, es. "sensore di presenza mmWave a zone"'),
  sintesi: s(2000).min(1).describe('2–4 frasi: cosa fa e cosa conta sapere per usarlo in Home Assistant'),
  collegamento: s(2000).describe('Protocollo, hub necessari, integrazioni di Home Assistant possibili (locali o cloud) e quale conviene'),
  entita: z.array(z.object({ cosa: s(200).min(1), significato: s(1000).min(1) })).max(30).describe('Entità che espone in Home Assistant e come interpretarle'),
  eventi: z.array(z.object({ evento: s(200).min(1), significato: s(500).min(1) })).max(30).describe('Eventi di pulsanti o gesti (tipo e sottotipo come li vede HA), vuoto se non ne ha'),
  consigli: z.array(s(1000).min(1)).max(15).describe('Consigli pratici per le automazioni con questo modello'),
  limiti: z.array(s(1000).min(1)).max(15).describe('Limiti e problemi noti (firmware, portata, falsi positivi, latenza…)'),
  fonti: z.array(z.object({ url: s(500).url(), titolo: s(300).min(1) })).min(1).max(12).describe('Pagine consultate da cui vengono le informazioni'),
})
export type CardContent = z.infer<typeof CardContent>

export interface CardSource {
  url: string
  titolo: string
  /** pagina aperta con web_fetch (non solo vista nei risultati di ricerca) */
  aperta: boolean
}

export interface Card extends Omit<CardContent, 'fonti'> {
  key: string
  manufacturer: string
  model: string
  modelIds: string[]
  fonti: CardSource[]
  status: 'bozza' | 'approvata'
  createdAt: string
  studiedBy: string
  approved?: { at: string; by: string }
  /** com'è stata fatta: le ricerche sono salvate per trasparenza (non contengono dati della casa) */
  study: { model: string; effort: string; costUsd: number; searches: number; fetches: number; queries: string[]; durationMs: number }
}

export interface CardSummary {
  slug: string
  status: Card['status']
  nome_commerciale: string
  categoria: string
  createdAt: string
  approved?: Card['approved']
  costUsd: number
}

export function cardSummary(c: Card): CardSummary {
  return {
    slug: cardSlug(c.key),
    status: c.status,
    nome_commerciale: c.nome_commerciale,
    categoria: c.categoria,
    createdAt: c.createdAt,
    ...(c.approved ? { approved: c.approved } : {}),
    costUsd: c.study.costUsd,
  }
}

/** Nome del file della scheda: "aqara|presence sensor fp2" → "aqara__presence-sensor-fp2". */
export function cardSlug(key: string): string {
  const [manu, model] = key.split('|') as [string, string]
  const part = (x: string) => (x ?? '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x'
  return `${part(manu)}__${part(model)}`
}

export const SLUG_RE = /^[a-z0-9-]{1,60}__[a-z0-9-]{1,60}$/

export class KbStore {
  private readonly dir: string
  private readonly cards = new Map<string, Card>()

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'kb', 'devices')
  }

  async load(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    this.cards.clear()
    for (const f of await fs.readdir(this.dir)) {
      if (!f.endsWith('.json')) continue
      const c = await readJson<Card | null>(join(this.dir, f), null)
      if (c && typeof c.key === 'string' && SLUG_RE.test(cardSlug(c.key))) this.cards.set(c.key, c)
    }
  }

  get(key: string): Card | undefined {
    return this.cards.get(key)
  }

  bySlug(slug: string): Card | undefined {
    return [...this.cards.values()].find((c) => cardSlug(c.key) === slug)
  }

  list(): Card[] {
    return [...this.cards.values()].sort((a, b) => a.manufacturer.localeCompare(b.manufacturer) || a.model.localeCompare(b.model))
  }

  async save(card: Card): Promise<void> {
    const slug = cardSlug(card.key)
    if (!SLUG_RE.test(slug)) throw new Error('chiave della scheda non valida')
    this.cards.set(card.key, card)
    await writeJsonAtomic(join(this.dir, `${slug}.json`), card)
  }

  async remove(key: string): Promise<boolean> {
    if (!this.cards.delete(key)) return false
    await fs.rm(join(this.dir, `${cardSlug(key)}.json`), { force: true })
    return true
  }
}

/** Indice compatto per il prompt della chat: una riga per scheda. */
export function cardIndex(cards: Card[]): string {
  if (!cards.length) return ''
  const one = (x: string) => x.replace(/\s+/g, ' ').trim()
  const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '')
  return cards
    .map((c) => {
      const model = one(modelLabel(c.manufacturer, c.model))
      const name = same(model, c.nome_commerciale) ? '' : ` (${one(c.nome_commerciale)})`
      return `- ${model}${name}: ${one(c.categoria)}${c.status === 'bozza' ? ' [bozza, non ancora approvata]' : ''}`
    })
    .join('\n')
}
