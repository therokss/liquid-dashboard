import { join } from 'node:path'
import { readJson, writeJsonAtomic } from './atomic.ts'
import { DEFAULT_CONSENTS, parseConsents, type Consents } from '../inventory/privacy.ts'

// Impostazioni modificabili dall'interfaccia (le opzioni dell'add-on restano nel Supervisor).

export interface Settings {
  consents: Consents
  /** Chi ha cambiato i consensi e quando: utile se più admin usano l'add-on. */
  consentsChangedBy?: string
  consentsChangedAt?: string
}

export class SettingsStore {
  private readonly file: string
  private current: Settings = { consents: { ...DEFAULT_CONSENTS } }

  constructor(dataDir: string) {
    this.file = join(dataDir, 'settings.json')
  }

  async load(): Promise<void> {
    const raw = await readJson<Record<string, unknown>>(this.file, {})
    this.current = {
      consents: parseConsents(raw.consents),
      consentsChangedBy: typeof raw.consentsChangedBy === 'string' ? raw.consentsChangedBy : undefined,
      consentsChangedAt: typeof raw.consentsChangedAt === 'string' ? raw.consentsChangedAt : undefined,
    }
  }

  get(): Settings {
    return this.current
  }

  consents(): Consents {
    return this.current.consents
  }

  async setConsents(consents: Consents, by: string): Promise<Settings> {
    this.current = { ...this.current, consents, consentsChangedBy: by, consentsChangedAt: new Date().toISOString() }
    await writeJsonAtomic(this.file, this.current)
    return this.current
  }
}
