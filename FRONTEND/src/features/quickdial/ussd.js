const USSD_PATTERN = /^[*#][0-9*#]*#$/

// Finds the first valid Kenyan number in pasted text and returns it as 07XXXXXXXX.
// Accepts 0712..., 712..., 254712..., +254712..., with spaces or dashes.
export function parsePhone(text) {
  const chunks = text.split(/[\n,;]+/)
  for (const chunk of chunks) {
    let digits = chunk.replace(/\D/g, '')
    if (digits.startsWith('254') && digits.length === 12) digits = '0' + digits.slice(3)
    else if (digits.length === 9 && /^[71]/.test(digits)) digits = '0' + digits
    if (/^0[71]\d{8}$/.test(digits)) return digits
  }
  return ''
}

// Your Offers page uses "ab" as the phone-number placeholder.
export function buildCode(offer, phone) {
  return offer.ussd.replaceAll('ab', phone)
}

export function isValidUssd(code) {
  return code.length >= 3 && USSD_PATTERN.test(code)
}

// Opens the phone dialer with the code filled in ("#" must be encoded).
export function dialUssd(code) {
  window.location.href = `tel:${encodeURIComponent(code)}`
}