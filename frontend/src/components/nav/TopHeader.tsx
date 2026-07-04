import { useMemo, useState } from 'react'
import { Maximize, Minimize } from 'lucide-react'
import { useStore } from '../../store'
import { artworkUrl } from '../../lib/media'
import { setKiosk } from '../../lib/kiosk'
import type { HassEntity } from '../../types/ha'

function initials(name: string): string {
  return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('')
}

function PersonAvatar({ entity }: { entity: HassEntity }) {
  const name = (entity.attributes.friendly_name as string) || entity.entity_id
  const home = entity.state === 'home'
  const pic = artworkUrl(entity.attributes.entity_picture as string | undefined)
  const [err, setErr] = useState(false)
  const ring = home ? 'var(--accent)' : 'rgba(255,255,255,0.18)'

  return (
    <div
      title={`${name} · ${home ? 'A casa' : 'Fuori'}`}
      style={{
        position: 'relative',
        width: 38,
        height: 38,
        borderRadius: '50%',
        padding: 2,
        border: `2px solid ${ring}`,
        boxShadow: home ? '0 0 10px var(--accent-glow)' : 'none',
      }}
    >
      <div
        style={{
          width: '100%', height: '100%', borderRadius: '50%', overflow: 'hidden',
          background: 'var(--glass-bg-active)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          filter: home ? 'none' : 'grayscale(0.6) opacity(0.75)',
        }}
      >
        {pic && !err
          ? <img src={pic} alt="" onError={() => setErr(true)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>{initials(name)}</span>}
      </div>
    </div>
  )
}

export function TopHeader() {
  const isAdmin = useStore((s) => s.isAdmin)
  const kioskMode = useStore((s) => s.kioskMode)
  const setKioskMode = useStore((s) => s.setKioskMode)
  const entities = useStore((s) => s.entities)

  const persons = useMemo(
    () => Object.values(entities).filter((e) => e.entity_id.startsWith('person.')),
    [entities]
  )

  const toggleKiosk = () => {
    const next = !kioskMode
    setKioskMode(next)
    setKiosk(next)
    try {
      if (next && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {})
      else if (!next && document.fullscreenElement) document.exitFullscreen?.().catch(() => {})
    } catch { /* ignora */ }
  }

  if (!isAdmin && persons.length === 0) return null

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: 'calc(env(safe-area-inset-top, 0px) + 10px) var(--space-md) 8px',
      }}
    >
      <div>
        {isAdmin && (
          <button
            onClick={toggleKiosk}
            aria-label={kioskMode ? 'Mostra barra Home Assistant' : 'Schermo intero'}
            style={{
              width: 38, height: 38, borderRadius: '50%',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
              color: 'var(--text-primary)', cursor: 'pointer',
            }}
          >
            {kioskMode ? <Minimize size={18} /> : <Maximize size={18} />}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {persons.map((p) => <PersonAvatar key={p.entity_id} entity={p} />)}
      </div>
    </div>
  )
}
