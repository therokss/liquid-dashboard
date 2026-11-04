import { memo, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ChevronRight, Trash2, X } from 'lucide-react'
import { GlassCard } from '../glass/GlassCard'
import { useStore } from '../../store'
import { useT } from '../../i18n'
import { INTERVAL_OPTIONS, WASTE_TYPES, WEEKDAYS, WEEKDAY_ORDER, upcomingCollections, weekdayName } from '../../lib/waste'
import type { Collection, WasteType } from '../../lib/waste'

const LOCALES = { it: 'it-IT', en: 'en-GB', es: 'es-ES' } as const
// Giorni mostrati nel dettaglio: bastano anche per la raccolta ogni 4 settimane
const DETAIL_DAYS = 28
const EXPOSE = '#ffb300'

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function WasteChip({ type, small }: { type: WasteType; small?: boolean }) {
  const t = useT()
  const Icon = type.Icon
  return (
    <div
      style={{
        display: 'inline-flex', alignItems: 'center', gap: small ? 6 : 7,
        padding: small ? '5px 10px' : '7px 12px', borderRadius: 'var(--radius-pill)',
        background: `${type.color}1f`, border: `1px solid ${type.color}55`,
      }}
    >
      <Icon size={small ? 13 : 15} color={type.color} />
      <span style={{ fontSize: small ? 12 : 13, fontWeight: 600, color: 'var(--text-primary)' }}>{t(type.label)}</span>
    </div>
  )
}

export const WasteCard = memo(function WasteCard() {
  const t = useT()
  const schedule = useStore((s) => s.wasteSchedule)
  const intervals = useStore((s) => s.wasteInterval)
  const anchors = useStore((s) => s.wasteAnchor)
  const [showDetail, setShowDetail] = useState(false)

  // 35 giorni: ogni tipo configurato ha almeno una raccolta nella finestra
  const upcoming = useMemo(() => upcomingCollections(schedule, intervals, anchors, 35), [schedule, intervals, anchors])
  if (upcoming.length === 0) return null

  const tomorrow = upcoming.find((c) => c.diff === 1)
  const todayItems = upcoming.find((c) => c.diff === 0)

  let mode: 'expose' | 'today' | 'next'
  let next: Collection
  if (tomorrow) { mode = 'expose'; next = tomorrow }
  else if (todayItems) { mode = 'today'; next = todayItems }
  else { mode = 'next'; next = upcoming[0] }

  const highlight = mode === 'expose'
  const accent = highlight ? EXPOSE : 'var(--accent)'

  const title = mode === 'expose' ? t('Esponi stasera') : mode === 'today' ? t('Raccolta oggi') : t('Prossima raccolta')
  const subtitle = mode === 'expose'
    ? t('Domani passa la raccolta')
    : mode === 'today'
      ? t('Oggi passa la raccolta')
      : next.diff <= 7
        ? WEEKDAYS[next.date.getDay()]
        : capitalize(next.date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'short' }))

  return (
    <>
      <GlassCard
        size="md"
        onClick={() => setShowDetail(true)}
        style={{
          cursor: 'pointer',
          ...(highlight ? { border: '1px solid rgba(255,179,0,0.5)', boxShadow: 'var(--glass-shadow), inset 0 0 22px -4px rgba(255,179,0,0.35)' } : {}),
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div
            style={{
              width: 44, height: 44, borderRadius: 12,
              background: `${accent}22`, border: `1px solid ${accent}44`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: accent, flexShrink: 0,
            }}
          >
            {mode === 'expose' ? <AlertCircle size={22} /> : <Trash2 size={22} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{subtitle}</div>
          </div>
          <ChevronRight size={18} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {next.types.map((type) => <WasteChip key={type.id} type={type} />)}
        </div>
      </GlassCard>

      {createPortal(
        <AnimatePresence>
          {showDetail && <WasteDetailSheet onClose={() => setShowDetail(false)} />}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
})

// Bottom-sheet con le raccolte delle prossime 4 settimane e il calendario di ogni tipo
function WasteDetailSheet({ onClose }: { onClose: () => void }) {
  const t = useT()
  const schedule = useStore((s) => s.wasteSchedule)
  const intervals = useStore((s) => s.wasteInterval)
  const anchors = useStore((s) => s.wasteAnchor)
  const language = useStore((s) => s.language)
  const locale = LOCALES[language] ?? 'it-IT'

  const upcoming = useMemo(() => upcomingCollections(schedule, intervals, anchors, DETAIL_DAYS), [schedule, intervals, anchors])
  const configured = WASTE_TYPES.filter((w) => (schedule[w.id] ?? []).length > 0)

  // "Oggi", "Domani" o il giorno della settimana; la data va sotto
  const dayLabel = (c: Collection) =>
    c.diff === 0 ? t('Oggi') : c.diff === 1 ? t('Domani') : capitalize(c.date.toLocaleDateString(locale, { weekday: 'long' }))
  const dateLabel = (c: Collection) => c.date.toLocaleDateString(locale, { day: 'numeric', month: 'long' })
  const shortLabel = (c: Collection) =>
    c.diff === 0 ? t('Oggi') : c.diff === 1 ? t('Domani') : capitalize(c.date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }))

  return (
    <motion.div
      data-theme="dark"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3400, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(3,10,20,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        onClick={(ev) => ev.stopPropagation()}
        className="ld-no-inner-blur"
        style={{ background: '#08192b', borderTop: '1px solid var(--glass-border)', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxWidth: 640, width: '100%', margin: '0 auto', maxHeight: 'calc(85 * var(--dvh))', display: 'flex', flexDirection: 'column', padding: 'var(--space-lg) var(--space-lg) calc(env(safe-area-inset-bottom, 0px) + var(--space-lg))' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>{t('Prossime raccolte')}</h3>
          <button onClick={onClose} aria-label={t('Chiudi')} style={{ width: 32, height: 32, borderRadius: 10, cursor: 'pointer', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={17} />
          </button>
        </div>

        <div className="glass-scroll" style={{ overflowY: 'auto' }}>
          <div className="text-caption" style={{ marginBottom: 8 }}>{t('Prossime 4 settimane')}</div>
          <div className="glass-panel" style={{ padding: '2px var(--space-lg)', marginBottom: 'var(--space-lg)' }}>
            {upcoming.length === 0 && (
              <div style={{ padding: '12px 0', fontSize: 14, color: 'var(--text-secondary)' }}>{t('Nessuna raccolta nelle prossime 4 settimane')}</div>
            )}
            {upcoming.map((c, i) => {
              const expose = c.diff === 1
              return (
                <div key={c.date.getTime()} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: i < upcoming.length - 1 ? '1px solid var(--glass-border-dim)' : 'none' }}>
                  <div style={{ flex: '0 0 112px', minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: expose ? EXPOSE : 'var(--text-primary)' }}>{dayLabel(c)}</div>
                    <div style={{ fontSize: 12, color: expose ? EXPOSE : 'var(--text-secondary)', marginTop: 2 }}>{dateLabel(c)}</div>
                    {expose && <div style={{ fontSize: 12, fontWeight: 600, color: EXPOSE, marginTop: 2 }}>{t('Esponi stasera')}</div>}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {c.types.map((type) => <WasteChip key={type.id} type={type} small />)}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="text-caption" style={{ marginBottom: 8 }}>{t('Per tipo')}</div>
          <div className="glass-panel" style={{ padding: '2px var(--space-lg)' }}>
            {configured.map((w, i) => {
              const Icon = w.Icon
              const days = WEEKDAY_ORDER.filter((d) => schedule[w.id].includes(d)).map((d) => weekdayName(d, locale)).join(', ')
              const every = INTERVAL_OPTIONS.find((o) => o.value === (intervals[w.id] ?? 1))?.label
              const n = upcoming.find((c) => c.types.some((x) => x.id === w.id))
              return (
                <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: i < configured.length - 1 ? '1px solid var(--glass-border-dim)' : 'none' }}>
                  <div style={{ width: 32, height: 32, borderRadius: 10, background: `${w.color}22`, border: `1px solid ${w.color}44`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <Icon size={16} color={w.color} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{t(w.label)}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                      {capitalize(days)}{every ? ` · ${t(every)}` : ''}
                    </div>
                  </div>
                  {n && <div style={{ fontSize: 13, fontWeight: 600, color: n.diff === 1 ? EXPOSE : 'var(--text-secondary)', textAlign: 'right', flexShrink: 0 }}>{shortLabel(n)}</div>}
                </div>
              )
            })}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}
