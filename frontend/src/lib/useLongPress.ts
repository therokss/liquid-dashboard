import { useRef } from 'react'
import type React from 'react'

// Handler per "tieni premuto": richiama onLongPress dopo `ms` di pressione. Il tap breve
// richiama onTap (se fornito), altrimenti non fa nulla. Usa i pointer events → touch + mouse.
export function useLongPress(onLongPress: () => void, opts?: { ms?: number; onTap?: () => void }) {
  const ms = opts?.ms ?? 500
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)
  const start = () => {
    fired.current = false
    timer.current = setTimeout(() => { fired.current = true; onLongPress() }, ms)
  }
  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
  return {
    onPointerDown: start,
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onClick: () => { if (fired.current) { fired.current = false; return } opts?.onTap?.() },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  }
}
