import { useCallback, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sun, Minus, Plus } from 'lucide-react'
import { GlassCard } from '../glass/GlassCard'
import { useHA } from '../../hooks/useHA'
import type { HassEntity, LightAttributes } from '../../types/ha'

interface LightCardProps {
  entity: HassEntity
  compact?: boolean
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * color).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

function hsColorToCss(hsColor: [number, number] | undefined): string | null {
  if (!hsColor) return null
  const [h, s] = hsColor
  return hslToHex(h, s, 55)
}

function brightnessToPercent(b: number | undefined): number {
  if (b === undefined) return 100
  return Math.round((b / 255) * 100)
}

function percentToBrightness(p: number): number {
  return Math.round((p / 100) * 255)
}

export function LightCard({ entity, compact }: LightCardProps) {
  const { callService } = useHA()
  const attrs = entity.attributes as LightAttributes
  const isOn = entity.state === 'on'
  const brightness = brightnessToPercent(attrs.brightness)
  const colorCss = hsColorToCss(attrs.hs_color) ?? (isOn ? '#fff5cc' : null)
  const name = attrs.friendly_name ?? entity.entity_id

  const [showColorPicker, setShowColorPicker] = useState(false)

  const glowColor = useMemo(
    () => (isOn && colorCss ? `${colorCss}55` : undefined),
    [isOn, colorCss]
  )

  const toggle = useCallback(() => {
    callService('light', isOn ? 'turn_off' : 'turn_on', {
      entity_id: entity.entity_id,
    })
  }, [callService, entity.entity_id, isOn])

  const setBrightness = useCallback(
    (val: number) => {
      callService('light', 'turn_on', {
        entity_id: entity.entity_id,
        brightness: percentToBrightness(val),
      })
    },
    [callService, entity.entity_id]
  )

  const setHue = useCallback(
    (hue: number) => {
      callService('light', 'turn_on', {
        entity_id: entity.entity_id,
        hs_color: [hue, 80],
      })
    },
    [callService, entity.entity_id]
  )

  if (compact) {
    return (
      <GlassCard
        glowColor={glowColor}
        active={isOn}
        size="sm"
        style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
        onClick={toggle}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: isOn ? (colorCss ?? 'var(--accent)') : 'rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background 0.3s ease',
            boxShadow: isOn ? `0 0 12px ${colorCss ?? 'var(--accent-glow)'}` : 'none',
            flexShrink: 0,
          }}
        >
          <Sun size={18} color={isOn ? '#fff' : 'var(--text-secondary)'} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {name}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>
            {isOn ? `${brightness}%` : 'Spenta'}
          </div>
        </div>
        <ToggleSwitch isOn={isOn} onToggle={toggle} color={colorCss} />
      </GlassCard>
    )
  }

  return (
    <GlassCard glowColor={glowColor} active={isOn} size="md">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-md)' }}>
        <div>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 14,
              background: isOn ? (colorCss ?? 'var(--accent)') : 'rgba(255,255,255,0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 10,
              transition: 'background 0.4s ease',
              boxShadow: isOn ? `0 0 20px ${colorCss ?? 'var(--accent-glow)'}` : 'none',
            }}
          >
            <Sun size={22} color={isOn ? '#fff' : 'var(--text-secondary)'} />
          </div>
          <div style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>
            {name}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
            {isOn ? `Accesa · ${brightness}%` : 'Spenta'}
          </div>
        </div>
        <ToggleSwitch isOn={isOn} onToggle={toggle} color={colorCss} />
      </div>

      {/* Brightness slider */}
      <AnimatePresence>
        {isOn && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ marginBottom: 'var(--space-md)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <Minus size={14} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
                <div style={{ position: 'relative', flex: 1 }}>
                  <input
                    type="range"
                    className="glass-slider"
                    min={5}
                    max={100}
                    value={brightness}
                    onChange={(e) => setBrightness(Number(e.target.value))}
                    style={{
                      background: `linear-gradient(to right, ${colorCss ?? 'var(--accent)'} 0%, ${colorCss ?? 'var(--accent)'} ${brightness}%, rgba(255,255,255,0.2) ${brightness}%, rgba(255,255,255,0.2) 100%)`,
                    }}
                  />
                </div>
                <Plus size={14} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
              </div>
            </div>

            {/* Color picker — solo se supportato */}
            {attrs.hs_color !== undefined && (
              <div>
                <button
                  onClick={() => setShowColorPicker(!showColorPicker)}
                  style={{
                    background: 'rgba(255,255,255,0.08)',
                    border: '1px solid var(--glass-border)',
                    borderRadius: 'var(--radius-pill)',
                    color: 'var(--text-secondary)',
                    fontSize: 12,
                    fontWeight: 600,
                    padding: '6px 14px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: colorCss ?? '#fff' }} />
                  Colore
                </button>

                <AnimatePresence>
                  {showColorPicker && (
                    <motion.div
                      initial={{ opacity: 0, scaleY: 0.8 }}
                      animate={{ opacity: 1, scaleY: 1 }}
                      exit={{ opacity: 0, scaleY: 0.8 }}
                      style={{ marginTop: 10, transformOrigin: 'top' }}
                    >
                      <ColorRing onSelect={setHue} currentHue={attrs.hs_color?.[0]} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  )
}

function ToggleSwitch({ isOn, onToggle, color }: { isOn: boolean; onToggle: () => void; color: string | null }) {
  return (
    <label className="glass-toggle" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" checked={isOn} onChange={onToggle} />
      <div
        className="glass-toggle-track"
        style={isOn && color ? { background: color, borderColor: 'transparent', boxShadow: `0 0 12px ${color}88` } : {}}
      />
      <div className="glass-toggle-thumb" style={{ transform: isOn ? 'translateX(20px)' : 'translateX(0)' }} />
    </label>
  )
}

const COLOR_HUES = [0, 30, 60, 120, 180, 200, 240, 280, 320, 360]

function ColorRing({ onSelect, currentHue }: { onSelect: (h: number) => void; currentHue?: number }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {COLOR_HUES.map((hue) => (
        <motion.button
          key={hue}
          whileTap={{ scale: 0.85 }}
          onClick={() => onSelect(hue)}
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            background: `hsl(${hue}, 80%, 55%)`,
            border: currentHue !== undefined && Math.abs(currentHue - hue) < 20
              ? '2px solid white'
              : '2px solid transparent',
            cursor: 'pointer',
            boxShadow: `0 2px 8px hsla(${hue}, 80%, 55%, 0.5)`,
          }}
        />
      ))}
    </div>
  )
}
