import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, CheckCircle2, ChevronDown, ExternalLink, Globe, Layers, Loader2, Search, Square, Trash2, AlertTriangle, ShieldCheck } from 'lucide-react'
import { api, type ActiveStudy, type CatalogIntegration, type DeviceCard, type DeviceModel, type DevicesOverview, type StudyBatch } from '../api'
import { Button, GlassCard, Section } from '../components/Glass'
import { t, type TextKey } from '../i18n/it'

// Dispositivi: catalogo dei modelli presenti in casa (uno per modello, anche se arriva da più
// integrazioni), schede KB con le fonti, studio sul web di un modello alla volta.

type Filter = 'tutti' | 'scheda' | 'bozza' | 'senza'
const FILTERS: Filter[] = ['tutti', 'scheda', 'bozza', 'senza']
const usd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`
const dateIt = (s: string) => new Date(s).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
const isLocal = (i: CatalogIntegration) => Boolean(i.iotClass?.startsWith('local'))
const safeUrl = (u: string) => (/^https?:\/\//i.test(u) ? u : null)

/** "Shelly" + "Shelly 2PM Gen4" → "Shelly 2PM Gen4" (come modelLabel sul server). */
function modelLabel(manufacturer: string, model: string): string {
  const first = manufacturer.trim().toLowerCase().split(/[^a-z0-9]+/)[0]
  return first && model.trim().toLowerCase().startsWith(first) ? model.trim() : `${manufacturer.trim()} ${model.trim()}`.trim()
}

const counts = (searches: number, pages: number) =>
  `${searches} ${searches === 1 ? t('devSearch1') : t('devSearches')}, ${pages} ${pages === 1 ? t('devPage1') : t('devPages')}`

const same = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '')

function hostOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, '')
  } catch {
    return u
  }
}

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000))

function BatchLine({ batch }: { batch: StudyBatch }) {
  const n = batch.done + batch.failed + (batch.running ? 1 : 0)
  return (
    <p className="as-dev-batch-line">
      <Layers size={14} /> {t('devBatchProgress')} {Math.min(n, batch.total)} {t('devOf')} {batch.total} · {batch.done} {batch.done === 1 ? t('devCard1') : t('devCards')}
      {batch.failed > 0 && ` · ${batch.failed} ${t('devBatchFailed')}`}
    </p>
  )
}

function StudyProgress({ active, batch, onStop }: { active: ActiveStudy | null; batch: StudyBatch | null; onStop: () => void }) {
  const running = batch?.running ? batch : null
  if (!active) {
    // Tra un modello e l'altro della coda.
    if (!running) return null
    return (
      <div className="as-sug-progress">
        <div className="as-sug-progress-head">
          <Loader2 size={16} className="spin" />
          <span>{t('devBatchNext')}</span>
          <button type="button" className="glass-btn as-btn as-btn-small" onClick={onStop}>
            <Square size={14} /> {t('devStopAll')}
          </button>
        </div>
        <BatchLine batch={running} />
      </div>
    )
  }
  const p = active.progress
  return (
    <div className="as-sug-progress">
      {running && <BatchLine batch={running} />}
      <div className="as-sug-progress-head">
        <Loader2 size={16} className="spin" />
        <span>
          {t('devStudying')} {modelLabel(active.manufacturer, active.model)} · {t(`devPhase_${p.phase}` as TextKey)} · {counts(p.searches, p.fetches)}
          {active.costUsd > 0 && ` · ${usd(active.costUsd)}`}
          {active.origin === 'chat' && ` · ${t('devFromChat')}`}
        </span>
        <button type="button" className="glass-btn as-btn as-btn-small" onClick={onStop}>
          <Square size={14} /> {running ? t('devStopAll') : t('sugStop')}
        </button>
      </div>
      <div className="as-budget-bar">
        <span className="indeterminate" style={{ width: '35%' }} />
      </div>
      {p.queries.length > 0 && (
        <ul className="as-dev-queries">
          {p.queries.map((q, i) => (
            <li key={i}>
              <Search size={12} /> {q}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CardView({ card }: { card: DeviceCard }) {
  const list = (title: string, items: string[]) =>
    items.length > 0 && (
      <div className="as-dev-block">
        <h4>{title}</h4>
        <ul className="as-dev-bullets">
          {items.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ul>
      </div>
    )
  return (
    <div className="as-dev-card">
      <p className="as-sug-title">{card.nome_commerciale}</p>
      <p className="as-sug-subtitle">{card.categoria}</p>
      <p className="as-dev-text">{card.sintesi}</p>
      {card.collegamento && (
        <div className="as-dev-block">
          <h4>{t('devCardConnection')}</h4>
          <p className="as-dev-text">{card.collegamento}</p>
        </div>
      )}
      {card.entita.length > 0 && (
        <div className="as-dev-block">
          <h4>{t('devCardEntities')}</h4>
          <dl className="as-dev-pairs">
            {card.entita.map((e, i) => (
              <div key={i}>
                <dt>{e.cosa}</dt>
                <dd>{e.significato}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {card.eventi.length > 0 && (
        <div className="as-dev-block">
          <h4>{t('devCardEvents')}</h4>
          <dl className="as-dev-pairs">
            {card.eventi.map((e, i) => (
              <div key={i}>
                <dt>{e.evento}</dt>
                <dd>{e.significato}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {list(t('devCardTips'), card.consigli)}
      {list(t('devCardLimits'), card.limiti)}
      <div className="as-dev-block">
        <h4>{t('devCardSources')}</h4>
        <ul className="as-dev-sources">
          {card.fonti.map((f) => {
            const href = safeUrl(f.url)
            return (
              <li key={f.url}>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer nofollow">
                    {f.titolo} <ExternalLink size={12} />
                  </a>
                ) : (
                  <span>{f.titolo}</span>
                )}
                <span className="as-dev-source-meta">
                  {hostOf(f.url)} · {f.aperta ? t('devSourceOpened') : t('devSourceSeen')}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
      <p className="as-dev-meta">
        {t('devCardMeta')} {dateIt(card.createdAt)} · {card.study.model} ({card.study.effort}) · {usd(card.study.costUsd)} · {counts(card.study.searches, card.study.fetches)}
        {card.approved && ` · ${t('devApprovedBy')} ${card.approved.by} ${dateIt(card.approved.at)}`}
      </p>
      {card.study.queries.length > 0 && (
        <details className="as-details">
          <summary>{t('devQueries')}</summary>
          <ul className="as-dev-queries">
            {card.study.queries.map((q, i) => (
              <li key={i}>
                <Search size={12} /> {q}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function ModelRow({
  entry,
  overview,
  open,
  onToggle,
  onChanged,
}: {
  entry: DeviceModel
  overview: DevicesOverview
  open: boolean
  onToggle: () => void
  onChanged: () => Promise<void>
}) {
  const [card, setCard] = useState<DeviceCard | null>(null)
  const [busy, setBusy] = useState<null | 'study' | 'approve' | 'delete'>(null)
  const [error, setError] = useState<string | null>(null)
  const summary = entry.card
  const studying = overview.active?.key === entry.key

  useEffect(() => {
    if (!open || !summary) {
      setCard(null)
      return
    }
    let alive = true
    api.deviceCard(entry.slug).then(
      (r) => alive && setCard(r.card),
      (e) => alive && setError(e instanceof Error ? e.message : String(e)),
    )
    return () => {
      alive = false
    }
  }, [open, entry.slug, summary?.createdAt, summary?.status])

  const act = async (kind: 'study' | 'approve' | 'delete', fn: () => Promise<unknown>) => {
    setBusy(kind)
    setError(null)
    try {
      await fn()
      await onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const kinds = Object.entries(entry.entityKinds)
  const label = modelLabel(entry.manufacturer, entry.model)
  return (
    <li className={`as-dev-row ${open ? 'open' : ''}`}>
      <button type="button" className="as-dev-head" onClick={onToggle} aria-expanded={open}>
        <span className="as-dev-name">
          <span className="as-dev-model">{label}</span>
          {summary && <span className="as-dev-commercial">{same(summary.nome_commerciale, label) ? summary.categoria : summary.nome_commerciale}</span>}
        </span>
        <span className="as-dev-chips">
          {studying ? (
            <span className="as-chip conf-media">
              <Loader2 size={11} className="spin" /> {t('devStudyingShort')}
            </span>
          ) : summary ? (
            <span className={`as-chip ${summary.status === 'approvata' ? 'conf-alta' : 'conf-media'}`}>{t(`devStatus_${summary.status}` as TextKey)}</span>
          ) : entry.failure ? (
            <span className="as-chip err">{t('devFailedShort')}</span>
          ) : null}
          <span className="as-chip">
            {entry.devices.length} {entry.devices.length === 1 ? t('devDevice') : t('devDevicesShort')}
          </span>
        </span>
        <ChevronDown size={16} className="as-dev-chevron" aria-hidden />
      </button>
      {open && (
        <div className="as-dev-body">
          <div className="as-dev-integrations">
            {entry.integrations.map((i) => (
              <span key={i.domain} className={`as-chip ${isLocal(i) ? 'conf-alta' : ''}`} title={i.iotClass ?? undefined}>
                {i.name ?? i.domain} · {isLocal(i) ? t('devLocal') : i.iotClass ? t('devCloud') : '?'}
              </span>
            ))}
          </div>
          <dl className="as-info">
            {entry.modelIds.length > 0 && (
              <div className="as-info-row">
                <dt>{t('devModelIds')}</dt>
                <dd>{entry.modelIds.join(', ')}</dd>
              </div>
            )}
            {entry.firmware.length > 0 && (
              <div className="as-info-row">
                <dt>{t('devFirmware')}</dt>
                <dd>{entry.firmware.join(', ')}</dd>
              </div>
            )}
            <div className="as-info-row">
              <dt>{t('devDevices')}</dt>
              <dd>{entry.devices.map((d) => (d.area ? `${d.name} (${d.area})` : d.name)).join(', ')}</dd>
            </div>
            {kinds.length > 0 && (
              <div className="as-info-row">
                <dt>{t('devEntities')}</dt>
                <dd>{kinds.map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ''}`).join(', ')}</dd>
              </div>
            )}
          </dl>

          {entry.failure && !studying && (
            <p className="as-note warning">
              <AlertTriangle size={14} /> {t('devFailed')}: {entry.failure.message}
              {entry.failure.costUsd > 0 && ` (${usd(entry.failure.costUsd)})`}
            </p>
          )}
          {error && <p className="as-error">{error}</p>}
          {summary && !card && !error && <p className="as-probe-summary">{t('loading')}</p>}
          {card && <CardView card={card} />}

          <div className="as-dev-actions">
            {summary?.status === 'bozza' && (
              <Button accent disabled={busy !== null} onClick={() => void act('approve', () => api.approveCard(entry.slug))}>
                {busy === 'approve' ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />} {t('devApprove')}
              </Button>
            )}
            <Button
              accent={!summary}
              disabled={busy !== null || !overview.configured || overview.active !== null || Boolean(overview.batch?.running) || overview.budget.level === 'bloccato'}
              onClick={() => void act('study', () => api.studyDevice(entry.key))}
            >
              {busy === 'study' ? <Loader2 size={16} className="spin" /> : <Globe size={16} />} {summary ? t('devRestudy') : t('devStudy')}
              <span className="as-sug-estimate">
                {' '}
                · {t('devAbout')} {usd(overview.estimateUsd)}
              </span>
            </Button>
            {summary && (
              <button
                type="button"
                className="as-link as-ver-ignore"
                disabled={busy !== null || studying}
                onClick={() => {
                  if (confirm(t('devDeleteConfirm'))) void act('delete', () => api.deleteCard(entry.slug))
                }}
              >
                <Trash2 size={13} /> {t('devDelete')}
              </button>
            )}
          </div>
          {summary?.status === 'bozza' && <p className="as-probe-summary">{t('devDraftNote')}</p>}
        </div>
      )}
    </li>
  )
}

export function DevicesPage() {
  const [overview, setOverview] = useState<DevicesOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('tutti')
  const [open, setOpen] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    try {
      setOverview(await api.devices())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Durante uno studio si aggiorna la pagina finché non finisce (anche se avviato dalla chat).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!overview?.active && !overview?.batch?.running) return
    timer.current = setTimeout(() => void refresh(), 1500)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [overview, refresh])

  const entries = useMemo(() => {
    if (!overview) return []
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return overview.entries.filter((e) => {
      if (filter === 'scheda' && !e.card) return false
      if (filter === 'bozza' && e.card?.status !== 'bozza') return false
      if (filter === 'senza' && e.card) return false
      if (!words.length) return true
      const hay = [e.manufacturer, e.model, ...e.modelIds, e.card?.nome_commerciale ?? '', ...e.integrations.map((i) => `${i.domain} ${i.name ?? ''}`), ...e.devices.map((d) => `${d.name} ${d.area ?? ''}`)].join(' ').toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [overview, query, filter])

  const cards = overview?.entries.filter((e) => e.card) ?? []
  const approved = cards.filter((e) => e.card?.status === 'approvata').length
  // "Studia tutti" vale per i modelli visibili (ricerca e filtri) che non hanno ancora la scheda.
  const toStudy = entries.filter((e) => !e.card && overview?.active?.key !== e.key)
  const busy = Boolean(overview?.active || overview?.batch?.running)
  const batchCost = overview ? toStudy.length * overview.estimateUsd : 0
  const [batchError, setBatchError] = useState<string | null>(null)

  const studyAll = async () => {
    if (!overview || !toStudy.length) return
    const b = overview.budget
    const lines = [
      `${t('devBatchConfirm1')} ${toStudy.length} ${toStudy.length === 1 ? t('devModel1') : t('devModels')}?`,
      `${t('devBatchCost')} ${usd(batchCost)} · ${t('devBatchTime')} ${minutes(toStudy.length * overview.estimateMs)} ${t('devMinutes')}.`,
      `${t('devBatchSpent')} ${usd(b.spentUsd)}${b.warnUsd > 0 ? ` (${t('devBatchWarn')} ${usd(b.warnUsd)})` : ''}${b.blockUsd > 0 ? `, ${t('devBatchBlock')} ${usd(b.blockUsd)}` : ''}.`,
      ...(b.warnUsd > 0 && b.spentUsd + batchCost > b.warnUsd ? [t('devBatchOverWarn')] : []),
      t('devBatchConfirm2'),
    ]
    if (!confirm(lines.join('\n\n'))) return
    setBatchError(null)
    try {
      await api.studyAll(toStudy.map((e) => e.key))
      await refresh()
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : String(e))
    }
  }
  const lastBatch = overview?.batch && !overview.batch.running && overview.batch.finishedAt && Date.now() - Date.parse(overview.batch.finishedAt) < 24 * 3600_000 ? overview.batch : null

  return (
    <div className="as-page">
      <Section title={t('devTitle')} intro={t('devIntro')}>
        {overview && (
          <p className="as-probe-summary as-summary">
            {overview.entries.length} {overview.entries.length === 1 ? t('devModel1') : t('devModels')} · {cards.length} {cards.length === 1 ? t('devCard1') : t('devCards')} ({approved}{' '}
            {approved === 1 ? t('devApproved1') : t('devApprovedCount')}) · {overview.model} ({overview.effort})
          </p>
        )}
        <p className="as-note info">
          <ShieldCheck size={14} /> {t('devPrivacy')}
        </p>
        {overview && !overview.configured && <p className="as-note warning">{t('devNoKey')}</p>}
        {overview?.budget.level === 'bloccato' && <p className="as-note error">{t('devBudget')}</p>}
        {error && <p className="as-error">{error}</p>}
        {overview && (overview.active || overview.batch?.running) && (
          <StudyProgress active={overview.active} batch={overview.batch} onStop={() => void api.stopStudy().then(refresh, () => undefined)} />
        )}
        {lastBatch && (
          <p className={`as-note ${lastBatch.stopped ? 'warning' : 'info'}`}>
            <Layers size={14} /> {t('devBatchDone')}: {lastBatch.done} {lastBatch.done === 1 ? t('devCard1') : t('devCards')}
            {lastBatch.failed > 0 && `, ${lastBatch.failed} ${t('devBatchFailed')}`}
            {lastBatch.pending.length > 0 && `, ${lastBatch.pending.length} ${t('devBatchLeft')}`}
            {lastBatch.stopped && ` · ${lastBatch.stopped}`}
          </p>
        )}
      </Section>

      <GlassCard className="as-section">
        <div className="as-dev-toolbar">
          <label className="as-dev-search">
            <Search size={15} aria-hidden />
            <input type="search" value={query} placeholder={t('devSearch')} onChange={(e) => setQuery(e.target.value)} aria-label={t('devSearch')} />
          </label>
          <div className="as-dev-filters" role="group" aria-label={t('devFilter')}>
            {FILTERS.map((f) => (
              <button key={f} type="button" className={`as-chip as-dev-filter ${filter === f ? 'active' : ''}`} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {t(`devFilter_${f}` as TextKey)}
              </button>
            ))}
          </div>
        </div>
        {overview && (
          <div className="as-dev-batch">
            <Button disabled={busy || toStudy.length === 0 || !overview.configured || overview.budget.level === 'bloccato'} onClick={() => void studyAll()}>
              <Layers size={16} /> {t('devStudyAll')} ({toStudy.length})
              {toStudy.length > 0 && <span className="as-sug-estimate"> · {t('devAbout')} {usd(batchCost)}</span>}
            </Button>
            <span className="as-probe-summary">{query || filter !== 'tutti' ? t('devStudyAllFiltered') : t('devStudyAllHint')}</span>
          </div>
        )}
        {batchError && <p className="as-error">{batchError}</p>}
        {!overview && !error && <p className="text-body">{t('loading')}</p>}
        {overview && entries.length === 0 && <p className="as-probe-summary">{t('devEmpty')}</p>}
        <ul className="as-dev-list">
          {overview &&
            entries.map((e) => <ModelRow key={e.key} entry={e} overview={overview} open={open === e.key} onToggle={() => setOpen(open === e.key ? null : e.key)} onChanged={refresh} />)}
        </ul>
      </GlassCard>

      {overview && overview.orphans.length > 0 && (
        <Section title={t('devOrphans')}>
          <ul className="as-ver-clean">
            {overview.orphans.map((o) => (
              <li key={o.key}>
                <BookOpen size={13} /> {modelLabel(o.manufacturer, o.model)} · {o.card.nome_commerciale}{' '}
                <button type="button" className="as-link" onClick={() => confirm(t('devDeleteConfirm')) && void api.deleteCard(o.card.slug).then(refresh, () => undefined)}>
                  {t('devDelete')}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
