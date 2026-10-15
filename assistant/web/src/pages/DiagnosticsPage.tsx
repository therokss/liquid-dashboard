import { useEffect, useRef, useState } from 'react'
import { Activity, Bot, Radio } from 'lucide-react'
import { api, ApiError, type AnthropicPing, type ProbeRun, type Session } from '../api'
import { Button, Section } from '../components/Glass'
import { StatusIcon } from '../components/StatusIcon'
import { t } from '../i18n/it'

function ProbesSection() {
  const [run, setRun] = useState<ProbeRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      setRun(await api.runProbes())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const passed = run?.results.filter((r) => r.status === 'ok').length ?? 0
  return (
    <Section
      title={t('diagHa')}
      intro={t('diagIntro')}
      actions={
        <Button accent onClick={start} disabled={busy}>
          <Activity size={16} /> {busy ? t('diagRunning') : t('diagRun')}
        </Button>
      }
    >
      {error && <p className="as-error">{error}</p>}
      {run && (
        <>
          <p className="text-body as-summary">
            {passed}/{run.results.length} {t('diagSummary')} · {(run.durationMs / 1000).toFixed(1)} s
          </p>
          <ul className="as-probes">
            {run.results.map((r) => (
              <li key={r.id} className="as-probe">
                <StatusIcon status={r.status} />
                <div className="as-probe-text">
                  <span className="as-probe-label">{r.label}</span>
                  <span className="as-probe-summary">{r.summary}</span>
                </div>
                <span className="as-probe-ms">{r.ms} ms</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  )
}

function SseSection() {
  const [ticks, setTicks] = useState<number[]>([])
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const sourceRef = useRef<EventSource | null>(null)
  const SECONDS = 20

  useEffect(() => () => sourceRef.current?.close(), [])

  const start = () => {
    sourceRef.current?.close()
    setTicks([])
    setDone(false)
    setRunning(true)
    const es = new EventSource(api.sseTestUrl(SECONDS))
    sourceRef.current = es
    es.addEventListener('tick', () => setTicks((prev) => [...prev, performance.now()]))
    es.addEventListener('done', () => {
      es.close()
      setRunning(false)
      setDone(true)
    })
    es.onerror = () => {
      es.close()
      setRunning(false)
      setDone(true)
    }
  }

  const gaps = ticks.slice(1).map((v, i) => v - ticks[i]!)
  const maxGap = gaps.length ? Math.max(...gaps) : 0
  const regular = ticks.length >= SECONDS && maxGap < 2500 && gaps.filter((g) => g < 200).length < 3

  return (
    <Section
      title={t('diagSse')}
      intro={t('diagSseIntro')}
      actions={
        <Button onClick={start} disabled={running}>
          <Radio size={16} /> {t('diagSseRun')}
        </Button>
      }
    >
      {(running || done) && (
        <div className="as-sse">
          <div className="as-sse-bar">
            {Array.from({ length: SECONDS }, (_, i) => (
              <span key={i} className={`as-sse-dot ${i < ticks.length ? 'on' : ''}`} />
            ))}
          </div>
          <p className="text-body">
            {ticks.length}/{SECONDS} · {t('diagSseMaxGap')} {(maxGap / 1000).toFixed(2)} s
          </p>
          {done && (
            <p className="as-verdict">
              <StatusIcon status={regular ? 'ok' : 'avviso'} /> {regular ? t('diagSseOk') : t('diagSseBuffered')}
            </p>
          )}
        </div>
      )}
    </Section>
  )
}

function AnthropicSection({ configured }: { configured: boolean }) {
  const [ping, setPing] = useState<AnthropicPing | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      setPing(await api.pingAnthropic())
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section
      title={t('diagAnthropic')}
      intro={t('diagAnthropicIntro')}
      actions={
        <Button onClick={start} disabled={busy || !configured}>
          <Bot size={16} /> {t('diagAnthropicRun')}
        </Button>
      }
    >
      {!configured && <p className="as-warn">{t('diagAnthropicMissing')}</p>}
      {error && <p className="as-error">{error}</p>}
      {ping && (
        <ul className="as-probes">
          {ping.models.map((m) => (
            <li key={m.model} className="as-probe">
              <StatusIcon status={m.ok ? 'ok' : 'errore'} />
              <div className="as-probe-text">
                <span className="as-probe-label">
                  {m.role === 'chat' ? t('infoChatModel') : t('infoAnalysisModel')}: {m.displayName ?? m.model}
                </span>
                <span className="as-probe-summary">{m.ok ? m.model : m.error}</span>
              </div>
            </li>
          ))}
          {ping.countTokens && (
            <li className="as-probe">
              <StatusIcon status={'inputTokens' in ping.countTokens ? 'ok' : 'errore'} />
              <div className="as-probe-text">
                <span className="as-probe-label">countTokens</span>
                <span className="as-probe-summary">
                  {'inputTokens' in ping.countTokens ? `${ping.countTokens.inputTokens} ${t('diagTokens')}` : ping.countTokens.error}
                </span>
              </div>
            </li>
          )}
        </ul>
      )}
    </Section>
  )
}

export function DiagnosticsPage({ session }: { session: Session }) {
  const rows: Array<[string, string]> = [
    [t('infoVersion'), session.version],
    [t('infoMode'), session.mode === 'addon' ? 'add-on' : session.mode],
    [t('infoHa'), session.ha.version ? `${session.ha.version} (${session.ha.state})` : session.ha.error ?? session.ha.state],
    [t('infoUser'), session.user?.displayName || session.user?.name || '—'],
    [t('infoChatModel'), `${session.options.chatModel} · ${session.options.chatEffort}`],
    [t('infoAnalysisModel'), `${session.options.analysisModel} · ${session.options.suggestEffort}/${session.options.verifyEffort}/${session.options.devicesEffort}`],
  ]
  return (
    <div className="as-page">
      <Section title={t('diagTitle')}>
        <dl className="as-info">
          {rows.map(([k, v]) => (
            <div key={k} className="as-info-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <ProbesSection />
      <SseSection />
      <AnthropicSection configured={session.options.anthropicConfigured} />
    </div>
  )
}
