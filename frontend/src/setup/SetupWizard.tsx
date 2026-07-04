import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ConnectStep } from './steps/ConnectStep'
import { RoomsStep } from './steps/RoomsStep'
import { ThemeStep } from './steps/ThemeStep'

interface SetupWizardProps {
  onComplete: () => void
}

type Step = 'connect' | 'rooms' | 'theme'
const STEPS: Step[] = ['connect', 'rooms', 'theme']
const STEP_LABELS = ['Connetti', 'Stanze', 'Look']

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [currentStep, setCurrentStep] = useState<Step>('connect')
  const stepIndex = STEPS.indexOf(currentStep)

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'var(--space-md)',
        paddingTop: 'max(var(--space-xl), env(safe-area-inset-top, 20px))',
        paddingBottom: 'max(var(--space-xl), env(safe-area-inset-bottom, 20px))',
      }}
    >
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-2xl)' }}>
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 20,
                background: 'var(--glass-bg)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                border: '1px solid var(--glass-border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 16px',
                boxShadow: '0 0 40px var(--accent-glow)',
                fontSize: 28,
              }}
            >
              💧
            </div>
          </motion.div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 28,
              fontWeight: 800,
              color: 'var(--text-primary)',
              letterSpacing: '-0.04em',
            }}
          >
            Liquid Dashboard
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: 14, marginTop: 6 }}>
            Configurazione iniziale
          </p>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--space-xl)', gap: 6 }}>
          {STEPS.map((step, i) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', flex: i < STEPS.length - 1 ? 1 : 'none' }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: i <= stepIndex ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                  border: i <= stepIndex ? 'none' : '1px solid var(--glass-border)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 11,
                  fontWeight: 700,
                  color: i <= stepIndex ? 'white' : 'var(--text-tertiary)',
                  flexShrink: 0,
                  transition: 'background 0.3s ease',
                  boxShadow: i === stepIndex ? '0 0 12px var(--accent-glow)' : 'none',
                }}
              >
                {i < stepIndex ? '✓' : i + 1}
              </div>
              <span
                style={{
                  fontSize: 11,
                  color: i === stepIndex ? 'var(--accent)' : 'var(--text-tertiary)',
                  fontWeight: i === stepIndex ? 700 : 500,
                  marginLeft: 6,
                  transition: 'color 0.3s ease',
                }}
              >
                {STEP_LABELS[i]}
              </span>
              {i < STEPS.length - 1 && (
                <div
                  style={{
                    flex: 1,
                    height: 1,
                    background: i < stepIndex ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
                    marginLeft: 8,
                    transition: 'background 0.3s ease',
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Glass container */}
        <div
          className="glass-panel glass-scroll"
          style={{ maxHeight: 'calc(100dvh - 320px)', overflowY: 'auto', padding: 'var(--space-xl)' }}
        >
          <AnimatePresence mode="wait">
            {currentStep === 'connect' && (
              <ConnectStep key="connect" onNext={() => setCurrentStep('rooms')} />
            )}
            {currentStep === 'rooms' && (
              <RoomsStep key="rooms" onNext={() => setCurrentStep('theme')} />
            )}
            {currentStep === 'theme' && (
              <ThemeStep key="theme" onDone={onComplete} />
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
