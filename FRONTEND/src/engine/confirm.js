// Reads Safaricom's reply to a purchase. Returns null if the message is not a confirmation.
export function classifyConfirmation(text) {
  const t = String(text || '')

  // "Recommendation failed. The customer 0768028259 has already been recommended..."
  if (/recommendation\s+failed|already\s+been\s+recommended/i.test(t)) {
    const p = t.match(/customer\s+(\d{9,12})/i)
    return { status: 'failed', phone: p ? p[1] : null, reason: 'Already recommended' }
  }

  // Bingwa (*180*5*2...): "Recommendation for 0723403053 submitted successfully. Keep selling!!..."
  const bingwa = t.match(/recommendation\s+for\s+(\d{9,12})\s+submitted\s+successfully/i)
  if (bingwa) return { status: 'success', phone: bingwa[1] }
  if (/recommendation\b.{0,40}submitted\s+successfully/i.test(t)) return { status: 'success', phone: null }

  const ok = t.match(/successfully\s+recommended\s+offer\s+to\s+(\d{9,12})/i)
  if (ok) return { status: 'success', phone: ok[1] }

  if (/thank\s+you\s+for\s+choosing\s+safaricom/i.test(t)) return { status: 'success', phone: null }

  return null
}

// For the USSD screens themselves: also catches ordinary error messages.
// Kept apart from classifyConfirmation so a random SMS can never mark a transaction failed.
export function classifyScreen(text) {
  const c = classifyConfirmation(text)
  if (c) return c
  if (/connection\s+problem|invalid\s+mmi|invalid\s+input|insufficient|not\s+enough|unable\s+to|failed|error|try\s+again/i.test(String(text || ''))) {
    return { status: 'failed', phone: null }
  }
  return null
}