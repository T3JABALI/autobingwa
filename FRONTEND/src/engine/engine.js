// AutoBingwa engine: runs inside the app. Pure logic, no screens.
// It talks to the phone through a "bridge" (real one comes from the Android plugin later)
// and to saved data through a "store".

// ---------- M-Pesa SMS parsing ----------
export function parseMpesa(text) {
  const raw = String(text || '')
  const code = (raw.match(/^\s*([A-Z0-9]{10})\s+Confirmed/i) || [])[1]
  const amt = raw.match(/Ksh\s*([\d,]+(?:\.\d{1,2})?)\s+received\s+from\s+(\d{9,12})\s+([^.]+?)\./i)
  if (!code || !amt) return { code: code || '', amount: 0, phone: '', name: '', ok: false, raw }
  const digits = amt[2]
  return {
    code: code.toUpperCase(),
    amount: Number(amt[1].replace(/,/g, '')),
    phone: `0${digits.slice(-9)}`,
    name: amt[3].trim(),
    ok: true,
    raw,
  }
}

export const fillPhone = (ussd, phone) => String(ussd).replace(/\bAB\b/g, phone)

// ---------- Engine ----------
export function createEngine({ store, bridge, getOffers, getMode = () => 'Express', now = () => Date.now() }) {
  let running = false
  let working = false
  const listeners = new Set()
  const emit = (event, tx) => listeners.forEach((fn) => fn(event, tx))

  const findOffer = (amount) =>
    getOffers().find((o) => o.enabled && Number(o.price) === Number(amount))

  // Every M-Pesa SMS lands here. Nothing is dropped.
  function ingest(sms) {
    const p = parseMpesa(typeof sms === 'string' ? sms : sms.body)
    if (p.code && store.list().some((t) => t.mpesaId === p.code)) return null // same SMS delivered twice
    const offer = p.ok ? findOffer(p.amount) : null
    const status = !offer ? 'Unmatched' : running ? 'Pending' : 'Paused'
    const tx = store.add({
      id: `${p.code || 'MSG'}-${now()}`,
      mpesaId: p.code,
      name: p.name,
      phone: p.phone,
      amount: p.amount,
      rawMessage: p.raw,
      status,
      offerId: offer ? offer.id : null,
      offerName: offer ? offer.name : 'No matching offer',
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

  // Runs ONE transaction to its final state (retrying first if the offer allows)
  async function process(tx) {
    const offer = getOffers().find((o) => o.id === tx.offerId)
    store.update(tx.id, { status: 'Processing', startedAt: now() })
    emit('processing', tx)
    if (!offer) {
      store.update(tx.id, { status: 'Failed', responses: [{ input: '-', text: 'The offer was deleted.' }] })
      return
    }
    const maxRetries = offer.autoRetry && offer.retryFailed !== false ? Number(offer.retryCount) || 0 : 0
    let attempt = 0
    let result
    for (;;) {
      attempt += 1
      try {
        result = await bridge.runUssd({ ussd: tx.ussd, phone: tx.phone, mode: getMode(), offer })
      } catch (err) {
        result = { ok: false, responses: [{ input: '-', text: String(err && err.message ? err.message : err) }] }
      }
      store.update(tx.id, { attempts: attempt, responses: result.responses || [] })
      if (result.ok || attempt > maxRetries) break
    }
    const done = store.update(tx.id, {
      status: result.ok ? 'Completed' : 'Failed',
      completedAt: now(),
    })
    emit(result.ok ? 'completed' : 'failed', done)
  }

  // One at a time, oldest first. A new SMS never interrupts the one in progress.
  async function pump(force = false) {
    if (working) return
    working = true
    try {
      for (;;) {
        if (!running && !force) break
        const next = store
          .list()
          .filter((t) => t.status === 'Pending')
          .sort((a, b) => a.createdAt - b.createdAt)[0]
        if (!next) break
        await process(next)
      }
    } finally {
      working = false
    }
  }

  // Scheduled transactions whose time has come become Pending (or Paused if automation is off)
  function tick() {
    store
      .list()
      .filter((t) => t.status === 'Scheduled' && t.scheduledFor && t.scheduledFor <= now())
      .forEach((t) => store.update(t.id, { status: running ? 'Pending' : 'Paused', scheduledFor: null }))
    pump()
  }

  return {
    ingest,
    pump,
    tick,
    on(fn) { listeners.add(fn); return () => listeners.delete(fn) },
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
