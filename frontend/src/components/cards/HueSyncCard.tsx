import { useMemo, useRef, useState } from 'react'
import { Tv, Sparkles, Sun } from 'lucide-react'
import { useStore } from '../../store'
import { useHA } from '../../hooks/useHA'
import type { HassEntity } from '../../types/ha'

// Philips Hue Play HDMI Sync Box (integrazione huesyncbox):
//  switch.<x>_power, switch.<x>_light_sync, select.<x>_hdmi_input, number.<x>_brightness

function num(e?: HassEntity): number | null {
  if (!e) return null
  const n = parseFloat(e.state)
  return Number.isFinite(n) ? n : null
}

export function HueSyncSection({ areaEntities }: { areaEntities: HassEntity[] }) {
  const entities = useStore((s) => s.entities)

  const box = useMemo(() => {
    const hdmi = areaEntities.find((e) => e.entity_id.startsWith('select.') && e.entity_id.endsWith('_hdmi_input'))
    if (!hdmi) return null
    const base = hdmi.entity_id.slice('select.'.length, -'_hdmi_input'.length) // es. sync_box
    return {
      hdmi,
      power: entities[`switch.${base}_power`],
      lightSync: entities[`switch.${base}_light_sync`],
      brightness: entities[`number.${base}_brightness`],
      base,
    }
  }, [areaEntities, entities])

  if (!box) return null

  return (
    <div>
      <div className="text-caption" style={{ marginBottom: 10 }}>Sincronizzazione luci</div>
      <HueSyncCard box={box} />
    </div>
  )
}

interface Box {
  hdmi: HassEntity
  power?: HassEntity
  lightSync?: HassEntity
  brightness?: HassEntity
  base: string
}

function HueSyncCard({ box }: { box: Box }) {
  const { callService } = useHA()
  const powerOn = box.power?.state === 'on'
  const syncOn = box.lightSync?.state === 'on'
  const options = (box.hdmi.attributes.options as string[] | undefined) ?? []
  const activeInput = box.hdmi.state

  // Slider luminosità con commit debounced
  const [localBright, setLocalBright] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bAttr = box.brightness?.attributes as Record<string, unknown> | undefined
  const bMin = (bAttr?.min as number) ?? 0
  const bMax = (bAttr?.max as number) ?? 200
  const bStep = (bAttr?.step as number) ?? 1
  const brightVal = localBright ?? num(box.brightness) ?? bMin

  const setBright = (v: number) => {
    setLocalBright(v)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      callService('number', 'set_value', { entity_id: box.brightness!.entity_id, value: v })
    }, 250)
  }

  const togglePower = () => box.power && callService('switch', powerOn ? 'turn_off' : 'turn_on', { entity_id: box.power.entity_id })
  const toggleSync = () => box.lightSync && callService('switch', syncOn ? 'turn_off' : 'turn_on', { entity_id: box.lightSync.entity_id })
  const setInput = (opt: string) => callService('select', 'select_option', { entity_id: box.hdmi.entity_id, option: opt })

  return (
    <div className="glass-card" style={{ padding: 'var(--space-md)' }}>
      {/* Header + power */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12, flexShrink: 0,
          background: powerOn ? 'var(--accent-glow)' : 'var(--glass-bg-active)',
          border: '1px solid var(--glass-border)', color: powerOn ? 'var(--accent)' : 'var(--text-secondary)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: powerOn ? '0 0 20px var(--accent-glow)' : 'none',
        }}>
          <Tv size={21} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Hue Play</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>{powerOn ? (syncOn ? 'Sincronizzazione attiva' : 'Acceso') : 'Spento'}</div>
        </div>
        {box.power && (
          <label className="glass-toggle" style={{ flexShrink: 0 }}>
            <input type="checkbox" checked={powerOn} onChange={togglePower} />
            <div className="glass-toggle-track" />
            <div className="glass-toggle-thumb" style={{ transform: powerOn ? 'translateX(20px)' : 'translateX(0)' }} />
          </label>
        )}
      </div>

      {powerOn && (
        <>
          {/* Sorgenti HDMI */}
          {options.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 600, marginBottom: 8 }}>Sorgente</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {options.map((opt) => {
                  const active = opt === activeInput
                  return (
                    <button
                      key={opt}
                      onClick={() => setInput(opt)}
                      style={{
                        padding: '8px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                        border: active ? '1px solid var(--accent)' : '1px solid var(--glass-border)',
                        background: active ? 'var(--accent)' : 'var(--glass-bg)',
                        color: active ? '#04121e' : 'var(--text-secondary)',
                        boxShadow: active ? '0 4px 14px var(--accent-glow)' : 'none',
                      }}
                    >
                      {opt}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Sincronizzazione luci */}
          {box.lightSync && (
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: '1px solid var(--glass-border-dim)' }}>
              <Sparkles size={16} color={syncOn ? 'var(--accent)' : 'var(--text-tertiary)'} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 14, color: 'var(--text-primary)' }}>Sincronizzazione luci</span>
              <label className="glass-toggle" style={{ flexShrink: 0 }}>
                <input type="checkbox" checked={syncOn} onChange={toggleSync} />
                <div className="glass-toggle-track" />
                <div className="glass-toggle-thumb" style={{ transform: syncOn ? 'translateX(20px)' : 'translateX(0)' }} />
              </label>
            </div>
          )}

          {/* Luminosità (solo se l'entità esiste) */}
          {box.brightness && (
            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Sun size={16} color="var(--text-secondary)" style={{ flexShrink: 0 }} />
              <input
                type="range"
                className="glass-slider"
                min={bMin} max={bMax} step={bStep} value={brightVal}
                onChange={(e) => setBright(Number(e.target.value))}
                style={{
                  flex: 1,
                  background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${((brightVal - bMin) / (bMax - bMin)) * 100}%, rgba(255,255,255,0.18) ${((brightVal - bMin) / (bMax - bMin)) * 100}%, rgba(255,255,255,0.18) 100%)`,
                }}
              />
              <span style={{ fontSize: 12.5, color: 'var(--text-secondary)', width: 40, textAlign: 'right', flexShrink: 0 }}>
                {Math.round(((brightVal - bMin) / (bMax - bMin)) * 100)}%
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
