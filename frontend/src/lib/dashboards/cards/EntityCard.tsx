// Card di un singolo dispositivo per l'editor: sceglie il renderer giusto in base al
// dominio dell'entità, riusando le card esistenti dove possibile.
import { useMemo } from 'react'
import { useStore } from '../../../store'
import { useHA } from '../../../hooks/useHA'
import { getDomain } from '../../../types/ha'
import { LightCard } from '../../../components/cards/LightCard'
import { MediaCard } from '../../../components/cards/MediaCard'
import { ClimateCard } from '../../../components/cards/ClimateCard'
import { GlassCard } from '../../../components/glass/GlassCard'

export function EntityCard({ entityId }: { entityId?: string }) {
  const entity = useStore((s) => (entityId ? s.entities[entityId] : undefined))

  if (!entityId) return <MissingCard label="Nessuna entità selezionata" />
  if (!entity) return <MissingCard label={entityId} />

  const domain = getDomain(entityId)
  if (domain === 'light') return <LightCard entity={entity} compact />
  if (domain === 'media_player') return <MediaCard entity={entity} />
  if (domain === 'climate') return <ClimateCard entity={entity} />
  return <GenericEntityCard entityId={entityId} />
}

// Card generica per interruttori/prese/sensori: nome, stato e toggle se on/off.
function GenericEntityCard({ entityId }: { entityId: string }) {
  const { callService } = useHA()
  const entity = useStore((s) => s.entities[entityId])
  const domain = getDomain(entityId)
  const name = (entity?.attributes.friendly_name as string) || entityId
  const state = entity?.state ?? 'unavailable'
  const toggleable = state === 'on' || state === 'off'
  const isOn = state === 'on'
  const unit = entity?.attributes.unit_of_measurement as string | undefined

  const value = useMemo(() => {
    if (toggleable) return isOn ? 'Acceso' : 'Spento'
    return unit ? `${state} ${unit}` : state
  }, [toggleable, isOn, state, unit])

  const toggle = () => {
    if (!toggleable) return
    const d = domain === 'switch' ? 'switch' : 'homeassistant'
    callService(d, isOn ? 'turn_off' : 'turn_on', { entity_id: entityId })
  }

  return (
    <GlassCard active={isOn} size="sm" style={{ display: 'flex', alignItems: 'center', gap: 12, height: '100%' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{value}</div>
      </div>
      {toggleable && (
        <label className="glass-toggle" onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
          <input type="checkbox" checked={isOn} onChange={toggle} />
          <div className="glass-toggle-track" />
          <div className="glass-toggle-thumb" style={{ transform: isOn ? 'translateX(20px)' : 'translateX(0)' }} />
        </label>
      )}
    </GlassCard>
  )
}

function MissingCard({ label }: { label: string }) {
  return (
    <GlassCard size="sm" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)', fontSize: 13 }}>
      {label}
    </GlassCard>
  )
}
