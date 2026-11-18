import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useBackHandler } from './useBack.js'
import './pickers.css'

// Opens inside .app so the light/dark theme variables still apply
function Layer({ title, onClose, children, footer }) {
  useBackHandler(() => { onClose() })
  const host = document.querySelector('.app') || document.body
  return createPortal(
    <div className="sheet-back" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-body">
          <h3>{title}</h3>
          {children}
        </div>
        <div className="sheet-bar">{footer}</div>
      </div>
    </div>,
    host
  )
}

const norm = (o) => (o && typeof o === 'object' ? o : { value: o, label: String(o) })

export function Select({ value, onChange, options, title = 'Choose', placeholder = 'Choose', disabled }) {
  const [open, setOpen] = useState(false)
  const list = options.map(norm)
  const cur = list.find((o) => String(o.value) === String(value))
  return (
    <>
      <button type="button" className="pk-trigger" disabled={disabled} onClick={() => setOpen(true)}>
        <span className={cur && cur.value !== '' ? '' : 'pk-ph'}>{cur ? cur.label : placeholder}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <Layer title={title} onClose={() => setOpen(false)}
          footer={<button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>}>
          <div className="pk-list" role="listbox">
            {list.map((o) => {
              const on = String(o.value) === String(value)
              return (
                <button key={String(o.value)} type="button" role="option" aria-selected={on}
                  className={`pk-opt ${on ? 'on' : ''}`}
                  onClick={() => { onChange(o.value); setOpen(false) }}>
                  <span>{o.label}</span>
                  <i className="pk-radio" />
                </button>
              )
            })}
          </div>
        </Layer>
      )}
    </>
  )
}

const pad = (n) => String(n).padStart(2, '0')
const show12 = (v) => {
  if (!v) return 'Set time'
  const [h, m] = v.split(':').map(Number)
  return `${h % 12 || 12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'}`
}

const C = 130 // centre of the dial
const R = 100 // radius the numbers sit on

function Dial({ mode, h, m, onHour, onMinute, onDone }) {
  const ref = useRef(null)
  const dragging = useRef(false)

  const frac = mode === 'hour' ? (h % 12) / 12 : m / 60
  const ang = frac * 2 * Math.PI - Math.PI / 2
  const hx = C + R * Math.cos(ang)
  const hy = C + R * Math.sin(ang)

  function pick(e) {
    const r = ref.current.getBoundingClientRect()
    const x = e.clientX - (r.left + r.width / 2)
    const y = e.clientY - (r.top + r.height / 2)
    let deg = (Math.atan2(y, x) * 180) / Math.PI + 90
    if (deg < 0) deg += 360
    if (mode === 'hour') {
      const n = Math.round(deg / 30) % 12
      onHour(n === 0 ? 12 : n)
    } else {
      onMinute(Math.round(deg / 6) % 60)
    }
  }

  const labels = Array.from({ length: 12 }, (_, i) => {
    const n = mode === 'hour' ? (i === 0 ? 12 : i) : i * 5
    const a = (i * 30 - 90) * (Math.PI / 180)
    return {
      n,
      text: mode === 'hour' ? String(n) : pad(n),
      x: C + R * Math.cos(a),
      y: C + R * Math.sin(a),
    }
  })
  const current = mode === 'hour' ? h : m

  return (
    <svg
      ref={ref}
      className="pk-dial"
      viewBox="0 0 260 260"
      onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); pick(e) }}
      onPointerMove={(e) => { if (dragging.current) pick(e) }}
      onPointerUp={() => { if (dragging.current) { dragging.current = false; onDone() } }}
      onPointerCancel={() => { dragging.current = false }}
    >
      <circle cx={C} cy={C} r="126" className="pk-face" />
      <line x1={C} y1={C} x2={hx} y2={hy} className="pk-hand" />
      <circle cx={C} cy={C} r="5" className="pk-pivot" />
      <circle cx={hx} cy={hy} r="21" className="pk-knob" />
      {mode === 'minute' && m % 5 !== 0 && <circle cx={hx} cy={hy} r="3" className="pk-tick" />}
      {labels.map((l) => (
        <text key={l.n} x={l.x} y={l.y} className={`pk-num ${l.n === current ? 'on' : ''}`} textAnchor="middle" dominantBaseline="central">
          {l.text}
        </text>
      ))}
    </svg>
  )
}

export function TimeField({ value, onChange, title = 'Select time', disabled }) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState('hour')
  const [h, setH] = useState(6)
  const [m, setM] = useState(0)
  const [ap, setAp] = useState('AM')

  function openIt() {
    const [hh, mm] = (value || '06:00').split(':').map(Number)
    setH(hh % 12 || 12)
    setM(mm || 0)
    setAp(hh >= 12 ? 'PM' : 'AM')
    setMode('hour')
    setOpen(true)
  }
  function ok() {
    const h24 = (h % 12) + (ap === 'PM' ? 12 : 0)
    onChange(`${pad(h24)}:${pad(m)}`)
    setOpen(false)
  }

  return (
    <>
      <button type="button" className="pk-trigger" disabled={disabled} onClick={openIt}>
        <span>{show12(value)}</span>
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
      </button>
      {open && (
        <Layer
          title={title}
          onClose={() => setOpen(false)}
          footer={<>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn" onClick={ok}>Set time</button>
          </>}
        >
          <div className="pk-head">
            <button type="button" className={`pk-part ${mode === 'hour' ? 'on' : ''}`} onClick={() => setMode('hour')}>{h}</button>
            <span className="pk-colon">:</span>
            <button type="button" className={`pk-part ${mode === 'minute' ? 'on' : ''}`} onClick={() => setMode('minute')}>{pad(m)}</button>
            <div className="pk-ap">
              <button type="button" className={ap === 'AM' ? 'on' : ''} onClick={() => setAp('AM')}>AM</button>
              <button type="button" className={ap === 'PM' ? 'on' : ''} onClick={() => setAp('PM')}>PM</button>
            </div>
          </div>
          <Dial
            mode={mode}
            h={h}
            m={m}
            onHour={setH}
            onMinute={setM}
            onDone={() => { if (mode === 'hour') setMode('minute') }}
          />
        </Layer>
      )}
    </>
  )
}