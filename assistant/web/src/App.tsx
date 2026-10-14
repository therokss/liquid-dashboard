import { useCallback, useEffect, useState } from 'react'
import { MessageCircle, Sparkles, ShieldCheck, Cpu, Stethoscope, RefreshCw } from 'lucide-react'
import { api, ApiError, type Session } from './api'
import { ComingSoonPage } from './pages/ComingSoonPage'
import { DiagnosticsPage } from './pages/DiagnosticsPage'
import { GlassCard } from './components/Glass'
import { t } from './i18n/it'

type Tab = 'chat' | 'suggest' | 'verify' | 'devices' | 'diagnostics'

const TABS: Array<{ id: Tab; label: string; icon: typeof MessageCircle }> = [
  { id: 'chat', label: t('tabChat'), icon: MessageCircle },
  { id: 'suggest', label: t('tabSuggest'), icon: Sparkles },
  { id: 'verify', label: t('tabVerify'), icon: ShieldCheck },
  { id: 'devices', label: t('tabDevices'), icon: Cpu },
  { id: 'diagnostics', label: t('tabDiagnostics'), icon: Stethoscope },
]

// Navigazione con l'hash (#diagnostica): con base './' i percorsi annidati romperebbero gli asset.
const HASH: Record<Tab, string> = { chat: 'chat', suggest: 'suggerisci', verify: 'verifica', devices: 'dispositivi', diagnostics: 'diagnostica' }
const fromHash = (): Tab => (Object.entries(HASH).find(([, h]) => `#${h}` === location.hash)?.[0] as Tab | undefined) ?? 'diagnostics'

export function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<{ status: number; message: string } | null>(null)
  const [tab, setTab] = useState<Tab>(fromHash)

  const load = useCallback(async () => {
    setError(null)
    try {
      setSession(await api.session())
    } catch (e) {
      setError(e instanceof ApiError ? { status: e.status, message: e.message } : { status: 0, message: String(e) })
    }
  }, [])

  useEffect(() => {
    void load()
    const onHash = () => setTab(fromHash())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [load])

  const go = (next: Tab) => {
    location.hash = HASH[next]
    setTab(next)
  }

  // Dopo un aggiornamento l'ingress di HA può servire la pagina vecchia: lo segnaliamo.
  const staleUi = session && __APP_VERSION__ !== 'dev' && session.version !== 'dev' && session.version !== __APP_VERSION__

  return (
    <div className="app-root">
      <div className="app-content">
        <header className="as-header">
          <h1 className="text-title as-title">{t('appTitle')}</h1>
          {session && <span className="as-version">v{session.version}</span>}
        </header>

        <main className="as-main glass-scroll">
          {!session && !error && <p className="text-body as-center">{t('loading')}</p>}
          {error && (
            <GlassCard className="as-center-card">
              <p className="as-error">{error.status === 403 || error.status === 401 ? t('noAccess') : `${t('sessionError')}: ${error.message}`}</p>
              <button type="button" className="glass-btn as-btn" onClick={() => void load()}>
                <RefreshCw size={16} /> Riprova
              </button>
            </GlassCard>
          )}
          {staleUi && (
            <p className="as-warn as-banner">
              L'add-on è alla versione {session.version} ma questa pagina è la {__APP_VERSION__}: ricarica la pagina (Cmd/Ctrl+Shift+R).
            </p>
          )}
          {session && tab === 'diagnostics' && <DiagnosticsPage session={session} />}
          {session && tab === 'chat' && <ComingSoonPage icon={MessageCircle} title={t('tabChat')} text={t('comingChat')} version="0.2" />}
          {session && tab === 'suggest' && <ComingSoonPage icon={Sparkles} title={t('tabSuggest')} text={t('comingSuggest')} version="0.4" />}
          {session && tab === 'verify' && <ComingSoonPage icon={ShieldCheck} title={t('tabVerify')} text={t('comingVerify')} version="0.5" />}
          {session && tab === 'devices' && <ComingSoonPage icon={Cpu} title={t('tabDevices')} text={t('comingDevices')} version="0.6" />}
        </main>

        <nav className="as-tabbar glass-panel" aria-label="Sezioni">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" className={`as-tab ${tab === id ? 'active' : ''}`} onClick={() => go(id)} aria-current={tab === id ? 'page' : undefined}>
              <Icon size={20} aria-hidden />
              <span>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
