// Tipi condivisi del motore "Suggerisci": dati raccolti da Home Assistant, eventi
// normalizzati, candidati calcolati in locale e proposte di Claude.

/** Chi ha causato un cambio di stato, dai campi context_* del Registro attività. */
export type Cause = 'manuale' | 'automazione' | 'script' | 'sistema' | 'fisico' | 'altro'

export const CAUSE_LABELS: Record<Cause, string> = {
  manuale: "a mano (app, interfaccia, voce)",
  automazione: 'da automazione',
  script: 'da script',
  sistema: 'da strumenti esterni (Node-RED, add-on…)',
  fisico: 'dal dispositivo o da app esterne',
  altro: 'da altre entità',
}

export interface ActivityEvent {
  /** epoch ms */
  t: number
  /** entity_id */
  e: string
  /** stato (per le persone solo home/not_home senza consenso alla posizione) */
  s: string
  c: Cause
  /** automazione, script o utente all'origine (gli id utente non escono mai dall'add-on) */
  by?: string
  /** tipo di evento per le entità event.* (pulsanti) */
  et?: string
}

export interface EntityMeta {
  id: string
  domain: string
  name: string
  areaId: string | null
  areaName: string | null
  deviceClass: string | null
}

export interface AutomationInfo {
  entityId: string
  id: string | null
  alias: string
  enabled: boolean
  unavailable: boolean
  triggerEntities: string[]
  conditionEntities: string[]
  actionEntities: string[]
  /** trigger: state, time, sun, event, … */
  triggerKinds: string[]
}

export type UserKind = 'persona' | 'sistema'

export interface UserInfo {
  id: string
  name: string
  systemGenerated: boolean
  kind: UserKind
  /** true se il tipo è stato scelto dall'utente nelle impostazioni */
  overridden: boolean
}

export interface Activity {
  from: number
  to: number
  tz: string
  country: string | null
  /** Coordinate della casa: solo per alba/tramonto calcolati in locale. */
  location: { lat: number; lon: number } | null
  entities: Map<string, EntityMeta>
  events: ActivityEvent[]
  automations: AutomationInfo[]
  /** area_id → sensore di illuminamento e medie orarie (epoch ms dell'inizio ora → lux) */
  lux: Map<string, { sensor: string; byHour: Map<number, number> }>
  persons: string[]
  stats: ActivityStats
}

export interface ActivityStats {
  entities: number
  events: number
  byCause: Record<Cause, number>
  /** Primo giorno con dati nel Registro attività (il recorder può conservarne meno di quelli chiesti). */
  firstDay: string | null
  requestedDays: number
  luxAreas: number
  automations: number
}

export type CandidateKind = 'associazione' | 'routine' | 'routine_esterna' | 'dimenticata_fuori' | 'dimenticata_notte' | 'pulsante'

export interface Evidence {
  label: string
  value: string
}

export interface Candidate {
  id: string
  kind: CandidateKind
  /** Chiave stabile per "Non mi interessa" (soppressa per 60 giorni). */
  signature: string
  title: string
  score: number
  areaId: string | null
  /** Entità coinvolte, prima quella su cui agire. */
  entities: string[]
  evidence: Evidence[]
  /** Occorrenze recenti da confrontare col Registro attività di HA. */
  examples: string[]
  /** Dati compatti per Claude (niente nomi utente, niente coordinate). */
  dossier: Record<string, unknown>
}

/** Comportamento già coperto da un'automazione: non si propone, si rimanda a Verifica. */
export interface Deferred {
  title: string
  automation: string
  reason: string
}
