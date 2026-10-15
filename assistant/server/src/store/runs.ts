import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { readJson, writeJsonAtomic } from './atomic.ts'

// Analisi lunghe (Suggerisci, Verifica) salvate una per file in /data/<cartella>/runs: le
// ultime N, e quelle rimaste "in corso" a un riavvio diventano "interrotta".

export interface RunBase {
  id: string
  createdAt: string
  status: string
  progress: unknown
  error?: string
}

export interface RunStoreOptions {
  /** Lettera iniziale dell'id (s = Suggerisci, v = Verifica). */
  prefix: string
  keep: number
  /** Stati di un job in corso: al caricamento diventano "interrotta". */
  running: string[]
}

export class RunStore<R extends RunBase> {
  private readonly runs = new Map<string, R>()
  private readonly idRe: RegExp

  constructor(
    private readonly dir: string,
    private readonly opts: RunStoreOptions,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.idRe = new RegExp(`^${opts.prefix}[a-z0-9]{8,40}$`)
  }

  isId(id: string): boolean {
    return this.idRe.test(id)
  }

  async load(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true })
    this.runs.clear()
    for (const f of await fs.readdir(this.dir)) {
      if (!f.endsWith('.json')) continue
      const r = await readJson<R | null>(join(this.dir, f), null)
      if (!r || !this.isId(r.id)) continue
      if (this.opts.running.includes(r.status)) {
        r.status = 'interrotta'
        r.progress = null
        r.error = "L'add-on si è riavviato durante l'analisi."
        await writeJsonAtomic(join(this.dir, `${r.id}.json`), r)
      }
      this.runs.set(r.id, r)
    }
  }

  newId(): string {
    return `${this.opts.prefix}${this.now().getTime().toString(36)}${randomBytes(4).toString('hex')}`
  }

  get(id: string): R | undefined {
    return this.runs.get(id)
  }

  list(): R[] {
    return [...this.runs.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  }

  async save(run: R): Promise<void> {
    if (!this.isId(run.id)) throw new Error('id di analisi non valido')
    this.runs.set(run.id, run)
    await writeJsonAtomic(join(this.dir, `${run.id}.json`), run)
    for (const r of this.list().slice(this.opts.keep)) {
      if (this.opts.running.includes(r.status)) continue
      this.runs.delete(r.id)
      await fs.rm(join(this.dir, `${r.id}.json`), { force: true })
    }
  }
}

export interface Marked {
  at: string
  by: string
  title: string
}

/** Firme messe da parte dall'utente ("Non mi interessa", "Ignora"), con scadenza facoltativa. */
export class SignatureStore {
  private items: Record<string, Marked> = {}

  constructor(
    private readonly file: string,
    private readonly days: number | null,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async load(): Promise<void> {
    this.items = await readJson<Record<string, Marked>>(this.file, {})
  }

  /** Firme ancora valide. */
  active(): Map<string, Marked> {
    if (this.days === null) return new Map(Object.entries(this.items))
    const limit = this.now().getTime() - this.days * 86_400_000
    return new Map(Object.entries(this.items).filter(([, d]) => new Date(d.at).getTime() >= limit))
  }

  async add(signature: string, d: Marked): Promise<void> {
    this.items = { ...Object.fromEntries(this.active()), [signature]: d }
    await writeJsonAtomic(this.file, this.items)
  }

  async remove(signature: string): Promise<void> {
    const { [signature]: _gone, ...rest } = this.items
    this.items = rest
    await writeJsonAtomic(this.file, this.items)
  }

  async clear(): Promise<number> {
    const n = this.active().size
    this.items = {}
    await writeJsonAtomic(this.file, this.items)
    return n
  }
}
