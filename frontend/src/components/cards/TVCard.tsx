import { useState } from 'react'
import { Tv, ChevronRight } from 'lucide-react'
import { useStore } from '../../store'
import { getDomain } from '../../types/ha'
import { mediaKind, isTV, findPairedRemote } from '../../lib/mediaDevices'
import type { MediaKind } from '../../lib/mediaDevices'
import { TVRemoteModal } from '../TVRemoteModal'
import { MediaCard } from './MediaCard'
import { useT } from '../../i18n'
import type { HassEntity } from '../../types/ha'

// Determina il tipo di media player (TV LG/Apple/Android/generica o altoparlante).
export function useMediaKind(entity: HassEntity): MediaKind {
  const entities = useStore((s) => s.entities)
  const entityDevices = useStore((s) => s.entityDevices)
  const entityPlatform = useStore((s) => s.entityPlatform)
  const deviceInfo = useStore((s) => s.deviceInfo)
  const paired = findPairedRemote(entity.entity_id, entities, entityDevices)
  const model = deviceInfo[entityDevices[entity.entity_id] ?? '']?.model
  return mediaKind(entity, entityPlatform[entity.entity_id], Boolean(paired), model)
}

// Card TV: mostra stato/sorgente e apre il telecomando a schermo intero.
export function TVCard({ entity }: { entity: HassEntity }) {
  const t = useT()
  const kind = useMediaKind(entity)
  const [open, setOpen] = useState(false)
  const attrs = entity.attributes as Record<string, unknown>
  const name = (attrs.friendly_name as string) ?? entity.entity_id
  const isOff = entity.state === 'off' || entity.state === 'standby' || entity.state === 'unavailable'
  const source = attrs.source as string | undefined
  const sub = isOff ? t('Spenta · tocca per il telecomando') : `${source || t('Accesa')} ${t('· tocca per il telecomando')}`

  return (
    <>
      <div className="glass-card" onClick={() => setOpen(true)} style={{ padding: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}>
        <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, background: isOff ? 'var(--glass-bg-active)' : 'var(--accent-glow)', border: '1px solid var(--glass-border)', color: isOff ? 'var(--text-secondary)' : 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Tv size={20} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--text-primary)', fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
          <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>{sub}</div>
        </div>
        <ChevronRight size={18} color="var(--text-tertiary)" style={{ flexShrink: 0 }} />
      </div>
      {open && <TVRemoteModal entityId={entity.entity_id} kind={kind} onClose={() => setOpen(false)} />}
    </>
  )
}

// Sezione media di una stanza: TV (con telecomando) e altoparlanti.
export function MediaDevicesSection({ areaEntities }: { areaEntities: HassEntity[] }) {
  const t = useT()
  const entities = useStore((s) => s.entities)
  const entityDevices = useStore((s) => s.entityDevices)
  const entityPlatform = useStore((s) => s.entityPlatform)
  const deviceInfo = useStore((s) => s.deviceInfo)

  const players = areaEntities.filter((e) => getDomain(e.entity_id) === 'media_player')
  const kindOf = (e: HassEntity) => {
    const paired = findPairedRemote(e.entity_id, entities, entityDevices)
    const model = deviceInfo[entityDevices[e.entity_id] ?? '']?.model
    return mediaKind(e, entityPlatform[e.entity_id], Boolean(paired), model)
  }
  // Le TV restano visibili anche da spente (state 'unavailable'): servono proprio per
  // riaccenderle. Gli altoparlanti invece si nascondono se non disponibili.
  const tvs = players.filter((e) => isTV(kindOf(e)))
  const speakers = players.filter((e) => !isTV(kindOf(e)) && e.state !== 'unavailable')
  if (tvs.length === 0 && speakers.length === 0) return null

  return (
    <>
      {tvs.length > 0 && (
        <div>
          <div className="text-caption" style={{ marginBottom: 10 }}>{t('TV')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tvs.map((e) => <TVCard key={e.entity_id} entity={e} />)}
          </div>
        </div>
      )}
      {speakers.length > 0 && (
        <div>
          <div className="text-caption" style={{ marginBottom: 10 }}>{t('Altoparlanti')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {speakers.map((e) => <MediaCard key={e.entity_id} entity={e} />)}
          </div>
        </div>
      )}
    </>
  )
}
