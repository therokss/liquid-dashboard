// Renderer di una dashboard custom: dispone le card in griglia (react-grid-layout),
// responsive (lg su schermi larghi, sm su telefono). Read-only di default; con
// `editable` diventa trascinabile/ridimensionabile (usato dall'editor, Fase 4).
import { Responsive, WidthProvider, type Layout, type Layouts } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import type { CustomDashboard, DashboardCard } from './types'
import { GRID_COLS, GRID_ROW_HEIGHT } from './types'
import { EntityCard } from './cards/EntityCard'
import { TitleCard } from './cards/TitleCard'
import { GroupCard } from './cards/GroupCard'
import { PopupCard } from './cards/PopupCard'

const RGL = WidthProvider(Responsive)

function CardRenderer({ card }: { card: DashboardCard }) {
  const c = card.config as Record<string, unknown>
  switch (card.type) {
    case 'entity':
    case 'media': // media_player → MediaCard tramite EntityCard
      return <EntityCard entityId={c.entity_id as string | undefined} />
    case 'popup':
      return <PopupCard entityId={c.entity_id as string | undefined} title={c.title as string | undefined} />
    case 'group':
      return <GroupCard title={c.title as string | undefined} entities={c.entities as string[] | undefined} />
    case 'title':
      return <TitleCard text={c.text as string} subtitle={c.subtitle as string} />
    default:
      return null
  }
}

export interface DashboardRendererProps {
  dashboard: CustomDashboard
  editable?: boolean
  onLayoutChange?: (cards: DashboardCard[]) => void
  renderOverlay?: (card: DashboardCard) => React.ReactNode // es. pulsante rimuovi (editor)
}

export function DashboardRenderer({ dashboard, editable = false, onLayoutChange, renderOverlay }: DashboardRendererProps) {
  const cards = dashboard.cards

  const layouts: Layouts = {
    lg: cards.map((c) => ({ i: c.id, ...c.layout.lg })),
    sm: cards.map((c, idx) =>
      c.layout.sm
        ? { i: c.id, ...c.layout.sm }
        : { i: c.id, x: 0, y: idx * (c.layout.lg.h || 2), w: GRID_COLS.sm, h: c.layout.lg.h || 2 },
    ),
  }

  function handleLayoutChange(current: Layout[], all: Layouts) {
    if (!editable || !onLayoutChange) return
    const byId = (bp: Layout[] | undefined, id: string) => bp?.find((l) => l.i === id)
    const next = cards.map((c) => {
      const lg = byId(all.lg, c.id)
      const sm = byId(all.sm, c.id)
      return {
        ...c,
        layout: {
          lg: lg ? { x: lg.x, y: lg.y, w: lg.w, h: lg.h } : c.layout.lg,
          sm: sm ? { x: sm.x, y: sm.y, w: sm.w, h: sm.h } : c.layout.sm,
        },
      }
    })
    onLayoutChange(next)
  }

  return (
    <RGL
      className="ld-dash-grid"
      layouts={layouts}
      breakpoints={{ lg: 1080, sm: 0 }}
      cols={GRID_COLS}
      rowHeight={GRID_ROW_HEIGHT}
      margin={[12, 12]}
      isDraggable={editable}
      isResizable={editable}
      isDroppable={false}
      compactType="vertical"
      onLayoutChange={handleLayoutChange}
      draggableCancel=".glass-toggle,input,button,a,.ld-no-drag"
    >
      {cards.map((card) => (
        <div key={card.id} className="ld-dash-item" style={{ position: 'relative' }}>
          <CardRenderer card={card} />
          {editable && renderOverlay?.(card)}
        </div>
      ))}
    </RGL>
  )
}
