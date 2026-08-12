export function ElevationChart({ values }: { values: number[] }) {
  if (values.length < 2) return null
  const width = 600
  const height = 150
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = Math.max(1, max - min)
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width
    const y = height - ((value - min) / range) * (height - 24) - 12
    return `${x},${y}`
  }).join(' ')
  const area = `0,${height} ${points} ${width},${height}`
  return (
    <div className="elevation-chart">
      <div className="chart-labels"><span>{max}m</span><span>標高プロファイル</span><span>{min}m</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`最低標高${min}m、最高標高${max}m`} preserveAspectRatio="none">
        <defs><linearGradient id="elevationFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6fc29d" stopOpacity=".7"/><stop offset="1" stopColor="#6fc29d" stopOpacity=".06"/></linearGradient></defs>
        <polygon points={area} fill="url(#elevationFill)" />
        <polyline points={points} fill="none" stroke="#2d795a" strokeWidth="4" vectorEffect="non-scaling-stroke" />
      </svg>
    </div>
  )
}
