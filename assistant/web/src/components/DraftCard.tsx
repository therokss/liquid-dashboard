import { useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, ExternalLink, FilePlus2, FilePen, Loader2, RotateCcw, ShieldAlert, X } from 'lucide-react'
import { api, ApiCallError, type DraftPublic } from '../api'
import { automationEditorPath, navigateHomeAssistant } from '../lib/navigate'
import { t, type TextKey } from '../i18n/it'

const STATUS_KEY: Record<DraftPublic['status'], TextKey> = {
  pending: 'draftStatus_pending',
  applied: 'draftStatus_applied',
  discarded: 'draftStatus_discarded',
  undone: 'draftStatus_undone',
}

// Scheda di una bozza in chat: è l'unico punto da cui l'add-on scrive in Home Assistant,
// sempre dopo un tocco esplicito dell'amministratore.

function Diff({ lines }: { lines: NonNullable<DraftPublic['diff']> }) {
  return (
    <pre className="as-pre as-diff">
      {lines.map((l, i) => (
        <span key={i} className={l.op === '+' ? 'add' : l.op === '-' ? 'del' : ''}>
          {l.op} {l.line}
          {'\n'}
        </span>
      ))}
    </pre>
  )
}

export function DraftCard({ draft, onChange }: { draft: DraftPublic; onChange: (d: DraftPublic) => void }) {
  const [enabled, setEnabled] = useState(true)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<null | 'apply' | 'discard' | 'undo'>(null)
  const [error, setError] = useState<string | null>(null)

  const act = async (kind: 'apply' | 'discard' | 'undo', fn: () => Promise<{ draft: DraftPublic }>) => {
    setBusy(kind)
    setError(null)
    try {
      onChange((await fn()).draft)
    } catch (e) {
      if (kind === 'undo' && e instanceof ApiCallError && e.code === 'modificata_dopo' && confirm(`${e.message}\n\n${t('draftUndoForce')}`)) {
        try {
          onChange((await api.undoDraft(draft.id, true)).draft)
        } catch (e2) {
          setError(e2 instanceof Error ? e2.message : String(e2))
        }
      } else {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBusy(null)
    }
  }

  const isUpdate = draft.kind === 'update'
  const critical = draft.critical.length > 0
  const editorId = draft.applied?.automationId ?? draft.target?.automationId ?? null

  return (
    <div className={`as-draft glass-card status-${draft.status}`}>
      <div className="as-draft-head">
        {isUpdate ? <FilePen size={18} /> : <FilePlus2 size={18} />}
        <div className="as-draft-title">
          <span className="as-draft-kind">{isUpdate ? `${t('draftUpdate')} ${draft.target?.entityId ?? ''}` : t('draftCreate')}</span>
          <strong>{draft.alias}</strong>
        </div>
        <span className={`as-badge ${draft.status}`}>{t(STATUS_KEY[draft.status])}</span>
      </div>

      {draft.explanation && <p className="as-draft-text">{draft.explanation}</p>}

      <ul className="as-checks">
        {draft.checks.map((c) => (
          <li key={c.label}>
            {c.ok ? <Check size={14} className="st-ok" /> : <X size={14} className="st-err" />}
            <span>
              {c.label}
              {c.detail && <span className="as-check-detail"> · {c.detail}</span>}
            </span>
          </li>
        ))}
        {draft.warnings.map((w) => (
          <li key={w} className="st-warn">
            <AlertTriangle size={14} />
            <span>{w}</span>
          </li>
        ))}
      </ul>

      {isUpdate && draft.diff && (
        <details className="as-details" open>
          <summary>{t('draftDiff')}</summary>
          <Diff lines={draft.diff} />
        </details>
      )}
      <details className="as-details" open={!isUpdate && draft.status === 'pending'}>
        <summary>YAML</summary>
        <pre className="as-pre">{draft.yaml}</pre>
      </details>

      {draft.status === 'pending' && (
        <>
          {critical && (
            <div className="as-critical">
              <p>
                <ShieldAlert size={16} /> <strong>{t('draftCritical')}</strong>
              </p>
              <ul>
                {draft.critical.map((c) => (
                  <li key={c.ref}>
                    <code>{c.ref}</code> — {c.reason}
                  </li>
                ))}
              </ul>
              <label className="as-check-label">
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> {t('draftCriticalConfirm')}
              </label>
            </div>
          )}
          {!isUpdate && (
            <label className="as-check-label">
              <input type="checkbox" checked={!enabled} onChange={(e) => setEnabled(!e.target.checked)} /> {t('draftDisabled')}
            </label>
          )}
          <div className="as-draft-actions">
            <button
              type="button"
              className="glass-btn glass-btn-accent as-btn"
              disabled={busy !== null || (critical && !confirmed)}
              onClick={() => void act('apply', () => api.applyDraft(draft.id, { enabled, confirmCritical: confirmed }))}
            >
              {busy === 'apply' ? <Loader2 size={16} className="spin" /> : <Check size={16} />} {isUpdate ? t('draftApplyUpdate') : t('draftApplyCreate')}
            </button>
            <button type="button" className="glass-btn as-btn" disabled={busy !== null} onClick={() => void act('discard', () => api.discardDraft(draft.id))}>
              {busy === 'discard' ? <Loader2 size={16} className="spin" /> : <X size={16} />} {t('draftDiscard')}
            </button>
          </div>
        </>
      )}

      {draft.status === 'applied' && draft.applied && (
        <>
          <p className="as-note info as-draft-done">
            <CheckCircle2 size={14} className="st-ok" />
            {isUpdate ? t('draftDoneUpdate') : draft.applied.enabled ? t('draftDoneCreate') : t('draftDoneCreateOff')}
            {draft.applied.entityId && <code>{draft.applied.entityId}</code>}
          </p>
          {draft.applied.warning && (
            <p className="as-note warning">
              <AlertTriangle size={14} /> {draft.applied.warning}
            </p>
          )}
          <div className="as-draft-actions">
            {editorId && (
              <button type="button" className="glass-btn as-btn" onClick={() => navigateHomeAssistant(automationEditorPath(editorId))}>
                <ExternalLink size={16} /> {t('draftOpenEditor')}
              </button>
            )}
            <button
              type="button"
              className="glass-btn as-btn"
              disabled={busy !== null}
              onClick={() => confirm(isUpdate ? t('draftUndoConfirmUpdate') : t('draftUndoConfirmCreate')) && void act('undo', () => api.undoDraft(draft.id))}
            >
              {busy === 'undo' ? <Loader2 size={16} className="spin" /> : <RotateCcw size={16} />} {t('draftUndo')}
            </button>
          </div>
        </>
      )}

      {(error || (draft.status === 'pending' && draft.lastError)) && (
        <p className="as-note error">
          <AlertTriangle size={14} /> {error ?? draft.lastError}
        </p>
      )}
    </div>
  )
}
