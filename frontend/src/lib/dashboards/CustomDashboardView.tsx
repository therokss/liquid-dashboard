// Vista a schermo pieno di una dashboard custom assegnata a questo schermo (tablet a
// muro). Read-only, con un tasto per tornare alla dashboard predefinita (Home + tab).
import { Home } from 'lucide-react'
import { DashboardRenderer } from './DashboardRenderer'
import type { CustomDashboard } from './types'

export function CustomDashboardView({ dashboard, onDefault }: { dashboard: CustomDashboard; onDefault: () => void }) {
  return (
    <div className="app-content">
      <div
        style={{
          display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
          padding: 'calc(env(safe-area-inset-top, 0px) + 12px) var(--space-lg) 10px',
        }}
      >
        <h1 style={{ flex: 1, fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: 'var(--on-wallpaper)', letterSpacing: '-0.03em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {dashboard.name}
        </h1>
        <button
          onClick={onDefault}
          className="glass-btn"
          style={{ padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, flexShrink: 0 }}
        >
          <Home size={16} /> Predefinita
        </button>
      </div>

      <div className="glass-scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 var(--space-md) calc(env(safe-area-inset-bottom, 0px) + 24px)' }}>
        {dashboard.cards.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)', fontSize: 14 }}>
            Questa dashboard è vuota. Aggiungi delle card dall'editor.
          </div>
        ) : (
          <DashboardRenderer dashboard={dashboard} />
        )}
      </div>
    </div>
  )
}
