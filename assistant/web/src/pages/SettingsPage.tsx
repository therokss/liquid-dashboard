import { useEffect, useState } from 'react'
import { ExternalLink, Eye, Loader2, ShieldAlert, Stethoscope } from 'lucide-react'
import { api, type ConsentKey, type Consents, type HistoryEntry, type InventoryStats, type SettingsData } from '../api'
import { automationEditorPath, navigateHomeAssistant } from '../lib/navigate'
import { Button, Section } from '../components/Glass'
import { t, type TextKey } from '../i18n/it'

const CONSENT_TEXT: Record<ConsentKey, { title: string; text: string; warning: string }> = {
  posizione: {
    title: 'Posizione e GPS',
    text: 'Tracker, coordinate delle zone e luogo preciso delle persone. Senza consenso le persone risultano solo “a casa” o “fuori casa”.',
    warning: 'Claude riceverà coordinate GPS, zone e spostamenti delle persone. Attivi a tuo rischio: vuoi continuare?',
  },
  telecamere: {
    title: 'Telecamere e citofono',
    text: 'Entità di telecamere e campanelli/citofoni (movimento, chiamate, apriporta). Le immagini non vengono mai inviate.',
    warning: 'Claude vedrà stati e storici di telecamere e citofono, incluso l’apriporta. Attivi a tuo rischio: vuoi continuare?',
  },
  appMobile: {
    title: 'App mobile e salute',
    text: 'Sensori dell’app Home Assistant sui telefoni (batteria, attività, passi…) e integrazioni di salute e fitness.',
    warning: 'Claude riceverà dati dei telefoni e di salute/attività fisica. Attivi a tuo rischio: vuoi continuare?',
  },
}

const usd = (n: number) => `$${n.toFixed(2)}`

function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className={`as-switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)} disabled={disabled}>
      <span />
    </button>
  )
}

function InventoryPreview() {
  const [data, setData] = useState<{ stats: InventoryStats; text: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.inventoryPreview())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }
  return (
    <Section
      title={t('setInventory')}
      intro={t('setInventoryIntro')}
      actions={
        <Button onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={16} className="spin" /> : <Eye size={16} />} {data ? t('refresh') : t('setInventoryShow')}
        </Button>
      }
    >
      {error && <p className="as-error">{error}</p>}
      {data && (
        <>
          <dl className="as-info">
            <div className="as-info-row">
              <dt>{t('setIncluded')}</dt>
              <dd>
                {data.stats.included} su {data.stats.totalEntities} ({data.stats.forcedByAutomations} {t('setForced')})
              </dd>
            </div>
            <div className="as-info-row">
              <dt>{t('setAutomations')}</dt>
              <dd>{data.stats.automations}</dd>
            </div>
            <div className="as-info-row">
              <dt>{t('setExcludedPrivacy')}</dt>
              <dd>
                {(Object.keys(data.stats.excludedPrivacy) as ConsentKey[]).map((k) => `${CONSENT_TEXT[k].title}: ${data.stats.excludedPrivacy[k]}`).join(' · ')}
              </dd>
            </div>
          </dl>
          <div className="as-domains">
            {Object.entries(data.stats.byDomain).map(([d, n]) => (
              <span key={d} className="as-chip">
                {d} {n}
              </span>
            ))}
          </div>
          <details className="as-details">
            <summary>{t('setInventoryText')} ({Math.round(data.text.length / 1000)}K caratteri)</summary>
            <pre className="as-pre">{data.text}</pre>
          </details>
        </>
      )}
    </Section>
  )
}

function History() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  useEffect(() => {
    api.history().then((r) => setEntries(r.entries), () => setEntries([]))
  }, [])
  return (
    <Section title={t('setHistory')} intro={t('setHistoryIntro')}>
      {entries === null && <p className="as-probe-summary as-summary">{t('loading')}</p>}
      {entries?.length === 0 && <p className="as-probe-summary as-summary">{t('setHistoryEmpty')}</p>}
      {entries && entries.length > 0 && (
        <ul className="as-history">
          {entries.slice(0, 30).map((e, i) => (
            <li key={i}>
              <div>
                <p className="as-probe-label">
                  {t(`hist_${e.action}` as TextKey)} · {e.alias}
                </p>
                <p className="as-probe-summary">
                  {new Date(e.ts).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {e.by}
                  {e.entityId ? ` · ${e.entityId}` : ''}
                </p>
              </div>
              {(e.action === 'creata' || e.action === 'modificata' || e.action === 'ripristinata') && (
                <button type="button" className="as-icon-btn" onClick={() => navigateHomeAssistant(automationEditorPath(e.automationId))} aria-label={t('draftOpenEditor')} title={t('draftOpenEditor')}>
                  <ExternalLink size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

export function SettingsPage({ onOpenDiagnostics }: { onOpenDiagnostics: () => void }) {
  const [data, setData] = useState<SettingsData | null>(null)
  const [saving, setSaving] = useState<ConsentKey | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.settings().then(setData, (e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const toggle = async (key: ConsentKey, value: boolean) => {
    if (!data) return
    if (value && !confirm(CONSENT_TEXT[key].warning)) return
    setSaving(key)
    setError(null)
    try {
      const next: Consents = { ...data.consents, [key]: value }
      const r = await api.setPrivacy(next)
      setData({ ...data, consents: r.consents })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(null)
    }
  }

  if (!data) return <p className="text-body as-center">{error ?? t('loading')}</p>
  const b = data.budget
  const pct = b.blockUsd > 0 ? Math.min(100, (b.spentUsd / b.blockUsd) * 100) : 0

  return (
    <div className="as-page">
      <Section title={t('setPrivacy')} intro={t('setPrivacyIntro')}>
        <ul className="as-consents">
          {(Object.keys(CONSENT_TEXT) as ConsentKey[]).map((k) => (
            <li key={k}>
              <div>
                <p className="as-probe-label">
                  {data.consents[k] && <ShieldAlert size={14} className="st-warn" />} {CONSENT_TEXT[k].title}
                </p>
                <p className="as-probe-summary">{CONSENT_TEXT[k].text}</p>
              </div>
              {saving === k ? <Loader2 size={18} className="spin" /> : <Switch checked={data.consents[k]} onChange={(v) => void toggle(k, v)} label={CONSENT_TEXT[k].title} />}
            </li>
          ))}
        </ul>
        <p className="as-probe-summary as-summary">{t('setPrivacyNote')}</p>
        {error && <p className="as-error">{error}</p>}
      </Section>

      <History />

      <InventoryPreview />

      <Section title={t('setModels')} intro={t('setModelsIntro')}>
        <dl className="as-info">
          <div className="as-info-row">
            <dt>{t('infoChatModel')}</dt>
            <dd>
              {data.models.chat} · effort {data.models.chatEffort}
            </dd>
          </div>
          <div className="as-info-row">
            <dt>{t('infoAnalysisModel')}</dt>
            <dd>{data.models.analysis}</dd>
          </div>
        </dl>
      </Section>

      <Section title={t('setBudget')} intro={t('setBudgetIntro')}>
        <div className="as-budget">
          <div className="as-budget-bar">
            <span className={b.level} style={{ width: `${pct}%` }} />
          </div>
          <p className="text-body">
            {b.month}: <strong>{usd(b.spentUsd)}</strong> · avviso a ${b.warnUsd} · blocco a ${b.blockUsd}
          </p>
        </div>
      </Section>

      <Section
        title={t('tabDiagnostics')}
        intro={t('setDiagIntro')}
        actions={
          <Button onClick={onOpenDiagnostics}>
            <Stethoscope size={16} /> {t('setDiagOpen')}
          </Button>
        }
      />
    </div>
  )
}
