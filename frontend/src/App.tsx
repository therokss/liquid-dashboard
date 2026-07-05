import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CloudOff } from 'lucide-react'
import { useStore } from './store'
import { useHA, saveToken, clearToken, clearAuth } from './hooks/useHA'
import { useWallpaper, useAccentFromWallpaper } from './hooks/useWallpaper'
import { setKiosk } from './lib/kiosk'
import { loadPrefs, applyHouse, extractHouse, savePrefs, startHouseSync } from './lib/permissions'
import { loadUserConfig, applyUserConfig, startUserConfigSync } from './lib/userConfig'
import { startLiveSync } from './lib/liveSync'
import { CustomDashboardView } from './lib/dashboards/CustomDashboardView'
import { loadDashboards } from './lib/dashboards/store'
import { getScreenId } from './lib/dashboards/deviceId'
import type { CustomDashboard } from './lib/dashboards/types'
import { SetupWizard } from './setup/SetupWizard'
import { OnboardingWizard } from './pages/OnboardingWizard'
import { TabBar, type Tab } from './components/nav/TabBar'
import { TopHeader } from './components/nav/TopHeader'
import { HomePage } from './pages/HomePage'
import { RoomsPage } from './pages/RoomsPage'
import { SecurityPage } from './pages/SecurityPage'
import { MediaPage } from './pages/MediaPage'
import { SettingsPage } from './pages/SettingsPage'

function ThemeApplier() {
  const theme = useStore((s) => s.theme)

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--glass-intensity', String(theme.glassIntensity))
    root.style.setProperty('--accent-hue', String(theme.accentHue))

    // 'auto' segue il tema chiaro/scuro del dispositivo; 'light'/'dark' forzati
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const dark = theme.mode === 'dark' || (theme.mode === 'auto' && mq.matches)
      root.setAttribute('data-theme', dark ? 'dark' : 'light')
    }
    apply()
    if (theme.mode === 'auto') {
      mq.addEventListener('change', apply)
      return () => mq.removeEventListener('change', apply)
    }
  }, [theme])

  return null
}

function LoadingScreen() {
  return (
    <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24 }}>
      <motion.div
        animate={{ scale: [1, 1.08, 1], opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        style={{ fontSize: 56 }}
      >
        💧
      </motion.div>
      <div className="loading-dots">
        <span /><span /><span />
      </div>
      <p style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>Connessione a Home Assistant…</p>
    </div>
  )
}

function Dashboard({ onReconfigure }: { onReconfigure: () => void }) {
  const { reconnect } = useHA()
  useWallpaper()
  useAccentFromWallpaper()

  const loading = useStore((s) => s.loading)
  const connected = useStore((s) => s.connected)
  const hassUrl = useStore((s) => s.hassUrl)
  const [everConnected, setEverConnected] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const [retries, setRetries] = useState(0)
  const [assignedDash, setAssignedDash] = useState<CustomDashboard | null>(null)
  const [showDefault, setShowDefault] = useState(false)
  const MAX_RETRIES = 40 // ~3 min a 5s: copre il tempo di riavvio di HA

  useEffect(() => {
    if (connected) setEverConnected(true)
  }, [connected])

  // Questo schermo ha una dashboard custom assegnata? La mostra di default.
  useEffect(() => {
    if (!connected) return
    void loadDashboards().then(({ dashboards, deviceMap }) => {
      const id = deviceMap[getScreenId()]
      setAssignedDash(id ? dashboards.find((d) => d.id === id) ?? null : null)
    })
  }, [connected])

  // Auto-retry al primo avvio (es. mentre Home Assistant si sta riavviando):
  // riprova da solo senza mostrare subito l'errore.
  useEffect(() => {
    if (connected || everConnected || retries >= MAX_RETRIES) return
    const t = setTimeout(() => { reconnect(); setRetries((r) => r + 1) }, 5000)
    return () => clearTimeout(t)
  }, [connected, everConnected, retries, reconnect])

  if (loading) return <LoadingScreen />

  if (!connected && !everConnected) {
    // Sta ancora ritentando (es. HA in riavvio): mostra il caricamento, non l'errore
    if (retries < MAX_RETRIES) return <LoadingScreen />
    return (
      <div style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20, padding: '0 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
          <CloudOff size={48} strokeWidth={1.5} />
        </div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', textAlign: 'center', margin: 0 }}>
          Impossibile connettersi
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, textAlign: 'center', lineHeight: 1.6, margin: 0 }}>
          Nessuna risposta da Home Assistant.<br />
          Verifica di essere sulla stessa rete Wi-Fi.
        </p>
        <div style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid var(--glass-border)', borderRadius: 10, padding: '10px 16px', fontSize: 13, color: 'var(--text-tertiary)', fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'center' }}>
          {hassUrl}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}>
          <button className="glass-btn glass-btn-accent" onClick={() => { setRetries(0); reconnect() }}>
            Riprova
          </button>
          <button className="glass-btn" onClick={onReconfigure}>
            Riconfigura URL e token
          </button>
        </div>
      </div>
    )
  }

  // Schermo con dashboard custom assegnata: la mostra di default (tasto per la predefinita).
  if (assignedDash && !showDefault) {
    return <CustomDashboardView dashboard={assignedDash} onDefault={() => setShowDefault(true)} />
  }

  return (
    <div className="app-content">
      <TopHeader />
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            style={{ position: 'absolute', inset: 0 }}
          >
            {activeTab === 'home' && <HomePage />}
            {activeTab === 'rooms' && <RoomsPage />}
            {activeTab === 'security' && <SecurityPage />}
            {activeTab === 'media' && <MediaPage />}
            {activeTab === 'settings' && <SettingsPage />}
          </motion.div>
        </AnimatePresence>
      </div>
      <TabBar active={activeTab} onChange={setActiveTab} />
    </div>
  )
}

function hasStoredCredentials(): boolean {
  return (
    localStorage.getItem('ha-ll-token') !== null ||
    localStorage.getItem('ha-ll-use-proxy') !== null
  )
}

// Calcola l'URL base dell'addon (gestisce prefisso ingress di HA)
function getAddonApiBase(): string {
  const { origin, pathname } = window.location
  const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname.replace(/\/[^/]*$/, '')
  return origin + base
}

async function syncAddonConfig(): Promise<void> {
  // OAuth token inutilizzabili in ingress — puliamo subito
  localStorage.removeItem('ha-ll-oauth')

  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), 3000)
  try {
    const resp = await fetch(getAddonApiBase() + '/api/addon-config', {
      signal: controller.signal,
    })
    clearTimeout(tid)
    if (!resp.ok) return
    const text = await resp.text()
    let cfg: { token?: string; ha_url?: string }
    try { cfg = JSON.parse(text) } catch { return }
    const hasSupervisorToken = Boolean((cfg as { has_supervisor_token?: boolean }).has_supervisor_token)

    if (hasSupervisorToken) {
      // Proxy mode: il server autentica con SUPERVISOR_TOKEN → nessun token manuale necessario
      localStorage.setItem('ha-ll-use-proxy', '1')
      localStorage.removeItem('ha-ll-token')
      if (cfg.ha_url) useStore.getState().setHassUrl(cfg.ha_url)
    } else if (cfg.token) {
      localStorage.removeItem('ha-ll-use-proxy')
      saveToken(cfg.token)
      if (cfg.ha_url) useStore.getState().setHassUrl(cfg.ha_url)
    } else {
      // Nessuna credenziale → mostra wizard
      localStorage.removeItem('ha-ll-use-proxy')
      clearToken()
      clearAuth()
      useStore.getState().resetSetup()
    }
  } catch {
    clearTimeout(tid)
    // Non è un addon o server non raggiungibile — usa localStorage così com'è
  }
}

function handleReconfigure() {
  clearToken()
  clearAuth()
  localStorage.removeItem('ha-ll-use-proxy')
  useStore.getState().resetSetup()
  window.location.reload()
}

function OnboardingGate() {
  const connected = useStore((s) => s.connected)
  const isAdmin = useStore((s) => s.isAdmin)
  const onboardingDone = useStore((s) => s.onboardingDone)
  const setOnboardingDone = useStore((s) => s.setOnboardingDone)
  // Il wizard di configurazione è riservato agli amministratori: gli altri utenti
  // vedono direttamente la dashboard con le impostazioni standard.
  if (!isAdmin || onboardingDone || !connected) return null
  return <OnboardingWizard onDone={() => setOnboardingDone(true)} />
}

export default function App() {
  const [initialized, setInitialized] = useState(false)
  const [showDashboard, setShowDashboard] = useState(false)

  useWallpaper()

  useEffect(() => {
    syncAddonConfig().then(() => {
      setShowDashboard(hasStoredCredentials())
      setInitialized(true)
    })
  }, [])

  // Rileva se l'utente ingress è amministratore (per il pulsante schermo intero)
  useEffect(() => {
    const controller = new AbortController()
    const tid = setTimeout(() => controller.abort(), 4000)
    fetch(getAddonApiBase() + '/api/user', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => { if (u) { const st = useStore.getState(); st.setIsAdmin(Boolean(u.is_admin)); st.setCurrentUserId(u.id || null) } })
      .catch(() => {})
      .finally(() => clearTimeout(tid))
  }, [])

  // Preferenze condivise: permessi + config "casa" (rifiuti/meteo/energia/aree).
  // La config casa la imposta l'admin ed è vista da tutti; se non esiste ancora,
  // viene migrata dai valori locali dell'admin (il server rifiuta i non-admin).
  useEffect(() => {
    loadPrefs().then(({ permissions, house }) => {
      const st = useStore.getState()
      if (permissions) st.setUserPermissions(permissions)
      if (house && Object.keys(house).length) applyHouse(house)
      else void savePrefs({ house: extractHouse(st as unknown as Record<string, unknown>) })
      startHouseSync()
    })
  }, [])

  // Preferenze per-utente: carica dal server (per ID utente ingress), applica,
  // poi avvia il salvataggio automatico. Se non disponibile → resta su localStorage.
  useEffect(() => {
    let cancelled = false
    loadUserConfig().then((res) => {
      if (cancelled) return
      if (res.config) applyUserConfig(res.config)
      startUserConfigSync()
      startLiveSync() // polling leggero: modifiche da altri dispositivi arrivano live
    })
    return () => { cancelled = true }
  }, [])

  // Kiosk sempre attivo all'avvio: la barra di HA resta nascosta per tutti.
  // Solo l'admin ha il tasto (in TopHeader) per uscirne temporaneamente; al
  // prossimo caricamento il kiosk torna comunque attivo.
  useEffect(() => {
    setKiosk(true)
    useStore.getState().setKioskMode(true)
  }, [])

  if (!initialized) {
    return (
      <div className="app-root">
        <ThemeApplier />
        <LoadingScreen />
      </div>
    )
  }

  return (
    <div className="app-root">
      <ThemeApplier />

      <AnimatePresence mode="wait">
        {!showDashboard ? (
          <motion.div
            key="setup"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.3 }}
            style={{ height: '100%' }}
          >
            <SetupWizard onComplete={() => setShowDashboard(true)} />
          </motion.div>
        ) : (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, scale: 1.02 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            style={{ height: '100%' }}
          >
            <Dashboard onReconfigure={handleReconfigure} />
          </motion.div>
        )}
      </AnimatePresence>

      {showDashboard && <OnboardingGate />}
    </div>
  )
}
