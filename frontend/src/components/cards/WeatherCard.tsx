import { memo, useEffect, useState } from 'react'
import {
  Sun, Moon, Cloud, CloudFog, CloudLightning, CloudRain, CloudRainWind,
  CloudSnow, CloudSun, CloudHail, Wind, AlertTriangle, Droplets, ArrowUp, ArrowDown,
} from 'lucide-react'
import { GlassCard } from '../glass/GlassCard'
import { useStore } from '../../store'
import { useHA } from '../../hooks/useHA'
import { useT } from '../../i18n'
import { cachedFetch, peekCache } from '../../lib/fetchCache'
import type { WeatherAttributes, WeatherForecast } from '../../types/ha'

type IconType = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>

const COND: Record<string, { label: string; Icon: IconType }> = {
  'clear-night': { label: 'Sereno', Icon: Moon },
  cloudy: { label: 'Nuvoloso', Icon: Cloud },
  fog: { label: 'Nebbia', Icon: CloudFog },
  hail: { label: 'Grandine', Icon: CloudHail },
  lightning: { label: 'Temporale', Icon: CloudLightning },
  'lightning-rainy': { label: 'Temporale', Icon: CloudLightning },
  partlycloudy: { label: 'Poco nuvoloso', Icon: CloudSun },
  pouring: { label: 'Pioggia intensa', Icon: CloudRainWind },
  rainy: { label: 'Pioggia', Icon: CloudRain },
  snowy: { label: 'Neve', Icon: CloudSnow },
  'snowy-rainy': { label: 'Nevischio', Icon: CloudSnow },
  sunny: { label: 'Soleggiato', Icon: Sun },
  windy: { label: 'Ventoso', Icon: Wind },
  'windy-variant': { label: 'Ventoso', Icon: Wind },
  exceptional: { label: 'Attenzione', Icon: AlertTriangle },
}

function toNum(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return isNaN(n) ? undefined : n
}

export const WeatherCard = memo(function WeatherCard() {
  const t = useT()
  const weatherSel = useStore((s) => s.weatherEntity)
  const tempSource = useStore((s) => s.externalTempSource)
  const { callServiceResponse } = useHA()

  // Entità weather effettiva: quella scelta, altrimenti la prima disponibile. Selettori
  // stretti (id / singole entità): la card non si ri-renderizza a ogni evento di HA.
  const entityId = useStore((s) => {
    if (weatherSel && s.entities[weatherSel]) return weatherSel
    return Object.keys(s.entities).find((id) => id.startsWith('weather.')) ?? null
  })
  const weather = useStore((s) => (entityId ? s.entities[entityId] : undefined))
  const tempEntity = useStore((s) => (tempSource === 'weather' ? undefined : s.entities[tempSource]))

  // Previsioni in cache di modulo: tornando sulla Home compaiono subito.
  const [forecast, setForecast] = useState<WeatherForecast[]>(() => (entityId && peekCache<WeatherForecast[]>(`forecast:${entityId}`)) || [])

  useEffect(() => {
    if (!entityId) return
    let cancelled = false
    cachedFetch(`forecast:${entityId}`, () => callServiceResponse<Record<string, { forecast: WeatherForecast[] }>>(
      'weather', 'get_forecasts', { entity_id: entityId, type: 'daily' }
    ).then((resp) => resp?.[entityId]?.forecast ?? null), { shouldCache: (v) => !!v && v.length > 0 })
      .then((v) => { if (!cancelled && v) setForecast(v) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [entityId, callServiceResponse])

  if (!entityId || !weather) return null
  const attrs = weather.attributes as WeatherAttributes
  const meta = COND[weather.state] ?? { label: weather.state, Icon: Cloud }
  const Icon = meta.Icon

  // Temperatura mostrata: dal sensore scelto, oppure dal meteo
  const displayTemp = tempSource === 'weather'
    ? attrs.temperature
    : toNum(tempEntity?.state)
  const unit = attrs.temperature_unit ?? '°C'
  const usingSensor = tempSource !== 'weather' && tempEntity !== undefined

  const today = forecast[0]
  const hi = today?.temperature
  const lo = today?.templow
  const humidity = attrs.humidity
  const wind = attrs.wind_speed

  return (
    <GlassCard size="lg" style={{ overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontSize: 52, fontWeight: 300, lineHeight: 1, color: 'var(--text-primary)', letterSpacing: '-0.04em' }}>
              {displayTemp !== undefined ? Math.round(displayTemp) : '--'}
            </span>
            <span style={{ fontSize: 20, fontWeight: 400, color: 'var(--text-secondary)', marginTop: 4 }}>{unit}</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginTop: 6 }}>{t(meta.label)}</div>
          <div style={{ display: 'flex', gap: 12, marginTop: 6, flexWrap: 'wrap' }}>
            {hi !== undefined && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 13, color: 'var(--text-secondary)' }}>
                <ArrowUp size={13} />{Math.round(hi)}°
              </span>
            )}
            {lo !== undefined && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 13, color: 'var(--text-secondary)' }}>
                <ArrowDown size={13} />{Math.round(lo)}°
              </span>
            )}
          </div>
        </div>
        <div style={{ color: 'var(--accent)', flexShrink: 0 }}>
          <Icon size={56} strokeWidth={1.5} />
        </div>
      </div>

      {(humidity !== undefined || wind !== undefined || usingSensor) && (
        <div style={{ display: 'flex', gap: 16, marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--glass-border-dim)', fontSize: 13, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
          {humidity !== undefined && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Droplets size={14} /> {Math.round(humidity)}%
            </span>
          )}
          {wind !== undefined && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Wind size={14} /> {Math.round(wind)} {attrs.wind_speed_unit ?? 'km/h'}
            </span>
          )}
          {usingSensor && (
            <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-tertiary)' }}>
              {t('sensore locale')}
            </span>
          )}
        </div>
      )}
    </GlassCard>
  )
})
