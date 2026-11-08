import { useEffect, useRef, useState } from 'react'

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function scale(max) {
  if (!(max > 0)) return { top: 40, step: 10 }
  const rough = max / 4
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= rough)
  return { top: step * Math.ceil(max / step), step }
}

const short = (v) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : String(Math.round(v)))
const val = (v) => Math.max(0, Number(v) || 0)

const curve = (pts) =>
  pts.reduce((d, [px, py], i) => {
    if (i === 0) return `M${px},${py}`
    const [qx, qy] = pts[i - 1]
    const mx = (qx + px) / 2
    return `${d} C${mx},${qy} ${mx},${py} ${px},${py}`
  }, '')

// series: [{ values: number[], color: 'var(--primary)', fill?: boolean }]
// upto: last index that has real data (later points are not drawn)
export function GlowChart({ series = [], labels = [], upto = -1, highlight = -1, showValues = false, uid = 'g' }) {
  const box = useRef(null)
  const [size, setSize] = useState({ w: 320, h: 110 })

  useEffect(() => {
    const el = box.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      if (r.width > 0 && r.height > 0) setSize({ w: Math.floor(r.width), h: Math.floor(r.height) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { w, h } = size
  const n = labels.length
  const lastIdx = Math.min(upto, n - 1)
  let max = 0
  series.forEach((s) => {
    for (let i = 0; i <= lastIdx; i++) max = Math.max(max, val(s.values[i]))
  })
  const { top, step } = scale(max)
  const ticks = []
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v)

  const padL = 32
  const padR = 16
  const padT = 16
  const padB = 18
  const inset = 12
  const cw = Math.max(10, w - padL - padR)
  const ch = Math.max(10, h - padT - padB)
  const x = (i) => padL + inset + (n > 1 ? ((cw - 2 * inset) * i) / (n - 1) : (cw - 2 * inset) / 2)
  const y = (v) => padT + ch - (v / top) * ch
  const base = y(0)
  const txt = { fontFamily: 'inherit', fontSize: 9 }

  return (
    <div ref={box} style={{ position: 'relative', flex: '1 1 0', width: '100%', minWidth: 0, minHeight: 0 }}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ position: 'absolute', inset: 0, display: 'block' }}
        role="img"
        aria-label="Chart"
      >
        <defs>
          <filter id={`${uid}-glow`} filterUnits="userSpaceOnUse" x="0" y="0" width={w} height={h}>
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
          {series.map((s, k) => (
            <linearGradient key={k} id={`${uid}-f${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" style={{ stopColor: s.color, stopOpacity: 0.5 }} />
              <stop offset="1" style={{ stopColor: s.color, stopOpacity: 0.03 }} />
            </linearGradient>
          ))}
        </defs>

        <text x="2" y="9" style={{ ...txt, fill: 'var(--soft)', fontSize: 8 }}>KES</text>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--border)', strokeWidth: 1, strokeDasharray: t === 0 ? 'none' : '3 4' }} />
            <text x={padL - 5} y={y(t) + 3} textAnchor="end" style={{ ...txt, fill: 'var(--soft)' }}>
              {short(t)}
            </text>
          </g>
        ))}

        {series.map((s, k) => {
          const pts = []
          for (let i = 0; i <= lastIdx; i++) pts.push([x(i), y(val(s.values[i]))])
          if (!pts.length) return null
          const line = curve(pts)
          const area = pts.length > 1 ? `${line} L${pts[pts.length - 1][0]},${base} L${pts[0][0]},${base} Z` : ''
          return (
            <g key={k}>
              {s.fill && area && <path d={area} style={{ fill: `url(#${uid}-f${k})` }} />}
              {s.fill && pts.length === 1 && (
                <rect x={pts[0][0] - 1.5} y={pts[0][1]} width="3" height={Math.max(0, base - pts[0][1])} rx="1.5" style={{ fill: `url(#${uid}-f${k})` }} />
              )}
              {pts.length > 1 && (
                <path d={line} filter={`url(#${uid}-glow)`} style={{ fill: 'none', stroke: s.color, strokeWidth: 7, opacity: 0.55, strokeLinecap: 'round' }} />
              )}
              {pts.length > 1 && (
                <path d={line} style={{ fill: 'none', stroke: s.color, strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
              )}
              {pts.map(([px, py], i) => (
                <g key={i}>
                  <circle cx={px} cy={py} r="7" style={{ fill: s.color, opacity: 0.22 }} />
                  <circle cx={px} cy={py} r="3.2" style={{ fill: 'var(--bg)', stroke: s.color, strokeWidth: 1.8 }} />
                  {showValues && k === 0 && val(s.values[i]) > 0 && (
                    <text x={px} y={Math.max(9, py - 9)} textAnchor="middle" style={{ ...txt, fill: 'var(--text)', fontWeight: 700 }}>
                      {short(val(s.values[i]))}
                    </text>
                  )}
                </g>
              ))}
            </g>
          )
        })}

        {labels.map((d, i) => (
          <text
            key={d}
            x={x(i)}
            y={h - 4}
            textAnchor="middle"
            style={{ ...txt, fill: i === highlight ? 'var(--primary)' : 'var(--soft)', fontWeight: i === highlight ? 700 : 400 }}
          >
            {d}
          </text>
        ))}
      </svg>
    </div>
  )
}

// The Home screen chart: daily commissions, Sunday to Saturday
export default function CommissionChart({ values = [], todayIndex = -1 }) {
  const last = todayIndex >= 0 ? Math.min(todayIndex, values.length - 1) : values.length - 1
  return (
    <GlowChart
      uid="hm"
      labels={WEEKDAYS}
      upto={last}
      highlight={todayIndex}
      showValues
      series={[{ values, color: 'var(--primary)', fill: true }]}
    />
  )
}