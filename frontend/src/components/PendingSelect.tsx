import { useEffect, useState } from 'react'

// <select> che mostra SUBITO l'opzione scelta: tiene uno stato "pending" locale finché
// lo stato reale non cambia (conferma o override ottimistico) o per qualche secondo al
// massimo, poi torna a seguire HA. Senza, il menu scattava indietro al valore vecchio
// finché non arrivava l'evento da Home Assistant.
export function PendingSelect({ value, options, onSelect, className = 'ld-select', style }: {
  value: string
  options: string[]
  onSelect: (opt: string) => void
  className?: string
  style?: React.CSSProperties
}) {
  const [pending, setPending] = useState<string | null>(null)
  const [base, setBase] = useState(value)
  // Lo stato reale è cambiato → il pending non serve più (pattern "reset on prop change").
  if (base !== value) {
    setBase(value)
    setPending(null)
  }
  useEffect(() => {
    if (pending === null) return
    const t = setTimeout(() => setPending(null), 5000)
    return () => clearTimeout(t)
  }, [pending])

  return (
    <select
      className={className}
      style={style}
      value={pending ?? value}
      onChange={(ev) => { setPending(ev.target.value); onSelect(ev.target.value) }}
    >
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  )
}
