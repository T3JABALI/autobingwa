const ALLOWED = ['processing', 'failed']
let queue = []
let current = null
let listener = () => {}
let timer = null

export function onToast(fn) { listener = fn; fn(current); return () => { listener = () => {} } }

export function toast(kind, message) {
  if (!ALLOWED.includes(kind)) return           // success etc. never pop up
  if (current && current.kind === kind && current.message === message) return
  if (queue.some(q => q.kind === kind && q.message === message)) return
  queue.push({ kind, message })
  if (queue.length > 3) queue.shift()           // never build a backlog
  next()
}

function next() {
  if (current || queue.length === 0) return
  current = queue.shift()
  listener(current)
  timer = setTimeout(() => {
    current = null
    listener(null)
    next()
  }, 2500)
}