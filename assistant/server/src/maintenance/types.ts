// Manutenzione dei dispositivi: problemi trovati con regole precise sui registri, sugli stati e
// sullo storico di Home Assistant. Tutto calcolato nell'add-on, senza Claude.

export const KINDS = ['integrazione', 'offline', 'orfane', 'stanza', 'senza_area', 'doppione', 'batteria', 'aggiornamento'] as const
export type IssueKind = (typeof KINDS)[number]

export type Action =
  | { type: 'sposta'; deviceId: string; areaId: string; areaName: string; from: string | null }
  | { type: 'disattiva'; deviceId: string }
  | { type: 'elimina_dispositivo'; deviceId: string; configEntryId: string }
  | { type: 'elimina_entita'; entityIds: string[] }

export interface IssueDevice {
  id: string
  name: string
  area: string | null
  integration: string | null
  model: string | null
}

export interface Issue {
  id: string
  kind: IssueKind
  /** stabile tra un controllo e l'altro: serve a "Ignora" */
  signature: string
  severity: 'avviso' | 'info'
  /** quanto è sicuro il suggerimento (stanze e doppioni) */
  confidence?: 'certa' | 'da_verificare'
  title: string
  detail: string
  device?: IssueDevice
  entities?: string[]
  actions: Action[]
  /** pagina di Home Assistant da aprire */
  link?: string
  /** automazioni e script che usano il dispositivo o le entità (dalla ricerca di HA) */
  usedBy?: Array<{ entityId: string; name: string }>
  /** il dispositivo comanda serrature, allarmi o garage: anche "Disattiva" va confermato */
  critical?: string
  /** azione già applicata da questa pagina */
  applied?: { action: Action['type']; at: string; by: string; historyId: string; undone?: boolean }
}

export interface ConfigEntryInfo {
  entryId: string
  domain: string
  title: string
  state: string
  reason: string | null
  disabled: boolean
  supportsRemoveDevice: boolean
  source: string | null
}

export interface ReauthFlow {
  domain: string
  entryId: string | null
}

/** Una modifica fatta da questa pagina, in /data/maintenance/history.jsonl. */
export interface MaintenanceChange {
  id: string
  at: string
  by: string
  issueId: string
  signature: string
  title: string
  action: Action
  /** valori di prima, per Annulla (solo sposta e disattiva) */
  before: { area_id?: string | null; disabled_by?: string | null } | null
  /** entità davvero eliminate (le altre erano già tornate) */
  removed?: string[]
  undone?: { at: string; by: string }
}

export interface MaintenanceRun {
  id: string
  createdAt: string
  by: string
  durationMs: number
  /** giorni di storico davvero disponibili (per "offline da almeno…") */
  coverageDays: number
  issues: Issue[]
  counts: Record<IssueKind, number>
  /** dispositivi senza area e senza indizi, solo come elenco */
  unassigned: IssueDevice[]
}
