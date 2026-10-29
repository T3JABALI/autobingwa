const num = (s) => parseFloat(String(s).replace(/,/g, ''))

// Reads Safaricom's reply to a purchase. Returns null if the message is not a confirmation.
export function classifyConfirmation(text) {
  const t = String(text || '')

  if (/recommendation\s+failed|already\s+been\s+recommended/i.test(t)) {
    const p = t.match(/customer\s+(\d{9,12})/i)
    return { status: 'failed', phone: p ? p[1] : null, reason: 'Already recommended' }
  }

  const ok = t.match(/successfully\s+recommended\s+offer\s+to\s+(\d{9,12})/i)
  if (ok) return { status: 'success', phone: ok[1] }

  if (/thank\s+you\s+for\s+choosing\s+safaricom/i.test(t)) return { status: 'success', phone: null }

  return null
}