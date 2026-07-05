import { motion, type HTMLMotionProps } from 'framer-motion'
import type { CSSProperties, ReactNode } from 'react'

interface GlassCardProps extends Omit<HTMLMotionProps<'div'>, 'children'> {
  children: ReactNode
  glowColor?: string
  active?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
  style?: CSSProperties
}

const sizeStyles: Record<string, CSSProperties> = {
  sm: { borderRadius: 'var(--radius-md)', padding: 'var(--space-md)' },
  md: { borderRadius: 'var(--radius-lg)', padding: 'var(--space-lg)' },
  lg: { borderRadius: 'var(--radius-xl)', padding: 'var(--space-xl)' },
}

export function GlassCard({
  children,
  glowColor,
  active,
  size = 'md',
  className = '',
  style,
  ...props
}: GlassCardProps) {
  return (
    <motion.div
      className={`glass-card ${active ? 'entity-glow' : ''} ${className}`}
      style={{
        ...sizeStyles[size],
        ...(glowColor ? { '--entity-color': glowColor } as CSSProperties : {}),
        ...style,
      }}
      whileTap={{ scale: 0.94 }}
      transition={{ type: 'spring', stiffness: 500, damping: 24, mass: 0.7 }}
      {...props}
    >
      {children}
    </motion.div>
  )
}
