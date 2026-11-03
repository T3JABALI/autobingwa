import { useEffect, useState } from 'react'
import { TOAST_EVENT } from './notify.js'
import { CSS } from './toastStyles.js'

// Only these two kinds ever show. Everything else stays silent.
const SHOW = ['processing', 'failed', 'error']

export default function Toaster() {
  const [item, setItem] = useState(null)

  useEffect(() => {
    let current = null
    let queue = []
    let timer = null

    const put = (n) => { current = n; setItem(n) }
    const arm = (n) => { timer = setTimeout(advance, n.type === 'processing' ? 40000 : 4000) }
    function advance() {
      clearTimeout(timer)
      const n = queue.shift() || null
      put(n)
      if (n) arm(n)
    }

    const onToast = (e) => {
      const { message, type = 'info', title = '' } = e.detail || {}

      if (!SHOW.includes(type)) {
        // A result such as "completed" ends a Processing pop-up and shows nothing itself
        if (current && current.type === 'processing') advance()
        return
      }

      const n = { message, type, title }
      if (current && current.message === message && current.type === type) return
      const last = queue[queue.length - 1]
      if (last && last.message === message && last.type === type) return

      if (!current) { put(n); arm(n); return }
      if (current.type === 'processing') { clearTimeout(timer); put(n); arm(n); return }
      queue.push(n)
      if (queue.length > 3) queue.shift()
    }

    window.addEventListener(TOAST_EVENT, onToast)
    return () => {
      window.removeEventListener(TOAST_EVENT, onToast)
      clearTimeout(timer)
    }
  }, [])

  return (
    <div className="tt-wrap" aria-live="polite">
      <style>{CSS}</style>
      {item && (
        <div className={`tt ${item.type}`} role="status">
          {item.type === 'processing' && <span className="tt-spin" />}
          <div className="tt-body">
            {item.title && <div className="tt-title">{item.title}</div>}
            <div className="tt-msg">{item.message}</div>
          </div>
        </div>
      )}
    </div>
  )
}