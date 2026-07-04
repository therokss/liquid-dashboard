import type { ReactNode, CSSProperties } from 'react'

interface GlassPanelProps {
  children: ReactNode
  className?: string
  style?: CSSProperties
  padding?: boolean
}

export function GlassPanel({ children, className = '', style, padding = true }: GlassPanelProps) {
  return (
    <div
      className={`glass-panel ${className}`}
      style={{
        padding: padding ? 'var(--space-lg)' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

interface GlassDividerProps {
  vertical?: boolean
}

export function GlassDivider({ vertical }: GlassDividerProps) {
  return (
    <div
      style={{
        background: 'var(--glass-border-dim)',
        width: vertical ? '1px' : '100%',
        height: vertical ? '100%' : '1px',
        flexShrink: 0,
      }}
    />
  )
}
