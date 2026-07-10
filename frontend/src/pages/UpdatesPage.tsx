import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { ChevronLeft, RefreshCw, ArrowUpCircle, CheckCircle2, ExternalLink, Package, ShieldCheck } from 'lucide-react'
import { useStore } from '../store'
import { useHA } from '../hooks/useHA'
import { useT } from '../i18n'
import type { HassEntity } from '../types/ha'

const attr = (e: HassEntity, k: string) => (e.attributes as Record<string, unknown>)[k]
const titleOf = (e: HassEntity) => (attr(e, 'title') as string) || (attr(e, 'friendly_name') as string) || e.entity_id
const FEAT_INSTALL = 1
const FEAT_BACKUP = 8
const canInstall = (e: HassEntity) => {
  const f = attr(e, 'supported_features') as number | undefined
  return f == null || (f & FEAT_INSTALL) !== 0
}
const supportsBackup = (e: HassEntity) => {
  const f = attr(e, 'supported_features') as number | undefined
  return f != null && (f & FEAT_BACKUP) !== 0
}
const isInProgress = (e: HassEntity) => attr(e, 'in_progress') === true || typeof attr(e, 'update_percentage') === 'number'
const progressOf = (e: HassEntity): number | null => {
  const p = attr(e, 'update_percentage')
  return typeof p === 'number' ? p : null
}

function UpdateRow({ e, onInstall, willBackup }: { e: HassEntity; onInstall: (id: string) => void; willBackup: boolean }) {
  const t = useT()
  const installed = (attr(e, 'installed_version') as string) || '—'
  const latest = (attr(e, 'latest_version') as string) || '—'
  const url = attr(e, 'release_url') as string | undefined
  const inProg = isInProgress(e)
  const pct = progressOf(e)

  return (
    <div style={{ padding: '14px var(--space-lg)', borderBottom: '1px solid var(--glass-border-dim)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0, background: 'var(--accent-glow)', border: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
          <ArrowUpCircle size={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titleOf(e)}</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span><span style={{ fontFamily: 'monospace' }}>{installed}</span> → <span style={{ fontFamily: 'monospace', color: 'var(--accent)' }}>{latest}</span></span>
            {willBackup && !inProg && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: '#34d399' }}>
                <ShieldCheck size={12} /> {t('backup')}
              </span>
            )}
          </div>
        </div>
        {inProg ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--accent)', fontSize: 12.5, fontWeight: 700, flexShrink: 0 }}>
            <RefreshCw size={14} className="ld-spin" />
            {pct != null ? `${Math.round(pct)}%` : t('In corso…')}
          </div>
        ) : (
          <button className="glass-btn glass-btn-accent" style={{ padding: '8px 16px', fontSize: 13, flexShrink: 0 }} onClick={() => onInstall(e.entity_id)} disabled={!canInstall(e)}>
            {t('Aggiorna')}
          </button>
        )}
      </div>
      {inProg && pct != null && (
        <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.12)', marginTop: 10, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', borderRadius: 2, transition: 'width 0.4s ease' }} />
        </div>
      )}
      {url && (
        <a href={url} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8, fontSize: 12.5, color: 'var(--text-secondary)', textDecoration: 'none' }}>
          <ExternalLink size={12} /> {t('Note di rilascio')}
        </a>
      )}
    </div>
  )
}

export function UpdatesPage({ onBack }: { onBack: () => void }) {
  const t = useT()
  const { callService } = useHA()
  const entities = useStore((s) => s.entities)
  const [confirmAll, setConfirmAll] = useState(false)
  const [backup, setBackup] = useState(true)

  // Nota: NON filtriamo per hidden/userHidden — gli update.* hanno spesso
  // entity_category 'config'/'diagnostic' e verrebbero esclusi dall'auto-nascondi,
  // ma in questa pagina dedicata li vogliamo tutti.
  const { available, upToDateCount } = useMemo(() => {
    const all = Object.values(entities).filter((e) => e.entity_id.startsWith('update.') && e.state !== 'unavailable')
    const available = all.filter((e) => e.state === 'on').sort((a, b) => titleOf(a).localeCompare(titleOf(b)))
    const upToDateCount = all.length - available.length
    return { available, upToDateCount }
  }, [entities])

  const anyInProgress = available.some(isInProgress)
  const installable = available.filter((e) => !isInProgress(e) && canInstall(e))
  const backupAvailable = available.some(supportsBackup)

  const install = (id: string) => {
    const e = entities[id]
    const data: Record<string, unknown> = { entity_id: id }
    if (backup && e && supportsBackup(e)) data.backup = true
    return callService('update', 'install', data).catch(() => {})
  }
  const installAll = () => {
    if (!confirmAll) { setConfirmAll(true); return }
    setConfirmAll(false)
    for (const e of installable) install(e.entity_id)
  }

  return createPortal(
    <motion.div
      data-theme="dark"
      initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 3200, overflowY: 'auto',
        background: '#051424',
        backgroundImage: 'radial-gradient(circle at 12% 6%, rgba(0,219,231,0.12), transparent 42%), radial-gradient(circle at 88% 96%, rgba(74,142,255,0.12), transparent 46%)',
      }}
    >
      <div style={{ maxWidth: 720, margin: '0 auto', padding: 'calc(env(safe-area-inset-top, 0px) + 20px) var(--space-lg) calc(env(safe-area-inset-bottom, 0px) + 32px)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 'var(--space-lg)' }}>
          <button onClick={onBack} style={{ background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-pill)', color: 'var(--text-primary)', padding: '6px 12px 6px 8px', display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            <ChevronLeft size={16} /> {t('Indietro')}
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <RefreshCw size={22} color="var(--accent)" />
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
              {t('Aggiornamenti')}
            </h2>
          </div>
        </div>

        {available.length > 0 ? (
          <>
            {/* Riepilogo + Aggiorna tutti */}
            <div className="glass-card" style={{ padding: 'var(--space-lg)', marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
                  {available.length} {available.length === 1 ? t('aggiornamento') : t('aggiornamenti')}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  {anyInProgress ? t('Installazione in corso…') : confirmAll ? t('Tocca di nuovo per confermare') : t('disponibili')}
                </div>
              </div>
              <button
                className="glass-btn glass-btn-accent"
                style={{ padding: '11px 20px', fontSize: 14, opacity: installable.length === 0 ? 0.5 : 1 }}
                disabled={installable.length === 0}
                onClick={installAll}
              >
                {confirmAll ? t('Confermi? Aggiorna tutti') : t('Aggiorna tutti')}
              </button>
            </div>

            {/* Backup prima di aggiornare (solo dove supportato: Core, add-on) */}
            {backupAvailable && (
              <button
                onClick={() => setBackup((b) => !b)}
                className="glass-panel"
                style={{ width: '100%', textAlign: 'left', cursor: 'pointer', padding: 'var(--space-md) var(--space-lg)', marginBottom: 'var(--space-lg)', display: 'flex', alignItems: 'center', gap: 14, background: 'transparent' }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, background: 'var(--accent-glow)', border: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                  <ShieldCheck size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{t('Backup prima di aggiornare')}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginTop: 2 }}>{t('Consigliato · dove supportato (Core, add-on)')}</div>
                </div>
                <label className="glass-toggle" style={{ flexShrink: 0 }} onClick={(ev) => ev.stopPropagation()}>
                  <input type="checkbox" checked={backup} onChange={() => setBackup((b) => !b)} />
                  <div className="glass-toggle-track" />
                  <div className="glass-toggle-thumb" style={{ transform: backup ? 'translateX(20px)' : 'translateX(0)' }} />
                </label>
              </button>
            )}

            {/* Elenco */}
            <div className="glass-panel" style={{ padding: 0, overflow: 'hidden', marginBottom: 'var(--space-lg)' }}>
              {available.map((e) => <UpdateRow key={e.entity_id} e={e} onInstall={install} willBackup={backup && supportsBackup(e)} />)}
            </div>

            {upToDateCount > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-tertiary)', fontSize: 13, padding: '0 4px' }}>
                <CheckCircle2 size={15} color="#34d399" /> {t('Altri {{n}} componenti sono aggiornati', { n: upToDateCount })}
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: 'center', padding: 'var(--space-2xl) var(--space-lg)', color: 'var(--text-tertiary)' }}>
            <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center', color: '#34d399' }}>
              <CheckCircle2 size={44} strokeWidth={1.5} />
            </div>
            <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>{t('Tutto aggiornato')}</div>
            <div style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
              <Package size={14} /> {upToDateCount > 0 ? t('{{n}} componenti monitorati', { n: upToDateCount }) : t('Nessun aggiornamento in sospeso')}
            </div>
          </div>
        )}
      </div>
    </motion.div>,
    document.body,
  )
}
