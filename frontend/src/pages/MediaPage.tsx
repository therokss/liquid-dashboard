import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Music } from 'lucide-react'
import { useStore } from '../store'
import { MediaCard } from '../components/cards/MediaCard'
import { TVCard } from '../components/cards/TVCard'
import { MasonryColumns } from '../components/MasonryColumns'
import { mediaKind, isTV, findPairedRemote } from '../lib/mediaDevices'
import { useT } from '../i18n'
import { getDomain } from '../types/ha'
import type { HassEntity } from '../types/ha'

// Dopo la pausa, il player resta tra "In riproduzione" per questo tempo, così
// puoi riprenderlo dai controlli completi prima che scenda tra i disponibili.
const PAUSE_GRACE_MS = 5 * 60 * 1000

function isNowPlaying(e: HassEntity): boolean {
  if (e.state === 'playing' || e.state === 'buffering') return true
  if (e.state === 'paused') {
    const t = Date.parse(e.last_changed || '')
    return Number.isFinite(t) && Date.now() - t < PAUSE_GRACE_MS
  }
  return false
}

export function MediaPage() {
  const t = useT()
  const entities = useStore((s) => s.entities)
  const entityDevices = useStore((s) => s.entityDevices)
  const entityPlatform = useStore((s) => s.entityPlatform)
  const deviceInfo = useStore((s) => s.deviceInfo)
  const hiddenEntities = useStore((s) => s.hiddenEntities)
  const userHidden = useStore((s) => s.userHiddenEntities)

  // Tick periodico per far scadere la "grazia" della pausa anche senza altri eventi.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 30000)
    return () => clearInterval(id)
  }, [])

  const { tvs, playing, others } = useMemo(() => {
    const all = Object.values(entities).filter(
      (e) => getDomain(e.entity_id) === 'media_player' &&
        !hiddenEntities[e.entity_id] && !userHidden[e.entity_id]
    )
    // Le TV vanno in una sezione dedicata col telecomando e restano visibili anche da
    // spente (unavailable), così puoi riaccenderle. Gli altoparlanti tengono la vista
    // "in riproduzione / disponibili" e spariscono se non disponibili.
    const tvList = all.filter((e) => {
      const paired = findPairedRemote(e.entity_id, entities, entityDevices)
      const model = deviceInfo[entityDevices[e.entity_id] ?? '']?.model
      return isTV(mediaKind(e, entityPlatform[e.entity_id], Boolean(paired), model))
    })
    const tvSet = new Set(tvList.map((e) => e.entity_id))
    const speakers = all.filter((e) => !tvSet.has(e.entity_id) && e.state !== 'unavailable')
    const nowPlaying = speakers
      .filter(isNowPlaying)
      .sort((a, b) => {
        // Chi sta davvero suonando prima di chi è in pausa recente
        const ap = a.state === 'playing' || a.state === 'buffering' ? 0 : 1
        const bp = b.state === 'playing' || b.state === 'buffering' ? 0 : 1
        return ap - bp
      })
    const nowSet = new Set(nowPlaying.map((e) => e.entity_id))
    // "Disponibili": gli altri, esclusi quelli in riproduzione (niente doppioni) e gli spenti
    const rest = speakers.filter(
      (e) => !nowSet.has(e.entity_id) && e.state !== 'off' && e.state !== 'standby'
    )
    return { tvs: tvList, playing: nowPlaying, others: rest }
  }, [entities, entityDevices, entityPlatform, deviceInfo, hiddenEntities, userHidden, tick])

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
          {t('Media')}
        </h1>
      </div>

      <MasonryColumns rowGap="0px">
      {tvs.length > 0 && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="text-caption" style={{ marginBottom: 10 }}>{t('TV')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {tvs.map((entity) => <TVCard key={entity.entity_id} entity={entity} />)}
          </div>
        </div>
      )}

      {playing.length > 0 && (
        <div style={{ marginBottom: 'var(--space-xl)' }}>
          <div className="text-caption" style={{ marginBottom: 10 }}>{t('In riproduzione')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {playing.map((entity, i) => (
              <motion.div key={entity.entity_id} className="anim-slide-up" style={{ animationDelay: `${i * 60}ms` }}>
                <MediaCard entity={entity} featured={i === 0} />
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div>
          <div className="text-caption" style={{ marginBottom: 10 }}>{t('Disponibili')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {others.map((entity, i) => (
              <motion.div key={entity.entity_id} className="anim-scale-in" style={{ animationDelay: `${i * 40}ms` }}>
                <MediaCard entity={entity} />
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {tvs.length === 0 && playing.length === 0 && others.length === 0 && (
        <div style={{ textAlign: 'center', padding: 'var(--space-2xl)', color: 'var(--text-tertiary)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>
            <Music size={48} style={{ opacity: 0.3 }} />
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
            {t('Nessun media player disponibile')}
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            {t('Aggiungi un media player a Home Assistant per controllarlo qui')}
          </div>
        </div>
      )}
      </MasonryColumns>
    </div>
  )
}
