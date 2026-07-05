import { useState } from 'react'
import { motion } from 'framer-motion'
import { Wifi, Check, AlertCircle, ChevronDown } from 'lucide-react'
import { createLongLivedTokenAuth, createConnection } from 'home-assistant-js-websocket'
import { useStore } from '../../store'
import { saveToken } from '../../hooks/useHA'

interface ConnectStepProps {
  onNext: () => void
}

type Status = 'idle' | 'testing' | 'success' | 'error'

export function ConnectStep({ onNext }: ConnectStepProps) {
  const hassUrl = useStore((s) => s.hassUrl)
  const setHassUrl = useStore((s) => s.setHassUrl)

  const [token, setToken] = useState('')
  const [customUrl, setCustomUrl] = useState(hassUrl)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const autoUrl = hassUrl || 'http://homeassistant.local:8123'

  async function testAndConnect() {
    if (!token.trim()) {
      setErrorMsg('Inserisci il token di accesso')
      setStatus('error')
      return
    }

    setStatus('testing')
    setErrorMsg('')

    const url = showAdvanced ? customUrl : autoUrl

    try {
      const auth = createLongLivedTokenAuth(url, token.trim())
      const conn = await createConnection({ auth })
      conn.close()

      saveToken(token.trim())
      setHassUrl(url)

      // Salva anche sul server addon (gestisce "Elimina dati")
      try {
        const base = window.location.pathname.endsWith('/')
          ? window.location.origin + window.location.pathname.slice(0, -1)
          : window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '')
        await fetch(base + '/api/addon-config/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: token.trim(), ha_url: url }),
        })
      } catch { /* non critico se non è un addon */ }

      setStatus('success')
      setTimeout(() => onNext(), 800)
    } catch {
      setStatus('error')
      setErrorMsg('Impossibile connettersi. Verifica il token e l\'URL di Home Assistant.')
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}
    >
      {/* Icona */}
      <div style={{ textAlign: 'center', marginBottom: 'var(--space-md)' }}>
        <motion.div
          animate={status === 'testing' ? { rotate: 360 } : { rotate: 0 }}
          transition={{ duration: 1, repeat: status === 'testing' ? Infinity : 0, ease: 'linear' }}
          style={{
            width: 72,
            height: 72,
            borderRadius: 22,
            background: status === 'success' ? 'rgba(102,187,106,0.2)' : status === 'error' ? 'rgba(239,83,80,0.2)' : 'var(--glass-bg)',
            border: `1px solid ${status === 'success' ? 'rgba(102,187,106,0.4)' : status === 'error' ? 'rgba(239,83,80,0.4)' : 'var(--glass-border)'}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto',
          }}
        >
          {status === 'success'
            ? <Check size={32} color="#66bb6a" />
            : status === 'error'
            ? <AlertCircle size={32} color="#ef5350" />
            : <Wifi size={32} color="var(--accent)" />
          }
        </motion.div>

        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.03em', marginTop: 16 }}>
          Connetti Home Assistant
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 6, lineHeight: 1.5 }}>
          Genera un token in <strong style={{ color: 'var(--text-primary)' }}>Profilo → Token di lunga durata</strong>
        </p>
      </div>

      {/* URL auto-detected */}
      <div
        style={{
          background: 'rgba(255,255,255,0.06)',
          border: '1px solid var(--glass-border)',
          borderRadius: 'var(--radius-md)',
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <Wifi size={16} color="var(--accent)" style={{ flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
            URL Home Assistant
          </div>
          <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 600 }}>
            {autoUrl || hassUrl}
          </div>
        </div>
      </div>

      {/* Token input */}
      <div>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Token di accesso
        </label>
        <input
          className="glass-input"
          type="password"
          placeholder="eyJ0eXAi..."
          value={token}
          onChange={(e) => { setToken(e.target.value); setStatus('idle') }}
          onKeyDown={(e) => e.key === 'Enter' && testAndConnect()}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      {/* Advanced toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        style={{
          background: 'none',
          border: 'none',
          color: 'var(--text-tertiary)',
          fontSize: 13,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: 0,
          alignSelf: 'flex-start',
        }}
      >
        <ChevronDown
          size={14}
          style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s ease' }}
        />
        URL personalizzato
      </button>

      {showAdvanced && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
          <input
            className="glass-input"
            type="url"
            placeholder="http://192.168.1.x:8123"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
          />
        </motion.div>
      )}

      {/* Error */}
      {status === 'error' && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          style={{
            background: 'rgba(239,83,80,0.12)',
            border: '1px solid rgba(239,83,80,0.3)',
            borderRadius: 'var(--radius-md)',
            padding: '12px 16px',
            fontSize: 13,
            color: '#ef5350',
          }}
        >
          {errorMsg}
        </motion.div>
      )}

      {/* CTA */}
      <motion.button
        className={`glass-btn ${status !== 'success' ? 'glass-btn-accent' : ''}`}
        whileTap={{ scale: 0.97 }}
        onClick={testAndConnect}
        disabled={status === 'testing' || status === 'success'}
        style={{
          width: '100%',
          opacity: status === 'testing' ? 0.7 : 1,
          background: status === 'success' ? '#66bb6a' : undefined,
        }}
      >
        {status === 'testing' ? 'Connessione in corso…' : status === 'success' ? 'Connesso!' : 'Connetti'}
      </motion.button>
    </motion.div>
  )
}
