import { useCallback, useState } from 'react'
import { motion } from 'framer-motion'
import { Sun, Moon, Sunset, CloudMoon, Upload, Sparkles } from 'lucide-react'
import { useStore } from '../../store'
import type { WallpaperSlot, ThemeConfig } from '../../store'

interface ThemeStepProps {
  onDone: () => void
}

const WALLPAPER_SLOTS: Array<{ slot: WallpaperSlot; label: string; icon: React.ReactNode; hours: string; gradient: string }> = [
  { slot: 'morning', label: 'Mattina', icon: <Sun size={18} />, hours: '06–11', gradient: 'linear-gradient(135deg, #ff9a6c, #ffd89b)' },
  { slot: 'day', label: 'Giorno', icon: <Sun size={18} />, hours: '11–18', gradient: 'linear-gradient(135deg, #4facfe, #a8edea)' },
  { slot: 'evening', label: 'Sera', icon: <Sunset size={18} />, hours: '18–22', gradient: 'linear-gradient(135deg, #f7971e, #c54b8c)' },
  { slot: 'night', label: 'Notte', icon: <CloudMoon size={18} />, hours: '22–06', gradient: 'linear-gradient(135deg, #0c0c1e, #1a3a6e)' },
]

const THEME_MODES = [
  { value: 'auto' as const, label: 'Auto', icon: <Sparkles size={16} /> },
  { value: 'light' as const, label: 'Chiaro', icon: <Sun size={16} /> },
  { value: 'dark' as const, label: 'Scuro', icon: <Moon size={16} /> },
]

export function ThemeStep({ onDone }: ThemeStepProps) {
  const wallpapers = useStore((s) => s.wallpapers)
  const theme = useStore((s) => s.theme)
  const setWallpaper = useStore((s) => s.setWallpaper)
  const setTheme = useStore((s) => s.setTheme)
  const completeSetup = useStore((s) => s.completeSetup)

  const [previews, setPreviews] = useState<Record<string, string>>({})

  const handleFileUpload = useCallback(
    (slot: WallpaperSlot, file: File) => {
      const url = URL.createObjectURL(file)
      setPreviews((p) => ({ ...p, [slot]: url }))
      setWallpaper(slot, url)
    },
    [setWallpaper]
  )

  function handleDone() {
    completeSetup()
    onDone()
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xl)' }}
    >
      <div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginBottom: 8 }}>
          Personalizza il look
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
          Opzionale — puoi farlo anche dopo dalle impostazioni.
        </p>
      </div>

      {/* Tema chiaro/scuro */}
      <div>
        <div className="text-caption" style={{ marginBottom: 12 }}>Tema</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {THEME_MODES.map(({ value, label, icon }) => {
            const isActive = theme.mode === value
            return (
              <motion.button
                key={value}
                whileTap={{ scale: 0.93 }}
                onClick={() => setTheme({ mode: value })}
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 6,
                  padding: '12px 8px',
                  borderRadius: 'var(--radius-md)',
                  border: isActive ? '1px solid var(--accent)' : '1px solid var(--glass-border)',
                  background: isActive ? 'rgba(var(--accent-hue), var(--accent-sat), var(--accent-lit), 0.15)' : 'var(--glass-bg)',
                  cursor: 'pointer',
                  color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  transition: 'all 0.2s ease',
                }}
              >
                {icon}
                {label}
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* Intensità vetro */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div className="text-caption">Effetto vetro</div>
          <div style={{ fontSize: 13, color: 'var(--accent)', fontWeight: 700 }}>
            {Math.round(theme.glassIntensity * 100)}%
          </div>
        </div>
        <input
          type="range"
          className="glass-slider"
          min={20}
          max={100}
          value={Math.round(theme.glassIntensity * 100)}
          onChange={(e) => setTheme({ glassIntensity: Number(e.target.value) / 100 })}
          style={{
            background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${theme.glassIntensity * 100}%, rgba(255,255,255,0.2) ${theme.glassIntensity * 100}%, rgba(255,255,255,0.2) 100%)`,
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 11, color: 'var(--text-tertiary)' }}>
          <span>Trasparente</span>
          <span>Opaco</span>
        </div>
      </div>

      {/* Wallpaper per ora */}
      <div>
        <div className="text-caption" style={{ marginBottom: 12 }}>Sfondi per ora del giorno</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
          {WALLPAPER_SLOTS.map(({ slot, label, icon, hours, gradient }) => {
            const preview = previews[slot] ?? wallpapers[slot]
            return (
              <label
                key={slot}
                style={{ cursor: 'pointer', display: 'block' }}
              >
                <input
                  type="file"
                  accept="image/*"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleFileUpload(slot, file)
                  }}
                />
                <motion.div
                  whileTap={{ scale: 0.95 }}
                  style={{
                    borderRadius: 'var(--radius-md)',
                    overflow: 'hidden',
                    border: preview ? '1px solid var(--accent)' : '1px dashed var(--glass-border)',
                    position: 'relative',
                    aspectRatio: '16/9',
                    background: preview ? `url(${preview}) center/cover` : gradient,
                  }}
                >
                  {!preview && (
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, background: 'rgba(0,0,0,0.2)' }}>
                      <Upload size={18} color="white" />
                      <span style={{ fontSize: 11, color: 'white', fontWeight: 600 }}>Carica foto</span>
                    </div>
                  )}
                  <div
                    style={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
                      padding: '16px 10px 8px',
                      display: 'flex',
                      alignItems: 'flex-end',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: 'white' }}>
                      {icon}
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
                    </div>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{hours}</span>
                  </div>
                </motion.div>
              </label>
            )
          })}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 8, lineHeight: 1.5 }}>
          Se non carichi immagini, verranno usati gradienti automatici.
        </p>
      </div>

      <motion.button
        className="glass-btn glass-btn-accent"
        whileTap={{ scale: 0.97 }}
        onClick={handleDone}
        style={{ width: '100%' }}
      >
        Inizia a usare la dashboard
      </motion.button>
    </motion.div>
  )
}
