let host = null
let openCount = 0

export function registerHost(fn) {
  host = fn
  return () => { if (host === fn) host = null }
}

export const dialogOpen = () => openCount > 0

// choices: [{ id, label, kind: 'primary' | 'danger' | 'ghost' | 'text' }]. Resolves with the chosen id, or 'dismiss'.
export function askChoice({ title, message, choices }) {
  return new Promise((resolve) => {
    if (!host) { resolve('dismiss'); return }
    openCount++
    host({
      title, message, choices,
      resolve: (v) => { openCount = Math.max(0, openCount - 1); resolve(v) },
    })
  })
}

export async function confirmDialog(message, opts = {}) {
  const r = await askChoice({
    title: opts.title || 'Are you sure?',
    message,
    choices: [
      { id: 'no', label: opts.cancelLabel || 'Cancel', kind: 'text' },
      { id: 'yes', label: opts.confirmLabel || 'Yes', kind: opts.danger ? 'danger' : 'primary' },
    ],
  })
  return r === 'yes'
}