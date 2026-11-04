import { registerPlugin } from '@capacitor/core'

// Must match the name in @CapacitorPlugin(name = "...") in AutoBingwaPlugin.java
const AutoBingwa = registerPlugin('AutoBingwa')

const USSD_PATTERN = /^[*#][0-9*#]*#$/

// Finds the first valid Kenyan number in pasted text and returns it as 07XXXXXXXX.
// Accepts 0712..., 712..., 254712..., +254712..., with spaces or dashes.
export function parsePhone(text) {
  const chunks = String(text || '').split(/[\n,;]+/)
  for (const chunk of chunks) {
    let digits = chunk.replace(/\D/g, '')
    if (digits.startsWith('254') && digits.length === 12) digits = '0' + digits.slice(3)
    else if (digits.length === 9 && /^[71]/.test(digits)) digits = '0' + digits
    if (/^0[71]\d{8}$/.test(digits)) return digits
  }
  return ''
}

// Offers use AB (any case) as the phone-number placeholder.
export function buildCode(offer, phone) {
  return String(offer.ussd).replace(/\bAB\b/gi, phone)
}

export function isValidUssd(code) {
  return code.length >= 3 && USSD_PATTERN.test(code)
}

// Dials directly from native code, with no dialer screen or keyboard.
// slot: 0 = SIM 1, 1 = SIM 2. Leave it out to use the phone's default SIM.
// Falls back to the old behavior if the native method isn't available.
export async function dialUssd(code, slot) {
  try {
    const args = slot === undefined || slot === null ? { code } : { code, slot }
    await AutoBingwa.dialUssd(args)
  } catch (e) {
    window.location.href = `tel:${encodeURIComponent(code)}`
  }
}