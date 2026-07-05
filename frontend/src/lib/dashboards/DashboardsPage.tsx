// Gestione delle dashboard custom: crea, modifica, elimina e assegna a QUESTO schermo.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { ChevronLeft, Plus, Pencil, Trash2, Monitor, Check } from 'lucide-react'
import { loadDashboards, deleteDashboard, setDeviceAssignment, saveDashboard, type DashboardsData } from './store'
import { DashboardEditor } from './DashboardEditor'
import { emptyDashboard, type CustomDashboard } from './types'
import { getScreenId, getScreenName } from './deviceId'

export function DashboardsPage({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<DashboardsData>({ dashboards: [], deviceMap: {} })
  const [editing, setEditing] = useState<CustomDashboard | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const screenId = getScreenId()
  const assigned = data.deviceMap[screenId] || null

  function reload() { void loadDashboards().then(setData) }
  useEffect(() => { reload() }, [])

  async function assign(id: string | null) { await setDeviceAssignment(screenId, id); reload() }
  async function remove(id: string) { await deleteDashboard(id); setConfirmDel(null); reload() }
  async function doRename(d: CustomDashboard) {
    const name = renameText.trim()
    setRenaming(null)
    if (name && name !== d.name) { await saveDashboard({ ...d, name }); reload() }
  }

  return createPortal(
    <motion.div
      data-theme="dark"
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      style={{ position: 'fixed', inset: 0, zIndex: 3200, overflowY: 'auto', background: '#051424' }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 'calc(env(safe-area-inset-top, 0px) + 20px) var(--space-lg) calc(env(safe-area-inset-bottom, 0px) + 32px)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--space-lg)' }}>
          <button onClick={onBack} style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-pill)', color: 'var(--text-primary)', padding: '6px 12px 6px 8px', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            <ChevronLeft size={16} /> Indietro
          </button>
          <h2 style={{ flex: 1, fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>Dashboard</h2>
          <button onClick={() => setEditing(emptyDashboard('Nuova dashboard'))} className="glass-btn glass-btn-accent" style={{ padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
            <Plus size={16} /> Crea
          </button>
        </div>

        {/* Cosa mostra questo schermo */}
        <div className="glass-card" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <Monitor size={18} color="var(--accent)" />
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Questo schermo · {getScreenName()}</div>
          </div>
          <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginBottom: 12 }}>
            Mostra di default: <b style={{ color: 'var(--text-secondary)' }}>{assigned ? (data.dashboards.find((d) => d.id === assigned)?.name || 'dashboard') : 'Predefinita (Home)'}</b>
          </div>
          <button onClick={() => assign(null)} className="glass-btn" style={{ fontSize: 13, padding: '7px 14px', opacity: assigned ? 1 : 0.5 }} disabled={!assigned}>
            Torna alla predefinita
          </button>
        </div>

        {/* Elenco dashboard */}
        {data.dashboards.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)', fontSize: 14 }}>
            Nessuna dashboard. Tocca <b>Crea</b> per la prima.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.dashboards.map((d) => (
              <div key={d.id} className="glass-panel" style={{ padding: 'var(--space-md) var(--space-lg)', display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {renaming === d.id ? (
                    <input
                      className="glass-input"
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onBlur={() => doRename(d)}
                      onKeyDown={(e) => { if (e.key === 'Enter') doRename(d); if (e.key === 'Escape') setRenaming(null) }}
                      autoFocus
                      style={{ fontSize: 15, padding: '5px 10px' }}
                    />
                  ) : (
                    <div
                      onClick={() => { setRenaming(d.id); setRenameText(d.name) }}
                      style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', cursor: 'text' }}
                    >
                      {d.name}
                    </div>
                  )}
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{d.cards.length} card{assigned === d.id ? ' · su questo schermo' : ''}</div>
                </div>
                <button onClick={() => assign(d.id)} aria-label="Assegna" className="glass-btn" style={{ padding: '7px 10px', flexShrink: 0, color: assigned === d.id ? 'var(--accent)' : undefined }}>
                  {assigned === d.id ? <Check size={16} /> : <Monitor size={16} />}
                </button>
                <button onClick={() => setEditing(d)} aria-label="Modifica" className="glass-btn" style={{ padding: '7px 10px', flexShrink: 0 }}>
                  <Pencil size={16} />
                </button>
                <button onClick={() => setConfirmDel(d.id)} aria-label="Elimina" style={{ padding: '7px 10px', flexShrink: 0, borderRadius: 'var(--radius-md)', cursor: 'pointer', background: 'rgba(255,90,95,0.12)', border: '1px solid rgba(255,90,95,0.25)', color: '#ff8f8f' }}>
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        {confirmDel && (
          <div style={{ marginTop: 14, padding: 'var(--space-md) var(--space-lg)', borderRadius: 'var(--radius-lg)', background: 'rgba(255,90,95,0.1)', border: '1px solid rgba(255,90,95,0.3)', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, fontSize: 13.5, color: 'var(--text-secondary)' }}>Eliminare questa dashboard?</div>
            <button onClick={() => setConfirmDel(null)} className="glass-btn" style={{ padding: '6px 12px', fontSize: 13 }}>Annulla</button>
            <button onClick={() => remove(confirmDel)} className="glass-btn" style={{ padding: '6px 12px', fontSize: 13, background: '#ff5a5f', color: 'white' }}>Elimina</button>
          </div>
        )}
      </div>

      {editing && (
        <DashboardEditor
          dashboard={editing}
          onSaved={() => { setEditing(null); reload() }}
          onClose={() => setEditing(null)}
        />
      )}
    </motion.div>,
    document.body,
  )
}
