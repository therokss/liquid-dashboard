import { join } from 'node:path'
import { readJson, writeJsonAtomic } from './atomic.ts'
import { DEFAULT_CONSENTS, parseConsents, type Consents } from '../inventory/privacy.ts'
import type { UserKind } from '../suggest/types.ts'

// Impostazioni modificabili dall'interfaccia (le opzioni dell'add-on restano nel Supervisor).

export interface Settings {
  consents: Consents
  /** Chi ha cambiato i consensi e quando: utile se più admin usano l'add-on. */
  consentsChangedBy?: string
  consentsChangedAt?: string
  /** Interruttore di prova input_boolean.test_claude: creato dall'add-on o già presente. */
  testHelper?: { status: 'creato' | 'esistente'; at: string }
  /** Utenti HA da contare come persona o come strumento (Suggerisci); assenti = valore predefinito. */
  userKinds?: Record<string, UserKind>
}

function parseUserKinds(raw: unknown): Record<string, UserKind> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: Record<string, UserKind> = {}
  for (const [k, v] of Object.entries(raw)) if (/^[a-f0-9]{32}$/.test(k) && (v === 'persona' || v === 'sistema')) out[k] = v
  return out
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
      testHelper: raw.testHelper && typeof raw.testHelper === 'object' ? (raw.testHelper as Settings['testHelper']) : undefined,
      userKinds: parseUserKinds(raw.userKinds),
    }
  }

  get(): Settings {
    return this.current
  }

  consents(): Consents {
    return this.current.consents
  }

  async setTestHelper(status: 'creato' | 'esistente'): Promise<void> {
    this.current = { ...this.current, testHelper: { status, at: new Date().toISOString() } }
    await writeJsonAtomic(this.file, this.current)
  }

  async setUserKinds(kinds: Record<string, UserKind>): Promise<Settings> {
    this.current = { ...this.current, userKinds: parseUserKinds(kinds) ?? {} }
    await writeJsonAtomic(this.file, this.current)
    return this.current
  }

  async setConsents(consents: Consents, by: string): Promise<Settings> {
    this.current = { ...this.current, consents, consentsChangedBy: by, consentsChangedAt: new Date().toISOString() }
    await writeJsonAtomic(this.file, this.current)
    return this.current
  }
}
