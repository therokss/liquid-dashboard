export interface ChartSeries {
  values: number[]
  color: string
  fill?: boolean
  dashed?: boolean
}

// Grafico a linee minimale (sparkline). Più serie sovrapposte, scala condivisa.
export function MiniChart({
  series,
  width = 300,
  height = 60,
  strokeWidth = 2,
}: {
  series: ChartSeries[]
  width?: number
  height?: number
  strokeWidth?: number
}) {
  const all = series.flatMap((s) => s.values).filter((v) => !isNaN(v))
  if (all.length < 2) return null
  const min = Math.min(...all)
  const max = Math.max(...all)
  const range = max - min || 1
  const pad = strokeWidth + 1

  const toPath = (values: number[]) => {
    const clean = values.filter((v) => !isNaN(v))
    const n = clean.length
    if (n < 2) return ''
    return clean
      .map((v, i) => {
        const x = (i / (n - 1)) * width
        const y = pad + (1 - (v - min) / range) * (height - pad * 2)
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  }

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      {series.map((s, i) => {
        const path = toPath(s.values)
        if (!path) return null
        return (
          <g key={i}>
            {s.fill && <path d={`${path} L${width},${height} L0,${height} Z`} fill={s.color} opacity={0.14} />}
            <path
              d={path}
              fill="none"
              stroke={s.color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={s.dashed ? '4 3' : undefined}
              vectorEffect="non-scaling-stroke"
            />
          </g>
        )
      })}
    </svg>
  )
}
