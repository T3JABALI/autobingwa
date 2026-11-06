import { TOKEN_API, deviceId } from './tokenPay.js'

const QUEUE = 'contacts:queue'
const SENT = 'contacts:sent'

const read = (k) => {
  try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : [] } catch (e) { return [] }
}
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { /* ignore */ } }

let flushing = false
async function flush() {
  if (flushing) return
  flushing = true
  try {
    for (;;) {
      const queue = read(QUEUE)
      if (!queue.length) break
      const chunk = queue.slice(0, 200)
      const res = await fetch(TOKEN_API + '/contacts/ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId: deviceId(), contacts: chunk }),
      })
      if (!res.ok) break // keep them, try again later
      const gone = new Set(chunk.map((c) => c.phone))
      write(QUEUE, queue.filter((c) => !gone.has(c.phone)))
      write(SENT, [...read(SENT), ...gone].slice(-5000))
    }
  } catch (e) { /* offline: the queue is kept */ }
  flushing = false
}

// Call once, right after the engine is created. Returns a function that stops it.
export function startContactSync(engine) {
  const off = engine.on((event, tx) => {
    if (event !== 'completed' || !tx || !tx.phone) return
    const sent = new Set(read(SENT))
    const queue = read(QUEUE)
    if (sent.has(tx.phone) || queue.some((c) => c.phone === tx.phone)) return
    write(QUEUE, [...queue, { name: tx.name || '', phone: tx.phone }].slice(-2000))
    flush()
  })
  const timer = setInterval(flush, 5 * 60000)
  window.addEventListener('online', flush)
  flush()
  return () => { off(); clearInterval(timer); window.removeEventListener('online', flush) }
}