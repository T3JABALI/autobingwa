export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const money = (n) =>
  Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function niceStep(x) {
  const pow = Math.pow(10, Math.floor(Math.log10(x)))
  const n = x / pow
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow
}

function axisMax(peak) {
  if (peak <= 0) return 100
  return niceStep(peak / 4) * 4
}

// Smooth monotone curve, so it never overshoots or shows sharp corners.
function smoothPath(pts) {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${pts[0].x},${pts[0].y}`
  const dx = []
  const m = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1].x - pts[i].x
    m[i] = (pts[i + 1].y - pts[i].y) / dx[i]
  }
  const t = new Array(n)
  t[0] = m[0]
  t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
    } else {
      const a = t[i] / m[i]
      const b = t[i + 1] / m[i]
      const s = a * a + b * b
      if (s > 9) {
        const tau = 3 / Math.sqrt(s)
        t[i] = tau * a * m[i]
        t[i + 1] = tau * b * m[i]
      }
    }
  }
  let d = `M${pts[0].x},${pts[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += ` C${pts[i].x + h},${pts[i].y + t[i] * h} ${pts[i + 1].x - h},${pts[i + 1].y - t[i + 1] * h} ${pts[i + 1].x},${pts[i + 1].y}`
  }
  return d
}

export default function CommissionChart({ values, todayIndex, total }) {
  const W = 400
  const H = 230
  const left = 52
  const right = 14
  const top = 26
  const bottom = 34
  const plotW = W - left - right
  const plotH = H - top - bottom
  const shown = values.slice(0, todayIndex + 1)
  const max = axisMax(Math.max(0, ...shown))
  const y = (v) => top + plotH - (v / max) * plotH
  const x = (i) => left + (plotW / 6) * i
  const ticks = [0, 1, 2, 3, 4].map((k) => (max / 4) * k)
  const pts = shown.map((v, i) => ({ x: x(i), y: y(v) }))
  const line = smoothPath(pts)
  const area =
    pts.length > 1 ? `${line} L${pts[pts.length - 1].x},${y(0)} L${pts[0].x},${y(0)} Z` : ''

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Daily commission this week, total KES ${money(total)}`}>
      <text className="hm-axis" x={left - 8} y={12} textAnchor="end">KES</text>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className="hm-grid" x1={left} x2={W - right} y1={y(tick)} y2={y(tick)} />
          <text className="hm-axis" x={left - 8} y={y(tick) + 4} textAnchor="end">
            {Number(tick.toFixed(2))}
          </text>
        </g>
      ))}
      {area && <path className="hm-area" d={area} />}
      {line && <path className="hm-line" d={line} />}
      {pts.map((p, i) => (
        <circle key={i} className="hm-dot" cx={p.x} cy={p.y} r="4" />
      ))}
      {WEEKDAYS.map((day, i) => (
        <text
          key={day}
          className={`hm-axis ${i === todayIndex ? 'today' : ''}`}
          x={x(i)}
          y={H - 10}
          textAnchor="middle"
        >
          {day}
        </text>
      ))}
    </svg>
  )
}