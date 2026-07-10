import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye, EyeOff, ChevronLeft, ChevronRight, Check, Lightbulb, Power, Gauge, Radio,
  Thermometer, Speaker, Blinds, Fan, Lock, HelpCircle, RotateCcw, List, LayoutGrid, type LucideIcon,
} from 'lucide-react'
import { useStore } from '../store'
import { getDomain } from '../types/ha'
import { useT } from '../i18n'
import type { HassEntity } from '../types/ha'

const MANAGEABLE_DOMAINS = new Set([
  'light', 'switch', 'sensor', 'binary_sensor', 'climate', 'media_player', 'cover', 'fan', 'lock',
])

const DOMAIN_ICON: Record<string, LucideIcon> = {
  light: Lightbulb, switch: Power, sensor: Gauge, binary_sensor: Radio,
  climate: Thermometer, media_player: Speaker, cover: Blinds, fan: Fan, lock: Lock,
}
const DOMAIN_LABEL: Record<string, string> = {
  light: 'Luce', switch: 'Interruttore', sensor: 'Sensore', binary_sensor: 'Sensore',
  climate: 'Clima', media_player: 'Media', cover: 'Tapparella', fan: 'Ventola', lock: 'Serratura',
}
const STATE_LABEL: Record<string, string> = {
  on: 'Acceso', off: 'Spento', open: 'Aperto', closed: 'Chiuso', home: 'A casa', not_home: 'Fuori',
  locked: 'Bloccato', unlocked: 'Sbloccato', playing: 'In riproduzione', paused: 'In pausa',
  idle: 'Inattivo', unavailable: 'Non disponibile', unknown: 'Sconosciuto',
}

function entityName(e: HassEntity): string {
  return (e.attributes.friendly_name as string) ?? e.entity_id
}
function stateLabel(e: HassEntity): string {
  const unit = e.attributes.unit_of_measurement as string | undefined
  if (unit) {
    const n = Number(e.state)
    const v = Number.isFinite(n) ? (Math.round(n * 100) / 100).toString() : e.state
    return `${v} ${unit}`
  }
  return STATE_LABEL[e.state] ?? e.state
}
function buildManageable(entities: Record<string, HassEntity>, autoHidden: Record<string, true>): HassEntity[] {
  const arr: HassEntity[] = []
  for (const e of Object.values(entities)) {
    if (autoHidden[e.entity_id]) continue
    if (!MANAGEABLE_DOMAINS.has(getDomain(e.entity_id))) continue
    arr.push(e)
  }
  return arr
}

export function VisibilityStepper({ onDone }: { onDone?: () => void }) {
  const t = useT()
  const entities = useStore((s) => s.entities)
  const areas = useStore((s) => s.areas)
  const entityAreas = useStore((s) => s.entityAreas)
  const autoHidden = useStore((s) => s.hiddenEntities)
  const userHidden = useStore((s) => s.userHiddenEntities)
  const decide = useStore((s) => s.decideVisibility)
  const clearReviewed = useStore((s) => s.clearReviewed)

  const [areaFilter, setAreaFilter] = useState<string>('all')
  const [queue, setQueue] = useState<HassEntity[]>([])
  const [index, setIndex] = useState(0)
  const [dir, setDir] = useState(1)
  const [reviewAll, setReviewAll] = useState(false)
  const [viewMode, setViewMode] = useState<'stepper' | 'list'>('stepper')

  const areaName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const a of areas) m[a.area_id] = a.name
    return m
  }, [areas])

  // Aree con entità gestibili (per il selettore) + presenza di "senza stanza"
  const areaOptions = useMemo(() => {
    const set = new Set<string>()
    let hasNone = false
    for (const e of buildManageable(entities, autoHidden)) {
      const a = entityAreas[e.entity_id]
      if (a) set.add(a); else hasNone = true
    }
    const opts = areas.filter((a) => set.has(a.area_id)).map((a) => ({ id: a.area_id, name: a.name }))
    opts.sort((x, y) => x.name.localeCompare(y.name))
    return { opts, hasNone }
  }, [entities, autoHidden, entityAreas, areas])

  const entitiesReady = Object.keys(entities).length > 20

  const listFor = (filter: string): HassEntity[] => {
    const all = buildManageable(useStore.getState().entities, useStore.getState().hiddenEntities)
    const inArea = all.filter((e) => {
      const a = entityAreas[e.entity_id]
      if (filter === 'all') return true
      if (filter === 'none') return !a
      return a === filter
    })
    inArea.sort((a, b) => {
      const aa = areaName[entityAreas[a.entity_id]] ?? '￿'
      const ba = areaName[entityAreas[b.entity_id]] ?? '￿'
      return aa.localeCompare(ba) || entityName(a).localeCompare(entityName(b))
    })
    return inArea
  }

  const rebuild = () => {
    const st = useStore.getState()
    const base = listFor(areaFilter)
    // Già "decise" = riviste nello stepper OPPURE già nascoste in precedenza
    const pending = reviewAll
      ? base
      : base.filter((e) => !st.visibilityReviewed[e.entity_id] && !st.userHiddenEntities[e.entity_id])
    setQueue(pending)
    setIndex(0)
    setDir(1)
  }

  // Ricostruisce la coda (snapshot) al cambio stanza o quando le entità sono pronte
  useEffect(() => {
    if (entitiesReady) rebuild()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaFilter, entitiesReady, reviewAll])

  const total = queue.length
  const hiddenCount = Object.keys(userHidden).length
  const done = index >= total

  const choose = (hidden: boolean) => {
    const e = queue[index]
    if (!e) return
    decide(e.entity_id, hidden)
    setDir(1)
    setIndex((i) => i + 1)
  }

  const reviewAgain = () => {
    clearReviewed(listFor(areaFilter).map((e) => e.entity_id))
    setReviewAll(true) // include anche le già nascoste, per riconsiderarle
    setQueue(listFor(areaFilter))
    setIndex(0)
    setDir(1)
  }

  const areaSelect = (
    <select
      className="ld-select"
      value={areaFilter}
      onChange={(e) => { setReviewAll(false); setAreaFilter(e.target.value) }}
      style={{ width: '100%' }}
    >
      <option value="all">{t('Tutte le stanze')}</option>
      {areaOptions.opts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      {areaOptions.hasNone && <option value="none">{t('Senza stanza')}</option>}
    </select>
  )

  const e = !done ? queue[index] : undefined
  const domain = e ? getDomain(e.entity_id) : ''
  const Icon = DOMAIN_ICON[domain] ?? HelpCircle
  const area = e ? areaName[entityAreas[e.entity_id]] : undefined
  const visible = e ? !userHidden[e.entity_id] : true

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
      {/* Selettore stanza + toggle vista (scheda una-alla-volta ↔ lista) */}
      <div>
        <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6, fontWeight: 600 }}>{t('Scegli la stanza da configurare')}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>{areaSelect}</div>
          <button
            onClick={() => setViewMode((v) => (v === 'list' ? 'stepper' : 'list'))}
            aria-label={viewMode === 'list' ? t('Vista scheda') : t('Vista lista')}
            className="glass-btn"
            style={{ flexShrink: 0, padding: '0 14px' }}
          >
            {viewMode === 'list' ? <LayoutGrid size={17} /> : <List size={17} />}
          </button>
        </div>
      </div>

      {viewMode === 'list' ? (
        <div className="glass-scroll" style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          <div className="glass-panel" style={{ padding: '2px var(--space-lg)' }}>
            {listFor(areaFilter).map((it) => {
              const vis = !userHidden[it.entity_id]
              const RowIcon = DOMAIN_ICON[getDomain(it.entity_id)] ?? HelpCircle
              return (
                <div key={it.entity_id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: '1px solid var(--glass-border-dim)' }}>
                  <RowIcon size={18} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, color: 'var(--text-primary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entityName(it)}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{areaName[entityAreas[it.entity_id]] ?? t('Senza stanza')}</div>
                  </div>
                  <button
                    onClick={() => decide(it.entity_id, vis)}
                    aria-label={vis ? t('Nascondi') : t('Mostra')}
                    style={{ flexShrink: 0, width: 46, height: 30, borderRadius: 9, cursor: 'pointer', border: vis ? 'none' : '1px solid var(--glass-border)', background: vis ? 'var(--accent)' : 'var(--glass-bg)', color: vis ? '#04121e' : 'var(--text-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    {vis ? <Eye size={16} /> : <EyeOff size={16} />}
                  </button>
                </div>
              )
            })}
            {listFor(areaFilter).length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>{t('Nessun dispositivo')}</div>
            )}
          </div>
        </div>
      ) : (
      <>

      {/* Progresso */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          aria-label={t('Precedente')}
          onClick={() => index > 0 && (setDir(-1), setIndex((i) => i - 1))}
          disabled={index === 0 || done}
          style={{
            width: 38, height: 38, flexShrink: 0, borderRadius: 12, cursor: index === 0 || done ? 'default' : 'pointer',
            background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary)', opacity: index === 0 || done ? 0.35 : 1,
          }}
        >
          <ChevronLeft size={18} />
        </button>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 6 }}>
            <span>{total === 0 ? t('Nessuno da rivedere') : t('{{a}} di {{b}}', { a: Math.min(index + 1, total), b: total })}</span>
            <span>{t('{{n}} nascosti', { n: hiddenCount })}</span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: 'var(--glass-border)', overflow: 'hidden' }}>
            <motion.div
              animate={{ width: `${total === 0 ? 0 : (Math.min(index, total) / total) * 100}%` }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              style={{ height: '100%', borderRadius: 3, background: 'var(--accent)', boxShadow: '0 0 12px var(--accent-glow)' }}
            />
          </div>
        </div>
        <button
          aria-label={t('Successivo')}
          onClick={() => { if (!done && index < total - 1) { setDir(1); setIndex((i) => i + 1) } }}
          disabled={done || index >= total - 1}
          style={{
            width: 38, height: 38, flexShrink: 0, borderRadius: 12, cursor: done || index >= total - 1 ? 'default' : 'pointer',
            background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-secondary)', opacity: done || index >= total - 1 ? 0.35 : 1,
          }}
        >
          <ChevronRight size={18} />
        </button>
        {onDone && (
          <button
            onClick={onDone}
            style={{
              flexShrink: 0, padding: '9px 14px', borderRadius: 12, cursor: 'pointer',
              background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
              color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600,
            }}
          >
            {t('Fine')}
          </button>
        )}
      </div>

      {/* Scheda dispositivo / stato completato */}
      <div style={{ flex: 1, position: 'relative', minHeight: 240 }}>
        {done ? (
          <div className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 14, padding: 'var(--space-lg)' }}>
            <div style={{ width: 64, height: 64, borderRadius: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-glow)', color: 'var(--accent)', boxShadow: '0 0 24px var(--accent-glow)' }}>
              <Check size={34} strokeWidth={2} />
            </div>
            <div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 19, fontWeight: 800, color: 'var(--text-primary)' }}>
                {areaFilter === 'all' ? t('Tutto configurato') : t('Stanza configurata')}
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, marginTop: 6 }}>
                {t('Hai già deciso tutti i dispositivi{{suffix}}. Cambia stanza dal menù in alto.', { suffix: areaFilter !== 'all' ? t(' di questa stanza') : '' })}
              </p>
            </div>
            <button
              onClick={reviewAgain}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 16px', borderRadius: 'var(--radius-md)', cursor: 'pointer', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', fontSize: 13.5, fontWeight: 600 }}
            >
              <RotateCcw size={15} /> {t('Rivedi da capo')}
            </button>
          </div>
        ) : (
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <motion.div
              key={e!.entity_id}
              custom={dir}
              initial={{ opacity: 0, x: dir * 40 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -40 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              style={{ position: 'absolute', inset: 0 }}
            >
              <div className="glass-panel" style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', gap: 14, padding: 'var(--space-lg)', opacity: visible ? 1 : 0.72 }}>
                <div style={{
                  width: 88, height: 88, borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: visible ? 'var(--accent-glow)' : 'var(--glass-bg)', border: '1px solid var(--glass-border)',
                  color: visible ? 'var(--accent)' : 'var(--text-tertiary)', boxShadow: visible ? '0 0 32px var(--accent-glow)' : 'none',
                }}>
                  <Icon size={40} strokeWidth={1.6} />
                </div>
                <div>
                  <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em', lineHeight: 1.2, padding: '0 8px' }}>
                    {entityName(e!)}
                  </h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 12 }}>
                    <span style={chipStyle}>{t(DOMAIN_LABEL[domain] ?? domain)}</span>
                    {area && <span style={chipStyle}>{area}</span>}
                    <span style={chipStyle}>{t(stateLabel(e!))}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: visible ? 'var(--accent)' : 'var(--text-tertiary)' }}>
                  {visible ? <Eye size={15} /> : <EyeOff size={15} />}
                  {visible ? t('Verrà mostrato in dashboard') : t('Nascosto dalla dashboard')}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        )}
      </div>

      {/* Azioni */}
      {!done && total > 0 && (
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => choose(true)} style={choiceBtn(!visible, 'hide')}>
            <EyeOff size={18} /> {t('Nascondi')}
          </button>
          <button onClick={() => choose(false)} style={choiceBtn(visible, 'show')}>
            {visible ? <Check size={18} /> : <Eye size={18} />} {t('Mostra')}
          </button>
        </div>
      )}
      </>
      )}
    </div>
  )
}

const chipStyle: React.CSSProperties = {
  padding: '4px 12px', borderRadius: 999, fontSize: 12.5, fontWeight: 600,
  background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)',
}

function choiceBtn(active: boolean, kind: 'show' | 'hide'): React.CSSProperties {
  const base: React.CSSProperties = {
    flex: 1, padding: '15px', borderRadius: 'var(--radius-md)', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    fontSize: 15, fontWeight: 700, transition: 'all 0.2s ease',
  }
  if (kind === 'show' && active) return { ...base, background: 'var(--accent)', border: 'none', color: '#04121e', boxShadow: '0 6px 20px var(--accent-glow)' }
  if (kind === 'hide' && active) return { ...base, background: 'rgba(255,107,107,0.14)', border: '1px solid rgba(255,107,107,0.5)', color: '#ff8f8f' }
  return { ...base, background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)' }
}
