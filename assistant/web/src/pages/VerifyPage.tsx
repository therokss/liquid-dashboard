import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, EyeOff, Info, Loader2, MessageCircle, PlayCircle, RotateCcw, ShieldCheck, Square, Wrench, XCircle } from 'lucide-react'
import { api, ApiCallError, type AutomationReport, type DraftPublic, type Severity, type VerifyEstimate, type VerifyFinding, type VerifyOverview, type VerifyRunView } from '../api'
import { Button, GlassCard, Section } from '../components/Glass'
import { DraftCard } from '../components/DraftCard'
import { automationEditorPath, navigateHomeAssistant } from '../lib/navigate'
import { t, type TextKey } from '../i18n/it'

// Verifica: controllo rapido gratuito (regole deterministiche) → problemi per automazione con
// correzioni meccaniche applicabili come bozze → su richiesta, analisi approfondita di Claude.

const DAYS = [0, 7, 14]
const RUNNING = new Set(['raccolta', 'analisi'])
const SEVERITY_ORDER: Record<Severity, number> = { errore: 0, avviso: 1, info: 2 }
const SEVERITY_ICON: Record<Severity, typeof Info> = { errore: XCircle, avviso: AlertTriangle, info: Info }
const usd = (n: number) => `$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`
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
    /* navigazione privata: si riparte dall'ultima verifica */
  }
}

/** Stima in dollari dell'analisi approfondita per le automazioni scelte. */
export function estimateCost(e: VerifyEstimate, selection: string[]): number {
  const n = selection.length
  if (!n) return 0
  const batches = Math.ceil(n / e.batchSize)
  const input = e.systemTokens * batches + selection.reduce((sum, a) => sum + (e.perAutomation[a] ?? 1500), 0)
  const output = e.outputPerAutomation * n + e.outputPerBatch * batches
  return ((input * e.priceIn + output * e.priceOut) / 1_000_000) * 1.1
}

function Progress({ run, onStop }: { run: VerifyRunView; onStop: () => void }) {
  const p = run.progress
  const pct = p && p.total > 0 ? Math.round((p.done / p.total) * 100) : null
  return (
    <div className="as-sug-progress">
      <div className="as-sug-progress-head">
        <Loader2 size={16} className="spin" />
        <span>
          {p?.phase ?? t(`status_${run.status}` as TextKey)}
          {p && p.total > 0 && ` · ${p.done}/${p.total}`}
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

function FindingRow({
  f,
  editable,
  chosen,
  onToggle,
  onIgnore,
  busy,
}: {
  f: VerifyFinding
  editable: boolean
  chosen: boolean
  onToggle: (on: boolean) => void
  onIgnore: () => void
  busy: boolean
}) {
  const Icon = SEVERITY_ICON[f.severity]
  return (
    <li className={`as-ver-finding sev-${f.severity} ${f.ignored ? 'ignored' : ''}`}>
      <Icon size={16} className="as-ver-sev" aria-label={t(`sev_${f.severity}` as TextKey)} />
      <div className="as-ver-finding-body">
        <p className="as-ver-finding-title">
          {f.title} <span className="as-chip as-ver-rule">{t(`rule_${f.rule}` as TextKey)}</span>
          {f.ignored && <span className="as-chip">{t('verIgnoredChip')}</span>}
        </p>
        <p className="as-ver-finding-detail">{f.detail}</p>
        {f.fix && (
          <label className={`as-ver-fix ${editable && !f.ignored ? '' : 'disabled'}`}>
            {editable && !f.ignored && <input type="checkbox" checked={chosen} onChange={(e) => onToggle(e.target.checked)} />}
            <Wrench size={13} />
            <span>
              {f.fix.label} <span className={`as-chip ${f.fix.certain ? 'conf-alta' : 'conf-media'}`}>{f.fix.certain ? t('verFixSure') : t('verFixCheck')}</span>
            </span>
          </label>
        )}
      </div>
      <button type="button" className="as-link as-ver-ignore" disabled={busy} onClick={onIgnore}>
        {f.ignored ? <RotateCcw size={13} /> : <EyeOff size={13} />} {f.ignored ? t('verRestore') : t('verIgnore')}
      </button>
    </li>
  )
}

function traceLine(r: AutomationReport): string {
  const parts = [`${t('verLastRun')}: ${r.lastTriggered ? dateTimeIt(r.lastTriggered) : t('verNever')}`]
  const tr = r.traces
  if (tr.stored) {
    parts.push(`${tr.stored} ${tr.stored === 1 ? t('verTrace') : t('verTraces')} (${Object.entries(tr.outcomes).map(([k, v]) => `${v} ${k}`).join(', ')})`)
    if (tr.perHour !== null && tr.perHour >= 1) parts.push(`~${Math.round(tr.perHour).toLocaleString('it-IT')} ${t('verPerHour')}`)
  }
  parts.push(`mode ${r.mode}`)
  return parts.join(' · ')
}

function AutomationCard({
  run,
  report,
  findings,
  onRun,
  onOpenChat,
}: {
  run: VerifyRunView
  report: AutomationReport
  findings: VerifyFinding[]
  onRun: (r: VerifyRunView) => void
  onOpenChat: (conversationId: string) => void
}) {
  const fixable = findings.filter((f) => f.fix && !f.ignored)
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(fixable.filter((f) => f.fix!.certain).map((f) => f.id)))
  const [busy, setBusy] = useState<null | 'fix' | 'chat' | string>(null)
  const [error, setError] = useState<string | null>(null)
  const review = run.reviews[report.entityId]
  const fix = run.fixes[report.entityId]

  const act = async (kind: string, fn: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const updateFixDraft = (d: DraftPublic) => onRun({ ...run, fixes: { ...run.fixes, [report.entityId]: { ...fix!, draft: d } } })
  const updateReviewDraft = (d: DraftPublic) => onRun({ ...run, reviews: { ...run.reviews, [report.entityId]: { ...review!, draft: d } } })
  const worst = findings.filter((f) => !f.ignored).reduce<Severity | null>((w, f) => (w === null || SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[w] ? f.severity : w), null)

  return (
    <GlassCard className={`as-sug-card as-ver-card ${worst ? `worst-${worst}` : ''}`}>
      <div className="as-sug-card-head">
        <span className="as-chip">{t(`verSource_${report.source}` as TextKey)}</span>
        {(report.state === 'off' || report.state === 'unavailable') && <span className="as-chip err">{t(`verState_${report.state}` as TextKey)}</span>}
        {review && <span className={`as-chip verdict-${review.giudizio}`}>{t(`verVerdict_${review.giudizio}` as TextKey)}</span>}
      </div>
      <h3 className="as-sug-title">{report.alias}</h3>
      <p className="as-sug-subtitle">
        {report.entityId} · {traceLine(report)}
      </p>

      {findings.length > 0 && (
        <ul className="as-ver-findings">
          {findings.map((f) => (
            <FindingRow
              key={f.id}
              f={f}
              editable={report.editable}
              chosen={chosen.has(f.id)}
              busy={busy !== null}
              onToggle={(on) => setChosen((prev) => {
                const next = new Set(prev)
                if (on) next.add(f.id)
                else next.delete(f.id)
                return next
              })}
              onIgnore={() => void act(f.id, async () => onRun((f.ignored ? await api.unignoreFinding(run.id, f.id) : await api.ignoreFinding(run.id, f.id)).run))}
            />
          ))}
        </ul>
      )}

      {fixable.length > 0 &&
        (report.editable ? (
          <div className="as-ver-fixbar">
            <p className="as-probe-summary">{t('verFixHint')}</p>
            <button
              type="button"
              className="glass-btn as-btn glass-btn-accent"
              disabled={busy !== null || chosen.size === 0 || run.running}
              onClick={() => void act('fix', async () => onRun((await api.fixVerify(run.id, report.entityId, [...chosen])).run))}
            >
              {busy === 'fix' ? <Loader2 size={16} className="spin" /> : <Wrench size={16} />} {t('verMakeFix')} ({chosen.size})
            </button>
          </div>
        ) : (
          <p className="as-note info">
            <Info size={14} /> {t('verNotEditable')}
          </p>
        ))}
      {fix?.errors?.length ? (
        <p className="as-note error">
          <AlertTriangle size={14} /> <strong>{t('verFixFailed')}:</strong> {fix.errors.join(' ')}
        </p>
      ) : null}
      {fix?.draft && <DraftCard draft={fix.draft} onChange={updateFixDraft} />}

      {review && (
        <div className="as-ver-review">
          <p className="as-probe-label">
            <ShieldCheck size={14} /> {t('verReview')}
            {review.repaired && <span className="as-chip">{t('verRepaired')}</span>}
          </p>
          <p className="as-draft-text">{review.sintesi}</p>
          {review.problemi.length > 0 && (
            <ul className="as-ver-problems">
              {review.problemi.map((p, i) => (
                <li key={i} className={`grav-${p.gravita}`}>
                  <strong>{p.titolo}</strong> <span className="as-chip">{t(`verGravita_${p.gravita}` as TextKey)}</span>
                  <span>{p.spiegazione}</span>
                </li>
              ))}
            </ul>
          )}
          {review.spiegazione && !review.draft && <p className="as-draft-text">{review.spiegazione}</p>}
          {review.draft && <DraftCard draft={review.draft} onChange={updateReviewDraft} />}
          {!review.draft && review.errors?.length && review.yaml ? (
            <p className="as-note error">
              <AlertTriangle size={14} /> <strong>{t('verIncomplete')}:</strong> {review.errors.join(' ')}
            </p>
          ) : null}
          {!review.draft && review.yaml && (
            <details className="as-details">
              <summary>{report.editable ? 'YAML' : t('verCopyYaml')}</summary>
              <pre className="as-pre">{review.yaml}</pre>
            </details>
          )}
        </div>
      )}

      <div className="as-draft-actions">
        <button type="button" className="glass-btn as-btn" disabled={busy !== null} onClick={() => void act('chat', async () => onOpenChat((await api.discussAutomation(run.id, report.entityId)).conversationId))}>
          {busy === 'chat' ? <Loader2 size={16} className="spin" /> : <MessageCircle size={16} />} {t('verDiscuss')}
        </button>
        {report.id && (report.source === 'editor' || report.source === 'blueprint') && (
          <button type="button" className="glass-btn as-btn" onClick={() => navigateHomeAssistant(automationEditorPath(report.id!))}>
            <ExternalLink size={16} /> {t('verOpenEditor')}
          </button>
        )}
      </div>
      {error && <p className="as-error">{error}</p>}
    </GlassCard>
  )
}

function DeepAnalysis({
  run,
  overview,
  selection,
  setSelection,
  onStart,
  busy,
}: {
  run: VerifyRunView
  overview: VerifyOverview | null
  selection: Set<string>
  setSelection: (s: Set<string>) => void
  onStart: () => void
  busy: boolean
}) {
  const list = [...selection]
  const cost = run.estimate ? estimateCost(run.estimate, list) : null
  const hot = new Set(run.defaultSelection)
  return (
    <div className="as-sug-generate as-ver-deep">
      <h3 className="as-sug-title">{t('verDeep')}</h3>
      <p className="text-body">{t('verDeepIntro')}</p>
      <details className="as-details">
        <summary>
          {t('verDeepChoose')} ({selection.size}/{run.reports.length})
        </summary>
        <div className="as-ver-select-actions">
          <button type="button" className="as-link" onClick={() => setSelection(new Set(run.defaultSelection))}>
            {t('verSelectHot')}
          </button>
          <button type="button" className="as-link" onClick={() => setSelection(new Set(run.reports.map((r) => r.entityId).slice(0, 60)))}>
            {t('verSelectAll')}
          </button>
          <button type="button" className="as-link" onClick={() => setSelection(new Set())}>
            {t('verSelectNone')}
          </button>
        </div>
        <ul className="as-ver-select">
          {run.reports.map((r) => (
            <li key={r.entityId}>
              <label>
                <input
                  type="checkbox"
                  checked={selection.has(r.entityId)}
                  onChange={(e) => {
                    const next = new Set(selection)
                    if (e.target.checked) next.add(r.entityId)
                    else next.delete(r.entityId)
                    setSelection(next)
                  }}
                />
                <span className={hot.has(r.entityId) ? 'hot' : ''}>{r.alias}</span>
                {run.reviews[r.entityId] && <CheckCircle2 size={13} className="as-ok" />}
              </label>
            </li>
          ))}
        </ul>
      </details>
      {overview && !overview.configured ? (
        <p className="as-warn">{t('verNoKey')}</p>
      ) : (
        <Button accent onClick={onStart} disabled={busy || selection.size === 0 || selection.size > 60}>
          {busy ? <Loader2 size={16} className="spin" /> : <PlayCircle size={16} />} {t('verDeepRun')} ({selection.size})
          {cost !== null && selection.size > 0 && (
            <span className="as-sug-estimate">
              · {t('verEstimate')} {usd(cost)}
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
  )
}

export function VerifyPage({ onOpenChat }: { onOpenChat: (conversationId: string) => void }) {
  const [overview, setOverview] = useState<VerifyOverview | null>(null)
  const [run, setRun] = useState<VerifyRunView | null>(null)
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState<null | 'start' | 'analyze'>(null)
  const [error, setError] = useState<string | null>(null)
  const [showInfo, setShowInfo] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const selectionFor = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadRun = useCallback(async (id: string) => {
    try {
      const { run: r } = await api.verifyRun(id)
      setRun(r)
      storageSet('as-verify', r.id)
      return r
    } catch (e) {
      if (e instanceof ApiCallError && e.status === 404) return null
      throw e
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const o = await api.verify()
      setOverview(o)
      const wanted = o.active ?? storageGet('as-verify') ?? o.runs[0]?.id ?? null
      const r = wanted ? await loadRun(wanted) : null
      if (!r && o.runs[0] && o.runs[0].id !== wanted) await loadRun(o.runs[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [loadRun])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!run || !RUNNING.has(run.status)) return
    timer.current = setTimeout(() => {
      void loadRun(run.id).then((r) => {
        if (r && !RUNNING.has(r.status)) void api.verify().then(setOverview, () => undefined)
      })
    }, 1200)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [run, loadRun])

  // Selezione dell'analisi approfondita: proposta una volta per verifica, poi la decide l'utente.
  useEffect(() => {
    if (!run || run.status === 'raccolta' || selectionFor.current === run.id) return
    selectionFor.current = run.id
    const reviewed = new Set(Object.keys(run.reviews))
    setSelection(new Set(run.defaultSelection.filter((a) => !reviewed.has(a))))
  }, [run])

  const start = async () => {
    setBusy('start')
    setError(null)
    try {
      const { run: r } = await api.startVerify(days)
      setRun(r)
      storageSet('as-verify', r.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const analyze = async () => {
    if (!run) return
    setBusy('analyze')
    setError(null)
    try {
      setRun((await api.analyzeVerify(run.id, [...selection])).run)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const stop = async () => {
    if (run) await api.stopVerify(run.id).catch(() => undefined)
  }

  const clearIgnored = async () => {
    await api.clearIgnored().catch(() => undefined)
    await refresh()
  }

  const running = run ? RUNNING.has(run.status) : false
  const ready = run && !running && run.reports.length > 0 && run.status !== 'raccolta'

  // Automazioni da mostrare: con problemi visibili coi filtri, o con un giudizio o una correzione.
  const cards = useMemo(() => {
    if (!run) return []
    const byAuto = new Map<string, VerifyFinding[]>()
    for (const f of run.findings) {
      if (f.ignored && !showIgnored) continue
      if (f.severity === 'info' && !showInfo) continue
      byAuto.set(f.automation, [...(byAuto.get(f.automation) ?? []), f])
    }
    const worst = (fs: VerifyFinding[]) => Math.min(3, ...fs.filter((f) => !f.ignored).map((f) => SEVERITY_ORDER[f.severity]))
    return run.reports
      .filter((r) => byAuto.has(r.entityId) || run.reviews[r.entityId] || run.fixes[r.entityId])
      .map((r) => ({ report: r, findings: byAuto.get(r.entityId) ?? [] }))
      .sort((a, b) => worst(a.findings) - worst(b.findings) || b.findings.length - a.findings.length || a.report.alias.localeCompare(b.report.alias))
  }, [run, showInfo, showIgnored])

  const st = run?.stats
  const clean = run ? run.reports.filter((r) => r.findings.length === 0) : []

  return (
    <div className="as-page">
      <Section
        title={t('verTitle')}
        intro={t('verIntro')}
        actions={
          <div className="as-sug-start">
            <label className="as-sug-days">
              {t('verDays')}
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={running || busy !== null}>
                {DAYS.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              {t('verDaysUnit')}
            </label>
            <Button accent onClick={() => void start()} disabled={running || busy !== null}>
              {busy === 'start' ? <Loader2 size={16} className="spin" /> : <ShieldCheck size={16} />} {t('verCheck')}
            </Button>
          </div>
        }
      >
        {error && <p className="as-error">{error}</p>}
        {overview && overview.ignored.length > 0 && (
          <p className="as-probe-summary as-summary">
            {overview.ignored.length} {t('verHidden')} ·{' '}
            <button type="button" className="as-link" onClick={() => void clearIgnored()}>
              {t('verShowHidden')}
            </button>
          </p>
        )}
      </Section>

      {run && (
        <GlassCard className="as-section">
          <div className="as-section-head">
            <h2 className="text-title as-h2">
              {t(`status_${run.status}` as TextKey)} · {dateTimeIt(run.createdAt)}
            </h2>
          </div>
          {running && <Progress run={run} onStop={() => void stop()} />}
          <dl className="as-info">
            {st && (
              <>
                <div className="as-info-row">
                  <dt>{t('verAutomations')}</dt>
                  <dd>
                    {st.automations} · {st.editable} {t('verEditable')}
                  </dd>
                </div>
                <div className="as-info-row">
                  <dt>{t('verProblems')}</dt>
                  <dd className="as-ver-counts">
                    {(['errore', 'avviso', 'info'] as Severity[]).map((s) => (
                      <span key={s} className={`sev-${s}`}>
                        {st.bySeverity[s]} {t(`verSev_${s}` as TextKey)}
                      </span>
                    ))}
                  </dd>
                </div>
                {run.days > 0 && (
                  <div className="as-info-row">
                    <dt>{t('verActivity')}</dt>
                    <dd>
                      {st.events.toLocaleString('it-IT')} {t('verActivityText')} {st.logged} {t('verActivityEntities')} ({run.days} {t('verDaysUnit')})
                    </dd>
                  </div>
                )}
              </>
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
          {run.error && (
            <p className="as-note error">
              <AlertTriangle size={14} /> {run.error}
            </p>
          )}
          {ready && (
            <div className="as-ver-filters">
              <label>
                <input type="checkbox" checked={showInfo} onChange={(e) => setShowInfo(e.target.checked)} /> {t('verShowInfo')}
              </label>
              <label>
                <input type="checkbox" checked={showIgnored} onChange={(e) => setShowIgnored(e.target.checked)} /> {t('verShowIgnored')}
              </label>
            </div>
          )}
          {ready && <DeepAnalysis run={run} overview={overview} selection={selection} setSelection={setSelection} onStart={() => void analyze()} busy={busy !== null} />}
        </GlassCard>
      )}

      {run && ready && cards.length === 0 && (
        <GlassCard className="as-section">
          <p className="text-body">{t('verAllGood')}</p>
        </GlassCard>
      )}
      {run && cards.map(({ report, findings }) => <AutomationCard key={`${run.id}-${report.entityId}`} run={run} report={report} findings={findings} onRun={setRun} onOpenChat={onOpenChat} />)}

      {run && ready && clean.length > 0 && (
        <Section title={`${clean.length} ${t('verClean')}`}>
          <details className="as-details">
            <summary>{t('verAutomations')}</summary>
            <ul className="as-ver-clean">
              {clean.map((r) => (
                <li key={r.entityId}>
                  <CheckCircle2 size={13} className="as-ok" /> {r.alias}
                </li>
              ))}
            </ul>
          </details>
        </Section>
      )}

      {overview && overview.runs.length > 1 && (
        <Section title={t('verPrevious')}>
          <ul className="as-history">
            {overview.runs.map((r) => (
              <li key={r.id} className={run?.id === r.id ? 'current' : ''}>
                <button type="button" className="as-sug-run" onClick={() => void loadRun(r.id)}>
                  <span className="as-probe-label">
                    {dateTimeIt(r.createdAt)} · {t(`status_${r.status}` as TextKey)}
                  </span>
                  <span className="as-probe-summary">
                    {r.automations} automazioni · {r.findings} problemi ({r.errors} errori){r.reviewed ? ` · ${r.reviewed} analizzate` : ''}
                    {r.costUsd > 0 ? ` · ${usd(r.costUsd)}` : ''}
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
