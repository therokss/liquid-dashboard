// Editor di una dashboard: trascina/ridimensiona le card, aggiungine di nuove
// (scegliendo tipo ed entità) e salva. Grafica Liquid Glass.
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Plus, Save, X, Check, LayoutGrid, Cpu, Play, Type, Layers } from 'lucide-react'
import { DashboardRenderer } from './DashboardRenderer'
import { EntityPicker } from './EntityPicker'
import { saveDashboard } from './store'
import { newId, type CustomDashboard, type DashboardCard, type CardType, type CardLayout } from './types'

const DEFAULT_SIZE: Record<CardType, [number, number]> = {
  entity: [4, 2], group: [6, 4], media: [6, 3], title: [12, 1], popup: [3, 2],
}

function defaultLayout(type: CardType, cards: DashboardCard[]): { lg: CardLayout } {
  const maxY = cards.reduce((m, c) => Math.max(m, c.layout.lg.y + c.layout.lg.h), 0)
  const [w, h] = DEFAULT_SIZE[type]
  return { lg: { x: 0, y: maxY, w, h } }
}

export function DashboardEditor({ dashboard, onSaved, onClose }: { dashboard: CustomDashboard; onSaved: () => void; onClose: () => void }) {
  const [cards, setCards] = useState<DashboardCard[]>(dashboard.cards)
  const [name, setName] = useState(dashboard.name)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)

  function addCard(type: CardType, config: Record<string, unknown>) {
    setCards((cs) => [...cs, { id: newId(), type, config, layout: defaultLayout(type, cs) }])
    setAdding(false)
  }
  function removeCard(id: string) {
    setCards((cs) => cs.filter((c) => c.id !== id))
  }
  async function save() {
    setSaving(true)
    await saveDashboard({ ...dashboard, name, cards })
    setSaving(false)
    onSaved()
  }

  return createPortal(
    <div data-theme="dark" style={{ position: 'fixed', inset: 0, zIndex: 3300, backgroundColor: '#051424', backgroundImage: 'var(--wallpaper-url)', backgroundSize: 'cover', backgroundPosition: 'center', display: 'flex', flexDirection: 'column' }}>
      {/* Overlay del wallpaper: stessa resa della dashboard reale, così i colori
          del testo (var --on-wallpaper) si adattano allo sfondo. */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, background: 'var(--wallpaper-overlay)', pointerEvents: 'none' }} />
      {/* Toolbar */}
      <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: 'calc(env(safe-area-inset-top, 0px) + 12px) var(--space-lg) 12px', borderBottom: '1px solid var(--glass-border)', background: 'rgba(5,20,36,0.55)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', flexShrink: 0 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome dashboard"
          style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)', fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800 }}
        />
        <button onClick={() => setAdding(true)} className="glass-btn glass-btn-accent" style={{ padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, flexShrink: 0 }}>
          <Plus size={16} /> Card
        </button>
        <button onClick={save} disabled={saving} className="glass-btn" style={{ padding: '8px 14px', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, flexShrink: 0 }}>
          <Save size={16} /> {saving ? '…' : 'Salva'}
        </button>
        <button onClick={onClose} aria-label="Chiudi" style={{ width: 36, height: 36, borderRadius: 10, cursor: 'pointer', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <X size={16} />
        </button>
      </div>

      {/* Griglia editabile */}
      <div className="glass-scroll" style={{ position: 'relative', zIndex: 1, flex: 1, overflowY: 'auto', padding: 'var(--space-md)' }}>
        {cards.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)' }}>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}><LayoutGrid size={40} strokeWidth={1.5} /></div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Dashboard vuota</div>
            <div style={{ fontSize: 13 }}>Tocca <b>+ Card</b> per aggiungere il primo elemento.</div>
          </div>
        ) : (
          <DashboardRenderer
            dashboard={{ ...dashboard, name, cards }}
            editable
            onLayoutChange={setCards}
            renderOverlay={(card) => (
              <button
                className="ld-no-drag"
                onClick={() => removeCard(card.id)}
                aria-label="Rimuovi"
                style={{ position: 'absolute', top: -8, right: -8, width: 26, height: 26, borderRadius: '50%', cursor: 'pointer', background: '#ff5a5f', border: '2px solid #051424', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 5 }}
              >
                <X size={13} />
              </button>
            )}
          />
        )}
      </div>

      {adding && <AddCardFlow onAdd={addCard} onClose={() => setAdding(false)} />}
    </div>,
    document.body,
  )
}

// --- Flusso "Aggiungi card": scegli tipo → (entità o testo) ---
const CARD_TYPES: Array<{ type: CardType; label: string; Icon: typeof Cpu; desc: string }> = [
  { type: 'entity', label: 'Dispositivo', Icon: Cpu, desc: 'Luce, interruttore, sensore…' },
  { type: 'group', label: 'Gruppo', Icon: Layers, desc: 'Più dispositivi insieme' },
  { type: 'media', label: 'Media', Icon: Play, desc: 'Lettore multimediale' },
  { type: 'popup', label: 'Popup', Icon: LayoutGrid, desc: 'Card compatta con dettaglio' },
  { type: 'title', label: 'Titolo', Icon: Type, desc: 'Intestazione di sezione' },
]

function AddCardFlow({ onAdd, onClose }: { onAdd: (type: CardType, config: Record<string, unknown>) => void; onClose: () => void }) {
  const [step, setStep] = useState<'type' | 'title'>('type')
  const [pickerFor, setPickerFor] = useState<CardType | null>(null)
  const [titleText, setTitleText] = useState('')

  function choose(type: CardType) {
    if (type === 'title') { setStep('title'); return }
    if (type === 'group') { setPickerFor('group'); return }
    setPickerFor(type) // entity/media/popup → picker singolo
  }

  if (pickerFor) {
    const domains = pickerFor === 'media' ? ['media_player'] : undefined
    return (
      <EntityPicker
        domains={domains}
        multiple={pickerFor === 'group'}
        onPick={(ids) => {
          if (pickerFor === 'group') onAdd('group', { entities: ids, title: 'Gruppo' })
          else onAdd(pickerFor, { entity_id: ids[0] })
        }}
        onClose={() => setPickerFor(null)}
      />
    )
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
        style={{ background: '#08192b', borderTop: '1px solid var(--glass-border)', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxWidth: 640, width: '100%', margin: '0 auto', padding: 'var(--space-lg) var(--space-lg) calc(env(safe-area-inset-bottom, 0px) + var(--space-lg))' }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 14 }}>Aggiungi una card</div>

        {step === 'type' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
            {CARD_TYPES.map(({ type, label, Icon, desc }) => (
              <button key={type} onClick={() => choose(type)} className="glass-panel" style={{ textAlign: 'left', cursor: 'pointer', padding: 'var(--space-md)', display: 'flex', flexDirection: 'column', gap: 6, background: 'transparent' }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: 'var(--accent-glow)', border: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                  <Icon size={19} />
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--text-primary)' }}>{label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', lineHeight: 1.4 }}>{desc}</div>
              </button>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input className="glass-input" placeholder="Testo del titolo" value={titleText} onChange={(e) => setTitleText(e.target.value)} autoFocus />
            <button className="glass-btn glass-btn-accent" style={{ width: '100%' }} onClick={() => onAdd('title', { text: titleText || 'Titolo' })}>
              <Check size={16} style={{ marginRight: 6 }} /> Aggiungi titolo
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  )
}
