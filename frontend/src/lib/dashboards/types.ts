// Modello dati dell'editor di dashboard custom.
//
// Una dashboard è una lista di card; ogni card ha un tipo, una config (dipende dal
// tipo) e una posizione nella griglia per breakpoint (lg = schermi larghi, sm = telefono).

export type CardType = 'entity' | 'group' | 'media' | 'title' | 'popup'

export interface CardLayout {
  x: number
  y: number
  w: number
  h: number
}

export interface DashboardCard {
  id: string
  type: CardType
  // Config specifica del tipo. Esempi:
  //  entity  → { entity_id }
  //  group   → { title?, entities: string[] }
  //  media   → { entity_id }
  //  title   → { text, subtitle? }
  //  popup   → { entity_id, title? } (card compatta che apre un dettaglio)
  config: Record<string, unknown>
  // Posizione/dimensione per breakpoint (react-grid-layout). sm opzionale: se assente
  // il renderer impila le card automaticamente su telefono.
  layout: { lg: CardLayout; sm?: CardLayout }
}

export interface CustomDashboard {
  id: string
  name: string
  icon?: string        // nome icona lucide (opzionale)
  cards: DashboardCard[]
  updatedAt?: number
}

// Numero di colonne della griglia per breakpoint (react-grid-layout).
export const GRID_COLS = { lg: 12, sm: 4 } as const
export const GRID_ROW_HEIGHT = 84 // px per unità di altezza

export function newId(): string {
  return 'c' + Math.random().toString(36).slice(2, 9)
}

export function emptyDashboard(name: string): CustomDashboard {
  return { id: 'd' + Math.random().toString(36).slice(2, 9), name, cards: [], updatedAt: Date.now() }
}
