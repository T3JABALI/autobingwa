import { useEffect, useState } from 'react'
import { TOAST_EVENT } from './notify.js'
import { CSS } from './toastStyles.js'

const QUOTES = [
  'Automation Meets Ultimate Speeds.',
  'Consistency Powered by AUTOBINGWA',
  'Every Transaction Counts. Keep Going.',
  'Speed Today. Profit Tomorrow.',
  'Small Sales, Big Success. Stay Consistent.',
]

export default function Toaster() {
  const [items, setItems] = useState([])

  useEffect(() => {
    let n = 0
    const show = (message, type = 'info', title = '') => {
      const id = Date.now() + Math.random()
      setItems((list) => [...list.slice(-2), { id, message, type, title }])
      setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), type === 'motivation' ? 6000 : 4500)
    }
    const onToast = (e) => show(e.detail.message, e.detail.type, e.detail.title)
    window.addEventListener(TOAST_EVENT, onToast)
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') show(QUOTES[n++ % QUOTES.length], 'motivation', 'AUTOBINGWA')
    }, 60000)
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast)
      clearInterval(timer)
    }
  }, [])

  const close = (id) => setItems((list) => list.filter((t) => t.id !== id))

  return (
    <div className="tt-wrap" aria-live="polite">
      <style>{CSS}</style>
      {items.map((t) => (
        <div key={t.id} className={`tt ${t.type}`} role="status">
          {t.type === 'processing' && <span className="tt-spin" />}
          <div className="tt-body">
            {t.title && <div className="tt-title">{t.title}</div>}
            <div className="tt-msg">{t.message}</div>
          </div>
          <button className="tt-x" onClick={() => close(t.id)} aria-label="Dismiss">×</button>
        </div>
      ))}
    </div>
  )
}