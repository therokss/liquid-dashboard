import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, ShieldAlert } from 'lucide-react'
import QRCode from 'qrcode'
import { makeCredsQR } from '../lib/credsQR'

// Mostra un QR con le credenziali (token + URL) di questo dispositivo, da scansionare su
// un altro (iPhone ↔ Android) per configurarlo senza riscrivere il token.
export function CredsQRModal({ url, externalUrl, onClose }: { url: string; externalUrl?: string; onClose: () => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    const token = localStorage.getItem('ha-ll-token') || ''
    if (!token) { setErr('Nessun token salvato su questo dispositivo.'); return }
    QRCode.toDataURL(makeCredsQR(token, url, externalUrl), { width: 360, margin: 2, errorCorrectionLevel: 'M' })
      .then(setDataUrl)
      .catch(() => setErr('Impossibile generare il QR.'))
  }, [url, externalUrl])

  return createPortal(
    <motion.div
      data-theme="dark"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 3500, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(3,10,20,0.7)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)', padding: 'var(--space-lg)' }}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#08192b', border: '1px solid var(--glass-border)', borderRadius: 22, maxWidth: 380, width: '100%', padding: 'var(--space-lg)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>Trasferisci su un altro dispositivo</h3>
          <button onClick={onClose} aria-label="Chiudi" style={{ width: 32, height: 32, borderRadius: 10, cursor: 'pointer', background: 'var(--glass-bg)', border: '1px solid var(--glass-border)', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <X size={17} />
          </button>
        </div>

        {dataUrl ? (
          <img src={dataUrl} alt="QR credenziali" style={{ width: 260, height: 260, borderRadius: 14, background: '#fff', padding: 8 }} />
        ) : (
          <div style={{ width: 260, height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 14 }}>
            {err || 'Genero il QR…'}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', color: 'var(--text-secondary)', fontSize: 12.5, lineHeight: 1.45 }}>
          <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: 1, color: '#e6a23c' }} />
          <span>Sull'altro dispositivo, al primo avvio tocca <strong style={{ color: 'var(--text-primary)' }}>Scansiona QR</strong>. Il QR contiene il token: non condividerlo.</span>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
