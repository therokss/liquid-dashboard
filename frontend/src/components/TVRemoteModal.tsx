import { useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import {
  X, Power, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, CornerUpLeft, Home,
  Menu, Play, Pause, Square, SkipBack, SkipForward, Volume2, VolumeX, Plus, Minus, Info, Tv, Speaker, ListVideo, Trash2,
} from 'lucide-react'
import { useStore } from '../store'
import { useHA } from '../hooks/useHA'
import { findPairedRemote } from '../lib/mediaDevices'
import type { MediaKind } from '../lib/mediaDevices'
import type { HassEntity } from '../types/ha'

// Comandi astratti del telecomando; ogni modello li mappa sui servizi HA reali.
type Cmd =
  | 'up' | 'down' | 'left' | 'right' | 'ok'
  | 'back' | 'home' | 'menu' | 'exit' | 'info'
  | 'play_pause' | 'stop' | 'prev' | 'next'
  | 'volup' | 'voldown' | 'mute' | 'chup' | 'chdown'
  | 'red' | 'green' | 'yellow' | 'blue'

type CallService = (domain: string, service: string, data: Record<string, unknown>) => Promise<void>

interface RemoteCtx {
  media: HassEntity
  remoteId?: string
  mac?: string
  call: CallService
}

// Uscite audio LG (webostv.select_sound_output).
const SOUND_OUTPUTS: Array<{ label: string; value: string }> = [
  { label: 'TV', value: 'tv_speaker' },
  { label: 'HDMI ARC', value: 'external_arc' },
  { label: 'Ottico', value: 'external_optical' },
  { label: 'Bluetooth', value: 'bt_soundbar' },
  { label: 'Cuffie', value: 'headphone' },
  { label: 'TV + Ottico', value: 'tv_external_speaker' },
]

// Canali TV italiani (numerazione LCN). Toccando un canale si inviano le sue cifre.
const ITALIAN_CHANNELS: Array<{ n: number; name: string }> = [
  { n: 1, name: 'Rai 1' }, { n: 2, name: 'Rai 2' }, { n: 3, name: 'Rai 3' },
  { n: 4, name: 'Rete 4' }, { n: 5, name: 'Canale 5' }, { n: 6, name: 'Italia 1' },
  { n: 7, name: 'LA7' }, { n: 8, name: 'TV8' }, { n: 9, name: 'NOVE' },
  { n: 20, name: '20 Mediaset' }, { n: 21, name: 'Rai 4' }, { n: 22, name: 'Iris' },
  { n: 23, name: 'Rai 5' }, { n: 24, name: 'Rai Movie' }, { n: 25, name: 'Rai Premium' },
  { n: 26, name: 'Rai Gulp' }, { n: 27, name: 'TwentySeven' }, { n: 34, name: 'Cielo' },
  { n: 35, name: 'Focus' }, { n: 37, name: 'La5' }, { n: 49, name: 'Giallo' },
  { n: 52, name: 'DMAX' },
]

// Mappa un comando astratto sul servizio corretto per il modello.
function dispatch(kind: MediaKind, cmd: Cmd, ctx: RemoteCtx): void {
  const { media, remoteId, call } = ctx
  const mp = (s: string, d: Record<string, unknown> = {}) => call('media_player', s, { entity_id: media.entity_id, ...d })
  const lgBtn = (button: string) => call('webostv', 'button', { entity_id: media.entity_id, button })
  const rc = (command: string) => remoteId && call('remote', 'send_command', { entity_id: remoteId, command })
  const muted = Boolean((media.attributes as Record<string, unknown>).is_volume_muted)
  const isPlaying = media.state === 'playing'

  // Controlli comuni via media_player (funzionano su quasi tutte le TV).
  if (cmd === 'volup') return void mp('volume_up')
  if (cmd === 'voldown') return void mp('volume_down')
  if (cmd === 'mute') return void mp('volume_mute', { is_volume_muted: !muted })
  if (cmd === 'play_pause') return void mp(isPlaying ? 'media_pause' : 'media_play')
  if (cmd === 'stop') return void mp('media_stop')
  if (cmd === 'prev') return void mp('media_previous_track')
  if (cmd === 'next') return void mp('media_next_track')

  if (kind === 'lg') {
    const map: Partial<Record<Cmd, () => void>> = {
      up: () => lgBtn('UP'), down: () => lgBtn('DOWN'), left: () => lgBtn('LEFT'), right: () => lgBtn('RIGHT'),
      ok: () => lgBtn('ENTER'), back: () => lgBtn('BACK'), home: () => lgBtn('HOME'),
      exit: () => lgBtn('EXIT'), info: () => lgBtn('INFO'),
      chup: () => lgBtn('CHANNELUP'), chdown: () => lgBtn('CHANNELDOWN'),
      red: () => lgBtn('RED'), green: () => lgBtn('GREEN'), yellow: () => lgBtn('YELLOW'), blue: () => lgBtn('BLUE'),
    }
    return void map[cmd]?.()
  }

  if (kind === 'appletv') {
    const map: Partial<Record<Cmd, () => void>> = {
      up: () => rc('up'), down: () => rc('down'), left: () => rc('left'), right: () => rc('right'),
      ok: () => rc('select'), back: () => rc('menu'), home: () => rc('home'), menu: () => rc('menu'),
      exit: () => rc('home'), info: () => rc('top_menu'),
    }
    return void map[cmd]?.()
  }

  if (kind === 'androidtv') {
    const map: Partial<Record<Cmd, () => void>> = {
      up: () => rc('DPAD_UP'), down: () => rc('DPAD_DOWN'), left: () => rc('DPAD_LEFT'), right: () => rc('DPAD_RIGHT'),
      ok: () => rc('DPAD_CENTER'), back: () => rc('BACK'), home: () => rc('HOME'), menu: () => rc('MENU'),
      exit: () => rc('HOME'), info: () => rc('INFO'),
    }
    return void map[cmd]?.()
  }

  // TV generica senza remote abbinato: solo navigazione via remote se c'è, altrimenti niente.
  const map: Partial<Record<Cmd, () => void>> = {
    up: () => rc('up'), down: () => rc('down'), left: () => rc('left'), right: () => rc('right'), ok: () => rc('select'),
    back: () => rc('back'), home: () => rc('home'), menu: () => rc('menu'),
  }
  map[cmd]?.()
}

// Tasto tondo in vetro con feedback al tocco.
function Key({ onPress, children, size = 52, accent, label }: { onPress: () => void; children: React.ReactNode; size?: number; accent?: boolean; label?: string }) {
  return (
    <motion.button
      whileTap={{ scale: 0.86 }}
      transition={{ type: 'spring', stiffness: 520, damping: 20, mass: 0.5 }}
      onClick={onPress}
      aria-label={label}
      style={{
        width: size, height: size, borderRadius: '50%', flexShrink: 0,
        background: accent ? 'var(--accent)' : 'var(--glass-bg)',
        border: `1px solid ${accent ? 'transparent' : 'var(--glass-border)'}`,
        color: accent ? '#04121e' : 'var(--text-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        boxShadow: accent ? '0 4px 16px var(--accent-glow)' : '0 2px 8px rgba(0,0,0,0.2)',
      }}
    >
      {children}
    </motion.button>
  )
}

// Croce direzionale con OK centrale (griglia 3×3).
function DPad({ on }: { on: (c: Cmd) => void }) {
  const cell = (node: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{node}</div>
  )
  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gridTemplateRows: 'repeat(3, 1fr)',
        width: 216, height: 216, borderRadius: '50%', margin: '0 auto',
        background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
        boxShadow: 'inset 0 1px 0 var(--glass-rim), 0 4px 18px rgba(0,0,0,0.25)', padding: 6,
      }}
    >
      {cell(null)}
      {cell(<Key onPress={() => on('up')} label="Su"><ChevronUp size={26} /></Key>)}
      {cell(null)}
      {cell(<Key onPress={() => on('left')} label="Sinistra"><ChevronLeft size={26} /></Key>)}
      {cell(<Key onPress={() => on('ok')} accent label="OK"><span style={{ fontSize: 15, fontWeight: 800 }}>OK</span></Key>)}
      {cell(<Key onPress={() => on('right')} label="Destra"><ChevronRight size={26} /></Key>)}
      {cell(null)}
      {cell(<Key onPress={() => on('down')} label="Giù"><ChevronDown size={26} /></Key>)}
      {cell(null)}
    </div>
  )
}

// Barra verticale +/- (volume o canali) con etichetta centrale.
function PlusMinus({ onPlus, onMinus, label }: { onPlus: () => void; onMinus: () => void; label: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', borderRadius: 'var(--radius-pill)', padding: '10px 6px' }}>
      <Key onPress={onPlus} size={46} label={`${label} +`}><Plus size={22} /></Key>
      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <Key onPress={onMinus} size={46} label={`${label} -`}><Minus size={22} /></Key>
    </div>
  )
}

export function TVRemoteModal({ entityId, kind, onClose }: { entityId: string; kind: MediaKind; onClose: () => void }) {
  const entities = useStore((s) => s.entities)
  const entityDevices = useStore((s) => s.entityDevices)
  const deviceInfo = useStore((s) => s.deviceInfo)
  const tvMacs = useStore((s) => s.tvMacs)
  const setTvMac = useStore((s) => s.setTvMac)
  const tvChannels = useStore((s) => s.tvChannels)
  const setTvChannels = useStore((s) => s.setTvChannels)
  const { callService } = useHA()

  // MAC per il WoL: quello inserito a mano ha priorità sul registro (le TV LG spesso
  // non espongono il MAC a HA, quindi il registro è vuoto).
  const registryMac = deviceInfo[entityDevices[entityId] ?? '']?.mac
  const [macInput, setMacInput] = useState(tvMacs[entityId] ?? registryMac ?? '')
  const [showNum, setShowNum] = useState(false)
  const [showSound, setShowSound] = useState(false)
  const [showChannels, setShowChannels] = useState(false)
  const [editCh, setEditCh] = useState(false)

  const media = entities[entityId]
  if (!media) return null

  const remoteId = findPairedRemote(entityId, entities, entityDevices)
  const mac = (tvMacs[entityId] || registryMac || '').trim() || undefined
  const ctx: RemoteCtx = { media, remoteId, mac, call: callService }
  const on = (c: Cmd) => dispatch(kind, c, ctx)
  // Comandi LG diretti (numeri, uscita audio): non passano dai comandi astratti.
  const lgButton = (b: string) => callService('webostv', 'button', { entity_id: entityId, button: b })
  const soundOut = (o: string) => callService('webostv', 'select_sound_output', { entity_id: entityId, sound_output: o })
  // Sintonizza un canale inviandone le cifre in sequenza (come digitarle sul telecomando).
  const tuneChannel = async (num: number) => {
    for (const d of String(num).split('')) {
      await callService('webostv', 'button', { entity_id: entityId, button: d })
      await new Promise((r) => setTimeout(r, 350))
    }
  }
  // Lista canali: personalizzata se presente, altrimenti quella italiana di default.
  const channels = tvChannels.length > 0 ? tvChannels : ITALIAN_CHANNELS
  const chBase = () => (tvChannels.length > 0 ? tvChannels : ITALIAN_CHANNELS)
  const chUpdate = (i: number, patch: Partial<{ n: number; name: string }>) => setTvChannels(chBase().map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  const chRemove = (i: number) => setTvChannels(chBase().filter((_, idx) => idx !== i))
  const chAdd = () => setTvChannels([...chBase(), { n: 0, name: '' }])
  const chReset = () => { setTvChannels([]); setEditCh(false) }

  const attrs = media.attributes as Record<string, unknown>
  const name = (attrs.friendly_name as string) ?? entityId
  const isOff = media.state === 'off' || media.state === 'standby' || media.state === 'unavailable'
  const muted = Boolean(attrs.is_volume_muted)
  const sources = (attrs.source_list as string[] | undefined) ?? []
  const activeSource = attrs.source as string | undefined
  const activeSoundOut = attrs.sound_output as string | undefined
  const isLG = kind === 'lg'

  // Accensione: per LG il turn_on affidabile è il magic packet WoL (la scheda di rete
  // dorme), poi turn_on. Per gli altri, turn_on standard.
  const power = () => {
    if (isOff) {
      if (isLG && mac) callService('wake_on_lan', 'send_magic_packet', { mac })
      callService('media_player', 'turn_on', { entity_id: entityId })
    } else {
      callService('media_player', 'turn_off', { entity_id: entityId })
    }
  }
  const selectSource = (s: string) => callService('media_player', 'select_source', { entity_id: entityId, source: s })

  const hasChannels = isLG
  const hasDPad = isLG || kind === 'appletv' || kind === 'androidtv' || Boolean(remoteId)

  return createPortal(
    <motion.div
      data-theme="dark"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3400, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(3,10,20,0.6)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        onClick={(ev) => ev.stopPropagation()}
        className="glass-scroll"
        style={{ background: '#08192b', borderTop: '1px solid var(--glass-border)', borderTopLeftRadius: 22, borderTopRightRadius: 22, maxWidth: 460, width: '100%', margin: '0 auto', maxHeight: '92vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18, padding: 'var(--space-lg) var(--space-lg) calc(env(safe-area-inset-bottom, 0px) + var(--space-lg))' }}
      >
        {/* Header: nome + accensione + chiudi */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, flexShrink: 0, background: isOff ? 'var(--glass-bg-active)' : 'var(--accent-glow)', border: '1px solid var(--glass-border)', color: isOff ? 'var(--text-secondary)' : 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Tv size={20} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{isOff ? 'Spenta' : activeSource || 'Accesa'}</div>
          </div>
          <Key onPress={power} size={44} accent={!isOff} label="Accensione"><Power size={20} /></Key>
          <button onClick={onClose} aria-label="Chiudi" style={{ width: 36, height: 36, borderRadius: 10, cursor: 'pointer', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        {/* LG: riga utility — tastierino / canali / uscita audio / exit */}
        {isLG && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
            <Key onPress={() => { setShowNum((v) => !v); setShowSound(false); setShowChannels(false) }} accent={showNum} label="Tastierino"><span style={{ fontSize: 13, fontWeight: 800 }}>123</span></Key>
            <Key onPress={() => { setShowChannels((v) => !v); setShowNum(false); setShowSound(false) }} accent={showChannels} label="Canali"><ListVideo size={20} /></Key>
            <Key onPress={() => { setShowSound((v) => !v); setShowNum(false); setShowChannels(false) }} accent={showSound} label="Uscita audio"><Speaker size={20} /></Key>
            <Key onPress={() => on('exit')} label="Exit"><span style={{ fontSize: 11, fontWeight: 800 }}>EXIT</span></Key>
          </div>
        )}

        {/* LG: tastierino numerico */}
        {isLG && showNum && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, maxWidth: 260, margin: '0 auto', width: '100%' }}>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <motion.button key={n} whileTap={{ scale: 0.94 }} onClick={() => lgButton(String(n))} style={{ padding: '14px 0', borderRadius: 14, background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', fontSize: 20, fontWeight: 700, cursor: 'pointer' }}>{n}</motion.button>
            ))}
            <div />
            <motion.button whileTap={{ scale: 0.94 }} onClick={() => lgButton('0')} style={{ padding: '14px 0', borderRadius: 14, background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-primary)', fontSize: 20, fontWeight: 700, cursor: 'pointer' }}>0</motion.button>
            <div />
          </div>
        )}

        {/* LG: selettore uscita audio */}
        {isLG && showSound && (
          <div>
            <div className="text-caption" style={{ marginBottom: 8 }}>Uscita audio</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {SOUND_OUTPUTS.map((o) => {
                const active = o.value === activeSoundOut
                return (
                  <button key={o.value} onClick={() => soundOut(o.value)} style={{ padding: '10px 6px', borderRadius: 'var(--radius-md)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', border: active ? '1px solid var(--accent)' : '1px solid var(--glass-border)', background: active ? 'var(--accent)' : 'var(--glass-bg)', color: active ? '#04121e' : 'var(--text-secondary)' }}>{o.label}</button>
                )
              })}
            </div>
          </div>
        )}

        {/* LG: lista canali (tocca per sintonizzare; personalizzabile) */}
        {isLG && showChannels && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="text-caption">Canali</span>
              <button onClick={() => setEditCh((v) => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 13, fontWeight: 700, padding: '2px 4px' }}>
                {editCh ? 'Fine' : 'Modifica'}
              </button>
            </div>
            {editCh ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className="glass-scroll" style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 260, overflowY: 'auto', paddingRight: 2 }}>
                  {channels.map((c, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <input value={c.n || ''} onChange={(ev) => chUpdate(i, { n: parseInt(ev.target.value, 10) || 0 })} inputMode="numeric" placeholder="N°" style={{ width: 54, flexShrink: 0, boxSizing: 'border-box', padding: '9px 8px', borderRadius: 'var(--radius-md)', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)', fontSize: 14, fontWeight: 700, textAlign: 'center' }} />
                      <input value={c.name} onChange={(ev) => chUpdate(i, { name: ev.target.value })} placeholder="Nome canale" style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', padding: '9px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)', fontSize: 14 }} />
                      <button onClick={() => chRemove(i)} aria-label="Rimuovi" style={{ width: 34, height: 34, flexShrink: 0, borderRadius: 9, cursor: 'pointer', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: '#ff6b6b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Trash2 size={16} /></button>
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={chAdd} style={{ flex: 1, padding: '10px', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: '1px dashed var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}><Plus size={16} /> Aggiungi canale</button>
                  <button onClick={chReset} style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>Ripristina IT</button>
                </div>
              </div>
            ) : (
              <div className="glass-scroll" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, maxHeight: 232, overflowY: 'auto', paddingRight: 2 }}>
                {channels.map((c, i) => (
                  <motion.button key={i} whileTap={{ scale: 0.96 }} onClick={() => tuneChannel(c.n)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', textAlign: 'left' }}>
                    <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)', minWidth: 22, flexShrink: 0 }}>{c.n}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                  </motion.button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Riga navigazione: Indietro / Home / (Menu solo non-LG) */}
        {hasDPad && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 14 }}>
            <Key onPress={() => on('back')} label="Indietro"><CornerUpLeft size={20} /></Key>
            <Key onPress={() => on('home')} label="Home"><Home size={20} /></Key>
            {!isLG && <Key onPress={() => on('menu')} label="Menu"><Menu size={20} /></Key>}
          </div>
        )}

        {/* Croce direzionale */}
        {hasDPad && <DPad on={on} />}

        {/* Volume / Play-Pause / Canali */}
        <div style={{ display: 'flex', alignItems: 'stretch', justifyContent: 'center', gap: 16 }}>
          <PlusMinus onPlus={() => on('volup')} onMinus={() => on('voldown')} label="Vol" />
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <Key onPress={() => on('play_pause')} size={56} label="Play/Pausa">
              {media.state === 'playing' ? <Pause size={24} /> : <Play size={24} />}
            </Key>
            <Key onPress={() => on('mute')} label="Muto">{muted ? <VolumeX size={20} /> : <Volume2 size={20} />}</Key>
            {isLG && <Key onPress={() => on('info')} label="Info"><Info size={18} /></Key>}
          </div>
          {hasChannels
            ? <PlusMinus onPlus={() => on('chup')} onMinus={() => on('chdown')} label="Ch" />
            : <div style={{ width: 58 }} />}
        </div>

        {/* Riproduzione estesa: Precedente / Stop / Successivo */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 14 }}>
          <Key onPress={() => on('prev')} label="Precedente"><SkipBack size={20} /></Key>
          <Key onPress={() => on('stop')} label="Stop"><Square size={18} /></Key>
          <Key onPress={() => on('next')} label="Successivo"><SkipForward size={20} /></Key>
        </div>

        {/* LG: tasti colorati */}
        {isLG && (
          <div style={{ display: 'flex', gap: 10 }}>
            {([['red', '#e53935'], ['green', '#43a047'], ['yellow', '#fdd835'], ['blue', '#1e88e5']] as const).map(([c, col]) => (
              <motion.button key={c} whileTap={{ scale: 0.94 }} onClick={() => on(c)} aria-label={c} style={{ flex: 1, height: 34, borderRadius: 9, background: col, border: 'none', cursor: 'pointer', boxShadow: '0 2px 8px rgba(0,0,0,0.25)' }} />
            ))}
          </div>
        )}

        {/* Sorgenti / App */}
        {sources.length > 0 && (
          <div>
            <div className="text-caption" style={{ marginBottom: 8 }}>Sorgenti</div>
            <div className="glass-scroll" style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {sources.map((s) => {
                const active = s === activeSource
                return (
                  <button
                    key={s}
                    onClick={() => selectSource(s)}
                    style={{
                      flexShrink: 0, padding: '9px 14px', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
                      border: active ? '1px solid var(--accent)' : '1px solid var(--glass-border)',
                      background: active ? 'var(--accent)' : 'var(--glass-bg)',
                      color: active ? '#04121e' : 'var(--text-secondary)',
                    }}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Wake-on-LAN: MAC manuale (le TV LG spesso non lo espongono a HA) */}
        {isLG && (
          <div>
            <div className="text-caption" style={{ marginBottom: 8 }}>Accensione (Wake-on-LAN)</div>
            <input
              value={macInput}
              onChange={(ev) => { setMacInput(ev.target.value); setTvMac(entityId, ev.target.value) }}
              placeholder="MAC — es. 74:e6:b8:3a:8a:4c"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--glass-border)', background: 'var(--glass-bg)', color: 'var(--text-primary)', fontSize: 14, fontFamily: 'ui-monospace, monospace' }}
            />
            <div style={{ fontSize: 11.5, color: 'var(--text-tertiary)', marginTop: 6, lineHeight: 1.4 }}>
              {mac
                ? 'Il magic packet verrà inviato a questo MAC all’accensione.'
                : 'La tua TV LG non espone il MAC a Home Assistant: scrivilo qui una volta per accenderla col Wake-on-LAN.'}
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>,
    document.body,
  )
}
