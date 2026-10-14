import { CircleCheck, CircleAlert, CircleX, CircleMinus, LoaderCircle } from 'lucide-react'
import type { ProbeStatus } from '../api'

const META: Record<ProbeStatus | 'attesa', { icon: typeof CircleCheck; cls: string; label: string }> = {
  ok: { icon: CircleCheck, cls: 'st-ok', label: 'superata' },
  avviso: { icon: CircleAlert, cls: 'st-warn', label: 'avviso' },
  errore: { icon: CircleX, cls: 'st-err', label: 'errore' },
  saltata: { icon: CircleMinus, cls: 'st-skip', label: 'saltata' },
  attesa: { icon: LoaderCircle, cls: 'st-wait spin', label: 'in corso' },
}

export function StatusIcon({ status, size = 20 }: { status: ProbeStatus | 'attesa'; size?: number }) {
  const { icon: Icon, cls, label } = META[status]
  return <Icon size={size} className={cls} aria-label={label} role="img" />
}
