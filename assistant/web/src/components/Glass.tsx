import type { CSSProperties, ReactNode } from 'react'

// Versioni leggere di GlassCard/GlassPanel della Liquid Dashboard (stesse classi CSS),
// senza framer-motion: qui non servono animazioni al tocco.

export function GlassCard({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={`glass-card as-card ${className}`} style={style}>
      {children}
    </div>
  )
}

export function Section({ title, intro, actions, children }: { title: string; intro?: string; actions?: ReactNode; children?: ReactNode }) {
  return (
    <GlassCard className="as-section">
      <div className="as-section-head">
        <div>
          <h2 className="text-title as-h2">{title}</h2>
          {intro && <p className="text-body as-intro">{intro}</p>}
        </div>
        {actions}
      </div>
      {children}
    </GlassCard>
  )
}

export function Button({
  children,
  onClick,
  disabled,
  accent,
}: {
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  accent?: boolean
}) {
  return (
    <button type="button" className={`glass-btn as-btn ${accent ? 'glass-btn-accent' : ''}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  )
}
