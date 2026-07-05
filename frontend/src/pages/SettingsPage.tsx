import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sun, Moon, Sparkles, Upload, Trash2, RefreshCw, Server, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import { clearToken } from '../hooks/useHA'
import { getDomain } from '../types/ha'
import { RoomAssigner } from '../components/RoomAssigner'
import { VisibilityStepper } from '../components/VisibilityStepper'
import { ServerPage } from './ServerPage'
import { UpdatesPage } from './UpdatesPage'
import { CAPABILITIES, canModify, savePermissions } from '../lib/permissions'
import { MasonryColumns } from '../components/MasonryColumns'
import { WASTE_TYPES, WEEKDAY_ORDER, WEEKDAY_INITIALS, INTERVAL_OPTIONS } from '../lib/waste'
import { fileToWallpaperDataUrl } from '../lib/image'
import type { WallpaperSlot } from '../store'
import type { HassEntity } from '../types/ha'

function entityName(e: HassEntity): string {
  return (e.attributes.friendly_name as string) ?? e.entity_id
}

const WALLPAPER_SLOTS: Array<{ slot: WallpaperSlot; label: string; hours: string }> = [
  { slot: 'morning', label: 'Mattina', hours: '06–11' },
  { slot: 'day', label: 'Giorno', hours: '11–18' },
  { slot: 'evening', label: 'Sera', hours: '18–22' },
  { slot: 'night', label: 'Notte', hours: '22–06' },
]

export function SettingsPage() {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const wallpapers = useStore((s) => s.wallpapers)
  const setWallpaper = useStore((s) => s.setWallpaper)
  const hassUrl = useStore((s) => s.hassUrl)
  const isAdmin = useStore((s) => s.isAdmin)
  const permissions = useStore((s) => s.userPermissions)
  const resetSetup = useStore((s) => s.resetSetup)
  const entities = useStore((s) => s.entities)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showServer, setShowServer] = useState(false)
  const [showUpdates, setShowUpdates] = useState(false)
  const [uploadingSlot, setUploadingSlot] = useState<WallpaperSlot | null>(null)

  async function handleWallpaperPick(slot: WallpaperSlot, file: File) {
    setUploadingSlot(slot)
    try {
      setWallpaper(slot, await fileToWallpaperDataUrl(file))
    } catch {
      /* file non leggibile: ignora */
    } finally {
      setUploadingSlot(null)
    }
  }

  const updateCount = useMemo(
    () => Object.values(entities).filter((e) => e.entity_id.startsWith('update.') && e.state === 'on').length,
    [entities]
  )

  const can = (cap: string) => canModify(cap, isAdmin, permissions)
  const anyEditable = CAPABILITIES.some((c) => can(c.key))

  function handleReset() {
    clearToken()
    resetSetup()
    window.location.reload()
  }

  return (
    <div className="page">
      <div style={{ marginBottom: 'var(--space-xl)' }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 34,
            fontWeight: 800,
            color: 'var(--on-wallpaper)',
            letterSpacing: '-0.04em',
          }}
        >
          Impostazioni
        </h1>
      </div>

      <MasonryColumns rowGap="var(--space-lg)">

        {/* Connessione */}
        <Section title="Connessione">
          <SettingRow label="Home Assistant URL">
            <span style={{ fontSize: 13, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
              {hassUrl || 'Non configurato'}
            </span>
          </SettingRow>
        </Section>

        {/* Sistema — solo amministratori */}
        {isAdmin && (
          <div>
            <div className="text-caption" style={{ marginBottom: 10 }}>Sistema</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowUpdates(true)}
                className="glass-panel"
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  padding: 'var(--space-md) var(--space-lg)',
                  display: 'flex', alignItems: 'center', gap: 14,
                }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, background: 'var(--accent-glow)', border: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                  <RefreshCw size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Aggiornamenti</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginTop: 2 }}>
                    {updateCount > 0 ? `${updateCount} ${updateCount === 1 ? 'disponibile' : 'disponibili'}` : 'Tutto aggiornato'}
                  </div>
                </div>
                {updateCount > 0 && (
                  <span style={{ flexShrink: 0, minWidth: 22, height: 22, padding: '0 7px', borderRadius: 11, background: '#ff5a5f', color: 'white', fontSize: 12, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    {updateCount}
                  </span>
                )}
                <ChevronRight size={18} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
              </motion.button>

              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={() => setShowServer(true)}
                className="glass-panel"
                style={{
                  width: '100%', textAlign: 'left', cursor: 'pointer',
                  padding: 'var(--space-md) var(--space-lg)',
                  display: 'flex', alignItems: 'center', gap: 14,
                }}
              >
                <div style={{ width: 40, height: 40, borderRadius: 12, flexShrink: 0, background: 'var(--accent-glow)', border: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
                  <Server size={20} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>Informazioni server</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', marginTop: 2 }}>CPU, memoria, disco, rete e sensori</div>
                </div>
                <ChevronRight size={18} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
              </motion.button>
            </div>
          </div>
        )}

        {/* Plancia a schermo intero — solo amministratori */}
        {isAdmin && <FullscreenDashboardSetup />}

        {/* Permessi utenti — solo amministratori */}
        {isAdmin && <PermissionsPanel />}

        {/* Avviso per utenti non-admin con impostazioni limitate */}
        {!isAdmin && !anyEditable && (
          <div className="glass-panel" style={{ padding: 'var(--space-lg)', color: 'var(--text-secondary)', fontSize: 13.5, lineHeight: 1.5 }}>
            L'amministratore ha limitato le impostazioni modificabili. Contattalo per eventuali modifiche.
          </div>
        )}

        {/* Assegna stanze */}
        {can('rooms') && (
          <Section title="Assegna stanze">
            <RoomAssigner />
          </Section>
        )}

        {/* Stanze visibili — config casa, solo admin */}
        {isAdmin && <AreaVisibilitySettings />}

        {/* Visibilità dispositivi */}
        {can('visibility') && (
          <div>
            <div className="text-caption" style={{ marginBottom: 10 }}>Visibilità dispositivi</div>
            <VisibilityStepper />
          </div>
        )}

        {/* Meteo e calendario — config casa, solo admin */}
        {isAdmin && <WeatherCalendarSettings />}

        {/* Elettricità — config casa, solo admin */}
        {isAdmin && <EnergySettings />}

        {/* Raccolta rifiuti — config casa, solo admin */}
        {isAdmin && <WasteSettings />}

        {/* Tema */}
        {can('appearance') && (
        <Section title="Aspetto">
          <SettingRow label="Tema">
            <div style={{ display: 'flex', gap: 8 }}>
              {([
                { value: 'auto', icon: <Sparkles size={14} />, label: 'Auto' },
                { value: 'light', icon: <Sun size={14} />, label: 'Chiaro' },
                { value: 'dark', icon: <Moon size={14} />, label: 'Scuro' },
              ] as const).map(({ value, icon, label }) => {
                const isActive = theme.mode === value
                return (
                  <motion.button
                    key={value}
                    whileTap={{ scale: 0.9 }}
                    onClick={() => setTheme({ mode: value })}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '6px 12px',
                      borderRadius: 'var(--radius-pill)',
                      border: isActive ? '1px solid var(--accent)' : '1px solid var(--glass-border)',
                      background: isActive ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.05)',
                      color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                      fontSize: 12,
                      fontWeight: isActive ? 700 : 500,
                      cursor: 'pointer',
                    }}
                  >
                    {icon}
                    {label}
                  </motion.button>
                )
              })}
            </div>
          </SettingRow>

          <SettingRow label={`Effetto vetro — ${Math.round(theme.glassIntensity * 100)}%`}>
            <input
              type="range"
              className="glass-slider"
              min={20}
              max={100}
              value={Math.round(theme.glassIntensity * 100)}
              onChange={(e) => setTheme({ glassIntensity: Number(e.target.value) / 100 })}
              style={{
                width: 120,
                background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${theme.glassIntensity * 100}%, rgba(255,255,255,0.2) ${theme.glassIntensity * 100}%, rgba(255,255,255,0.2) 100%)`,
              }}
            />
          </SettingRow>

          <SettingRow label="Colori automatici dal wallpaper">
            <label className="glass-toggle">
              <input
                type="checkbox"
                checked={theme.autoAccent}
                onChange={(e) => setTheme({ autoAccent: e.target.checked })}
              />
              <div className="glass-toggle-track" />
              <div className="glass-toggle-thumb" style={{ transform: theme.autoAccent ? 'translateX(20px)' : 'translateX(0)' }} />
            </label>
          </SettingRow>
        </Section>
        )}

        {/* Sfondi */}
        {can('wallpapers') && (
        <Section title="Sfondi per ora del giorno">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {WALLPAPER_SLOTS.map(({ slot, label, hours }) => {
              const currentWp = wallpapers[slot]
              return (
                <div
                  key={slot}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 0',
                    borderBottom: '1px solid var(--glass-border-dim)',
                  }}
                >
                  {currentWp && (
                    <div
                      style={{
                        width: 48,
                        height: 32,
                        borderRadius: 8,
                        backgroundImage: `url(${currentWp})`,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        flexShrink: 0,
                        border: '1px solid var(--glass-border)',
                      }}
                    />
                  )}
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>{label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{hours}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <label style={{ cursor: 'pointer' }}>
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: 'none' }}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) void handleWallpaperPick(slot, file)
                          e.target.value = '' // consenti di ricaricare lo stesso file
                        }}
                      />
                      <div
                        style={{
                          padding: '6px 12px',
                          borderRadius: 'var(--radius-pill)',
                          background: 'rgba(255,255,255,0.08)',
                          border: '1px solid var(--glass-border)',
                          color: 'var(--text-secondary)',
                          fontSize: 12,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          cursor: 'pointer',
                          opacity: uploadingSlot === slot ? 0.6 : 1,
                        }}
                      >
                        <Upload size={12} />
                        {uploadingSlot === slot ? 'Carico…' : currentWp ? 'Cambia' : 'Carica'}
                      </div>
                    </label>
                    {currentWp && (
                      <motion.button
                        whileTap={{ scale: 0.85 }}
                        onClick={() => setWallpaper(slot, null)}
                        style={{
                          padding: '6px',
                          borderRadius: 'var(--radius-pill)',
                          background: 'rgba(239,83,80,0.12)',
                          border: '1px solid rgba(239,83,80,0.25)',
                          color: '#ef5350',
                          display: 'flex',
                          alignItems: 'center',
                          cursor: 'pointer',
                        }}
                      >
                        <Trash2 size={12} />
                      </motion.button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Section>
        )}

        {/* Info */}
        <Section title="Informazioni">
          <SettingRow label="Versione">
            <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>1.39.0</span>
          </SettingRow>
          <SettingRow label="Progetto">
            <span style={{ fontSize: 13, color: 'var(--text-tertiary)' }}>Liquid Dashboard</span>
          </SettingRow>
        </Section>

        {/* Reset */}
        {can('reset') && (
        <Section title="Reset">
          {!showResetConfirm ? (
            <motion.button
              whileTap={{ scale: 0.97 }}
              onClick={() => setShowResetConfirm(true)}
              style={{
                width: '100%',
                padding: '14px',
                borderRadius: 'var(--radius-md)',
                background: 'rgba(239,83,80,0.1)',
                border: '1px solid rgba(239,83,80,0.25)',
                color: '#ef5350',
                fontSize: 15,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <RefreshCw size={16} />
              Riconfigura dashboard
            </motion.button>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ fontSize: 14, color: 'var(--text-secondary)', textAlign: 'center' }}>
                Sei sicuro? Perderai tutte le impostazioni.
              </p>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  onClick={() => setShowResetConfirm(false)}
                  className="glass-btn"
                  style={{ flex: 1 }}
                >
                  Annulla
                </button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={handleReset}
                  style={{
                    flex: 1,
                    padding: '14px',
                    borderRadius: 'var(--radius-pill)',
                    background: '#ef5350',
                    border: 'none',
                    color: 'white',
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  Reset
                </motion.button>
              </div>
            </div>
          )}
        </Section>
        )}
      </MasonryColumns>

      <AnimatePresence>
        {showServer && <ServerPage onBack={() => setShowServer(false)} />}
        {showUpdates && <UpdatesPage onBack={() => setShowUpdates(false)} />}
      </AnimatePresence>
    </div>
  )
}

function apiBaseUrl(): string {
  const { origin, pathname } = window.location
  const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname.replace(/\/[^/]*$/, '')
  return origin + base
}

function AreaVisibilitySettings() {
  const areas = useStore((s) => s.areas)
  const enabledAreas = useStore((s) => s.enabledAreas)
  const setEnabledAreas = useStore((s) => s.setEnabledAreas)

  if (areas.length === 0) return null
  const allIds = areas.map((a) => a.area_id)
  const shown = (id: string) => enabledAreas.length === 0 || enabledAreas.includes(id)

  const toggle = (id: string) => {
    let next: string[]
    if (enabledAreas.length === 0) next = allIds.filter((x) => x !== id) // tutte visibili → nascondi questa
    else if (enabledAreas.includes(id)) next = enabledAreas.filter((x) => x !== id)
    else next = [...enabledAreas, id]
    if (allIds.every((x) => next.includes(x))) next = [] // tutte visibili → stato pulito
    setEnabledAreas(next)
  }

  const sorted = [...areas].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div>
      <div className="text-caption" style={{ marginBottom: 10 }}>Stanze visibili</div>
      <div className="glass-panel" style={{ padding: 'var(--space-md) var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', paddingBottom: 4, lineHeight: 1.5 }}>
          Spegni le stanze che non vuoi mostrare nella dashboard.
        </div>
        {sorted.map((a) => (
          <div key={a.area_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--glass-border-dim)' }}>
            <span style={{ fontSize: 15, color: 'var(--text-primary)' }}>{a.name}</span>
            <Toggle checked={shown(a.area_id)} onChange={() => toggle(a.area_id)} />
          </div>
        ))}
      </div>
    </div>
  )
}

function FullscreenDashboardSetup() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')
  const [exists, setExists] = useState<boolean | null>(null)

  // All'avvio verifica se la plancia esiste già: il tasto compare solo se manca
  useEffect(() => {
    fetch(apiBaseUrl() + '/api/dashboard-status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setExists(d ? Boolean(d.exists) : null))
      .catch(() => setExists(null))
  }, [])

  const create = async () => {
    setStatus('loading')
    try {
      const r = await fetch(apiBaseUrl() + '/api/create-dashboard', { method: 'POST' })
      const d = await r.json().catch(() => null)
      if (r.ok && d?.ok) { setStatus('ok'); setMsg('Dashboard "Casa" creata.'); setExists(true) }
      else { setStatus('err'); setMsg(d?.error || 'Errore nella creazione') }
    } catch {
      setStatus('err'); setMsg('Server non raggiungibile')
    }
  }

  const configured = exists === true

  return (
    <div>
      <div className="text-caption" style={{ marginBottom: 10 }}>Plancia a schermo intero</div>
      <div className="glass-panel" style={{ padding: 'var(--space-md) var(--space-lg)' }}>
        {configured ? (
          <div style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>✓</span>
            <span>Plancia <b>Casa</b> configurata. {status === 'ok' ? <>Impostala dal tuo <b>Profilo → Dashboard predefinita → Casa</b>.</> : 'Si apre a tutto schermo dal pannello «Casa».'}</span>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>
              La plancia a schermo intero non risulta configurata. Creane una che apre la Liquid Dashboard a tutto schermo,
              poi impostala come predefinita dal tuo profilo.
            </p>
            <button
              onClick={create}
              disabled={status === 'loading'}
              className="glass-btn glass-btn-accent"
              style={{ width: '100%', opacity: status === 'loading' ? 0.7 : 1 }}
            >
              {status === 'loading' ? 'Creazione…' : 'Crea dashboard «Casa»'}
            </button>
            {status === 'err' && <div style={{ marginTop: 12, fontSize: 13, color: '#ff8f8f' }}>{msg}</div>}
          </>
        )}
      </div>
    </div>
  )
}

function PermissionsPanel() {
  const permissions = useStore((s) => s.userPermissions)
  const setUserPermissions = useStore((s) => s.setUserPermissions)
  const [saving, setSaving] = useState(false)

  const toggle = async (key: string, value: boolean) => {
    const next = { ...permissions, [key]: value }
    setUserPermissions(next) // aggiornamento ottimistico
    setSaving(true)
    const saved = await savePermissions(next)
    if (saved) setUserPermissions(saved)
    setSaving(false)
  }

  return (
    <div>
      <div className="text-caption" style={{ marginBottom: 10 }}>Permessi utenti</div>
      <div className="glass-panel" style={{ padding: 'var(--space-md) var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 0 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-tertiary)', paddingBottom: 4, lineHeight: 1.5 }}>
          Scegli cosa possono modificare gli utenti <b>non amministratori</b>. Vale per tutti i dispositivi.
        </div>
        {CAPABILITIES.map((c) => (
          <div key={c.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--glass-border-dim)' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, color: 'var(--text-primary)' }}>{c.label}</div>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{c.desc}</div>
            </div>
            <Toggle checked={permissions[c.key] !== false} onChange={(v) => toggle(c.key, v)} />
          </div>
        ))}
        <div style={{ fontSize: 11.5, color: saving ? 'var(--accent)' : 'var(--text-tertiary)', paddingTop: 8 }}>
          {saving ? 'Salvataggio…' : 'Le modifiche sono immediate.'}
        </div>
      </div>
    </div>
  )
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (b: boolean) => void }) {
  return (
    <label className="glass-toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <div className="glass-toggle-track" />
      <div className="glass-toggle-thumb" style={{ transform: checked ? 'translateX(20px)' : 'translateX(0)' }} />
    </label>
  )
}

function WeatherCalendarSettings() {
  const entities = useStore((s) => s.entities)
  const weatherEnabled = useStore((s) => s.weatherEnabled)
  const setWeatherEnabled = useStore((s) => s.setWeatherEnabled)
  const weatherEntity = useStore((s) => s.weatherEntity)
  const setWeatherEntity = useStore((s) => s.setWeatherEntity)
  const externalTempSource = useStore((s) => s.externalTempSource)
  const setExternalTempSource = useStore((s) => s.setExternalTempSource)
  const calendarEnabled = useStore((s) => s.calendarEnabled)
  const setCalendarEnabled = useStore((s) => s.setCalendarEnabled)
  const calendarEntities = useStore((s) => s.calendarEntities)
  const toggleCalendarEntity = useStore((s) => s.toggleCalendarEntity)

  const weatherList = useMemo(
    () => Object.values(entities).filter((e) => getDomain(e.entity_id) === 'weather'),
    [entities]
  )
  const tempSensors = useMemo(
    () =>
      Object.values(entities)
        .filter((e) => getDomain(e.entity_id) === 'sensor' && (e.attributes as Record<string, unknown>).device_class === 'temperature')
        .sort((a, b) => entityName(a).localeCompare(entityName(b))),
    [entities]
  )
  const calendarList = useMemo(
    () => Object.values(entities).filter((e) => getDomain(e.entity_id) === 'calendar'),
    [entities]
  )

  if (weatherList.length === 0 && calendarList.length === 0) return null

  return (
    <Section title="Meteo e calendario">
      {weatherList.length > 0 && (
        <>
          <SettingRow label="Mostra meteo">
            <Toggle checked={weatherEnabled} onChange={setWeatherEnabled} />
          </SettingRow>
          {weatherEnabled && (
            <>
              <SettingRow label="Servizio meteo">
                <select
                  className="ld-select"
                  value={weatherEntity ?? ''}
                  onChange={(e) => setWeatherEntity(e.target.value || null)}
                >
                  <option value="">Automatico</option>
                  {weatherList.map((w) => (
                    <option key={w.entity_id} value={w.entity_id}>{entityName(w)}</option>
                  ))}
                </select>
              </SettingRow>
              <SettingRow label="Temperatura esterna">
                <select
                  className="ld-select"
                  value={externalTempSource}
                  onChange={(e) => setExternalTempSource(e.target.value)}
                >
                  <option value="weather">Dal meteo</option>
                  {tempSensors.map((s) => (
                    <option key={s.entity_id} value={s.entity_id}>{entityName(s)}</option>
                  ))}
                </select>
              </SettingRow>
            </>
          )}
        </>
      )}

      {calendarList.length > 0 && (
        <>
          <SettingRow label="Mostra calendario">
            <Toggle checked={calendarEnabled} onChange={setCalendarEnabled} />
          </SettingRow>
          {calendarEnabled && (
            <div style={{ padding: '12px 0' }}>
              <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 10 }}>
                Calendari {calendarEntities.length === 0 ? '(tutti)' : `(${calendarEntities.length} selezionati)`}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {calendarList.map((c) => {
                  const active = calendarEntities.length === 0 || calendarEntities.includes(c.entity_id)
                  return (
                    <button
                      key={c.entity_id}
                      onClick={() => toggleCalendarEntity(c.entity_id)}
                      style={{
                        padding: '6px 14px',
                        borderRadius: 'var(--radius-pill)',
                        border: active ? '1px solid var(--accent)' : '1px solid var(--glass-border)',
                        background: active ? 'var(--accent-glow)' : 'rgba(0,0,0,0.04)',
                        color: active ? 'var(--accent)' : 'var(--text-secondary)',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {entityName(c)}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </Section>
  )
}

function WasteSettings() {
  const wasteEnabled = useStore((s) => s.wasteEnabled)
  const setWasteEnabled = useStore((s) => s.setWasteEnabled)
  const wasteSchedule = useStore((s) => s.wasteSchedule)
  const toggleWasteDay = useStore((s) => s.toggleWasteDay)
  const wasteInterval = useStore((s) => s.wasteInterval)
  const setWasteInterval = useStore((s) => s.setWasteInterval)
  const wasteAnchor = useStore((s) => s.wasteAnchor)
  const setWasteAnchor = useStore((s) => s.setWasteAnchor)

  return (
    <Section title="Raccolta rifiuti">
      <SettingRow label="Mostra promemoria rifiuti">
        <Toggle checked={wasteEnabled} onChange={setWasteEnabled} />
      </SettingRow>
      {wasteEnabled && (
        <div style={{ paddingTop: 6 }}>
          {WASTE_TYPES.map((t) => {
            const days = wasteSchedule[t.id] ?? []
            const interval = wasteInterval[t.id] ?? 1
            const anchor = wasteAnchor[t.id] ?? ''
            const Icon = t.Icon
            return (
              <div key={t.id} style={{ padding: '12px 0', borderBottom: '1px solid var(--glass-border-dim)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <Icon size={16} color={t.color} />
                  <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{t.label}</span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {WEEKDAY_ORDER.map((d) => {
                    const on = days.includes(d)
                    return (
                      <button
                        key={d}
                        onClick={() => toggleWasteDay(t.id, d)}
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: '50%',
                          border: on ? `1px solid ${t.color}` : '1px solid var(--glass-border)',
                          background: on ? t.color : 'transparent',
                          color: on ? '#fff' : 'var(--text-secondary)',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {WEEKDAY_INITIALS[d]}
                      </button>
                    )
                  })}
                </div>

                {days.length > 0 && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
                    <select
                      className="ld-select"
                      value={interval}
                      onChange={(e) => setWasteInterval(t.id, Number(e.target.value))}
                    >
                      {INTERVAL_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    {interval > 1 && (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                        1ª raccolta
                        <input
                          type="date"
                          value={anchor}
                          onChange={(e) => setWasteAnchor(t.id, e.target.value)}
                          style={{
                            background: 'var(--glass-bg)',
                            border: '1px solid var(--glass-border)',
                            borderRadius: 'var(--radius-pill)',
                            color: 'var(--text-primary)',
                            fontSize: 13,
                            padding: '7px 12px',
                            outline: 'none',
                          }}
                        />
                      </label>
                    )}
                  </div>
                )}
                {interval > 1 && !anchor && (
                  <div style={{ fontSize: 11, color: '#ffb300', marginTop: 6 }}>
                    Imposta la data di una raccolta per calcolare le settimane.
                  </div>
                )}
              </div>
            )
          })}
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 10 }}>
            Seleziona i giorni di raccolta. La sera prima vedrai il promemoria "Esponi stasera" nella Home.
          </div>
        </div>
      )}
    </Section>
  )
}

function EnergySettings() {
  const entities = useStore((s) => s.entities)
  const energyEnabled = useStore((s) => s.energyEnabled)
  const setEnergyEnabled = useStore((s) => s.setEnergyEnabled)
  const energyPowerEntity = useStore((s) => s.energyPowerEntity)
  const setEnergyPowerEntity = useStore((s) => s.setEnergyPowerEntity)

  const powerSensors = useMemo(
    () =>
      Object.values(entities)
        .filter((e) => getDomain(e.entity_id) === 'sensor' && (e.attributes as Record<string, unknown>).device_class === 'power')
        .sort((a, b) => entityName(a).localeCompare(entityName(b))),
    [entities]
  )

  return (
    <Section title="Elettricità">
      <SettingRow label="Mostra consumi elettrici">
        <Toggle checked={energyEnabled} onChange={setEnergyEnabled} />
      </SettingRow>
      {energyEnabled && powerSensors.length > 0 && (
        <SettingRow label="Consumo istantaneo">
          <select
            className="ld-select"
            value={energyPowerEntity ?? ''}
            onChange={(e) => setEnergyPowerEntity(e.target.value || null)}
          >
            <option value="">Automatico</option>
            {powerSensors.map((s) => (
              <option key={s.entity_id} value={s.entity_id}>{entityName(s)}</option>
            ))}
          </select>
        </SettingRow>
      )}
      <div style={{ fontSize: 12, color: 'var(--text-tertiary)', paddingTop: 10 }}>
        L'energia (kWh/costi) proviene dalla dashboard Energia di HA. Il "consumo istantaneo" usa un sensore di potenza (W).
      </div>
    </Section>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-caption" style={{ marginBottom: 10 }}>{title}</div>
      <div
        className="glass-panel"
        style={{ padding: 'var(--space-md) var(--space-lg)', display: 'flex', flexDirection: 'column', gap: 0 }}
      >
        {children}
      </div>
    </div>
  )
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 0',
        borderBottom: '1px solid var(--glass-border-dim)',
      }}
    >
      <span style={{ fontSize: 15, color: 'var(--text-primary)', flex: 1 }}>{label}</span>
      {children}
    </div>
  )
}
