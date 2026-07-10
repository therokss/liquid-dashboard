import { useCallback, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Music } from 'lucide-react'
import { GlassCard } from '../glass/GlassCard'
import { useHA } from '../../hooks/useHA'
import { useT } from '../../i18n'
import { artworkUrl } from '../../lib/media'
import type { HassEntity, MediaPlayerAttributes } from '../../types/ha'

// Immagine cover con fallback all'icona se non carica
function Artwork({ src, iconSize }: { src?: string; iconSize: number }) {
  const [err, setErr] = useState(false)
  if (!src || err) return <Music size={iconSize} color="var(--text-tertiary)" />
  return (
    <img
      src={src}
      alt=""
      onError={() => setErr(true)}
      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
    />
  )
}

interface MediaCardProps {
  entity: HassEntity
  featured?: boolean
}

const SUPPORTED_FEATURES = {
  PAUSE: 1,
  SEEK: 2,
  VOLUME_SET: 4,
  VOLUME_MUTE: 8,
  PREVIOUS_TRACK: 16,
  NEXT_TRACK: 32,
  PLAY: 4096,
  STOP: 4096,
}

function hasFeature(features: number | undefined, feature: number): boolean {
  return ((features ?? 0) & feature) !== 0
}

export function MediaCard({ entity, featured }: MediaCardProps) {
  const t = useT()
  const { callService } = useHA()
  const attrs = entity.attributes as MediaPlayerAttributes
  const isPlaying = entity.state === 'playing'
  const isIdle = entity.state === 'idle' || entity.state === 'paused'
  const isOn = entity.state !== 'off' && entity.state !== 'unavailable'

  const name = attrs.friendly_name ?? entity.entity_id
  const title = attrs.media_title ?? (isOn ? t('Nessuna riproduzione') : t('Spento'))
  const artist = attrs.media_artist
  const artwork = artworkUrl(attrs.entity_picture)
  const volume = Math.round((attrs.volume_level ?? 0) * 100)
  const isMuted = attrs.is_volume_muted ?? false
  const features = attrs.supported_features

  const volumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const callMedia = useCallback(
    (service: string, data: Record<string, unknown> = {}) => {
      callService('media_player', service, { entity_id: entity.entity_id, ...data })
    },
    [callService, entity.entity_id]
  )

  const setVolume = useCallback(
    (val: number) => {
      if (volumeTimerRef.current) clearTimeout(volumeTimerRef.current)
      volumeTimerRef.current = setTimeout(() => {
        callMedia('volume_set', { volume_level: val / 100 })
      }, 150)
    },
    [callMedia]
  )

  if (featured) {
    return (
      <div
        style={{
          position: 'relative',
          borderRadius: 'var(--radius-xl)',
          overflow: 'hidden',
          minHeight: 240,
        }}
      >
        {/* Artwork blurred background */}
        {artwork && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url(${artwork})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(30px) saturate(1.4)',
              transform: 'scale(1.1)',
              opacity: 0.6,
            }}
          />
        )}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.45)',
          }}
        />

        <div style={{ position: 'relative', padding: 'var(--space-lg)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-md)', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
            {/* Artwork thumb */}
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 14,
                overflow: 'hidden',
                flexShrink: 0,
                background: 'rgba(255,255,255,0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
              }}
            >
              <Artwork src={artwork} iconSize={28} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: 'white',
                  letterSpacing: '-0.02em',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {title}
              </div>
              {artist && (
                <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.65)', marginTop: 2 }}>
                  {artist}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>
                {name}
              </div>
            </div>
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-lg)' }}>
            {hasFeature(features, SUPPORTED_FEATURES.PREVIOUS_TRACK) && (
              <ControlBtn onClick={() => callMedia('media_previous_track')}>
                <SkipBack size={20} fill="white" color="white" />
              </ControlBtn>
            )}
            <motion.button
              whileTap={{ scale: 0.9 }}
              onClick={() => callMedia(isPlaying ? 'media_pause' : 'media_play')}
              style={{
                width: 60,
                height: 60,
                borderRadius: '50%',
                background: 'white',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
              }}
            >
              {isPlaying
                ? <Pause size={24} fill="black" color="black" />
                : <Play size={24} fill="black" color="black" style={{ marginLeft: 2 }} />
              }
            </motion.button>
            {hasFeature(features, SUPPORTED_FEATURES.NEXT_TRACK) && (
              <ControlBtn onClick={() => callMedia('media_next_track')}>
                <SkipForward size={20} fill="white" color="white" />
              </ControlBtn>
            )}
          </div>

          {/* Volume */}
          {hasFeature(features, SUPPORTED_FEATURES.VOLUME_SET) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'var(--space-lg)' }}>
              <button
                onClick={() => callMedia('volume_mute', { is_volume_muted: !isMuted })}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}
              >
                {isMuted
                  ? <VolumeX size={16} color="rgba(255,255,255,0.5)" />
                  : <Volume2 size={16} color="rgba(255,255,255,0.5)" />
                }
              </button>
              <input
                type="range"
                className="glass-slider"
                min={0}
                max={100}
                value={isMuted ? 0 : volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                style={{
                  background: `linear-gradient(to right, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.8) ${isMuted ? 0 : volume}%, rgba(255,255,255,0.2) ${isMuted ? 0 : volume}%, rgba(255,255,255,0.2) 100%)`,
                }}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  // Compact version
  return (
    <GlassCard size="sm" active={isPlaying}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            overflow: 'hidden',
            flexShrink: 0,
            background: 'rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Artwork src={artwork} iconSize={18} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {name}
          </div>
        </div>
        <motion.button
          whileTap={{ scale: 0.85 }}
          onClick={() => callMedia(isPlaying ? 'media_pause' : 'media_play')}
          style={{
            width: 36,
            height: 36,
            borderRadius: '50%',
            background: isPlaying ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
            border: 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          {isPlaying
            ? <Pause size={14} fill="white" color="white" />
            : <Play size={14} fill="var(--text-primary)" color="var(--text-primary)" style={{ marginLeft: 1 }} />
          }
        </motion.button>
      </div>
    </GlassCard>
  )
}

function ControlBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <motion.button
      whileTap={{ scale: 0.85 }}
      onClick={onClick}
      style={{
        background: 'rgba(255,255,255,0.1)',
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: '50%',
        width: 44,
        height: 44,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      {children}
    </motion.button>
  )
}
