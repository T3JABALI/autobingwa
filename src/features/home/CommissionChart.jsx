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

export default function CommissionChart({ values = [], todayIndex = -1 }) {
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
  const max = Math.max(0, ...values)
  const { top, step } = scale(max)
  const ticks = []
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v)

  const padL = 30
  const padR = 14
  const padT = 16
  const padB = 18
  const cw = Math.max(10, w - padL - padR)
  const ch = Math.max(10, h - padT - padB)
  const x = (i) => padL + (cw * i) / 6
  const y = (v) => padT + ch - (v / top) * ch

  const last = todayIndex >= 0 ? Math.min(todayIndex, values.length - 1) : values.length - 1
  const pts = []
  for (let i = 0; i <= last; i++) pts.push([x(i), y(values[i] || 0)])

  let line = ''
  pts.forEach(([px, py], i) => {
    if (i === 0) {
      line = `M${px},${py}`
      return
    }
    const [qx, qy] = pts[i - 1]
    const mx = (qx + px) / 2
    line += ` C${mx},${qy} ${mx},${py} ${px},${py}`
  })
  const area =
    pts.length > 1
      ? `${line} L${pts[pts.length - 1][0]},${y(0)} L${pts[0][0]},${y(0)} Z`
      : ''

  const txt = { fontFamily: 'inherit', fontSize: 9 }

  return (
    <div ref={box} style={{ position: 'relative', flex: '1 1 0', width: '100%', minWidth: 0, minHeight: 0 }}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ position: 'absolute', inset: 0, display: 'block' }}
        role="img"
        aria-label="Daily commissions this week"
      >
        <defs>
          <linearGradient id="hm-cg" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--primary)', stopOpacity: 0.32 }} />
            <stop offset="1" style={{ stopColor: 'var(--primary)', stopOpacity: 0.02 }} />
          </linearGradient>
        </defs>

        <text x="2" y="9" style={{ ...txt, fill: 'var(--soft)', fontSize: 8 }}>KES</text>

        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--border)', strokeWidth: 1 }} />
            <text x={padL - 5} y={y(t) + 3} textAnchor="end" style={{ ...txt, fill: 'var(--soft)' }}>
              {short(t)}
            </text>
          </g>
        ))}

        {area && <path d={area} style={{ fill: 'url(#hm-cg)' }} />}
        {line && (
          <path d={line} style={{ fill: 'none', stroke: 'var(--primary)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }} />
        )}

        {pts.map(([px, py], i) => (
          <g key={i}>
            <circle cx={px} cy={py} r="3" style={{ fill: 'var(--bg)', stroke: 'var(--primary)', strokeWidth: 1.6 }} />
            {(values[i] || 0) > 0 && (
              <text x={px} y={Math.max(9, py - 6)} textAnchor="middle" style={{ ...txt, fill: 'var(--text)', fontWeight: 700 }}>
                {short(values[i])}
              </text>
            )}
          </g>
        ))}

        {WEEKDAYS.map((d, i) => (
          <text
            key={d}
            x={x(i)}
            y={h - 4}
            textAnchor="middle"
            style={{ ...txt, fill: i === todayIndex ? 'var(--primary)' : 'var(--soft)', fontWeight: i === todayIndex ? 700 : 400 }}
          >
            {d}
          </text>
        ))}
      </svg>
    </div>
  )
}