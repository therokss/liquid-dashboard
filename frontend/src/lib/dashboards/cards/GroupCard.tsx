// Card "gruppo": più dispositivi in un'unica card, con toggle rapido per ognuno.
import { useStore } from '../../../store'
import { useHA } from '../../../hooks/useHA'
import { getDomain } from '../../../types/ha'
import { GlassCard } from '../../../components/glass/GlassCard'

export function GroupCard({ title, entities }: { title?: string; entities?: string[] }) {
  const all = useStore((s) => s.entities)
  const ids = entities || []

  return (
    <GlassCard size="md" style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {title && (
        <div style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 10 }}>
          {title}
        </div>
      )}
      <div className="glass-scroll" style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
        {ids.length === 0 && <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>Nessun dispositivo</div>}
        {ids.map((id, i) => (
          <GroupRow key={id} entityId={id} last={i === ids.length - 1} />
        ))}
      </div>
    </GlassCard>
  )
}

function GroupRow({ entityId, last }: { entityId: string; last: boolean }) {
  const { callService } = useHA()
  const entity = useStore((s) => s.entities[entityId])
  const domain = getDomain(entityId)
  const name = (entity?.attributes.friendly_name as string) || entityId
  const state = entity?.state ?? 'unavailable'
  const toggleable = state === 'on' || state === 'off'
  const isOn = state === 'on'
  const unit = entity?.attributes.unit_of_measurement as string | undefined
  const value = toggleable ? '' : unit ? `${state} ${unit}` : state

  const toggle = () => {
    if (!toggleable) return
    const d = domain === 'light' ? 'light' : domain === 'switch' ? 'switch' : 'homeassistant'
    callService(d, isOn ? 'turn_off' : 'turn_on', { entity_id: entityId })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: last ? 'none' : '1px solid var(--glass-border-dim)' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
      </div>
      {toggleable ? (
        <label className="glass-toggle" onClick={(e) => e.stopPropagation()} style={{ flexShrink: 0 }}>
          <input type="checkbox" checked={isOn} onChange={toggle} />
          <div className="glass-toggle-track" />
          <div className="glass-toggle-thumb" style={{ transform: isOn ? 'translateX(20px)' : 'translateX(0)' }} />
        </label>
      ) : (
        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-secondary)', flexShrink: 0 }}>{value}</span>
      )}
    </div>
  )
}
