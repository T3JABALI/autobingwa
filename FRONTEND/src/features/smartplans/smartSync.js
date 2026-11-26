import { useEffect, useRef } from 'react'
import { loadCatalog } from './catalog.js'

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const twKey = (t) => (t ? { on: Boolean(t.on), from: t.from, until: t.until } : null)

// Returns the updated offer, or null when nothing changed
export function applyCatalog(offer, plan) {
  if (!offer.sid || !plan) return null
  if (offer.catRev === plan.rev) return null
  const c = offer.custom || {}
  const next = {
    ...offer,
    name: c.name ? offer.name : plan.name,
ussd: plan.ussd,
steps: plan.steps,
    safPrice: c.safPrice ? offer.safPrice : plan.safPrice,
    sig: plan.sig,
    sigLearned: Boolean(plan.sig),
    sigEnabled: Boolean(plan.sig),
    catRev: plan.rev,
    updated: new Date().toLocaleString(),
  }
  // The time window only changes when the admin changed it, so a window the user set is not wiped
  const wanted = twKey(plan.tw)
  const before = offer.catTw !== undefined ? offer.catTw : twKey(offer.tw)
  if (!same(wanted, before)) {
    next.tw = { on: false, from: '06:00', until: '22:00', altId: '', notify: false, msg: '', ...(offer.tw || {}), ...(wanted || {}) }
  }
  next.catTw = wanted
  return next
}

export async function syncSmartOffers(offers, onSave) {
  // Updates are now manual: the user taps Update in Smart Plans.
  // Nothing here may touch an offer's USSD, steps or signature.
  return 0
}
// Call once in App.jsx with the same offers and save function you give the Offers page
export function useSmartSync(offers, onSave) {
  const ref = useRef({ offers, onSave })
  ref.current = { offers, onSave }
  const busy = useRef(false)

  const run = async () => {
    if (busy.current) return
    busy.current = true
    try {
      await syncSmartOffers(ref.current.offers, ref.current.onSave)
    } catch (e) {
      console.error('smart sync', e)
    } finally {
      busy.current = false
    }
  }

  useEffect(() => {
    run()
    const onVisible = () => { if (!document.hidden) run() }
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(run, 10 * 60 * 1000)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [])

  useEffect(() => { run() }, [(offers || []).length])
}