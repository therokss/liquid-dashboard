import type { LucideIcon } from 'lucide-react'
import { GlassCard } from '../components/Glass'
import { t } from '../i18n/it'

export function ComingSoonPage({ icon: Icon, title, text, version }: { icon: LucideIcon; title: string; text: string; version: string }) {
  return (
    <div className="as-page">
      <GlassCard className="as-soon">
        <Icon size={40} className="as-soon-icon" aria-hidden />
        <h2 className="text-title as-h2">{title}</h2>
        <p className="text-body">{text}</p>
        <span className="ld-chip">
          {t('plannedIn')} {version}
        </span>
      </GlassCard>
    </div>
  )
}
