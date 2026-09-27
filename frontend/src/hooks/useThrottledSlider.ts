import { useCallback, useEffect, useRef, useState } from 'react'

// Slider che "segue il dito": durante il trascinamento mostra un valore locale e invia
// a Home Assistant al massimo una chiamata ogni `interval` ms (throttle), più l'invio
// finale al rilascio. Il valore locale resta finché lo stato reale non raggiunge
// l'ultimo valore inviato (entro `tolerance`) o, in mancanza di conferma, per qualche
// secondo dopo l'ultimo movimento: niente salti indietro mentre HA risponde.
export function useThrottledSlider(
  remote: number,
  send: (v: number) => void,
  { interval = 200, tolerance = 0, holdMs = 3000 }: { interval?: number; tolerance?: number; holdMs?: number } = {},
) {
  const [local, setLocal] = useState<number | null>(null)
  const sendRef = useRef(send)
  useEffect(() => { sendRef.current = send }, [send])
  const pending = useRef<number | null>(null)
  const lastValue = useRef<number | null>(null)
  const lastSentAt = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragging = useRef(false)

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    if (pending.current === null) return
    const v = pending.current
    pending.current = null
    lastSentAt.current = Date.now()
    sendRef.current(v)
  }, [])

  const armHold = useCallback(() => {
    if (hold.current) clearTimeout(hold.current)
    hold.current = setTimeout(() => {
      hold.current = null
      dragging.current = false
      setLocal(null)
    }, holdMs)
  }, [holdMs])

  const onChange = useCallback((v: number) => {
    dragging.current = true
    setLocal(v)
    lastValue.current = v
    pending.current = v
    armHold()
    const wait = interval - (Date.now() - lastSentAt.current)
    if (wait <= 0) flush()
    else if (!timer.current) timer.current = setTimeout(flush, wait)
  }, [armHold, flush, interval])

  // Rilascio (pointer/touch/tastiera): invia subito l'ultimo valore.
  const onRelease = useCallback(() => {
    dragging.current = false
    flush()
  }, [flush])

  // Conferma da HA: lo stato reale ha raggiunto l'ultimo valore → torna a seguirlo.
  useEffect(() => {
    if (dragging.current || local === null || lastValue.current === null) return
    if (Math.abs(remote - lastValue.current) <= tolerance) {
      if (hold.current) { clearTimeout(hold.current); hold.current = null }
      setLocal(null)
    }
  }, [remote, local, tolerance])

  // Allo smontaggio invia l'eventuale valore in sospeso e pulisce i timer.
  useEffect(() => () => {
    if (hold.current) clearTimeout(hold.current)
    flush()
  }, [flush])

  // Props pronte da spargere sull'<input type="range">.
  const inputProps = {
    onPointerUp: onRelease,
    onTouchEnd: onRelease,
    onMouseUp: onRelease,
    onKeyUp: onRelease,
    onBlur: onRelease,
  }

  return { value: local ?? remote, onChange, onRelease, inputProps }
}
