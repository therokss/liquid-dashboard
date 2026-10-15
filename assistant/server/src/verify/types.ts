// Tipi di "Verifica automazioni": problemi trovati dalle regole deterministiche (V1–V10),
// correzioni meccaniche e valutazioni di Claude.

export type Severity = 'errore' | 'avviso' | 'info'

export const RULES = {
  V1: 'Riferimenti',
  V2: 'Stato',
  V3: 'Entità senza dati',
  V4: 'Soglie',
  V5: 'Logica',
  V6: 'Frequenza',
  V7: 'Oscillazioni',
  V8: 'Conflitti',
  V9: 'Esecuzioni',
  V10: 'Sintassi',
} as const
export type RuleId = keyof typeof RULES

/** Correzione applicabile senza interpretazione (o quasi: `certain` false = da confermare). */
export type Fix =
  | { kind: 'sostituisci_entita'; from: string; to: string; certain: boolean; label: string }
  | { kind: 'to_null'; triggers: number[]; certain: boolean; label: string }
  | { kind: 'time_pattern'; trigger: number; pattern: Record<string, string>; certain: boolean; label: string }
  | { kind: 'trigger_id'; from: string; to: string[]; certain: boolean; label: string }
  | { kind: 'sintassi'; certain: boolean; label: string }

export interface Finding {
  id: string
  /** Chiave stabile per "Ignora". */
  signature: string
  rule: RuleId
  code: string
  severity: Severity
  /** entity_id dell'automazione */
  automation: string
  title: string
  detail: string
  refs: string[]
  fix?: Fix
}

export type AutomationSource = 'editor' | 'blueprint' | 'yaml' | 'senza_id'

export interface TraceStats {
  stored: number
  outcomes: Record<string, number>
  lastError: string | null
  /** esecuzioni all'ora stimate dalle ultime tracce (null se non stimabile) */
  perHour: number | null
  last: string | null
}

export interface AutomationReport {
  entityId: string
  id: string | null
  alias: string
  state: string
  source: AutomationSource
  editable: boolean
  mode: string
  lastTriggered: string | null
  traces: TraceStats
  /** entità usate (trigger, condizioni, azioni) */
  entities: string[]
  findings: string[]
}
