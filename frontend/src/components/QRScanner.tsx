import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { X, CameraOff } from 'lucide-react'
import jsQR from 'jsqr'
import { useT } from '../i18n'

// Scanner QR: apre la fotocamera (posteriore), analizza i frame con jsQR e richiama
// onScan col testo decodificato. Funziona nella webview delle app (contesto sicuro) e
// nel browser via HTTPS.
export function QRScanner({ onScan, onClose }: { onScan: (text: string) => void; onClose: () => void }) {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    const stopStream = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }

    const scan = () => {
      const video = videoRef.current
      if (cancelled || !video || !ctx) return
      if (video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
        if (code && code.data) {
          stopStream()
          onScan(code.data)
          return
        }
      }
      rafRef.current = requestAnimationFrame(scan)
    }

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(t('Fotocamera non disponibile in questo contesto (serve HTTPS o l’app).'))
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        const video = videoRef.current!
        video.srcObject = stream
        await video.play()
        scan()
      } catch {
        setError(t('Impossibile accedere alla fotocamera. Consenti l’accesso nelle impostazioni e riprova.'))
      }
    }

    start()
    return () => { cancelled = true; stopStream() }
  }, [onScan, t])

  return createPortal(
    <motion.div
      data-theme="dark"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ position: 'fixed', inset: 0, zIndex: 3600, background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
    >
      <video ref={videoRef} playsInline muted style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
      {/* Riquadro di mira */}
      {!error && (
        <div style={{ position: 'relative', width: 240, height: 240, borderRadius: 24, border: '3px solid rgba(255,255,255,0.9)', boxShadow: '0 0 0 4000px rgba(0,0,0,0.45)' }} />
      )}
      {error && (
        <div style={{ position: 'relative', textAlign: 'center', padding: 'var(--space-lg)', color: 'white', maxWidth: 320 }}>
          <CameraOff size={40} style={{ opacity: 0.8, marginBottom: 12 }} />
          <div style={{ fontSize: 15, lineHeight: 1.5 }}>{error}</div>
        </div>
      )}
      <div style={{ position: 'absolute', bottom: 'calc(env(safe-area-inset-bottom, 0px) + 32px)', left: 0, right: 0, textAlign: 'center', color: 'rgba(255,255,255,0.85)', fontSize: 14, fontWeight: 600, textShadow: '0 1px 3px rgba(0,0,0,0.6)' }}>
        {t('Inquadra il QR del token')}
      </div>
      <button onClick={onClose} aria-label={t('Chiudi')} style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 16px)', right: 16, width: 44, height: 44, borderRadius: '50%', cursor: 'pointer', background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.3)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <X size={22} />
      </button>
    </motion.div>,
    document.body,
  )
}
