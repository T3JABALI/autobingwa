// Links this dialer phone to the owner's account with the code shown on a Connect phone.
// While automation runs it checks in with the server, so the Connect phone shows "Connected".
// Separate from the portal (PortalSync.js).
import { useEffect, useState } from 'react'
import { Device } from '@capacitor/device'
import { supabase } from '../../lib/supabase'
import { isNative, ussdServiceEnabled } from '../../engine/native.js'
import { getAirtimeBalance } from '../../engine/balances.js'
import { registerPlugin } from '@capacitor/core'
const AutoBingwa = registerPlugin('AutoBingwa')

async function pushToNative(p) {
  try {
    if (isNative() && p) await AutoBingwa.saveCloudDevice({ deviceId: p.deviceId, secret: p.secret, role: 'dialer' })
  } catch (e) { console.error('native pairing', e) }
}
const KEY = 'connect:pair'
const BEAT_MS = 15000
const LIVE_MS = 45000 // a check-in this recent counts as connected
export const PAIR_EVENT = 'ab-pairing'

let running = false // automation is running
let lastOk = 0 // when the last check-in worked
let lastLive = false
let timer = null
let flight = null // the check-in that is on its way, if any

const fire = () => {
  try { window.dispatchEvent(new Event(PAIR_EVENT)) } catch (e) { /* ignore */ }
}

// { deviceId, secret, userId, pairedAt } or null
export function getPairing() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null')
    return v && v.deviceId && v.secret ? v : null
  } catch (e) {
    return null
  }
}

// paired: linked to a Connect account. live: automation is running and the server is hearing from this phone.
export function getLink() {
  const paired = Boolean(getPairing())
  return { paired, live: paired && running && Date.now() - lastOk < LIVE_MS }
}

function emit() {
  const live = getLink().live
  if (live !== lastLive) {
    lastLive = live
    fire()
  }
}

export function clearPairing() {
  stopTimer()
  lastOk = 0
  lastLive = false
  try { localStorage.removeItem(KEY) } catch (e) { /* ignore */ }
  fire()
}

async function phoneName() {
  try {
    const i = await Device.getInfo()
    return i.name || [i.manufacturer, i.model].filter(Boolean).join(' ') || 'Dialer phone'
  } catch (e) {
    return 'Dialer phone'
  }
}

const friendly = (msg) => {
  const m = String(msg || '')
  if (/invalid or expired/i.test(m)) {
    return 'That code is invalid or expired. On the Connect phone tap New code, then enter the new code here.'
  }
  if (/not signed in/i.test(m)) return 'Sign in on this phone first.'
  if (/fetch|network/i.test(m)) return 'No internet connection.'
  return m || 'Pairing failed'
}

export async function pairWithConnect(code) {
  const { data: s } = await supabase.auth.getSession()
  const userId = s && s.session ? s.session.user.id : null
  if (!userId) throw new Error('Sign in on this phone first.')

  let installId = null
  try { const di = await Device.getId(); installId = di.identifier || di.uuid || null } catch (e) { /* no check */ }

  const { data, error } = await supabase.schema('connect').rpc('pair_device', {
    p_code: code,
    p_name: await phoneName(),
    p_app_version: '1.0',
    p_install_id: installId,
  })
  if (error) throw new Error(friendly(error.message))
  if (!data || !data.device_id || !data.secret) throw new Error('The server sent an unexpected reply.')

  try {
    localStorage.setItem(KEY, JSON.stringify({ deviceId: data.device_id, secret: data.secret, userId, pairedAt: Date.now() }))
  } catch (e) {
    throw new Error('Could not save the pairing on this phone.')
  }
  await pushToNative({ deviceId: data.device_id, secret: data.secret })
  lastOk = 0
  if (running) {
    startTimer()
    beat()
  }
  fire()
  return data.device_id
}

// ---- Check-in: only while automation is running ----
async function doBeat() {
  const p = getPairing()
  if (!p || !running) return
  try {
    let accessibility = null
    try { if (isNative()) accessibility = await ussdServiceEnabled() } catch (e) { /* unknown */ }
    const bal = getAirtimeBalance()
    const airtime = bal && Number.isFinite(Number(bal.value)) ? Number(bal.value) : null

    const { error } = await supabase.schema('connect').rpc('heartbeat', {
      p_device: p.deviceId,
      p_secret: p.secret,
      p_accessibility: accessibility,
      p_airtime: airtime,
    })
    if (error) {
      if (/not authorised/i.test(error.message)) { clearPairing(); return } // removed from the Connect side
      console.error('connect heartbeat', error.message)
    } else if (running) {
      lastOk = Date.now()
    }
  } catch (e) {
    console.error('connect heartbeat', e && e.message ? e.message : e)
  }
  emit()
}

function beat() {
  if (!flight) flight = doBeat().finally(() => { flight = null })
  return flight
}

// Tells the server this phone is no longer running, so Connect shows it offline at once
async function goOffline() {
  const p = getPairing()
  if (!p || running) return // not paired, or automation was started again meanwhile
  try {
    const { error } = await supabase.schema('connect').rpc('set_dialer_online', {
      p_device: p.deviceId,
      p_secret: p.secret,
      p_online: false,
    })
    if (error) console.error('connect offline', error.message) // the server marks it offline within 45 seconds anyway
  } catch (e) {
    console.error('connect offline', e && e.message ? e.message : e)
  }
}

const onVisible = () => { if (!document.hidden && running) beat() }

function startTimer() {
  stopTimer()
  timer = setInterval(beat, BEAT_MS)
  document.addEventListener('visibilitychange', onVisible)
}

function stopTimer() {
  clearInterval(timer)
  timer = null
  document.removeEventListener('visibilitychange', onVisible)
}

// App.jsx calls this whenever automation starts or stops
export function setConnectRunning(on) {
  const next = Boolean(on)
  if (next === running) return
  running = next
  if (!running) {
    stopTimer()
    lastOk = 0
    emit()
    // let a check-in that is on its way land first, so it cannot undo the "offline"
    Promise.resolve(flight).then(goOffline)
    return
  }
  if (getPairing()) {
    pushToNative(getPairing())
    startTimer()
    beat()
  }
}

// For screens: { paired, live }, kept up to date
export function useLink() {
  const [link, setLink] = useState(getLink)
  useEffect(() => {
    const sync = () => setLink((prev) => {
      const n = getLink()
      return prev.paired === n.paired && prev.live === n.live ? prev : n
    })
    window.addEventListener(PAIR_EVENT, sync)
    const t = setInterval(sync, 5000)
    sync()
    return () => {
      window.removeEventListener(PAIR_EVENT, sync)
      clearInterval(t)
    }
  }, [])
  return link
}