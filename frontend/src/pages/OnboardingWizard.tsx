import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CheckCircle2, Home, Eye } from 'lucide-react'
import { RoomAssigner } from '../components/RoomAssigner'
import { VisibilityStepper } from '../components/VisibilityStepper'

type Step = 'intro' | 'rooms' | 'visibility' | 'done'

const primaryBtn: React.CSSProperties = {
  width: '100%', padding: '15px', borderRadius: 'var(--radius-md)',
  background: 'var(--accent)', border: 'none', color: '#04121e',
  fontSize: 15, fontWeight: 700, cursor: 'pointer',
  boxShadow: '0 6px 20px var(--accent-glow)',
}
const ghostBtn: React.CSSProperties = {
  width: '100%', padding: '15px', borderRadius: 'var(--radius-md)',
  background: 'var(--glass-bg)', border: '1px solid var(--glass-border)',
  color: 'var(--text-primary)', fontSize: 15, fontWeight: 600, cursor: 'pointer',
}

export function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<Step>('intro')

  return (
    <div
      data-theme="dark"
      style={{
        position: 'fixed', inset: 0, zIndex: 3000, overflowY: 'auto',
        background: '#051424',
        backgroundImage:
          'radial-gradient(circle at 12% 6%, rgba(0,219,231,0.12), transparent 42%), radial-gradient(circle at 88% 94%, rgba(74,142,255,0.14), transparent 46%)',
      }}
    >
      <div
        style={{
          maxWidth: 640, margin: '0 auto', minHeight: '100dvh',
          display: 'flex', flexDirection: 'column',
          padding: 'calc(env(safe-area-inset-top, 0px) + 24px) var(--space-lg) calc(env(safe-area-inset-bottom, 0px) + 24px)',
        }}
      >
        <AnimatePresence mode="wait">
          {step === 'intro' && (
            <motion.div key="intro" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 24 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 56, marginBottom: 12 }}>💧</div>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
                  Benvenuto
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 15, marginTop: 8 }}>
                  Configuriamo la tua casa in un minuto.
                </p>
              </div>
              <div className="glass-panel" style={{ padding: 'var(--space-lg)' }}>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 16, lineHeight: 1.4 }}>
                  Hai già assegnato tutti i dispositivi alle stanze in Home Assistant?
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button style={primaryBtn} onClick={() => setStep('visibility')}>Sì, sono a posto</button>
                  <button style={ghostBtn} onClick={() => setStep('rooms')}>No, sistemali ora</button>
                </div>
              </div>
            </motion.div>
          )}

          {step === 'rooms' && (
            <motion.div key="rooms" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <StepHeader icon={<Home size={22} />} title="Assegna le stanze" subtitle="Metti ogni dispositivo nella sua stanza." />
              <div style={{ flex: 1, marginBottom: 'var(--space-lg)' }}>
                <RoomAssigner />
              </div>
              <button style={primaryBtn} onClick={() => setStep('visibility')}>Avanti</button>
            </motion.div>
          )}

          {step === 'visibility' && (
            <motion.div key="visibility" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <StepHeader icon={<Eye size={22} />} title="Cosa mostrare" subtitle="Un dispositivo alla volta: scegli se mostrarlo o nasconderlo." />
              <div style={{ flex: 1, minHeight: 0 }}>
                <VisibilityStepper onDone={() => setStep('done')} />
              </div>
            </motion.div>
          )}

          {step === 'done' && (
            <motion.div key="done" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 20, textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--accent)' }}>
                <CheckCircle2 size={64} strokeWidth={1.5} />
              </div>
              <div>
                <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>
                  Tutto pronto!
                </h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: 15, marginTop: 8 }}>
                  Puoi rifare queste impostazioni quando vuoi da Impostazioni.
                </p>
              </div>
              <button style={primaryBtn} onClick={onDone}>Inizia</button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

function StepHeader({ icon, title, subtitle }: { icon: React.ReactNode; title: string; subtitle: string }) {
  return (
    <div style={{ marginBottom: 'var(--space-lg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: 'var(--accent-glow)', border: '1px solid var(--glass-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)' }}>
          {icon}
        </div>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em' }}>{title}</h2>
      </div>
      <p style={{ color: 'var(--text-secondary)', fontSize: 14 }}>{subtitle}</p>
    </div>
  )
}
