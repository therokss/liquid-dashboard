import { Children, useEffect, useState, type ReactNode } from 'react'

// Masonry a colonne fatto in JS invece che con `column-count` CSS.
//
// Perché: Safari NON renderizza correttamente gli elementi con backdrop-filter (il
// nostro "vetro") dentro un contenitore `column-count` — le card in cima alle colonne
// spariscono. Qui creiamo colonne flex reali e distribuiamo le sezioni round-robin:
// nessun glitch, e su mobile (1 colonna) il flusso resta identico a prima.
export function MasonryColumns({ children, gap = 'var(--space-xl)' }: { children: ReactNode; gap?: string }) {
  const cols = useColumnCount()
  const items = Children.toArray(children).filter(Boolean)

  if (cols <= 1) return <>{items}</>

  const columns: ReactNode[][] = Array.from({ length: cols }, () => [])
  items.forEach((child, i) => columns[i % cols].push(child))

  return (
    <div style={{ display: 'flex', gap, alignItems: 'flex-start' }}>
      {columns.map((col, i) => (
        <div key={i} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {col}
        </div>
      ))}
    </div>
  )
}

// 1 colonna su telefono, 2 su tablet/desktop, 3 su schermi molto ampi.
export function useColumnCount(): number {
  const [cols, setCols] = useState(1)
  useEffect(() => {
    const mq2 = window.matchMedia('(min-width: 1080px)')
    const mq3 = window.matchMedia('(min-width: 1600px)')
    const update = () => setCols(mq3.matches ? 3 : mq2.matches ? 2 : 1)
    update()
    mq2.addEventListener('change', update)
    mq3.addEventListener('change', update)
    return () => {
      mq2.removeEventListener('change', update)
      mq3.removeEventListener('change', update)
    }
  }, [])
  return cols
}
