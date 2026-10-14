import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, BellOff, Clock, Hand, Lightbulb, Loader2, MessageCircle, MousePointerClick, Moon, PlayCircle, RotateCcw, Sparkles, Square, Workflow, Zap } from 'lucide-react'
import { api, ApiCallError, type CandidateKind, type CandidateView, type Cause, type DraftPublic, type SuggestOverview, type SuggestRunView } from '../api'
import { Button, GlassCard, Section } from '../components/Glass'
import { DraftCard } from '../components/DraftCard'
import { t, type TextKey } from '../i18n/it'

// Suggerisci: analisi locale dello storico (gratis) → candidati con i numeri → su richiesta
// Claude scrive le automazioni, che diventano bozze applicabili come in chat.

const KIND_ICON: Record<CandidateKind, typeof Zap> = {
  associazione: Zap,
  routine: Clock,
  routine_esterna: Workflow,
  dimenticata_fuori: Lightbulb,
  dimenticata_notte: Moon,
  pulsante: MousePointerClick,
}

const DAYS = [7, 14, 30]
const RUNNING = new Set(['raccolta', 'generazione'])
const usd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`
const dateIt = (s: string) => new Date(s).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })
const dateTimeIt = (s: string) => new Date(s).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

function storageGet(key: string): string | null {
  try {
    return sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function storageSet(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* navigazione privata: si ricomincia dall'ultima analisi */
  }
}

function Progress({ run, onStop }: { run: SuggestRunView; onStop: () => void }) {
  const p = run.progress
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : null
  return (
    <div className="as-sug-progress">
      <div className="as-sug-progress-head">
        <Loader2 size={16} className="spin" />
        <span>
          {p?.phase ?? t(`status_${run.status}` as TextKey)}
          {p && p.total > 0 && ` · ${p.done}/${p.total}`}
          {p && p.total === 0 && p.done > 0 && ` · ${Math.round(p.done / 1000)}K caratteri`}
        </span>
        <button type="button" className="glass-btn as-btn as-btn-small" onClick={onStop}>
          <Square size={14} /> {t('sugStop')}
        </button>
      </div>
      <div className="as-budget-bar">
        <span className={pct === null ? 'indeterminate' : 'ok'} style={{ width: `${pct ?? 35}%` }} />
      </div>
    </div>
  )
}

function CandidateCard({
  run,
  c,
  onRun,
  onOpenChat,
}: {
  run: SuggestRunView
  c: CandidateView
  onRun: (r: SuggestRunView) => void
  onOpenChat: (conversationId: string) => void
}) {
  const [busy, setBusy] = useState<null | 'dismiss' | 'chat'>(null)
  const [error, setError] = useState<string | null>(null)
  const Icon = KIND_ICON[c.kind]
  const r = c.result

  const act = async (kind: 'dismiss' | 'chat') => {
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'chat') {
        const { conversationId } = await api.discussCandidate(run.id, c.id)
        onOpenChat(conversationId)
      } else {
        onRun((c.dismissed ? await api.undismissCandidate(run.id, c.id) : await api.dismissCandidate(run.id, c.id)).run)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  // Scartate da Claude o nascoste dall'utente: i numeri restano consultabili ma chiusi.
  const compact = c.dismissed || r?.esito === 'scarta'
  const evidence = (
    <dl className="as-info as-sug-evidence">
      {c.evidence.map((e) => (
        <div key={e.label} className="as-info-row">
          <dt>{e.label}</dt>
          <dd>{e.value}</dd>
        </div>
      ))}
    </dl>
  )

  const updateDraft = (d: DraftPublic) =>
    onRun({ ...run, candidates: run.candidates.map((x) => (x.id === c.id && x.result ? { ...x, result: { ...x.result, draft: d } } : x)) })

  return (
    <GlassCard className={`as-sug-card ${c.dismissed ? 'dismissed' : ''} ${r?.esito === 'scarta' ? 'advised-against' : ''}`}>
      <div className="as-sug-card-head">
        <span className="as-chip as-sug-kind">
          <Icon size={13} /> {t(`kind_${c.kind}` as TextKey)}
        </span>
        {r && r.esito === 'proponi' && <span className={`as-chip conf-${r.confidenza}`}>{t(`conf_${r.confidenza}` as TextKey)}</span>}
        {r?.repaired && <span className="as-chip">{t('sugRepaired')}</span>}
      </div>
      <h3 className="as-sug-title">{r?.titolo || c.title}</h3>
      {r?.titolo && r.titolo !== c.title && <p className="as-sug-subtitle">{c.title}</p>}

      {compact ? (
        <details className="as-details">
          <summary>{t('sugNumbers')}</summary>
          {evidence}
        </details>
      ) : (
        evidence
      )}
      {c.examples.length > 0 && (
        <details className="as-details">
          <summary>{t('sugExamples')}</summary>
          <ul className="as-sug-examples">
            {c.examples.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </details>
      )}

      {r && (
        <div className="as-sug-result">
          {r.esito === 'scarta' && (
            <p className="as-note info">
              <BellOff size={14} /> <strong>{t('sugAdvised')}:</strong> {r.spiegazione}
            </p>
          )}
          {r.esito === 'proponi' && r.spiegazione && !r.draft && <p className="as-draft-text">{r.spiegazione}</p>}
          {r.esito === 'proponi' && r.rischi && (
            <p className="as-note warning">
              <AlertTriangle size={14} /> <strong>{t('sugRisks')}:</strong> {r.rischi}
            </p>
          )}
          {r.draft && <DraftCard draft={r.draft} onChange={updateDraft} />}
          {r.esito === 'proponi' && !r.draft && r.errors?.length ? (
            <>
              <p className="as-note error">
                <AlertTriangle size={14} /> <strong>{t('sugIncomplete')}:</strong> {r.errors.join(' ')}
              </p>
              {r.yaml && (
                <details className="as-details">
                  <summary>YAML</summary>
                  <pre className="as-pre">{r.yaml}</pre>
                </details>
              )}
            </>
          ) : null}
        </div>
      )}

      <details className="as-details">
        <summary>{t('sugDossier')}</summary>
        <pre className="as-pre">{JSON.stringify(c.dossier, null, 2)}</pre>
      </details>

      {c.dismissed && <p className="as-probe-summary">{t('sugDismissed')}</p>}
      <div className="as-draft-actions">
        <button type="button" className="glass-btn as-btn" disabled={busy !== null} onClick={() => void act('chat')}>
          {busy === 'chat' ? <Loader2 size={16} className="spin" /> : <MessageCircle size={16} />} {t('sugDiscuss')}
        </button>
        <button type="button" className="glass-btn as-btn" disabled={busy !== null} onClick={() => void act('dismiss')}>
          {busy === 'dismiss' ? <Loader2 size={16} className="spin" /> : c.dismissed ? <RotateCcw size={16} /> : <BellOff size={16} />} {c.dismissed ? t('sugRestore') : t('sugDismiss')}
        </button>
      </div>
      {error && <p className="as-error">{error}</p>}
    </GlassCard>
  )
}

function RunHeader({ run }: { run: SuggestRunView }) {
  const w = run.window
  const st = run.stats
  const requestedFrom = w ? new Date(w.from) : null
  const short = w?.firstDay && requestedFrom && new Date(`${w.firstDay}T12:00:00`).getTime() - requestedFrom.getTime() > 2 * 86_400_000
  return (
    <>
      <dl className="as-info">
        {w && (
          <div className="as-info-row">
            <dt>{t('sugWindow')}</dt>
            <dd>
              {dateIt(w.from)} → {dateIt(w.to)} · {w.observedDays} giorni completi ({w.feriali} feriali, {w.festivi} festivi)
            </dd>
          </div>
        )}
        {st && (
          <div className="as-info-row">
            <dt>{t('sugActivity')}</dt>
            <dd>
              {st.events.toLocaleString('it-IT')} {t('sugEvents')} su {st.entities} {t('sugEntities')}:{' '}
              {(Object.keys(st.byCause) as Cause[])
                .filter((k) => st.byCause[k] > 0)
                .map((k) => `${st.byCause[k].toLocaleString('it-IT')} ${t(`cause_${k}` as TextKey)}`)
                .join(' · ')}
            </dd>
          </div>
        )}
        {run.usage && (
          <div className="as-info-row">
            <dt>{t('sugCost')}</dt>
            <dd>
              {usd(run.usage.costUsd)} · {run.usage.model}
            </dd>
          </div>
        )}
      </dl>
      {short && (
        <p className="as-note info">
          <Hand size={14} /> {t('sugShortHistory')} {new Date(`${w!.firstDay}T12:00:00`).toLocaleDateString('it-IT')}. {t('sugShortHistoryHint')}
        </p>
      )}
      {run.error && (
        <p className="as-note error">
          <AlertTriangle size={14} /> {run.error}
        </p>
      )}
    </>
  )
}

export function SuggestPage({ onOpenChat }: { onOpenChat: (conversationId: string) => void }) {
  const [overview, setOverview] = useState<SuggestOverview | null>(null)
  const [run, setRun] = useState<SuggestRunView | null>(null)
  const [days, setDays] = useState(30)
  const [busy, setBusy] = useState<null | 'start' | 'generate'>(null)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadRun = useCallback(async (id: string) => {
    try {
      const { run: r } = await api.suggestRun(id)
      setRun(r)
      storageSet('as-suggest', r.id)
      return r
    } catch (e) {
      if (e instanceof ApiCallError && e.status === 404) return null
      throw e
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const o = await api.suggest()
      setOverview(o)
      const wanted = o.active ?? storageGet('as-suggest') ?? o.runs[0]?.id ?? null
      const r = wanted ? await loadRun(wanted) : null
      if (!r && o.runs[0] && o.runs[0].id !== wanted) await loadRun(o.runs[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [loadRun])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Avanzamento: si interroga il server finché il job lavora (regge reload e cambi pagina).
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!run || !RUNNING.has(run.status)) return
    timer.current = setTimeout(() => {
      void loadRun(run.id).then((r) => {
        if (r && !RUNNING.has(r.status)) void api.suggest().then(setOverview, () => undefined)
      })
    }, 1200)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [run, loadRun])

  const start = async () => {
    setBusy('start')
    setError(null)
    try {
      const { run: r } = await api.startSuggest(days)
      setRun(r)
      storageSet('as-suggest', r.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const generate = async () => {
    if (!run) return
    setBusy('generate')
    setError(null)
    try {
      setRun((await api.generateSuggest(run.id)).run)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const stop = async () => {
    if (run) await api.stopSuggest(run.id).catch(() => undefined)
  }

  const clearHidden = async () => {
    await api.clearDismissed().catch(() => undefined)
    await refresh()
  }

  const running = run ? RUNNING.has(run.status) : false
  const pending = run ? run.candidates.filter((c) => !c.result && !c.dismissed) : []
  const canGenerate = run && !running && pending.length > 0 && ['pronta', 'interrotta', 'errore'].includes(run.status)
  // Prima le bozze pronte, poi quelle da completare e i candidati in attesa; in fondo scartate e nascoste.
  const rank = (c: CandidateView) => (c.dismissed ? 4 : !c.result ? 1 : c.result.esito === 'scarta' ? 3 : c.result.draft ? 0 : 2)
  const visible = run ? [...run.candidates].sort((a, b) => rank(a) - rank(b)) : []

  return (
    <div className="as-page">
      <Section
        title={t('sugTitle')}
        intro={t('sugIntro')}
        actions={
          <div className="as-sug-start">
            <label className="as-sug-days">
              {t('sugDays')}
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={running || busy !== null}>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              {t('sugDaysUnit')}
            </label>
            <Button accent onClick={() => void start()} disabled={running || busy !== null}>
              {busy === 'start' ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} {t('sugAnalyze')}
            </Button>
          </div>
        }
      >
        {error && <p className="as-error">{error}</p>}
        {overview && overview.dismissed.length > 0 && (
          <p className="as-probe-summary as-summary">
            {overview.dismissed.length} {t('sugHidden')} ·{' '}
            <button type="button" className="as-link" onClick={() => void clearHidden()}>
              {t('sugShowHidden')}
            </button>
          </p>
        )}
      </Section>

      {run && (
        <GlassCard className="as-section">
          <div className="as-section-head">
            <div>
              <h2 className="text-title as-h2">
                {t(`status_${run.status}` as TextKey)} · {dateTimeIt(run.createdAt)}
              </h2>
            </div>
          </div>
          {running && <Progress run={run} onStop={() => void stop()} />}
          <RunHeader run={run} />
          {canGenerate && (
            <div className="as-sug-generate">
              <p className="text-body">{t('sugGenerateIntro')}</p>
              {overview && !overview.configured ? (
                <p className="as-warn">{t('sugNoKey')}</p>
              ) : (
                <Button accent onClick={() => void generate()} disabled={busy !== null}>
                  {busy === 'generate' ? <Loader2 size={16} className="spin" /> : <PlayCircle size={16} />} {t('sugGenerate')} ({pending.length})
                  {run.estimate && (
                    <span className="as-sug-estimate">
                      · {t('sugEstimate')} {usd(run.estimate.costUsd)}
                    </span>
                  )}
                </Button>
              )}
              {overview && (
                <p className="as-probe-summary">
                  {overview.model} · effort {overview.effort}
                </p>
              )}
            </div>
          )}
          {!running && run.status !== 'errore' && run.candidates.length === 0 && <p className="text-body as-summary">{t('sugNone')}</p>}
        </GlassCard>
      )}

      {run && visible.map((c) => <CandidateCard key={c.id} run={run} c={c} onRun={setRun} onOpenChat={onOpenChat} />)}

      {run && run.deferred.length > 0 && (
        <Section title={t('sugDeferred')} intro={t('sugDeferredIntro')}>
          <ul className="as-history">
            {run.deferred.map((d, i) => (
              <li key={i}>
                <div>
                  <p className="as-probe-label">{d.title}</p>
                  <p className="as-probe-summary">
                    {d.automation !== '—' ? `${d.automation} · ` : ''}
                    {d.reason}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {overview && overview.runs.length > 1 && (
        <Section title={t('sugPrevious')}>
          <ul className="as-history">
            {overview.runs.map((r) => (
              <li key={r.id} className={run?.id === r.id ? 'current' : ''}>
                <button type="button" className="as-sug-run" onClick={() => void loadRun(r.id)}>
                  <span className="as-probe-label">
                    {dateTimeIt(r.createdAt)} · {t(`status_${r.status}` as TextKey)}
                  </span>
                  <span className="as-probe-summary">
                    {r.days} giorni · {r.candidates} candidati · {r.drafts} bozze{r.costUsd > 0 ? ` · ${usd(r.costUsd)}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
