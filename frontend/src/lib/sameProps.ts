// Confronto props per React.memo nelle card con callback inline (onToggle={() => …}).
// Le funzioni vengono ignorate: sono ricreate a ogni render del genitore ma catturano
// solo valori già presenti tra le props (l'entità) o stabili (callService). Gli oggetti
// "piatti" (es. statistiche ricalcolate a ogni evento) sono confrontati a un livello.
// Usarlo SOLO dove questa ipotesi sulle callback è vera.
export function sameProps<P extends object>(a: P, b: P): boolean {
  const ka = Object.keys(a) as Array<keyof P>
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) {
    const x = a[k]
    const y = b[k]
    if (Object.is(x, y)) continue
    if (typeof x === 'function' && typeof y === 'function') continue
    if (isPlain(x) && isPlain(y) && shallowEqual(x, y)) continue
    return false
  }
  return true
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => Object.is(a[k], b[k]))
}
