// AutoBingwa engine: runs inside the app. Pure logic, no screens.
// It talks to the phone through a "bridge" (real one comes from the Android plugin later)
// and to saved data through a "store".
import { loadConfig, isBlacklisted } from './config.js'
import { classifyScreen } from './confirm.js'
import { pickOffer, nextDayAt, fillTemplate, inWindow } from './offerRules.js'
import { findFallback, fallbackDelayMinutes } from './fallbackStore.js'

// ---------- Phone numbers ----------
// Reads a Kenyan number written any common way:
// 0797411114, +254797411114, 254797411114, 0117818996, 07 97411114, 0797-411-114, 0797***114
const CANDIDATE_RE = /\+?\d[\d\s\-*]{7,15}[\d*]/g

export function normalizePhone(token) {
  const t = String(token || '').replace(/[\s\-().]/g, '')
  const masked = t.includes('*')
  const s = t.replace(/^\+/, '')
  let local = ''
  if (/^254[17][\d*]{8}$/.test(s)) local = '0' + s.slice(3)
  else if (/^0[17][\d*]{8}$/.test(s)) local = s
  else if (/^[17][\d*]{8}$/.test(s)) local = '0' + s
  return local ? { phone: local, masked } : null
}

function findPhone(text) {
  for (const c of String(text || '').match(CANDIDATE_RE) || []) {
    const n = normalizePhone(c)
    if (n) return n
  }
  return null
}

// ---------- M-Pesa SMS parsing ----------
// type: 'mpesa' (personal "You have received"), 'paybill' (has an account number), 'till' (everything else)
function detectType(raw, account) {
  if (/you have received/i.test(raw)) return 'mpesa'
  if (account) return 'paybill'
  return 'till'
}

export function parseMpesa(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  const code = (raw.match(/^([A-Z0-9]{10})\s+Confirmed/i) || [])[1]
  const empty = {
    code: code ? code.toUpperCase() : '', amount: 0, phone: '', name: '',
    account: '', type: 'till', masked: false, ok: false, raw,
  }
  if (!code) return empty
  if (!/received/i.test(raw)) return empty // sent, withdrawn, paid, balance messages

  const amt = raw.match(/(?:ksh|kes)\.?\s*([\d,]+(?:\.\d{1,2})?)/i) // the first amount is the payment
  if (!amt) return empty

  const account = (raw.match(/Account(?:\s+Number)?\s+(?!balance\b)([A-Za-z0-9#\-]+)/i) || [])[1] || ''
  const seg = (raw.match(/\bfrom\s+(.+?)(?:\s+on\s+\d|\.\s|\.$|$)/i) || [])[1] || ''

  const found = findPhone(seg) || findPhone(account)
  const masked = Boolean(found && found.masked)
  const name = seg
    .replace(CANDIDATE_RE, '')
    .replace(/Account(?:\s+Number)?\s+\S+/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    code: code.toUpperCase(),
    amount: Number(amt[1].replace(/,/g, '')),
    phone: found && !masked ? found.phone : '',
    name,
    account,
    type: detectType(raw, account),
    masked,
    ok: true,
    raw,
  }
}

export const fillPhone = (ussd, phone) => String(ussd).replace(/\bAB\b/gi, phone)

const firstName = (name) => {
  const w = String(name || '').trim().split(/\s+/)[0] || ''
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''
}
const sameId = (a, b) => String(a) === String(b)

const HOUR = 3600000
const RENEW_GRACE_HOURS = 6 // a renewal missed by more than this is skipped, not bought late
const RENEW_KEY = 'autorenew:schedules'
const FB_LABEL = { recommended: 'Already recommended', failed: 'Purchase failed' }
// Final USSD screens that prove the purchase (Talkmore and similar offers send no SMS)
const SUCCESS_SCREEN = /successfully\s+(purchased|bought|subscribed|activated|recommended)/i
const FAIL_SCREEN = /not\s+successful|unsuccessful|not\s+been\s+successful|failed/i

function readRenewals() {
  try {
    const v = JSON.parse(localStorage.getItem(RENEW_KEY) || '[]')
    return Array.isArray(v) ? v : []
  } catch (e) {
    return []
  }
}
function writeRenewals(list) {
  try {
    localStorage.setItem(RENEW_KEY, JSON.stringify(list))
  } catch (e) {
    console.error('renewals: could not save', e)
  }
}

// ---------- Engine ----------
export function createEngine({
  store, bridge, getOffers, getMode = () => 'Express', getConfig = loadConfig, now = () => Date.now(),
  hasToken = () => true,
}) {
  let running = false
  let working = false
  let held = false // true while a token payment is using the phone's USSD and airtime
  const manual = new Set() // Quick Dial transactions: they run even when automation is stopped
  const listeners = new Set()
  const emit = (event, tx) => listeners.forEach((fn) => fn(event, tx))
  const onEvent = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }

  const typeEnabled = (type) => {
    const cfg = getConfig()
    if (type === 'mpesa') return cfg.processMpesa !== false
    if (type === 'paybill') return cfg.processPaybill !== false
    return cfg.processTill !== false
  }

  // Every M-Pesa SMS lands here. Nothing is dropped.
  function ingest(sms) {
    const p = parseMpesa(typeof sms === 'string' ? sms : sms.body)
    if (p.code && store.list().some((t) => t.mpesaId === p.code)) return null // same SMS delivered twice
    console.log('AB parsed', JSON.stringify(p))
    if (!p.code || !p.ok) return null // not a payment received, so it is not a transaction

    const blacklisted = Boolean(p.phone && isBlacklisted(p.phone))
    let skipReason = ''
    if (!typeEnabled(p.type)) skipReason = 'This message type is switched off in Settings'
    else if (blacklisted) skipReason = 'Customer is blacklisted'

    // Time windows: outside its hours, the offer's alternative is used instead
    const hit = !skipReason && p.phone ? pickOffer(getOffers(), p.amount, new Date(now())) : null
    const offer = hit ? hit.offer : null
    const status = skipReason ? 'Skipped' : !offer ? 'Unmatched' : running ? 'Pending' : 'Paused'
    const tx = store.add({
      id: `${p.code || 'MSG'}-${now()}`,
      mpesaId: p.code,
      name: p.name,
      phone: p.phone,
      account: p.account,
      messageType: p.type,
      blacklisted,
      amount: p.amount,
      rawMessage: p.raw,
      status,
      offerId: offer ? offer.id : null,
      fallbackOf: hit && hit.primary ? hit.primary.id : null,
      offerName: skipReason || (offer ? offer.name : p.phone ? 'No matching offer' : 'No customer number in message'),
      ussd: offer ? fillPhone(offer.ussd, p.phone) : '',
      verified: Boolean(offer && (offer.smart || offer.signature || offer.sigEnabled)),
      cost: offer ? Number(offer.safPrice) || 0 : 0,
      attempts: 0,
      responses: [],
      createdAt: now(),
    })
    emit('added', tx)
    pump()
    return tx
  }

  // A transaction for one specific offer (Quick Dial, auto renewal, fallback).
  // fixedOffer: the engine must NOT pick the offer by payment amount.
  function directTx(offer, phone, extra = {}) {
    return {
      id: `${extra.tag || 'DIR'}-${now()}-${Math.random().toString(36).slice(2, 6)}`,
      mpesaId: '', name: '', phone, account: '', messageType: 'direct', blacklisted: false,
      amount: Number(offer.price) || 0,
      rawMessage: '',
      status: running ? 'Pending' : 'Paused',
      offerId: offer.id,
      fallbackOf: null,
      fixedOffer: true,
      offerName: offer.name,
      ussd: fillPhone(offer.ussd, phone),
      verified: Boolean(offer.smart || offer.signature || offer.sigEnabled),
      cost: Number(offer.safPrice) || 0,
      attempts: 0,
      responses: [],
      createdAt: now(),
      ...extra,
    }
  }

  // Safaricom's SMS decides the final result. One transaction runs at a time, so one waiter is enough.
  let waiter = null
  function arm(tx) {
    waiter = { phone: tx.phone, got: null, wake: null }
    return waiter
  }

  // A late success SMS cancels a backup that is still waiting out its delay
  function cancelPendingFallback(c) {
    if (!c || c.status !== 'success' || !c.phone) return false
    const n = normalizePhone(c.phone)
    if (!n) return false
    const fb = store.list().find((t) => t.fallbackPending && t.status === 'Scheduled' && t.phone === n.phone)
    if (!fb) return false
    store.update(fb.id, {
      status: 'Skipped',
      fallbackPending: false,
      scheduledFor: null,
      responses: [
        ...(fb.responses || []),
        ...(c.text ? [{ input: 'SMS', text: c.text }] : []),
        { input: '-', text: 'Fallback cancelled: the original purchase was confirmed.' },
      ],
    })
    if (fb.fallbackTrigger === 'failed' && fb.fallbackFromId) store.update(fb.fallbackFromId, { status: 'Completed' })
    return true
  }

  function confirm(c) {
    const w = waiter
    if (w) {
      let mine = true
      if (c.phone && w.phone) {
        const n = normalizePhone(c.phone)
        if (n && n.phone !== w.phone) mine = false // a reply about another customer
      }
      if (mine) {
        w.got = c
        if (w.wake) w.wake()
        return true
      }
    }
    return cancelPendingFallback(c)
  }

  async function awaitConfirm(w, ms) {
    if (!w.got) await new Promise((res) => { w.wake = res; setTimeout(res, ms) })
    waiter = null
    return w.got
  }

  // SMS to the customer after a purchase. Never delays the queue, and a failure never fails the transaction.
  function notifyCustomer(tx, offer, primary) {
    if (!bridge.sendSms || !tx.phone) return
    const vars = {
      name: firstName(tx.name), phone: tx.phone, offer: offer.name, amount: tx.amount, price: tx.amount,
    }
    const texts = []
    if (tx.isFallback && tx.fallbackNotify) {
      texts.push(
        fillTemplate(
          'Hi {name}, {first} could not be given, so we sent you {offer} instead. Thank you for buying!',
          { ...vars, first: tx.fallbackFromName || 'your offer' }
        ).replace(/^Hi ,/, 'Hi,')
      )
    } else if (offer.notifyOn && offer.notifyMsg) {
      texts.push(fillTemplate(offer.notifyMsg, vars))
    }
    if (primary && primary.tw && primary.tw.notify && primary.tw.msg) texts.push(fillTemplate(primary.tw.msg, vars))
    texts.forEach((text) => {
      const log = (input) => {
        const cur = store.list().find((t) => t.id === tx.id)
        if (cur) store.update(tx.id, { responses: [...(cur.responses || []), { input, text }] })
      }
      Promise.resolve()
        .then(() => bridge.sendSms({ to: tx.phone, text }))
        .then(() => log('SMS sent'))
        .catch((err) => { console.error('AB notify', err); log('SMS failed') })
    })
  }

  // Creates the backup transaction for a failed one. Returns null when there is no usable mapping.
  function startFallback(tx, offer, trigger) {
    const m = findFallback(offer.id, trigger)
    if (!m) return null
    const chain = tx.fallbackChain || [offer.id]
    if (chain.some((id) => sameId(id, m.fallbackId))) return null // never loop A -> B -> A
    const target = getOffers().find((o) => sameId(o.id, m.fallbackId) && o.enabled !== false)
    if (!target) return null
    const depth = (tx.fallbackDepth || 0) + 1
    // "Already recommended" is final: Safaricom said the customer has the offer, so there is nothing to wait for
    const delayMin = trigger === 'recommended' ? 0 : fallbackDelayMinutes()
    const wait = delayMin > 0
    const note = `Fallback for ${offer.name}: ${FB_LABEL[trigger]}`
    const fb = store.add({
      id: `${tx.mpesaId || 'FB'}-FB${depth}-${now()}`,
      mpesaId: tx.mpesaId,
      name: tx.name,
      phone: tx.phone,
      account: tx.account,
      messageType: tx.messageType,
      blacklisted: false,
      amount: tx.amount,
      rawMessage: tx.rawMessage,
      status: wait ? 'Scheduled' : running ? 'Pending' : 'Paused',
      scheduledFor: wait ? now() + delayMin * 60000 : null,
      offerId: target.id,
      fallbackOf: null,
      fixedOffer: true,
      offerName: target.name,
      ussd: fillPhone(target.ussd, tx.phone),
      verified: Boolean(target.smart || target.signature || target.sigEnabled),
      cost: Number(target.safPrice) || 0,
      attempts: 0,
      responses: [{ input: '-', text: note }],
      createdAt: now(),
      isFallback: true,
      fallbackDepth: depth,
      fallbackChain: [...chain, target.id],
      fallbackNote: note,
      fallbackTrigger: trigger,
      fallbackFromId: tx.id,
      fallbackFromName: offer.name,
      fallbackNotify: Boolean(m.notify),
      fallbackPending: wait,
    })
    return { fb, wait, delayMin, target }
  }

  // Runs ONE transaction to its final state (retrying first if the offer allows)
  async function process(startTx) {
    let tx = startTx
    let offer = getOffers().find((o) => sameId(o.id, tx.offerId))
    store.update(tx.id, { status: 'Processing', startedAt: now() })
    emit('processing', tx)

    const fail = (text) => {
      const done = store.update(tx.id, {
        status: 'Failed', completedAt: now(), responses: [{ input: '-', text }],
      })
      emit('failed', done)
    }
    if (!offer) return fail('The offer was deleted.')

    const useOffer = (next) => {
      offer = next
      tx = {
        ...tx,
        offerId: offer.id,
        offerName: offer.name,
        ussd: fillPhone(offer.ussd, tx.phone),
        cost: Number(offer.safPrice) || 0,
      }
      store.update(tx.id, { offerId: tx.offerId, offerName: tx.offerName, ussd: tx.ussd, cost: tx.cost })
    }

    let primary = null
    if (tx.fixedOffer) {
      // Quick Dial, renewal or fallback: the offer is fixed. Only its own time window applies.
      if (offer.tw && offer.tw.on && !inWindow(offer.tw, new Date(now()))) {
        const alt = offer.tw.altId
          ? getOffers().find((o) => sameId(o.id, offer.tw.altId) && o.enabled !== false)
          : null
        if (!alt || !inWindow(alt.tw, new Date(now()))) {
          return fail('This offer is outside its time window and has no alternative offer.')
        }
        primary = offer
        useOffer(alt)
      }
    } else if ((offer.tw && offer.tw.on) || (tx.fallbackOf !== null && tx.fallbackOf !== undefined)) {
      // Re-check the time window just before dialing (a payment can wait in the queue past closing time)
      const hit = pickOffer(getOffers(), tx.amount, new Date(now()))
      if (!hit) return fail('This offer is outside its time window and has no alternative offer.')
      if (!sameId(hit.offer.id, offer.id)) {
        useOffer(hit.offer)
        tx = { ...tx, fallbackOf: hit.primary ? hit.primary.id : null }
        store.update(tx.id, { fallbackOf: tx.fallbackOf })
      }
      primary = hit.primary
    }

    const cfg = getConfig()
    const maxRetries = offer.autoRetry ? Math.max(0, Number(offer.retryCount) || 0) : 0
    const retryFailed = offer.retryFailed !== false
    const retryPending = Boolean(offer.retryPending)
    const retryMs = (Number(cfg.retryAfterSec) || 15) * 1000
    const confirmMs = (Number(cfg.confirmWaitSec) || 45) * 1000

    let attempt = 0
    let result
    let ok = false
    let rs = []
    let alreadyRec = false
    let kind = 'failed' // ok | failed (nothing bought) | pending (may have sold) | stop (retrying cannot help)
    for (;;) {
      attempt += 1
      const w = arm(tx)
      try {
        result = await bridge.runUssd({ ussd: tx.ussd, phone: tx.phone, mode: getMode(), offer })
      } catch (err) {
        result = { ok: false, status: 'error', responses: [{ input: '-', text: String(err && err.message ? err.message : err) }] }
      }
      rs = result.responses || []
      if (result.message && result.status !== 'complete') rs = [...rs, { input: '-', text: result.message }]

      // 1) The final USSD screen usually says Successful / Failed / Already recommended
      const lastText = rs.length ? rs[rs.length - 1].text : ''
      let conf = classifyScreen(lastText)
      if (!conf && SUCCESS_SCREEN.test(lastText) && !FAIL_SCREEN.test(lastText)) {
        conf = { status: 'success', text: '' } // the screen itself confirmed the purchase
      }
      // 2) Otherwise Safaricom's SMS decides (also when the last step was sent but no screen came back)
      if (!conf && (result.ok || result.status === 'no_reply')) conf = await awaitConfirm(w, confirmMs)
      else waiter = null

      // Completed ONLY when Safaricom's screen or SMS says so. A finished dialog proves nothing.
      ok = false
      alreadyRec = Boolean(conf && conf.reason === 'Already recommended')
      if (conf) {
        ok = conf.status === 'success'
        if (conf.text) rs = [...rs, { input: 'SMS', text: conf.text }]
        kind = ok ? 'ok' : conf.reason ? 'stop' : 'failed' // already recommended: retrying cannot help
      } else if (result.status === 'sig_mismatch' || /accessibility/i.test(String(result.message))) {
        kind = 'stop' // nothing was bought, but retrying cannot work until it is fixed
      } else if (result.status === 'no_reply' || result.ok) {
        kind = 'pending'
        rs = [...rs, {
          input: '-',
          text: result.status === 'no_reply'
            ? 'The last step was sent but no reply came back. Check the customer before retrying.'
            : 'No success message or SMS came back. Check the customer before retrying.',
        }]
      } else {
        kind = 'failed'
      }

      store.update(tx.id, { attempts: attempt, responses: rs })
      const again = (kind === 'failed' && retryFailed) || (kind === 'pending' && retryPending)
      if (kind === 'ok' || !again || attempt > maxRetries) break
      if (kind === 'pending') {
        store.update(tx.id, {
          responses: [...rs, { input: '-', text: 'Retry pending is on, so the app is trying again. The first attempt may already have sold.' }],
        })
      }
      await new Promise((r) => setTimeout(r, retryMs))
    }

    // Fallback: only after a DEFINITE failure (all retries used) or "already recommended".
    // A timeout or no reply may have sold, so it never triggers a backup.
    if (!ok) {
      const trigger = alreadyRec ? 'recommended' : kind === 'failed' ? 'failed' : null
      if (trigger) {
        const started = startFallback(tx, offer, trigger)
        if (started) {
          const text = started.wait
            ? `Fallback queued: ${started.target.name} in ${started.delayMin} min, unless a success SMS arrives first.`
            : `Fallback started: ${started.target.name}.`
          const done = store.update(tx.id, {
            status: 'Failed', completedAt: now(), hasFallback: true, responses: [...rs, { input: '-', text }],
          })
          emit('failed', done)
          emit('fallback', started.fb)
          return
        }
      }
    }

    // Failed for real (nothing bought) and the offer asks for the next day: save it as Scheduled, once
    if (!ok && kind === 'failed' && offer.autoReschedule && !tx.autoRescheduled) {
      const sched = store.update(tx.id, {
        status: 'Scheduled',
        scheduledFor: nextDayAt(offer.rescheduleTime || '06:00', now()),
        autoRescheduled: true,
        completedAt: null,
      })
      emit('scheduled', sched)
      return
    }

    const done = store.update(tx.id, {
      status: ok ? 'Completed' : 'Failed',
      completedAt: now(),
    })
    emit(ok ? 'completed' : 'failed', done)
    if (ok) notifyCustomer({ ...tx, ...(done || {}) }, offer, primary)
  }

  // One at a time, oldest first. A new SMS never interrupts the one in progress.
  async function pump(force = false) {
    if (working) return
    working = true
    try {
      for (;;) {
        // No token or a payment in progress: nothing new starts. Waiting transactions stay Pending.
        if (held || !hasToken()) break
        const next = store
          .list()
          .filter((t) => t.status === 'Pending' && (running || force || manual.has(t.id)))
          .sort((a, b) => a.createdAt - b.createdAt)[0]
        if (!next) break
        await process(next)
        manual.delete(next.id)
        // a short breather so the phone releases the USSD session before the next one
        await new Promise((r) => setTimeout(r, Number(getConfig().gapMs ?? 1000)))
      }
    } finally {
      working = false
    }
  }

  // ---------- Auto renewal ----------
  // The Auto Renew screen saves entries to localStorage. Each one becomes a Scheduled transaction (day 1).
  // When a day's transaction comes due, the next day's one is created, until the last day.
  function armRenewals() {
    const list = readRenewals()
    if (!list.length) return
    const offers = getOffers()
    const keep = []
    list.forEach((entry) => {
      const offer = offers.find((o) => sameId(o.id, entry.offerId))
      if (!offer) {
        if (offers.length === 0) keep.push(entry) // offers not loaded yet, try again next tick
        else console.error('AB renewal: offer no longer exists', entry.offerName)
        return
      }
      const total = entry.autoRenew ? Math.max(1, Number(entry.days) || 1) : 1
      store.add(directTx(offer, entry.phone, {
        tag: 'RN',
        status: 'Scheduled',
        scheduledFor: new Date(entry.startAt).getTime(),
        renewal: { id: entry.id, day: 1, of: total, startAt: entry.startAt, offerId: offer.id },
        responses: [{ input: '-', text: `Auto renewal, day 1 of ${total}` }],
      }))
    })
    writeRenewals(keep)
  }

  function spawnNextRenewal(t) {
    const r = t.renewal
    if (!r || r.day >= r.of) return
    const offer = getOffers().find((o) => sameId(o.id, r.offerId))
    if (!offer) return
    const at = new Date(r.startAt)
    at.setDate(at.getDate() + r.day) // same clock time, one day later per step
    store.add(directTx(offer, t.phone, {
      tag: 'RN',
      status: 'Scheduled',
      scheduledFor: at.getTime(),
      renewal: { ...r, day: r.day + 1 },
      responses: [{ input: '-', text: `Auto renewal, day ${r.day + 1} of ${r.of}` }],
    }))
  }

  // Scheduled transactions whose time has come become Pending (or Paused if automation is off)
  function tick() {
    armRenewals()
    for (let pass = 0; pass < 400; pass++) {
      const due = store
        .list()
        .filter((t) => t.status === 'Scheduled' && t.scheduledFor && t.scheduledFor <= now())
      if (!due.length) break
      due.forEach((t) => {
        if (t.renewal && !t.renewalNext) {
          store.update(t.id, { renewalNext: true })
          spawnNextRenewal(t)
        }
        const late = t.renewal && now() - t.scheduledFor > RENEW_GRACE_HOURS * HOUR
        store.update(
          t.id,
          late
            ? {
                status: 'Skipped',
                scheduledFor: null,
                responses: [...(t.responses || []), { input: '-', text: 'Missed: the app was not running at the renewal time.' }],
              }
            : { status: running ? 'Pending' : 'Paused', scheduledFor: null, fallbackPending: false }
        )
      })
    }
    pump()
  }

  // ---------- Quick Dial ----------
  // Same path as a customer payment. Resolves with { ok, status, text } when the result is known.
  function quickDial({ offerId, phone }) {
    const offer = getOffers().find((o) => sameId(o.id, offerId))
    if (!offer) return Promise.resolve({ ok: false, status: 'Failed', text: 'That offer no longer exists.' })
    if (!phone) return Promise.resolve({ ok: false, status: 'Failed', text: 'Enter a valid phone number.' })
    if (!hasToken()) return Promise.resolve({ ok: false, status: 'Failed', text: 'You have no active token. Buy a token to continue.' })

    const tx = store.add(directTx(offer, phone, {
      tag: 'QD', status: 'Pending', source: 'quickdial', responses: [],
    }))
    manual.add(tx.id)

    const result = new Promise((resolve) => {
      let timer = null
      const off = onEvent((ev, t) => {
        if (!t || t.id !== tx.id || !['completed', 'failed', 'scheduled'].includes(ev)) return
        clearTimeout(timer)
        off()
        const cur = store.list().find((x) => x.id === tx.id) || t
        const last = (cur.responses || []).slice(-1)[0]
        const lastText = last && last.text ? String(last.text).trim() : ''
        if (ev === 'completed') {
          resolve({ ok: true, status: 'Completed', text: `${offer.name} was sent to ${phone}.` })
        } else if (ev === 'scheduled') {
          resolve({ ok: false, status: 'Scheduled', text: 'The purchase failed. It was saved to try again tomorrow.' })
        } else {
          const fb = store.list().find((x) => x.fallbackFromId === tx.id)
          resolve({
            ok: false,
            status: 'Failed',
            text: (lastText || 'The purchase failed.') + (fb ? ` A fallback plan (${fb.offerName}) was queued.` : ''),
          })
        }
      })
      timer = setTimeout(() => {
        off()
        resolve({ ok: false, status: 'Pending', text: 'Still running. Check Recent transactions for the result.' })
      }, 6 * 60000)
    })
    pump()
    return result
  }

  return {
    ingest,
    confirm,
    pump,
    tick,
    quickDial,
    hold(on) { held = Boolean(on); if (!held) pump() },
    isBusy: () => working,
    on: onEvent,
    isRunning: () => running,
    start() { running = true; pump() },
    stop() { running = false }, // the one in progress finishes, nothing new starts
    pausedCount: () => store.list().filter((t) => t.status === 'Paused').length,
    // After Start, the app asks the user, then calls this with 'process' or 'skip'
    releasePaused(choice) {
      store.list().filter((t) => t.status === 'Paused').forEach((t) =>
        store.update(t.id, { status: choice === 'process' ? 'Pending' : 'Skipped' }))
      if (choice === 'process') pump()
    },
    // Works on ANY status, whatever the last result was
    retry(id) { store.update(id, { status: 'Pending', scheduledFor: null }); pump(true) },
    reschedule(id, at) { store.update(id, { status: 'Scheduled', scheduledFor: at }) },
    // If the app was closed mid-dial, mark it Failed so it is checked before retrying (avoids a double purchase)
    recover() {
      store.list().filter((t) => t.status === 'Processing').forEach((t) =>
        store.update(t.id, {
          status: 'Failed',
          responses: [{ input: '-', text: 'The app closed while this was processing. Check your balance, then retry.' }],
        }))
    },
    remove(id) { store.remove(id) },
  }
}