import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, ExternalLink, EyeOff, Info, Loader2, RefreshCw, RotateCcw, ShieldCheck, Trash2, Undo2, Wrench } from 'lucide-react'
import { api, type MaintenanceAction, type MaintenanceIssue, type MaintenanceKind, type MaintenanceOverview } from '../api'
import { Button, GlassCard, Section } from '../components/Glass'
import { navigateHomeAssistant } from '../lib/navigate'
import { t, type TextKey } from '../i18n/it'

// Manutenzione: segnalazioni calcolate dall'add-on (senza Claude) e modifiche ai registri di HA
// con un tocco. "Sposta" e "Disattiva" si annullano; le eliminazioni chiedono conferma.

const KINDS: MaintenanceKind[] = ['integrazione', 'offline', 'orfane', 'stanza', 'senza_area', 'doppione', 'batteria', 'aggiornamento']
const ENTITY_PREVIEW = 6
const dateTimeIt = (s: string) => new Date(s).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const deviceLink = (id: string) => `/config/devices/device/${id}`

function actionLabel(a: MaintenanceAction): string {
  switch (a.type) {
    case 'sposta':
      return `${t('mntMoveTo')} ${a.areaName}`
    case 'disattiva':
      return t('mntDisable')
    case 'elimina_dispositivo':
      return t('mntDeleteDevice')
    case 'elimina_entita':
      return a.entityIds.length === 1 ? t('mntDeleteEntities1') : `${t('mntDeleteEntities')} (${a.entityIds.length})`
  }
}

function doneLabel(a: MaintenanceAction): string {
  if (a.type === 'sposta') return `${t('mntDone_sposta')} in ${a.areaName}`
  return t(`mntDone_${a.type}` as TextKey)
}

const destructive = (a: MaintenanceAction) => a.type === 'elimina_dispositivo' || a.type === 'elimina_entita'
const undoable = (a: MaintenanceAction['type']) => a === 'sposta' || a === 'disattiva'

/** Testo della conferma: cosa si elimina e quali automazioni ne risentono. */
function confirmText(issue: MaintenanceIssue, a: MaintenanceAction): string | null {
  const lines: string[] = []
  if (a.type === 'elimina_dispositivo') lines.push(`${t('mntConfirmDevice')}\n${issue.device?.name ?? ''}`)
  else if (a.type === 'elimina_entita') lines.push(`${t('mntConfirmEntities')}\n${a.entityIds.join('\n')}`)
  else if (issue.critical && a.type === 'disattiva') lines.push(`${t('mntConfirmCritical')}\n${issue.device?.name ?? ''}: ${issue.critical}.`)
  else return null
  if (issue.usedBy?.length) lines.push(`${t('mntUsedByWarn')}\n${issue.usedBy.map((u) => `• ${u.name}`).join('\n')}`)
  if (destructive(a)) lines.push(t('mntConfirmDelete'))
  return lines.join('\n\n')
}

function IssueRow({
  issue,
  canWrite,
  busy,
  onApply,
  onUndo,
  onIgnore,
}: {
  issue: MaintenanceIssue
  canWrite: boolean
  busy: boolean
  onApply: (index: number) => void
  onUndo: (changeId: string) => void
  onIgnore: () => void
}) {
  const [all, setAll] = useState(false)
  const applied = issue.applied && !issue.applied.undone ? issue.applied : null
  const appliedAction = applied ? issue.actions.find((a) => a.type === applied.action) : undefined
  const Icon = issue.severity === 'avviso' ? AlertTriangle : Info
  const entities = issue.entities ?? []
  const shown = all ? entities : entities.slice(0, ENTITY_PREVIEW)
  const meta = issue.device ? [issue.device.area, issue.device.integration, issue.device.model].filter(Boolean).join(' · ') : ''
  return (
    <li className={`as-ver-finding sev-${issue.severity} ${applied ? 'as-mnt-applied' : ''}`}>
      <Icon size={16} className="as-ver-sev" aria-hidden />
      <div className="as-ver-finding-body">
        <p className="as-ver-finding-title">
          {issue.title}
          {issue.confidence && (
            <span className={`as-chip as-ver-rule ${issue.confidence === 'certa' ? 'conf-alta' : 'conf-media'}`}>{issue.confidence === 'certa' ? t('mntSure') : t('mntCheckIt')}</span>
          )}
        </p>
        {meta && <p className="as-dev-meta">{meta}</p>}
        <p className="as-ver-finding-detail">{issue.detail}</p>
        {entities.length > 0 && issue.kind !== 'batteria' && issue.kind !== 'aggiornamento' && (
          <ul className="as-mnt-entities">
            {shown.map((e) => (
              <li key={e}>{e}</li>
            ))}
            {!all && entities.length > ENTITY_PREVIEW && (
              <li>
                <button type="button" className="as-link" onClick={() => setAll(true)}>
                  {t('mntMoreEntities')} {entities.length - ENTITY_PREVIEW}
                </button>
              </li>
            )}
          </ul>
        )}
        {issue.usedBy && issue.usedBy.length > 0 && !applied && (
          <p className="as-mnt-used">
            <Wrench size={13} /> {t('mntUsedBy')}: {issue.usedBy.map((u) => u.name).join(', ')}
          </p>
        )}
        {issue.critical && !applied && (
          <p className="as-mnt-used">
            <ShieldCheck size={13} /> {t('mntCritical')} {issue.critical}.
          </p>
        )}
        <div className="as-mnt-actions">
          {applied && appliedAction ? (
            <span className="as-mnt-done">
              <CheckCircle2 size={14} /> {doneLabel(appliedAction)} · {dateTimeIt(applied.at)}
              {undoable(applied.action) && canWrite && (
                <button type="button" className="as-link" disabled={busy} onClick={() => onUndo(applied.historyId)}>
                  <Undo2 size={13} /> {t('mntUndo')}
                </button>
              )}
            </span>
          ) : (
            canWrite &&
            issue.actions.map((a, i) => (
              <button key={i} type="button" className={`glass-btn as-btn as-mnt-btn ${destructive(a) ? 'danger' : ''}`} disabled={busy} onClick={() => onApply(i)}>
                {destructive(a) && <Trash2 size={14} />} {actionLabel(a)}
              </button>
            ))
          )}
          {issue.link && (
            <button type="button" className="as-link as-mnt-link" onClick={() => navigateHomeAssistant(issue.link!)}>
              <ExternalLink size={13} /> {t('mntOpenHA')}
            </button>
          )}
        </div>
      </div>
      {!applied && (
        <button type="button" className="as-link as-ver-ignore" disabled={busy} onClick={onIgnore}>
          <EyeOff size={13} /> {t('mntIgnore')}
        </button>
      )}
    </li>
  )
}

export function MaintenanceView() {
  const [overview, setOverview] = useState<MaintenanceOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [kind, setKind] = useState<MaintenanceKind | null>(null)
  const autoChecked = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const run = useCallback(async (fn: () => Promise<MaintenanceOverview>) => {
    setBusy(true)
    setError(null)
    try {
      setOverview(await fn())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      // Lo stato può essere cambiato comunque (es. una parte delle entità eliminate).
      await api.maintenance().then(setOverview, () => undefined)
    } finally {
      setBusy(false)
    }
  }, [])

  const check = useCallback(() => run(() => api.checkMaintenance()), [run])

  useEffect(() => {
    api.maintenance().then(
      (o) => {
        setOverview(o)
        // Il primo controllo parte da solo: è gratuito e in sola lettura.
        if (!o.run && !o.running && !autoChecked.current) {
          autoChecked.current = true
          void check()
        }
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    )
  }, [check])

  // Controllo avviato da un'altra scheda: si aspetta che finisca.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    if (!overview?.running || busy) return
    timer.current = setTimeout(() => void api.maintenance().then(setOverview, () => undefined), 1500)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [overview, busy])

  const apply = (issue: MaintenanceIssue, index: number) => {
    const a = issue.actions[index]!
    const text = confirmText(issue, a)
    if (text !== null && !confirm(text)) return
    void run(() => api.applyMaintenance(issue.id, index, text !== null))
  }

  const issues = overview?.run?.issues ?? []
  const byKind = useMemo(() => {
    const m = new Map<MaintenanceKind, MaintenanceIssue[]>()
    for (const i of issues) m.set(i.kind, [...(m.get(i.kind) ?? []), i])
    return m
  }, [issues])
  const visible = KINDS.filter((k) => byKind.has(k) && (!kind || kind === k))
  const open = (k: MaintenanceKind) => (byKind.get(k) ?? []).filter((i) => !i.applied || i.applied.undone)

  // Azioni di gruppo: spostamenti sicuri ed entità orfane, una richiesta alla volta.
  const bulk = async (list: MaintenanceIssue[], question: string, confirmFlag: boolean) => {
    if (!list.length || !confirm(`${question}\n\n${list.map((i) => `• ${i.title}`).join('\n')}${confirmFlag ? `\n\n${t('mntConfirmDelete')}` : ''}`)) return
    await run(async () => {
      let last: MaintenanceOverview | null = null
      for (const i of list) last = await api.applyMaintenance(i.id, 0, confirmFlag)
      return last ?? api.maintenance()
    })
  }
  const sureMoves = open('stanza').filter((i) => i.confidence === 'certa' && i.actions[0]?.type === 'sposta')
  const orphans = open('orfane').filter((i) => i.actions[0]?.type === 'elimina_entita')
  const orphanCount = orphans.reduce((n, i) => n + (i.entities?.length ?? 0), 0)
  const r = overview?.run

  return (
    <div className="as-page">
      <Section
        title={t('mntTitle')}
        intro={t('mntIntro')}
        actions={
          <Button accent disabled={busy || overview?.running} onClick={() => void check()}>
            {busy || overview?.running ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />} {t('mntCheck')}
          </Button>
        }
      >
        <p className="as-note info">
          <ShieldCheck size={14} /> {t('mntPrivacy')}
        </p>
        {(busy || overview?.running) && !r && <p className="as-probe-summary">{t('mntChecking')}</p>}
        {overview && !r && !overview.running && !busy && <p className="as-probe-summary">{t('mntNever')}</p>}
        {r && (
          <p className="as-probe-summary as-summary">
            {t('mntLast')}: {dateTimeIt(r.createdAt)} · {issues.length} {issues.length === 1 ? t('mntIssues1') : t('mntIssues')} · {t('mntCoverage')} {r.coverageDays} {t('mntDays')}
          </p>
        )}
        {r && r.coverageDays < 30 && <p className="as-note info">{t('mntCoverageShort')}</p>}
        {overview && !overview.canWrite && <p className="as-note warning">{t('mntNoWrite')}</p>}
        {error && <p className="as-error">{error}</p>}
        {r && issues.length > 0 && (
          <div className="as-dev-filters as-mnt-kinds" role="group">
            <button type="button" className={`as-chip as-dev-filter ${kind === null ? 'active' : ''}`} aria-pressed={kind === null} onClick={() => setKind(null)}>
              {t('mntAll')} ({issues.length})
            </button>
            {KINDS.filter((k) => byKind.has(k)).map((k) => (
              <button key={k} type="button" className={`as-chip as-dev-filter ${kind === k ? 'active' : ''}`} aria-pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
                {t(`mntKind_${k}` as TextKey)} ({byKind.get(k)!.length})
              </button>
            ))}
          </div>
        )}
        {r && issues.length === 0 && (
          <p className="as-mnt-done">
            <CheckCircle2 size={14} /> {t('mntAllGood')}
          </p>
        )}
      </Section>

      {visible.map((k) => (
        <GlassCard key={k} className="as-section">
          <div className="as-mnt-head">
            <h3 className="as-mnt-title">
              {t(`mntKind_${k}` as TextKey)} <span className="as-chip as-ver-rule">{byKind.get(k)!.length}</span>
            </h3>
            {k === 'stanza' && sureMoves.length > 1 && overview?.canWrite && (
              <Button disabled={busy} onClick={() => void bulk(sureMoves, t('mntBulkConfirmRooms'), false)}>
                {t('mntBulkRooms')} ({sureMoves.length})
              </Button>
            )}
            {k === 'orfane' && orphans.length > 1 && overview?.canWrite && (
              <Button disabled={busy} onClick={() => void bulk(orphans, t('mntBulkConfirmOrphans'), true)}>
                <Trash2 size={14} /> {t('mntBulkOrphans')} ({orphanCount})
              </Button>
            )}
          </div>
          <p className="as-probe-summary">{t(`mntHint_${k}` as TextKey)}</p>
          <ul className="as-ver-findings">
            {byKind.get(k)!.map((issue) => (
              <IssueRow
                key={issue.id}
                issue={issue}
                canWrite={Boolean(overview?.canWrite)}
                busy={busy}
                onApply={(i) => apply(issue, i)}
                onUndo={(id) => void run(() => api.undoMaintenance(id))}
                onIgnore={() => void run(() => api.ignoreMaintenance(issue.id))}
              />
            ))}
          </ul>
        </GlassCard>
      ))}

      {r && r.unassigned.length > 0 && (!kind || kind === 'senza_area') && (
        <Section title={t('mntUnassigned')} intro={t('mntUnassignedHint')}>
          <ul className="as-ver-clean">
            {r.unassigned.map((d) => (
              <li key={d.id}>
                <button type="button" className="as-link" onClick={() => navigateHomeAssistant(deviceLink(d.id))}>
                  {d.name}
                </button>
                {d.integration && <span className="as-dev-meta">· {d.integration}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {overview && overview.history.length > 0 && (
        <Section title={t('mntHistory')}>
          <ul className="as-mnt-history">
            {overview.history.map((c) => (
              <li key={c.id} className={c.undone ? 'undone' : ''}>
                <span>
                  {dateTimeIt(c.at)} · {doneLabel(c.action)}: {c.title} · {t('mntBy')} {c.by}
                  {c.undone && ` · ${t('mntUndone')}`}
                </span>
                {!c.undone && undoable(c.action.type) && overview.canWrite && (
                  <button type="button" className="as-link" disabled={busy} onClick={() => void run(() => api.undoMaintenance(c.id))}>
                    <Undo2 size={13} /> {t('mntUndo')}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {overview && overview.ignored.length > 0 && (
        <Section title={t('mntIgnored')}>
          <ul className="as-mnt-history">
            {overview.ignored.map((g) => (
              <li key={g.signature}>
                <span>{g.title}</span>
                <button type="button" className="as-link" disabled={busy} onClick={() => void run(() => api.unignoreMaintenance(g.signature))}>
                  <RotateCcw size={13} /> {t('mntRestore')}
                </button>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
