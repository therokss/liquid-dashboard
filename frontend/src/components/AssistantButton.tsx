import { memo, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Sparkles, X } from 'lucide-react'
import { useStore } from '../store'
import { useHA } from '../hooks/useHA'
import { useT } from '../i18n'
import { findAssistant, servedByIngress, type AssistantAddon } from '../lib/assistant'

// Pulsante "Claude" in basso a destra, su ogni pagina: apre l'Assistente Claude sopra la
// dashboard. Compare solo agli amministratori (l'Assistente è solo per loro) e solo se
// l'add-on è installato e avviato. Dentro Home Assistant l'Assistente si apre qui, in un
// iframe sulla stessa origine; altrove (app, porta diretta) si apre in Home Assistant.
// Una volta aperto l'iframe resta montato finché la dashboard è aperta, così chiudendo e
// riaprendo una risposta in corso non si interrompe.
export const AssistantButton = memo(function AssistantButton() {
  const t = useT()
  const { sendMessage } = useHA()
  const isAdmin = useStore((s) => s.isAdmin)
  const connected = useStore((s) => s.connected)
  const [addon, setAddon] = useState<AssistantAddon | null>(null)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (!isAdmin || !connected) return
    let cancelled = false
    findAssistant(sendMessage)
      .then((a) => { if (!cancelled) setAddon(a) })
      .catch(() => { if (!cancelled) setAddon(null) })
    return () => { cancelled = true }
  }, [isAdmin, connected, sendMessage])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!isAdmin || !addon) return null
  const inline = servedByIngress()

  const onClick = () => {
    if (inline) {
      setMounted(true)
      setOpen(true)
      return
    }
    const s = useStore.getState()
    const base = (s.activeHassUrl || (localStorage.getItem('ha-ll-use-proxy') === '1' ? `${location.protocol}//${location.hostname}:8123` : s.hassUrl)).replace(/\/$/, '')
    window.open(`${base}/hassio/ingress/${addon.slug}`, '_blank', 'noopener')
  }

  return (
    <>
      {!open && (
        <motion.button
          type="button"
          onClick={onClick}
          whileTap={{ scale: 0.88 }}
          aria-label={t('Assistente Claude')}
          title={t('Assistente Claude')}
          className="glass-btn"
          style={{
            position: 'fixed',
            right: 16,
            bottom: 'calc(var(--tabbar-height) + var(--safe-bottom) + 12px)',
            zIndex: 101,
            width: 52,
            height: 52,
            padding: 0,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent)',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.22), inset 0 1px 0 var(--glass-rim)',
          }}
        >
          <Sparkles size={22} />
        </motion.button>
      )}
      {mounted && inline && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('Assistente Claude')}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 2500,
            display: open ? 'flex' : 'none',
            flexDirection: 'column',
            background: 'var(--overlay-scrim)',
            backdropFilter: 'blur(32px) saturate(1.4)',
            WebkitBackdropFilter: 'blur(32px) saturate(1.4)',
          }}
        >
          <iframe
            title={t('Assistente Claude')}
            src={addon.ingressUrl}
            allow="clipboard-write"
            style={{ flex: 1, width: '100%', border: 0, background: 'transparent' }}
          />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t('Chiudi')}
            title={t('Chiudi')}
            className="glass-btn"
            style={{
              position: 'absolute',
              top: 'calc(var(--safe-top, env(safe-area-inset-top, 0px)) + 12px)',
              right: 12,
              width: 40,
              height: 40,
              padding: 0,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={18} />
          </button>
        </div>,
        document.body,
      )}
    </>
  )
})
