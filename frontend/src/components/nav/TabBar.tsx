import { motion } from 'framer-motion'
import { Home, LayoutGrid, ShieldCheck, Play, Settings } from 'lucide-react'

export type Tab = 'home' | 'rooms' | 'security' | 'media' | 'settings'

interface TabBarProps {
  active: Tab
  onChange: (tab: Tab) => void
}

const TABS: Array<{ id: Tab; icon: typeof Home; label: string }> = [
  { id: 'home', icon: Home, label: 'Casa' },
  { id: 'rooms', icon: LayoutGrid, label: 'Stanze' },
  { id: 'security', icon: ShieldCheck, label: 'Sicurezza' },
  { id: 'media', icon: Play, label: 'Media' },
  { id: 'settings', icon: Settings, label: 'Impostazioni' },
]

export function TabBar({ active, onChange }: TabBarProps) {
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        backdropFilter: 'blur(var(--tabbar-blur)) saturate(var(--glass-saturation))',
        WebkitBackdropFilter: 'blur(var(--tabbar-blur)) saturate(var(--glass-saturation))',
        background: 'var(--glass-bg)',
        borderTop: '1px solid var(--glass-border)',
        boxShadow: '0 -10px 40px rgba(0, 123, 255, 0.15)',
        paddingBottom: 'max(var(--safe-bottom), 8px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-around',
          paddingTop: 10,
          paddingBottom: 4,
        }}
      >
        {TABS.map(({ id, icon: Icon, label }) => {
          const isActive = id === active
          return (
            <motion.button
              key={id}
              onClick={() => onChange(id)}
              whileTap={{ scale: 0.88 }}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 4,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '4px 9px',
                minWidth: 54,
                borderRadius: 'var(--radius-md)',
              }}
            >
              <div style={{ position: 'relative' }}>
                {isActive && (
                  <motion.div
                    layoutId="tab-indicator"
                    style={{
                      position: 'absolute',
                      inset: '-6px -10px',
                      borderRadius: 12,
                      background: 'var(--glass-bg-active)',
                      border: '1px solid var(--glass-border)',
                    }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <Icon
                  size={22}
                  style={{
                    position: 'relative',
                    color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                    transition: 'color 0.2s ease',
                    filter: isActive ? 'drop-shadow(0 0 8px var(--accent-glow))' : 'none',
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: 9.5,
                  fontWeight: isActive ? 700 : 500,
                  whiteSpace: 'nowrap',
                  color: isActive ? 'var(--accent)' : 'var(--text-tertiary)',
                  letterSpacing: '-0.01em',
                  transition: 'color 0.2s ease',
                }}
              >
                {label}
              </span>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
