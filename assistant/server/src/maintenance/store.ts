import { join } from 'node:path'
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from '../store/atomic.ts'
import { SignatureStore } from '../store/runs.ts'
import type { MaintenanceChange, MaintenanceRun } from './types.ts'

// /data/maintenance: l'ultimo controllo (last.json), i problemi ignorati (ignored.json, senza
// scadenza) e le modifiche fatte (history.jsonl, append-only; un Annulla è una riga in più).

type HistoryLine = ({ type: 'modifica' } & MaintenanceChange) | { type: 'annulla'; id: string; at: string; by: string }

export class MaintenanceStore {
  readonly ignored: SignatureStore
  private readonly lastFile: string
  private readonly historyFile: string
  private run: MaintenanceRun | null = null
  private readonly changes = new Map<string, MaintenanceChange>()

  constructor(dataDir: string, now: () => Date = () => new Date()) {
    const dir = join(dataDir, 'maintenance')
    this.lastFile = join(dir, 'last.json')
    this.historyFile = join(dir, 'history.jsonl')
    this.ignored = new SignatureStore(join(dir, 'ignored.json'), null, now)
  }

  async load(): Promise<void> {
    await this.ignored.load()
    this.run = await readJson<MaintenanceRun | null>(this.lastFile, null)
    this.changes.clear()
    for (const line of await readJsonl<HistoryLine>(this.historyFile)) {
      if (line.type === 'modifica') {
        const { type: _t, ...change } = line
        this.changes.set(change.id, change)
      } else if (line.type === 'annulla') {
        const c = this.changes.get(line.id)
        if (c) c.undone = { at: line.at, by: line.by }
      }
    }
  }

  last(): MaintenanceRun | null {
    return this.run
  }

  async saveRun(run: MaintenanceRun): Promise<void> {
    this.run = run
    await writeJsonAtomic(this.lastFile, run)
  }

  change(id: string): MaintenanceChange | undefined {
    return this.changes.get(id)
  }

  /** Le più recenti prima. */
  history(limit = 30): MaintenanceChange[] {
    return [...this.changes.values()].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit)
  }

  async addChange(c: MaintenanceChange): Promise<void> {
    this.changes.set(c.id, c)
    await appendJsonl(this.historyFile, { type: 'modifica', ...c })
  }

  async markUndone(id: string, at: string, by: string): Promise<void> {
    const c = this.changes.get(id)
    if (!c) return
    c.undone = { at, by }
    await appendJsonl(this.historyFile, { type: 'annulla', id, at, by })
  }
}
