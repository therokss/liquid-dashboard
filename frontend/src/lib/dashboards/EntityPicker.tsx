// Selettore di entità: modale con ricerca, per scegliere il dispositivo di una card.
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Search, X } from 'lucide-react'
import { useStore } from '../../store'
import { getDomain } from '../../types/ha'

export function EntityPicker({
  domains,
  multiple,
  selected,
  onPick,
  onClose,
}: {
  domains?: string[]          // filtra per dominio (es. ['media_player'])
  multiple?: boolean          // selezione multipla (per i gruppi)
  selected?: string[]         // già selezionati (modalità multipla)
  onPick: (ids: string[]) => void
  onClose: () => void
}) {
  const entities = useStore((s) => s.entities)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string[]>(selected || [])

  const list = useMemo(() => {
    const query = q.trim().toLowerCase()
    return Object.values(entities)
      .filter((e) => !domains || domains.includes(getDomain(e.entity_id)))
      .filter((e) => {
        if (!query) return true
        const name = String(e.attributes.friendly_name || '').toLowerCase()
        return name.includes(query) || e.entity_id.toLowerCase().includes(query)
      })
      .sort((a, b) => String(a.attributes.friendly_name || a.entity_id).localeCompare(String(b.attributes.friendly_name || b.entity_id)))
      .slice(0, 200)
  }, [entities, q, domains])

  function toggle(id: string) {
    if (multiple) {
      setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
    } else {
      onPick([id])
    }
  }

  return createPortal(
    <motion.div
      data-theme="dark"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3600, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(3,10,20,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#08192b', borderTop: '1px solid var(--glass-border)', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxWidth: 640, width: '100%', margin: '0 auto', maxHeight: '82vh', display: 'flex', flexDirection: 'column', padding: 'var(--space-lg) var(--space-lg) calc(env(safe-area-inset-bottom, 0px) + var(--space-lg))' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <Search size={16} color="var(--text-tertiary)" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }} />
            <input
              className="glass-input"
              placeholder="Cerca dispositivo…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
              style={{ paddingLeft: 36 }}
            />
          </div>
          <button onClick={onClose} aria-label="Chiudi" style={{ width: 34, height: 34, borderRadius: 10, cursor: 'pointer', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={16} />
          </button>
        </div>

        <div className="glass-scroll" style={{ overflowY: 'auto', flex: 1 }}>
          {list.map((e) => {
            const on = sel.includes(e.entity_id)
            return (
              <button
                key={e.entity_id}
                onClick={() => toggle(e.entity_id)}
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, padding: '11px 8px', background: on ? 'var(--glass-bg-active)' : 'transparent', border: 'none', borderBottom: '1px solid var(--glass-border-dim)', borderRadius: 8 }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14.5, color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {String(e.attributes.friendly_name || e.entity_id)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontFamily: 'monospace' }}>{e.entity_id}</div>
                </div>
                {multiple && <div style={{ width: 20, height: 20, borderRadius: 6, flexShrink: 0, border: '1.5px solid var(--glass-border)', background: on ? 'var(--accent)' : 'transparent' }} />}
              </button>
            )
          })}
          {list.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Nessun dispositivo trovato</div>}
        </div>

        {multiple && (
          <button className="glass-btn glass-btn-accent" style={{ width: '100%', marginTop: 12 }} onClick={() => onPick(sel)}>
            Conferma ({sel.length})
          </button>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  )
}
