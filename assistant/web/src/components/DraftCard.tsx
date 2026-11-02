import { useState } from 'react'
import { AlertTriangle, Check, CheckCircle2, ExternalLink, FilePen, FilePlus2, Loader2, Package, RotateCcw, ShieldAlert, X } from 'lucide-react'
import { api, ApiCallError, type DraftPartPublic, type DraftPublic } from '../api'
import { editorPath, navigateHomeAssistant } from '../lib/navigate'
import { it, t, type TextKey } from '../i18n/it'

const STATUS_KEY: Record<DraftPublic['status'], TextKey> = {
  pending: 'draftStatus_pending',
  applied: 'draftStatus_applied',
  discarded: 'draftStatus_discarded',
  undone: 'draftStatus_undone',
}

// Scheda di una bozza in chat: è l'unico punto da cui l'add-on scrive in Home Assistant,
// sempre dopo un tocco esplicito dell'amministratore. Dalla 0.8 una bozza può contenere più
// parti (helper, script, automazioni) che si applicano e si annullano insieme.

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

/** "interruttore", "elenco di opzioni"…; il dominio se il tipo non è noto all'interfaccia. */
function helperType(domain: string | null): string {
  const key = `helper_${domain ?? ''}`
  return key in it ? t(key as TextKey) : (domain ?? '')
}

/** "Nuovo script", "Nuovo helper · interruttore", "Modifica di script.notte". */
function kindLabel(p: DraftPartPublic): string {
  if (p.kind === 'update') return `${t('draftUpdate')} ${p.entityId ?? ''}`
  if (p.object === 'script') return t('draftCreateScript')
  if (p.object === 'helper') return `${t('draftCreateHelper')} · ${helperType(p.domain)}`
  return t('draftCreate')
}

function applyLabel(parts: DraftPartPublic[]): string {
  if (parts.length > 1) return parts.every((p) => p.kind === 'create') ? t('draftApplyAllCreate') : t('draftApplyAll')
  const p = parts[0]!
  if (p.kind === 'update') return t('draftApplyUpdate')
  return p.object === 'script' ? t('draftApplyCreateScript') : p.object === 'helper' ? t('draftApplyCreateHelper') : t('draftApplyCreate')
}

function undoConfirm(parts: DraftPartPublic[]): string {
  if (parts.length > 1) return t('draftUndoConfirmBundle')
  const p = parts[0]!
  if (p.kind === 'update') return p.object === 'automation' ? t('draftUndoConfirmUpdate') : t('draftUndoConfirmUpdateOther')
  return p.object === 'script' ? t('draftUndoConfirmCreateScript') : p.object === 'helper' ? t('draftUndoConfirmCreateHelper') : t('draftUndoConfirmCreate')
}

const openLabel = (p: DraftPartPublic) => (p.object === 'helper' ? t('draftOpenHelpers') : t('draftOpenEditor'))

/** Una parte di una bozza con più elementi: tipo, nome, entity_id, esito, differenze e YAML. */
function PartBlock({ part, status }: { part: DraftPartPublic; status: DraftPublic['status'] }) {
  const applied = status === 'applied'
  return (
    <div className="as-draft-part">
      <div className="as-draft-part-head">
        <div className="as-draft-title">
          <span className="as-draft-kind">{kindLabel(part)}</span>
          <strong>{part.alias}</strong>
          {(part.kind === 'create' || applied) && part.entityId && <code className="as-draft-entity">{part.entityId}</code>}
          {applied && (
            <span className="as-draft-part-done">
              <CheckCircle2 size={13} className="st-ok" />{' '}
              {part.object === 'automation' ? (part.kind === 'create' ? t('draftDoneCreatedF') : t('draftDoneUpdatedF')) : part.kind === 'create' ? t('draftDoneCreated') : t('draftDoneUpdated')}
              {part.object === 'automation' && part.kind === 'create' && part.enabled === false ? ` · ${t('draftDisabledShort')}` : ''}
            </span>
          )}
        </div>
        {applied && part.key && (
          <button type="button" className="as-icon-btn" onClick={() => navigateHomeAssistant(editorPath(part.object, part.key!))} aria-label={openLabel(part)} title={openLabel(part)}>
            <ExternalLink size={16} />
          </button>
        )}
      </div>
      {part.kind === 'update' && part.diff && (
        <details className="as-details" open={status === 'pending'}>
          <summary>{t('draftDiff')}</summary>
          <Diff lines={part.diff} />
        </details>
      )}
      <details className="as-details">
        <summary>YAML</summary>
        <pre className="as-pre">{part.yaml}</pre>
      </details>
    </div>
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

  // Una bozza senza parti (servita da un add-on più vecchio) è una sola automazione.
  const parts: DraftPartPublic[] = draft.parts?.length
    ? draft.parts
    : [
        {
          object: 'automation',
          domain: null,
          kind: draft.kind,
          alias: draft.alias,
          yaml: draft.yaml,
          diff: draft.diff,
          entityId: draft.applied?.entityId ?? draft.target?.entityId ?? null,
          key: draft.applied?.automationId ?? draft.target?.automationId ?? null,
          enabled: draft.applied?.enabled ?? null,
        },
      ]
  const bundle = parts.length > 1
  const single = parts[0]!
  const critical = draft.critical.length > 0
  const createdAutomations = parts.filter((p) => p.object === 'automation' && p.kind === 'create').length

  return (
    <div className={`as-draft glass-card status-${draft.status}`}>
      <div className="as-draft-head">
        {bundle ? <Package size={18} /> : single.kind === 'update' ? <FilePen size={18} /> : <FilePlus2 size={18} />}
        <div className="as-draft-title">
          <span className="as-draft-kind">{bundle ? `${t('draftBundle')} · ${parts.length} ${t('draftBundleItems')}` : kindLabel(single)}</span>
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

      {bundle ? (
        <div className="as-draft-parts">
          {parts.map((p, i) => (
            <PartBlock key={`${p.object}-${p.entityId ?? p.alias}-${i}`} part={p} status={draft.status} />
          ))}
        </div>
      ) : (
        <>
          {single.kind === 'update' && single.diff && (
            <details className="as-details" open>
              <summary>{t('draftDiff')}</summary>
              <Diff lines={single.diff} />
            </details>
          )}
          <details className="as-details" open={single.kind === 'create' && draft.status === 'pending'}>
            <summary>YAML</summary>
            <pre className="as-pre">{single.yaml}</pre>
          </details>
        </>
      )}

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
          {createdAutomations > 0 && (
            <label className="as-check-label">
              <input type="checkbox" checked={!enabled} onChange={(e) => setEnabled(!e.target.checked)} />{' '}
              {!bundle ? t('draftDisabled') : createdAutomations > 1 ? t('draftDisabledBundle') : t('draftDisabledOne')}
            </label>
          )}
          <div className="as-draft-actions">
            <button
              type="button"
              className="glass-btn glass-btn-accent as-btn"
              disabled={busy !== null || (critical && !confirmed)}
              onClick={() => void act('apply', () => api.applyDraft(draft.id, { enabled, confirmCritical: confirmed }))}
            >
              {busy === 'apply' ? <Loader2 size={16} className="spin" /> : <Check size={16} />} {applyLabel(parts)}
            </button>
            <button type="button" className="glass-btn as-btn" disabled={busy !== null} onClick={() => void act('discard', () => api.discardDraft(draft.id))}>
              {busy === 'discard' ? <Loader2 size={16} className="spin" /> : <X size={16} />} {t('draftDiscard')}
            </button>
          </div>
        </>
      )}

      {draft.status === 'applied' && draft.applied && (
        <>
          {!bundle && (
            <p className="as-note info as-draft-done">
              <CheckCircle2 size={14} className="st-ok" />
              {single.kind === 'update'
                ? t('draftDoneUpdate')
                : single.object === 'script'
                  ? t('draftDoneCreateScript')
                  : single.object === 'helper'
                    ? t('draftDoneCreateHelper')
                    : draft.applied.enabled
                      ? t('draftDoneCreate')
                      : t('draftDoneCreateOff')}
              {single.entityId && <code>{single.entityId}</code>}
            </p>
          )}
          {draft.applied.warning && (
            <p className="as-note warning">
              <AlertTriangle size={14} /> {draft.applied.warning}
            </p>
          )}
          <div className="as-draft-actions">
            {!bundle && single.key && (
              <button type="button" className="glass-btn as-btn" onClick={() => navigateHomeAssistant(editorPath(single.object, single.key!))}>
                <ExternalLink size={16} /> {openLabel(single)}
              </button>
            )}
            <button type="button" className="glass-btn as-btn" disabled={busy !== null} onClick={() => confirm(undoConfirm(parts)) && void act('undo', () => api.undoDraft(draft.id))}>
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
