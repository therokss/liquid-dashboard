import { useCallback, useEffect, useState } from 'react'
import { MessageCircle, Sparkles, ShieldCheck, Cpu, Settings, RefreshCw } from 'lucide-react'
import { api, ApiError, type Session } from './api'
import { DiagnosticsPage } from './pages/DiagnosticsPage'
import { ChatPage } from './pages/ChatPage'
import { SettingsPage } from './pages/SettingsPage'
import { SuggestPage } from './pages/SuggestPage'
import { VerifyPage } from './pages/VerifyPage'
import { DevicesPage } from './pages/DevicesPage'
import { GlassCard } from './components/Glass'
import { t } from './i18n/it'

type Tab = 'chat' | 'suggest' | 'verify' | 'devices' | 'settings' | 'diagnostics'

// La Diagnostica non ha una scheda propria: si apre dalle Impostazioni (e da #diagnostica).
const TABS: Array<{ id: Tab; label: string; icon: typeof MessageCircle }> = [
  { id: 'chat', label: t('tabChat'), icon: MessageCircle },
  { id: 'suggest', label: t('tabSuggest'), icon: Sparkles },
  { id: 'verify', label: t('tabVerify'), icon: ShieldCheck },
  { id: 'devices', label: t('tabDevices'), icon: Cpu },
  { id: 'settings', label: t('tabSettings'), icon: Settings },
]

// Navigazione con l'hash (#diagnostica): con base './' i percorsi annidati romperebbero gli asset.
const HASH: Record<Tab, string> = { chat: 'chat', suggest: 'suggerisci', verify: 'verifica', devices: 'dispositivi', settings: 'impostazioni', diagnostics: 'diagnostica' }
const fromHash = (): Tab => (Object.entries(HASH).find(([, h]) => `#${h}` === location.hash)?.[0] as Tab | undefined) ?? 'chat'

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

  // "Discuti in chat" da Suggerisci e Verifica: la chat apre la conversazione appena creata.
  const openChat = (conversationId: string) => {
    try {
      sessionStorage.setItem('as-chat', conversationId)
    } catch {
      /* senza sessionStorage la chat apre l'ultima conversazione */
    }
    go('chat')
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

        <main className={`as-main ${tab === 'chat' && session ? 'as-main-chat' : 'glass-scroll'}`}>
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
          {session && tab === 'chat' && <ChatPage session={session} />}
          {session && tab === 'settings' && <SettingsPage onOpenDiagnostics={() => go('diagnostics')} />}
          {session && tab === 'suggest' && <SuggestPage onOpenChat={openChat} />}
          {session && tab === 'verify' && <VerifyPage onOpenChat={openChat} />}
          {session && tab === 'devices' && <DevicesPage />}
        </main>

        <nav className="as-tabbar glass-panel" aria-label="Sezioni">
          {TABS.map(({ id, label, icon: Icon }) => {
            const active = tab === id || (id === 'settings' && tab === 'diagnostics')
            return (
            <button key={id} type="button" className={`as-tab ${active ? 'active' : ''}`} onClick={() => go(id)} aria-current={active ? 'page' : undefined}>
              <Icon size={20} aria-hidden />
              <span>{label}</span>
            </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
