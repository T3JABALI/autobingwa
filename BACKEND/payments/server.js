import express from 'express'
import cors from 'cors'
import pg from 'pg'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import rateLimit from 'express-rate-limit'

const {
  DARAJA_ENV = 'sandbox', CONSUMER_KEY, CONSUMER_SECRET, PASSKEY,
  SHORTCODE, TILL_NUMBER, CALLBACK_BASE, CALLBACK_SECRET, DATABASE_URL, PORT = 3000,
  SUPABASE_URL, SUPABASE_SERVICE_KEY,
} = process.env

const LIVE = DARAJA_ENV === 'production'
const BASE = LIVE ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke'
// Prices live here, never trusted from the app
const PLANS = { u1000: 90, u600: 50, u250: 25, u100: 15, d1: 30, d7: 200, d30: 550 }

// Portal subscription plans. Everyone must subscribe; there is no free plan.
const SUB_PLANS = {
  d2:  { name: '2 Devices',      price: 100, max: 2,    history: 3, days: 31 },
  d4:  { name: '4 Devices',      price: 200, max: 4,    history: 5, days: 31 },
  unl: { name: 'Unlimited Plan', price: 400, max: 1000, history: 7, days: 31 },
}
const planList = () => Object.entries(SUB_PLANS).map(([id, p]) => ({ id, ...p }))
function planInfo(acct) {
  const exp = acct.plan_exp ? new Date(acct.plan_exp) : null
  const def = SUB_PLANS[acct.plan]
  if (def && exp && exp.getTime() > Date.now())
    return { id: acct.plan, name: def.name, max: def.max, history: def.history, exp: exp.toISOString().slice(0, 10), active: true }
  return { id: '', name: 'None', max: 0, history: 0, exp: '', active: false }
}

for (const [k, v] of Object.entries({ CONSUMER_KEY, CONSUMER_SECRET, PASSKEY, SHORTCODE, CALLBACK_BASE, CALLBACK_SECRET, DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_KEY })) {
  if (!v) console.error(`MISSING ENV VAR: ${k}`)
}
if (LIVE && !TILL_NUMBER) console.error('MISSING ENV VAR: TILL_NUMBER')

const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } })
pool.on('error', (e) => console.error('pool error', e.message))

// Supabase admin client for the portal (service key stays on the server only)
const sbAdmin = SUPABASE_URL && SUPABASE_SERVICE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

let dbReady = false
async function initDb() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY, device_id TEXT NOT NULL, phone TEXT NOT NULL, plan_id TEXT NOT NULL,
      amount INT NOT NULL, checkout_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
      receipt TEXT UNIQUE, message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
    await pool.query(`CREATE TABLE IF NOT EXISTS portal_payments (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, phone TEXT NOT NULL, plan_id TEXT NOT NULL,
      amount INT NOT NULL, checkout_id TEXT UNIQUE, status TEXT NOT NULL DEFAULT 'pending',
      receipt TEXT, message TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
    await pool.query(`CREATE TABLE IF NOT EXISTS portal_tx (
      device_id TEXT NOT NULL, tx_id TEXT NOT NULL, name TEXT, phone TEXT, amt INT NOT NULL DEFAULT 0,
      offer TEXT, st TEXT NOT NULL DEFAULT 'Pending', ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      msg TEXT, ussd TEXT, resp TEXT, qd BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (device_id, tx_id))`)
    await pool.query('CREATE INDEX IF NOT EXISTS portal_tx_dev_ts ON portal_tx (device_id, ts DESC)')
    await pool.query('ALTER TABLE payments ADD COLUMN IF NOT EXISTS credited BOOLEAN NOT NULL DEFAULT false')
    dbReady = true
    console.log('Database ready')
  } catch (e) {
    console.error('Database init failed, retrying in 10s:', e.message)
    setTimeout(initDb, 10000)
  }
}

function normalizePhone(input) {
  let p = String(input || '').replace(/[\s\-+]/g, '')
  if (/^0(7|1)\d{8}$/.test(p)) p = '254' + p.slice(1)
  else if (/^(7|1)\d{8}$/.test(p)) p = '254' + p
  return /^254(7|1)\d{8}$/.test(p) ? p : null
}

let tokenCache = { value: '', until: 0 }
async function accessToken() {
  if (tokenCache.value && Date.now() < tokenCache.until) return tokenCache.value
  const auth = Buffer.from(`${CONSUMER_KEY}:${CONSUMER_SECRET}`).toString('base64')
  const r = await fetch(`${BASE}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(20000),
  })
  if (!r.ok) throw new Error(`Daraja auth failed (${r.status}) ${await r.text()} [env=${DARAJA_ENV}]`)
  const d = await r.json()
  tokenCache = { value: d.access_token, until: Date.now() + (Number(d.expires_in) - 60) * 1000 }
  return tokenCache.value
}

function stamp() {
  const d = new Date(Date.now() + 3 * 3600000) // Nairobi time
  return d.toISOString().replace(/[-:T]/g, '').slice(0, 14)
}
const password = (ts) => Buffer.from(`${SHORTCODE}${PASSKEY}${ts}`).toString('base64')

async function daraja(path, body) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  })
  const text = await r.text()
  try { return JSON.parse(text) } catch { return { errorMessage: `M-Pesa replied (${r.status}) with an unreadable response.` } }
}

const app = express()
app.set('trust proxy', 1) // Render sits behind a proxy; needed for correct rate limiting
app.use(cors())
app.use(express.json({ limit: '1mb' }))
app.use((req, res, next) => { console.log(req.method, req.path); next() })
app.get('/', (req, res) => res.send('AutoBingwa token server running'))

/* ================= PORTAL (phone + password accounts) ================= */

// Public: create a portal account. Only this route can mark a user as a portal user.
app.post('/portal/signup',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false }),
  async (req, res) => {
    try {
      if (!sbAdmin) return res.status(503).json({ error: 'Portal is not configured yet.' })
      const phone = normalizePhone(req.body && req.body.phone)
      const pw = String((req.body && req.body.password) || '')
      if (!phone) return res.status(400).json({ error: 'Enter a valid phone number, for example 0712345678.' })
      if (pw.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' })

      const { data, error } = await sbAdmin.auth.admin.createUser({
        email: `${phone}@portal.autobingwaportal.co.ke`,
        password: pw,
        email_confirm: true,
        app_metadata: { portal: true },
        user_metadata: { phone },
      })
      if (error) {
        if (error.code === 'email_exists' || /already|registered/i.test(error.message || ''))
          return res.status(409).json({ error: 'This phone number already has a portal account. Please log in.' })
        console.error('portal signup', error.message)
        return res.status(400).json({ error: 'Could not create the account.' })
      }
      // The database trigger already created the portal_accounts row; store the phone on it
      await sbAdmin.from('portal_accounts').update({ phone }).eq('user_id', data.user.id)
      res.json({ ok: true })
    } catch (e) {
      console.error('portal signup', e)
      res.status(500).json({ error: 'Could not create the account.' })
    }
  })

// Everything below /portal needs a logged-in portal user
async function requireUser(req, res, next) {
  try {
    if (!sbAdmin) return res.status(503).json({ error: 'Portal is not configured yet.' })
    const token = (req.headers.authorization || '').replace(/^Bearer /, '')
    if (!token) return res.status(401).json({ error: 'No token' })
    const { data, error } = await sbAdmin.auth.getUser(token)
    if (error || !data.user) return res.status(401).json({ error: 'Invalid token' })

    let acct = (await sbAdmin.from('portal_accounts').select('*').eq('user_id', data.user.id).maybeSingle()).data
    // A genuine portal user whose row is missing gets one created automatically
    if (!acct && data.user.app_metadata && data.user.app_metadata.portal) {
      await sbAdmin.from('portal_accounts').insert({ user_id: data.user.id, phone: (data.user.user_metadata || {}).phone || null })
      acct = (await sbAdmin.from('portal_accounts').select('*').eq('user_id', data.user.id).maybeSingle()).data
    }
    if (!acct) return res.status(403).json({ error: 'No portal account' })

    req.user = data.user
    req.acct = acct // biz, plan, plan_exp and phone for this portal user
    next()
  } catch (e) {
    console.error('requireUser', e)
    res.status(500).json({ error: 'Could not check your login.' })
  }
}
app.use('/portal', requireUser)

// Test route: confirms the login reaches the server
app.get('/portal/me', (req, res) => {
  res.json({ userId: req.user.id, phone: req.acct.phone || null, biz: req.acct.biz || null, plan: req.acct.plan || null })
})

/* ================= PORTAL SUBSCRIPTION (M-Pesa) ================= */

app.get('/portal/plans', (req, res) =>
  res.json({ plans: planList(), current: planInfo(req.acct), phone: req.acct.phone || '' }))

async function finishSubPayment(id, receipt) {
  const { rows } = await pool.query(
    "UPDATE portal_payments SET status='paid', receipt=$2 WHERE id=$1 AND status='pending' RETURNING *", [id, receipt || null])
  const pay = rows[0]
  if (!pay) return // already handled, so a repeated callback cannot extend twice
  const def = SUB_PLANS[pay.plan_id]
  const { data: acct } = await sbAdmin.from('portal_accounts').select('plan_exp').eq('user_id', pay.user_id).maybeSingle()
  const cur = acct && acct.plan_exp ? new Date(acct.plan_exp).getTime() : 0
  const from = Math.max(cur, Date.now()) // renewing early adds on top of the remaining time
  await sbAdmin.from('portal_accounts')
    .update({ plan: pay.plan_id, plan_exp: new Date(from + def.days * 86400000).toISOString() })
    .eq('user_id', pay.user_id)
}

app.post('/portal/subscribe/start',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 15, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => (req.user ? req.user.id : 'none') }),
  async (req, res) => {
    try {
      if (!dbReady) return res.status(503).json({ error: 'Server is starting, try again in a few seconds.' })
      const plan = SUB_PLANS[req.body && req.body.planId]
      if (!plan) return res.status(400).json({ error: 'Unknown plan.' })
      const phone = normalizePhone((req.body && req.body.phone) || req.acct.phone)
      if (!phone) return res.status(400).json({ error: 'Enter a valid M-Pesa number, for example 0712345678.' })
      const ts = stamp()
      const d = await daraja('/mpesa/stkpush/v1/processrequest', {
        BusinessShortCode: SHORTCODE, Password: password(ts), Timestamp: ts,
        TransactionType: LIVE ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
        Amount: plan.price, PartyA: phone, PartyB: LIVE ? TILL_NUMBER : SHORTCODE, PhoneNumber: phone,
        CallBackURL: `${CALLBACK_BASE}/pay/portal/callback/${CALLBACK_SECRET}`,
        AccountReference: 'AutoBingwaPortal', TransactionDesc: `Portal ${plan.name}`,
      })
      if (d.ResponseCode !== '0') {
        console.error('portal stk refused', d)
        return res.status(502).json({ error: d.errorMessage || d.ResponseDescription || 'M-Pesa refused the request.' })
      }
      const id = crypto.randomUUID()
      await pool.query(
        'INSERT INTO portal_payments (id, user_id, phone, plan_id, amount, checkout_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, req.user.id, phone, req.body.planId, plan.price, d.CheckoutRequestID])
      res.json({ paymentId: id })
    } catch (e) {
      console.error('subscribe start', e)
      res.status(500).json({ error: 'Could not start the payment.' })
    }
  })

app.get('/portal/subscribe/status/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM portal_payments WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id])
    let p = rows[0]
    if (!p) return res.status(404).json({ error: 'Not found.' })
    // If the callback never arrived, ask Safaricom directly after 40 seconds
    if (p.status === 'pending' && Date.now() - new Date(p.created_at).getTime() > 40000) {
      const ts = stamp()
      const q = await daraja('/mpesa/stkpushquery/v1/query', {
        BusinessShortCode: SHORTCODE, Password: password(ts), Timestamp: ts, CheckoutRequestID: p.checkout_id })
      if (q.ResultCode !== undefined) {
        const code = Number(q.ResultCode)
        if (code === 0) await finishSubPayment(p.id, null)
        else if (code !== 4999)
          await pool.query("UPDATE portal_payments SET status=$2, message=$3 WHERE id=$1 AND status='pending'",
            [p.id, code === 1032 ? 'cancelled' : 'failed', q.ResultDesc || ''])
      }
      p = (await pool.query('SELECT * FROM portal_payments WHERE id=$1', [p.id])).rows[0]
    }
    res.json({ status: p.status, message: p.message || '' })
  } catch (e) {
    console.error('subscribe status', e)
    res.status(500).json({ error: 'Could not check the payment.' })
  }
})

// Safaricom calls this (no login), so it lives outside /portal
app.post('/pay/portal/callback/:secret', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' }) // always answer Safaricom quickly
  if (req.params.secret !== CALLBACK_SECRET) return
  try {
    const cb = req.body && req.body.Body && req.body.Body.stkCallback
    if (!cb) return
    const { rows } = await pool.query('SELECT * FROM portal_payments WHERE checkout_id=$1', [cb.CheckoutRequestID])
    const p = rows[0]
    if (!p || p.status !== 'pending') return
    if (Number(cb.ResultCode) === 0) {
      const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || []
      const get = (n) => (items.find((i) => i.Name === n) || {}).Value
      if (Number(get('Amount')) < p.amount) {
        await pool.query("UPDATE portal_payments SET status='failed', message='Amount did not match.' WHERE id=$1", [p.id])
        return
      }
      await finishSubPayment(p.id, String(get('MpesaReceiptNumber') || ''))
    } else {
      await pool.query("UPDATE portal_payments SET status=$2, message=$3 WHERE id=$1 AND status='pending'",
        [p.id, Number(cb.ResultCode) === 1032 ? 'cancelled' : 'failed', cb.ResultDesc || ''])
    }
  } catch (e) {
    console.error('portal callback', e)
  }
})

/* ================= PORTAL DEVICES (connect ID, live data, commands) ================= */

const ONLINE_MS = 40000 // a phone counts as online if it synced in the last 40 seconds

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b))
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d }
const str = (v, max = 500) => String(v ?? '').slice(0, max)
const normCid = (v) => { const c = String(v || '').trim().toUpperCase(); return /^[A-Z0-9-]{5,20}$/.test(c) ? c : '' }
const isOnline = (d) => !!d.portal_enabled && !!d.last_seen && Date.now() - new Date(d.last_seen).getTime() < ONLINE_MS

/* ---------- Offer (data plan) cleaning, shared by the phone sync and the portal routes ---------- */
   const OFFER_CATS = ['DATA', 'MINUTES', 'SMS', 'TUNUKIWA', 'BINGWA']
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
const normUssd = (v) => String(v || '').replace(/\s+/g, '').replace(/ab/gi, 'AB').slice(0, 200)
const ussdError = (u) => !u ? 'Enter the USSD code'
  : !u.includes('AB') ? 'The USSD code must contain AB where the phone number goes'
  : !/^\*[0-9*]+#$/.test(u.replace(/AB/g, '0')) ? 'The USSD code must start with * and end with #, with only numbers and * between'
  : ''
// A signature is passed through as the phone built it (small, JSON only), so the phone can read it back
const cleanSigRaw = (s) => {
  try {
    if (!s || typeof s !== 'object' || !Array.isArray(s.steps) || s.steps.length > 30) return null
    const j = JSON.stringify(s)
    if (j.length > 20000) return null
    const o = JSON.parse(j)
    o.complete = !!o.complete
    return o
  } catch { return null }
}
const cleanScreens = (a) => (Array.isArray(a) ? a : []).slice(0, 15).map((x) => str(x, 1500))
const cleanTw = (t) => {
  t = t && typeof t === 'object' ? t : {}
  return { on: !!t.on, from: HHMM.test(t.from) ? t.from : '06:00', until: HHMM.test(t.until) ? t.until : '22:00',
    altId: str(t.altId, 64), notify: !!t.notify, msg: str(t.msg, 300) }
}
function cleanOffer(o) {
  const smart = !!o.smart, signature = !!o.signature, sigLearned = !!o.sigLearned, sigEnabled = !!o.sigEnabled
  const sig = cleanSigRaw(o.sig)
  return {
    id: str(o.id, 64), name: str(o.name, 80), cat: str(o.cat || o.category, 30) || 'DATA',
    price: num(o.price), safPrice: num(o.safPrice), ussd: str(o.ussd, 200), on: (o.on ?? o.enabled) !== false,
    smart, signature, locked: smart || signature, sigLearned, sigEnabled, sigAuto: !!o.sigAuto,
    signed: smart || signature || (sigLearned && sigEnabled),
    ...(sig ? { sig } : {}),
    autoRetry: !!o.autoRetry, retryCount: Math.min(10, Math.max(1, Math.round(num(o.retryCount, 1)))),
    retryPending: !!o.retryPending, retryFailed: o.retryFailed !== false,
    autoReschedule: !!o.autoReschedule, rescheduleTime: HHMM.test(o.rescheduleTime) ? o.rescheduleTime : '06:00',
    notifyOn: !!o.notifyOn, notifyMsg: str(o.notifyMsg, 300),
    tw: cleanTw(o.tw),
  }
}

// Only known fields are kept, so a phone can never store anything unexpected
function cleanSnapshot(s = {}) {
  const recent = (Array.isArray(s.recent) ? s.recent : []).slice(0, 20).map((t) => ({
    id: str(t.id, 64), name: str(t.name, 80), phone: str(t.phone, 20), amt: num(t.amt), offer: str(t.offer, 80),
    st: ['Completed', 'Failed', 'Pending', 'Processing', 'Scheduled', 'Unmatched', 'Paused', 'Skipped'].includes(t.st) ? t.st : 'Pending',
    ts: Number.isFinite(Date.parse(t.ts)) ? new Date(t.ts).toISOString() : new Date().toISOString(),
    msg: str(t.msg, 600), ussd: str(t.ussd, 200), resp: str(t.resp, 600),
  }))
  return {
    ok: num(s.ok), failed: num(s.failed), tokens: num(s.tokens),
    airUsed: num(s.airUsed), airBal: num(s.airBal),
    battery: Math.max(0, Math.min(100, Math.round(num(s.battery)))), charging: !!s.charging,
    commission: num(s.commission), running: !!s.running, unlimitedUntil: str(s.unlimitedUntil, 10), recent,
    offers: (Array.isArray(s.offers) ? s.offers : []).slice(0, 150).filter((o) => o && typeof o === 'object').map(cleanOffer).filter((o) => o.id && o.ussd),
  }
}

/* ---------- Transaction history + command helpers ---------- */
const EAT = 3 * 3600000, DAY = 86400000
const dayStart = (back) => new Date(Math.floor((Date.now() + EAT) / DAY) * DAY - EAT - back * DAY) // start of Nairobi day
const TOKEN_LABELS = { u1000: '1,000 units', u600: '600 units', u250: '250 units', u100: '100 units', d1: '1 day unlimited', d7: '7 days unlimited', d30: '30 days unlimited' }
const TXCOLS = 'device_id,tx_id,name,phone,amt,offer,st,ts,msg,ussd,resp,qd'
const txOut = (r, now = Date.now()) => ({
  id: r.device_id + ':' + r.tx_id, dev: r.device_id, name: r.name || '', phone: r.phone || '', amt: r.amt, offer: r.offer || '',
  st: r.st, ts: new Date(r.ts).toISOString(), m: Math.max(0, Math.floor((now - new Date(r.ts).getTime()) / 60000)),
  msg: r.msg || '', ussd: r.ussd || '', resp: r.resp || '', qd: !!r.qd,
})
async function saveTx(devId, list) {
  for (const t of list || []) {
    if (!t.id) continue
    await pool.query(
      `INSERT INTO portal_tx (device_id,tx_id,name,phone,amt,offer,st,ts,msg,ussd,resp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (device_id,tx_id) DO UPDATE SET name=EXCLUDED.name,phone=EXCLUDED.phone,amt=EXCLUDED.amt,offer=EXCLUDED.offer,
       st=EXCLUDED.st,msg=EXCLUDED.msg,ussd=EXCLUDED.ussd,resp=EXCLUDED.resp`,
      [String(devId), t.id, t.name, t.phone, Math.round(t.amt), t.offer, t.st, t.ts, t.msg, t.ussd, t.resp])
  }
}
// A paid portal token purchase queues one command for the phone, exactly once
async function creditPortal(p) {
  if (!p || !String(p.device_id).startsWith('portal:')) return
  const r = await pool.query("UPDATE payments SET credited=true WHERE id=$1 AND credited=false AND status='paid'", [p.id])
  if (!r.rowCount) return
  await sbAdmin.from('device_commands').insert({
    device_id: String(p.device_id).slice(7), type: 'credit_tokens',
    payload: { packId: p.plan_id, paymentId: p.id, receipt: p.receipt || '' } })
}

/* ---------- Phone side (authenticated with the device key, not a login) ---------- */
async function deviceAuth(req, res, next) {
  try {
    if (!sbAdmin) return res.status(503).json({ error: 'Portal is not configured yet.' })
    const cid = normCid(req.headers['x-connect-id'])
    const secret = str(req.headers['x-device-secret'], 100)
    const { data: dev } = await sbAdmin.from('devices').select('*').eq('connect_id', cid).maybeSingle()
    if (!dev || !safeEq(sha(secret), dev.secret_hash)) return res.status(401).json({ error: 'Bad device credentials.' })
    req.dev = dev
    next()
  } catch (e) {
    console.error('deviceAuth', e)
    res.status(500).json({ error: 'Could not check the device.' })
  }
}

app.post('/device/register',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }),
  async (req, res) => {
    try {
      if (!sbAdmin) return res.status(503).json({ error: 'Portal is not configured yet.' })
      const cid = normCid(req.body && req.body.connectId)
      if (!cid) return res.status(400).json({ error: 'Bad Connect ID.' })
      const secret = crypto.randomBytes(24).toString('hex')
      const { error } = await sbAdmin.from('devices').insert({ connect_id: cid, secret_hash: sha(secret) })
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'This device is already registered.' })
        console.error('register', error.message)
        return res.status(500).json({ error: 'Could not register the device.' })
      }
      res.json({ secret })
    } catch (e) {
      console.error('register', e)
      res.status(500).json({ error: 'Could not register the device.' })
    }
  })

app.post('/device/sync',
  rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => String(req.headers['x-connect-id'] || 'none') }),
  deviceAuth,
  async (req, res) => {
    try {
      const b = req.body || {}
      const portalOn = !!b.portalOn
      const patch = { portal_enabled: portalOn, last_seen: new Date().toISOString() }
      if (portalOn && b.snapshot) patch.snapshot = cleanSnapshot(b.snapshot)
      await sbAdmin.from('devices').update(patch).eq('id', req.dev.id)
      if (portalOn && patch.snapshot) { try { await saveTx(req.dev.id, patch.snapshot.recent) } catch (e) { console.error('saveTx', e.message) } }

      const cutoff = new Date(Date.now() - 120000).toISOString()
      await sbAdmin.from('device_commands').update({ status: 'expired' })
        .eq('device_id', req.dev.id).eq('status', 'pending').neq('type', 'credit_tokens').lt('created_at', cutoff)
      let q = sbAdmin.from('device_commands').select('id,type,payload')
        .eq('device_id', req.dev.id).eq('status', 'pending').order('id').limit(10)
      if (!portalOn) q = q.in('type', ['portal_on', 'portal_off']) // while off, only the switch commands go out
      const { data } = await q
      const commands = data || []
      // credit_tokens (money already paid) is re-sent until the phone confirms it
      const mark = commands.filter((c) => c.type !== 'credit_tokens').map((c) => c.id)
      if (mark.length)
        await sbAdmin.from('device_commands').update({ status: 'sent', done_at: new Date().toISOString() }).in('id', mark)
      const qds = commands.filter((c) => c.type === 'quickdial' && c.payload && c.payload.txId).map((c) => c.payload.txId)
      if (qds.length) await pool.query("UPDATE portal_tx SET st='Processing' WHERE device_id=$1 AND tx_id=ANY($2::text[]) AND st='Pending'", [String(req.dev.id), qds])

      res.json({ ok: true, commands })
    } catch (e) {
      console.error('sync', e)
      res.status(500).json({ error: 'Sync failed.' })
    }
  })

// The phone reports how a command went (quickdial, buy_tokens, credit_tokens, offer and signature commands)
app.post('/device/command-result', deviceAuth, async (req, res) => {
  try {
    const b = req.body || {}, id = num(b.id), msg = str(b.msg, 600)
    let ok = !!b.ok
    const { data: c } = await sbAdmin.from('device_commands').select('*').eq('id', id).eq('device_id', req.dev.id).maybeSingle()
    if (!c) return res.status(404).json({ error: 'Unknown command.' })
    let store = msg
    if (c.type === 'sig_learn' && ok) {
      // The learned signature and the screens the phone saw travel back in b.data
      const sg = cleanSigRaw(b.data && b.data.signature)
      if (!sg) { ok = false; store = 'The phone returned a signature that could not be read.' }
      else store = JSON.stringify({ signature: sg, screens: cleanScreens(b.data.screens) })
    }
    await sbAdmin.from('device_commands').update({ status: 'sent', result: ok ? 'ok' : 'failed', result_msg: store, done_at: new Date().toISOString() }).eq('id', id)
    const txId = c.payload && c.payload.txId
    if (txId) await pool.query("UPDATE portal_tx SET st=$3, resp=CASE WHEN $4::text='' THEN resp ELSE $4::text END WHERE device_id=$1 AND tx_id=$2",
      [String(req.dev.id), txId, ok ? 'Completed' : 'Failed', msg])
    res.json({ ok: true })
  } catch (e) { console.error('command-result', e); res.status(500).json({ error: 'Could not save the result.' }) }
})

/* ---------- Portal side (logged-in portal user) ---------- */
app.post('/portal/devices/connect',
  rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
    keyGenerator: (req) => (req.user ? req.user.id : 'none') }),
  async (req, res) => {
    try {
      const plan = planInfo(req.acct)
      if (!plan.active)
        return res.status(403).json({ error: 'Subscribe first to connect a phone. Choose a plan on the subscription page.' })

      const cid = normCid(req.body && req.body.connectId)
      const name = str(req.body && req.body.name, 40).trim()
      if (!cid) return res.status(400).json({ error: 'Enter the Connect ID shown in the app, for example AUB-ABC12.' })
      if (!name) return res.status(400).json({ error: 'Give this phone a name.' })

      const { data: dev } = await sbAdmin.from('devices').select('*').eq('connect_id', cid).maybeSingle()
      if (!dev || !dev.portal_enabled)
        return res.status(404).json({ error: 'That phone is not showing as Connected. Open AutoBingwa on it, switch on AutoBingwa Portal, wait for the status to say Connected, then try again.' })
      if (dev.owner_id && dev.owner_id !== req.user.id)
        return res.status(409).json({ error: 'This phone is already connected to another portal account.' })

      if (dev.owner_id !== req.user.id) {
        const { count } = await sbAdmin.from('devices').select('id', { count: 'exact', head: true }).eq('owner_id', req.user.id)
        if ((count || 0) >= plan.max)
          return res.status(403).json({ error: `Your plan allows up to ${plan.max} phone${plan.max === 1 ? '' : 's'}. Upgrade to connect more.` })
      }
      const { error } = await sbAdmin.from('devices').update({ owner_id: req.user.id, name }).eq('id', dev.id)
      if (error) return res.status(500).json({ error: 'Could not connect the phone.' })
      res.json({ ok: true, id: dev.id })
    } catch (e) {
      console.error('connect', e)
      res.status(500).json({ error: 'Could not connect the phone.' })
    }
  })

app.get('/portal/overview', async (req, res) => {
  try {
    const plan = planInfo(req.acct)
    if (!plan.active)
      return res.json({ biz: req.acct.biz || 'My business', cid: req.acct.phone || '', plan, locked: true, devices: [], tx: [], plans: planList() })
    const { data: rows, error } = await sbAdmin.from('devices').select('*').eq('owner_id', req.user.id).order('created_at')
    if (error) return res.status(500).json({ error: 'Could not load your devices.' })
    const now = Date.now()
    const devices = [], tx = []
    for (const d of rows || []) {
      const s = d.snapshot || {}
      devices.push({
        id: d.id, name: d.name || d.connect_id, cid: d.connect_id,
        online: isOnline(d), portalOn: !!d.portal_enabled, running: !!s.running,
        reachable: !!d.last_seen && now - new Date(d.last_seen).getTime() < ONLINE_MS,
        air: s.airBal || 0, used: s.airUsed || 0, tok: s.tokens || 0,
        bat: s.battery || 0, chg: !!s.charging, com: s.commission || 0,
        ok: s.ok || 0, failed: s.failed || 0,
        offers: s.offers || [], // the Data plans page reads each phone's offers from here
        ...(s.unlimitedUntil ? { until: s.unlimitedUntil } : {}),
      })
    }
    try {
      const ids = (rows || []).map((d) => String(d.id))
      if (ids.length) {
        const r = await pool.query(`SELECT ${TXCOLS} FROM portal_tx WHERE device_id=ANY($1::text[]) AND ts>=$2 ORDER BY ts DESC LIMIT 60`,
          [ids, dayStart(plan.history - 1).toISOString()])
        for (const x of r.rows) tx.push(txOut(x, now))
      }
    } catch (e) { console.error('overview tx', e.message) }
    res.json({
      biz: req.acct.biz || 'My business', cid: req.acct.phone || '',
      plan,
      devices, tx, plans: [],
    })
  } catch (e) {
    console.error('overview', e)
    res.status(500).json({ error: 'Could not load your portal.' })
  }
})

app.get('/portal/transactions', async (req, res) => {
  try {
    const plan = planInfo(req.acct)
    if (!plan.active) return res.json({ tx: [], history: 0 })
    const { data: rows } = await sbAdmin.from('devices').select('id').eq('owner_id', req.user.id)
    let ids = (rows || []).map((r) => String(r.id))
    const want = str(req.query.device, 64)
    if (want && want !== 'all') ids = ids.filter((i) => i === want)
    if (!ids.length) return res.json({ tx: [], history: plan.history })
    const earliest = dayStart(plan.history - 1)
    let from = earliest, to = new Date(Date.now() + DAY)
    if (req.query.range === 'today') from = dayStart(0)
    else if (req.query.range === 'yest') { from = dayStart(1); to = dayStart(0) }
    if (from < earliest) from = earliest // the plan's history limit is enforced here, not in the page
    const params = [ids, from.toISOString(), to.toISOString()]
    let where = 'device_id=ANY($1::text[]) AND ts>=$2 AND ts<$3'
    const q = str(req.query.q, 60).trim()
    if (q) {
      const lk = (s) => '%' + s.replace(/[\\%_]/g, '\\$&') + '%'
      params.push(lk(q))
      let cond = 'name ILIKE $4 OR phone ILIKE $4 OR msg ILIKE $4 OR offer ILIKE $4'
      const digits = q.replace(/[\s+-]/g, '')
      if (/^\d{4,}$/.test(digits)) { params.push(lk(digits.replace(/^(254|0)/, ''))); cond += ' OR phone ILIKE $5 OR msg ILIKE $5' }
      where += ` AND (${cond})`
    }
    const r = await pool.query(`SELECT ${TXCOLS} FROM portal_tx WHERE ${where} ORDER BY ts DESC LIMIT 500`, params)
    res.json({ tx: r.rows.map((x) => txOut(x)), history: plan.history })
  } catch (e) { console.error('transactions', e); res.status(500).json({ error: 'Could not load transactions.' }) }
})

async function ownedDev(req, id) {
  const { data } = await sbAdmin.from('devices').select('*').eq('id', str(id, 64)).eq('owner_id', req.user.id).maybeSingle()
  return data
}
async function queueCmd(deviceId, type, payload) {
  const { data, error } = await sbAdmin.from('device_commands').insert({ device_id: deviceId, type, payload }).select('id').single()
  if (error) throw new Error(error.message)
  return data.id
}
const portalLimit = (n) => rateLimit({ windowMs: 60 * 60 * 1000, max: n, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => (req.user ? req.user.id : 'none') })

app.post('/portal/quickdial', portalLimit(200), async (req, res) => {
  try {
    if (!planInfo(req.acct).active) return res.status(403).json({ error: 'Your subscription has expired. Renew it to control your phones.' })
    const d = await ownedDev(req, req.body && req.body.device)
    if (!d) return res.status(404).json({ error: 'Device not found.' })
    if (!isOnline(d)) return res.status(409).json({ error: 'The phone is offline. Open AutoBingwa on it and check that AutoBingwa Portal is on.' })
    const offer = ((d.snapshot || {}).offers || []).find((o) => o.id === str(req.body.offerId, 64))
    if (!offer || !offer.on) return res.status(400).json({ error: 'That offer is not available on the phone.' })
    const p = normalizePhone(req.body.phone)
    if (!p) return res.status(400).json({ error: 'Enter a valid phone number, for example 0712345678.' })
    const phone = '0' + p.slice(3), txId = 'qd-' + crypto.randomBytes(6).toString('hex'), ussd = offer.ussd.replace(/AB/g, phone)
    await queueCmd(d.id, 'quickdial', { txId, offerId: offer.id, offer: offer.name, phone, ussd, amt: offer.price })
    await pool.query(`INSERT INTO portal_tx (device_id,tx_id,name,phone,amt,offer,st,msg,ussd,resp,qd) VALUES ($1,$2,'Quick Dial',$3,$4,$5,'Pending','Started from the portal Quick Dial',$6,'',true)`,
      [String(d.id), txId, phone, Math.round(offer.price), offer.name, ussd])
    res.json({ ok: true, txId: d.id + ':' + txId, ussd })
  } catch (e) { console.error('quickdial', e); res.status(500).json({ error: 'Could not send Quick Dial.' }) }
})

app.post('/portal/tokens/buy', portalLimit(30), async (req, res) => {
  try {
    if (!planInfo(req.acct).active) return res.status(403).json({ error: 'Your subscription has expired.' })
    const b = req.body || {}, amount = PLANS[b.packId]
    if (!amount) return res.status(400).json({ error: 'Unknown token pack.' })
    const d = await ownedDev(req, b.device)
    if (!d) return res.status(404).json({ error: 'Device not found.' })
    if (b.method === 'airtime') {
      if (!isOnline(d)) return res.status(409).json({ error: 'The phone is offline. Open AutoBingwa on it and check that AutoBingwa Portal is on.' })
      const { data: dup } = await sbAdmin.from('device_commands').select('id').eq('device_id', d.id).eq('type', 'buy_tokens')
        .in('status', ['pending', 'sent']).is('result', null).gte('created_at', new Date(Date.now() - 60000).toISOString()).limit(1)
      if (dup && dup.length) return res.status(409).json({ error: 'A token purchase is already in progress on this phone.' })
      const id = await queueCmd(d.id, 'buy_tokens', { packId: b.packId, amount, label: TOKEN_LABELS[b.packId] })
      return res.json({ commandId: id })
    }
    if (b.method !== 'mpesa') return res.status(400).json({ error: 'Choose M-Pesa or airtime.' })
    if (!dbReady) return res.status(503).json({ error: 'Server is starting, try again in a few seconds.' })
    const phone = normalizePhone(b.phone)
    if (!phone) return res.status(400).json({ error: 'Enter a valid M-Pesa number, for example 0712345678.' })
    const ts = stamp()
    const r = await daraja('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: SHORTCODE, Password: password(ts), Timestamp: ts,
      TransactionType: LIVE ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
      Amount: amount, PartyA: phone, PartyB: LIVE ? TILL_NUMBER : SHORTCODE, PhoneNumber: phone,
      CallBackURL: `${CALLBACK_BASE}/tokens/mpesa/callback/${CALLBACK_SECRET}`,
      AccountReference: 'AutoBingwa', TransactionDesc: `Tokens ${b.packId}` })
    if (r.ResponseCode !== '0') return res.status(502).json({ error: r.errorMessage || r.ResponseDescription || 'M-Pesa refused the request.' })
    const id = crypto.randomUUID()
    await pool.query('INSERT INTO payments (id, device_id, phone, plan_id, amount, checkout_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, 'portal:' + d.id, phone, b.packId, amount, r.CheckoutRequestID])
    res.json({ paymentId: id })
  } catch (e) { console.error('portal tokens', e); res.status(500).json({ error: 'Could not start the purchase.' }) }
})

app.get('/portal/tokens/mpesa/status/:id', async (req, res) => {
  try {
    let p = (await pool.query('SELECT * FROM payments WHERE id=$1', [req.params.id])).rows[0]
    if (!p || !String(p.device_id).startsWith('portal:') || !(await ownedDev(req, p.device_id.slice(7)))) return res.status(404).json({ error: 'Not found.' })
    if (p.status === 'pending' && Date.now() - new Date(p.created_at).getTime() > 40000) {
      const ts = stamp()
      const q = await daraja('/mpesa/stkpushquery/v1/query', { BusinessShortCode: SHORTCODE, Password: password(ts), Timestamp: ts, CheckoutRequestID: p.checkout_id })
      if (q.ResultCode !== undefined) {
        const code = Number(q.ResultCode)
        if (code === 0) await pool.query("UPDATE payments SET status='paid', receipt=COALESCE(receipt,$2) WHERE id=$1 AND status='pending'", [p.id, p.checkout_id])
        else if (code !== 4999) await pool.query("UPDATE payments SET status=$2, message=$3 WHERE id=$1 AND status='pending'", [p.id, code === 1032 ? 'cancelled' : 'failed', q.ResultDesc || ''])
        p = (await pool.query('SELECT * FROM payments WHERE id=$1', [p.id])).rows[0]
      }
    }
    let commandId = null
    if (p.status === 'paid') {
      await creditPortal(p)
      const { data: c } = await sbAdmin.from('device_commands').select('id').eq('payload->>paymentId', p.id).maybeSingle()
      commandId = c ? c.id : null
    }
    res.json({ status: p.status, message: p.message || '', commandId })
  } catch (e) { console.error('portal token status', e); res.status(500).json({ error: 'Could not check the payment.' }) }
})

app.get('/portal/commands/:id', async (req, res) => {
  try {
    const { data: c } = await sbAdmin.from('device_commands').select('id,device_id,status,result,result_msg').eq('id', num(req.params.id)).maybeSingle()
    if (!c || !(await ownedDev(req, c.device_id))) return res.status(404).json({ error: 'Not found.' })
    const s = c.result === 'ok' ? 'completed' : c.result ? 'failed' : c.status === 'expired' ? 'failed' : c.status === 'sent' ? 'running' : 'pending'
    res.json({ status: s, message: c.result_msg || (c.status === 'expired' ? 'The phone did not respond.' : '') })
  } catch (e) { console.error('command status', e); res.status(500).json({ error: 'Could not check the command.' }) }
})

/* ================= PORTAL DATA PLANS (the offers on each phone) =================
   Every change is queued as a command for the phone, and the saved copy of the phone's
   offers is updated right away so the portal looks instant. The phone's next sync then
   replaces that copy with what the phone really has, so the app is always the truth.
   Commands the phone must handle:
     offer_add     {offer}                      offer_delete  {id}
     offer_update  {id, mode, patch}            mode = 'edit' | 'toggle' | 'window'
     sig_learn     {offerId, ussd, testPhone}   (phone replies with data:{signature,screens})
     sig_save      {offerId, signature, enabled}                                              */

const offersOf = (d) => (d.snapshot || {}).offers || []
const saveOffers = (d, offers) => sbAdmin.from('devices').update({ snapshot: { ...(d.snapshot || {}), offers } }).eq('id', d.id)
const isLockedOffer = (o) => !!(o && (o.smart || o.signature || o.locked))
const verified = (o) => !!(o.smart || o.signature || (o.sigLearned && o.sigEnabled))
// The phone app names these fields category and enabled
const toApp = (p) => { const { on, cat, ...r } = p; return { ...r, ...(on !== undefined ? { enabled: on } : {}), ...(cat !== undefined ? { category: cat } : {}) } }

// Finds the phone a plan change is for: the one named in the request, otherwise the only phone that has this offer
async function planCtx(req, res, offerId) {
  if (!planInfo(req.acct).active) { res.status(403).json({ error: 'Your subscription has expired. Renew it to control your phones.' }); return null }
  const { data } = await sbAdmin.from('devices').select('*').eq('owner_id', req.user.id)
  const devs = data || []
  const want = str((req.body && req.body.device) || req.query.device, 64)
  let d = null
  if (want) d = devs.find((x) => String(x.id) === want) || null
  else if (offerId) {
    const hits = devs.filter((x) => offersOf(x).some((o) => o.id === String(offerId)))
    if (hits.length === 1) d = hits[0]
  } else if (devs.length === 1) d = devs[0]
  if (!d) { res.status(404).json({ error: 'Phone not found. Pick the phone first.' }); return null }
  if (!isOnline(d)) { res.status(409).json({ error: 'The phone is offline. Open AutoBingwa on it and check that AutoBingwa Portal is on.' }); return null }
  return d
}

// Turns what the portal sent into a clean patch. A locked (verified Smart) offer keeps its name, category, USSD and Safaricom price.
function offerPatch(b, cur) {
  const lock = isLockedOffer(cur), has = (k) => b[k] !== undefined, p = {}
  if (!lock) {
    if (has('name')) p.name = str(b.name, 80).trim()
    if (has('ussd')) p.ussd = normUssd(b.ussd)
    if (has('category')) { const c = String(b.category).toUpperCase(); if (OFFER_CATS.includes(c)) p.cat = c }
    if (has('safPrice')) p.safPrice = Math.max(0, num(b.safPrice))
  }
  if (has('price')) p.price = num(b.price)
  for (const k of ['autoRetry', 'retryPending', 'retryFailed', 'autoReschedule', 'notifyOn']) if (has(k)) p[k] = !!b[k]
  if (has('retryCount')) p.retryCount = Math.min(10, Math.max(1, Math.round(num(b.retryCount, 1))))
  if (has('rescheduleTime')) p.rescheduleTime = HHMM.test(b.rescheduleTime) ? b.rescheduleTime : '06:00'
  if (has('notifyMsg')) p.notifyMsg = str(b.notifyMsg, 300).trim()
  if (has('tw')) p.tw = cleanTw(b.tw)
  const en = has('enabled') ? b.enabled : b.on
  if (en !== undefined) p.on = !!en
  return p
}
const twError = (o, offers) => {
  const t = o.tw
  if (!t || !t.on) return ''
  if (t.from === t.until) return 'The start and end time cannot be the same'
  if (!offers.find((x) => x.id === t.altId && x.id !== o.id && x.on)) return 'Choose an alternative offer for outside the window'
  return ''
}
const offerError = (o, offers) => {
  if (!o.name) return 'Enter the offer name'
  const e = ussdError(o.ussd)
  if (e) return e
  if (!(o.price > 0) || o.price > 100000) return 'Enter the amount'
  if (o.notifyOn && !o.notifyMsg) return 'Write the SMS message for the customer'
  return twError(o, offers)
}

app.post('/portal/plans', portalLimit(300), async (req, res) => {
  try {
    const d = await planCtx(req, res, null)
    if (!d) return
    const offers = offersOf(d)
    if (offers.length >= 150) return res.status(400).json({ error: 'This phone already has the most offers it can hold.' })
    let id = Date.now()
    while (offers.some((x) => x.id === String(id))) id++
    const o = { id: String(id), cat: 'DATA', safPrice: 0, on: true, autoRetry: false, retryCount: 1, retryPending: false, retryFailed: true,
      autoReschedule: false, rescheduleTime: '06:00', notifyOn: false, notifyMsg: '', tw: cleanTw(), ...offerPatch(req.body || {}, null) }
    const err = offerError(o, offers)
    if (err) return res.status(400).json({ error: err })
    const commandId = await queueCmd(d.id, 'offer_add', { offer: toApp(o) })
    await saveOffers(d, [...offers, cleanOffer(o)])
    res.json({ ok: true, id: o.id, commandId })
  } catch (e) { console.error('plan add', e); res.status(500).json({ error: 'Could not add the plan.' }) }
})

app.put('/portal/plans/:id', portalLimit(600), async (req, res) => {
  try {
    const d = await planCtx(req, res, req.params.id)
    if (!d) return
    const offers = offersOf(d), cur = offers.find((o) => o.id === req.params.id)
    if (!cur) return res.status(404).json({ error: 'That plan is no longer on the phone.' })
    const p = offerPatch(req.body || {}, cur), keys = Object.keys(p)
    if (!keys.length) return res.json({ ok: true })
    const mode = keys.every((k) => k === 'on') ? 'toggle' : keys.every((k) => k === 'tw') ? 'window' : 'edit'
    const next = { ...cur, ...p }
    const err = mode === 'toggle' ? '' : mode === 'window' ? twError(next, offers) : offerError(next, offers)
    if (err) return res.status(400).json({ error: err })
    const commandId = await queueCmd(d.id, 'offer_update', { id: cur.id, mode, patch: toApp(p) })
    // A manual offer's signature is switched off by an edit, like in the app
    if (mode === 'edit' && !isLockedOffer(cur)) next.sigEnabled = false
    next.signed = verified(next)
    await saveOffers(d, offers.map((o) => (o.id === cur.id ? next : o)))
    res.json({ ok: true, commandId })
  } catch (e) { console.error('plan update', e); res.status(500).json({ error: 'Could not save the plan.' }) }
})

app.delete('/portal/plans/:id', portalLimit(300), async (req, res) => {
  try {
    const d = await planCtx(req, res, req.params.id)
    if (!d) return
    const offers = offersOf(d)
    if (!offers.some((o) => o.id === req.params.id)) return res.status(404).json({ error: 'That plan is no longer on the phone.' })
    const commandId = await queueCmd(d.id, 'offer_delete', { id: req.params.id })
    // An offer that used the deleted one as its time-window alternative is no longer restricted
    await saveOffers(d, offers.filter((o) => o.id !== req.params.id)
      .map((o) => (o.tw && o.tw.altId === req.params.id ? { ...o, tw: { ...o.tw, on: false, altId: '' } } : o)))
    res.json({ ok: true, commandId })
  } catch (e) { console.error('plan delete', e); res.status(500).json({ error: 'Could not delete the plan.' }) }
})

// Learn the signature: the phone dials every step with a test number and stops before the purchase
app.post('/portal/plans/:id/learn', portalLimit(60), async (req, res) => {
  try {
    const d = await planCtx(req, res, req.params.id)
    if (!d) return
    const cur = offersOf(d).find((o) => o.id === req.params.id)
    if (!cur) return res.status(404).json({ error: 'That plan is no longer on the phone.' })
    const bad = ussdError(cur.ussd)
    if (bad) return res.status(400).json({ error: bad })
    const { data: dup } = await sbAdmin.from('device_commands').select('id').eq('device_id', d.id).eq('type', 'sig_learn')
      .in('status', ['pending', 'sent']).is('result', null).gte('created_at', new Date(Date.now() - 150000).toISOString()).limit(1)
    if (dup && dup.length) return res.status(409).json({ error: 'A signature is already being learned on this phone. Wait for it to finish.' })
    const job = await queueCmd(d.id, 'sig_learn', { offerId: cur.id, ussd: cur.ussd, testPhone: '0700000000' })
    res.json({ ok: true, job })
  } catch (e) { console.error('sig learn', e); res.status(500).json({ error: 'Could not start learning.' }) }
})

app.get('/portal/plans/:id/learn/:job', async (req, res) => {
  try {
    const { data: c } = await sbAdmin.from('device_commands').select('*').eq('id', num(req.params.job)).eq('type', 'sig_learn').maybeSingle()
    if (!c || !(await ownedDev(req, c.device_id))) return res.status(404).json({ error: 'Not found.' })
    if (c.result === 'ok') {
      try {
        const r = JSON.parse(c.result_msg)
        return res.json({ status: 'done', signature: r.signature, screens: r.screens || [] })
      } catch { return res.json({ status: 'error', error: 'The phone returned a signature that could not be read.' }) }
    }
    if (c.result) return res.json({ status: 'error', error: c.result_msg || 'Learning failed on the phone.' })
    if (c.status === 'expired') return res.json({ status: 'error', error: 'The phone did not respond. Check that it is online and try again.' })
    if (Date.now() - new Date(c.created_at).getTime() > 150000) return res.json({ status: 'error', error: 'The phone took too long. Keep it unlocked and try again.' })
    res.json({ status: 'running' })
  } catch (e) { console.error('sig status', e); res.status(500).json({ error: 'Could not check the learning.' }) }
})

// Save the signature on the phone (and switch it on or off)
app.post('/portal/plans/:id/signature', portalLimit(120), async (req, res) => {
  try {
    const d = await planCtx(req, res, req.params.id)
    if (!d) return
    const offers = offersOf(d), cur = offers.find((o) => o.id === req.params.id)
    if (!cur) return res.status(404).json({ error: 'That plan is no longer on the phone.' })
    if (cur.smart && cur.sig && !cur.sigAuto) return res.status(403).json({ error: 'This verified Smart plan has a built-in signature that cannot be changed.' })
    const sig = cleanSigRaw(req.body && req.body.signature)
    if (!sig || !sig.complete) return res.status(400).json({ error: 'This signature is not complete, so it cannot be saved. Learn it again.' })
    const enabled = cur.smart ? true : !!(req.body && req.body.enabled)
    const commandId = await queueCmd(d.id, 'sig_save', { offerId: cur.id, signature: sig, enabled })
    const next = { ...cur, sig, sigLearned: true, sigEnabled: enabled }
    next.signed = verified(next)
    await saveOffers(d, offers.map((o) => (o.id === cur.id ? next : o)))
    res.json({ ok: true, commandId })
  } catch (e) { console.error('sig save', e); res.status(500).json({ error: 'Could not save the signature.' }) }
})

async function ownedDevice(req, res) {
  const { data } = await sbAdmin.from('devices').select('*').eq('id', req.params.id).eq('owner_id', req.user.id).maybeSingle()
  if (!data) { res.status(404).json({ error: 'Device not found.' }); return null }
  return data
}

for (const [path, type] of [['airtime-check', 'airtime_check'], ['start', 'start'], ['stop', 'stop']]) {
  app.post(`/portal/devices/:id/${path}`, async (req, res) => {
    try {
      const d = await ownedDevice(req, res)
      if (!d) return
      if (!planInfo(req.acct).active) return res.status(403).json({ error: 'Your subscription has expired. Renew it to control your phones.' })
      if (!isOnline(d)) return res.status(409).json({ error: 'The phone is offline. Open AutoBingwa on it and check that AutoBingwa Portal is on.' })
      const since = new Date(Date.now() - 20000).toISOString()
      const { data: dup } = await sbAdmin.from('device_commands').select('id')
        .eq('device_id', d.id).eq('type', type).in('status', ['pending', 'sent']).gte('created_at', since).limit(1)
      if (!dup || !dup.length) await sbAdmin.from('device_commands').insert({ device_id: d.id, type })
      res.json({ ok: true })
    } catch (e) {
      console.error('command', e)
      res.status(500).json({ error: 'Could not send the command.' })
    }
  })
}

// Flip the phone's AutoBingwa Portal switch from the portal. Works while the switch is off,
// as long as the phone has checked in recently.
for (const [path, type] of [['portal-on', 'portal_on'], ['portal-off', 'portal_off']]) {
  app.post(`/portal/devices/:id/${path}`, async (req, res) => {
    try {
      const d = await ownedDevice(req, res)
      if (!d) return
      if (!planInfo(req.acct).active) return res.status(403).json({ error: 'Your subscription has expired. Renew it to control your phones.' })
      const seen = d.last_seen ? Date.now() - new Date(d.last_seen).getTime() : Infinity
      if (seen > ONLINE_MS) return res.status(409).json({ error: 'The phone cannot be reached. Open AutoBingwa on it first.' })
      await sbAdmin.from('device_commands').update({ status: 'expired' })
        .eq('device_id', d.id).in('type', ['portal_on', 'portal_off']).eq('status', 'pending')
      const { error } = await sbAdmin.from('device_commands').insert({ device_id: d.id, type })
      if (error) { console.error('switch', error.message); return res.status(500).json({ error: 'Could not send the command.' }) }
      res.json({ ok: true })
    } catch (e) {
      console.error('switch', e)
      res.status(500).json({ error: 'Could not send the command.' })
    }
  })
}

app.post('/portal/devices/:id/unlink', async (req, res) => {
  try {
    const d = await ownedDevice(req, res)
    if (!d) return
    await sbAdmin.from('devices').update({ owner_id: null, name: null }).eq('id', d.id)
    res.json({ ok: true })
  } catch (e) {
    console.error('unlink', e)
    res.status(500).json({ error: 'Could not remove the phone.' })
  }
})

/* ================= TOKENS (M-Pesa) ================= */

// 1. The app asks for an STK push
app.post('/tokens/mpesa/start', async (req, res) => {
  try {
    if (!dbReady) return res.status(503).json({ error: 'Server is starting, try again in a few seconds.' })
    const { planId, deviceId } = req.body || {}
    const phone = normalizePhone(req.body && req.body.phone)
    const amount = PLANS[planId]
    if (!amount) return res.status(400).json({ error: 'Unknown plan.' })
    if (!phone) return res.status(400).json({ error: 'Invalid phone number.' })
    if (!deviceId) return res.status(400).json({ error: 'Missing device.' })

    const ts = stamp()
    const d = await daraja('/mpesa/stkpush/v1/processrequest', {
      BusinessShortCode: SHORTCODE,
      Password: password(ts),
      Timestamp: ts,
      TransactionType: LIVE ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
      Amount: amount,
      PartyA: phone,
      PartyB: LIVE ? TILL_NUMBER : SHORTCODE,
      PhoneNumber: phone,
      CallBackURL: `${CALLBACK_BASE}/tokens/mpesa/callback/${CALLBACK_SECRET}`,
      AccountReference: 'AutoBingwa',
      TransactionDesc: `Tokens ${planId}`,
    })
    if (d.ResponseCode !== '0') {
      console.error('stk refused', d)
      return res.status(502).json({ error: d.errorMessage || d.ResponseDescription || 'M-Pesa refused the request.' })
    }

    const id = crypto.randomUUID()
    await pool.query(
      'INSERT INTO payments (id, device_id, phone, plan_id, amount, checkout_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [id, String(deviceId), phone, planId, amount, d.CheckoutRequestID]
    )
    res.json({ paymentId: id })
  } catch (e) {
    console.error('start', e)
    res.status(500).json({ error: 'Could not start the payment.' })
  }
})

// 2. Safaricom tells us the result
app.post('/tokens/mpesa/callback/:secret', async (req, res) => {
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' }) // always answer Safaricom quickly
  if (req.params.secret !== CALLBACK_SECRET) return
  try {
    const cb = req.body && req.body.Body && req.body.Body.stkCallback
    if (!cb) return
    const { rows } = await pool.query('SELECT * FROM payments WHERE checkout_id = $1', [cb.CheckoutRequestID])
    const p = rows[0]
    if (!p || p.status !== 'pending') return
    if (Number(cb.ResultCode) === 0) {
      const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || []
      const get = (n) => (items.find((i) => i.Name === n) || {}).Value
      const paid = Number(get('Amount'))
      const receipt = String(get('MpesaReceiptNumber') || '')
      if (!receipt || paid < p.amount) {
        await pool.query("UPDATE payments SET status='failed', message='Amount did not match.' WHERE id=$1", [p.id])
        return
      }
      await pool.query("UPDATE payments SET status='paid', receipt=$2 WHERE id=$1 AND status='pending'", [p.id, receipt])
      await creditPortal({ ...p, receipt })
    } else {
      const status = Number(cb.ResultCode) === 1032 ? 'cancelled' : 'failed'
      await pool.query('UPDATE payments SET status=$2, message=$3 WHERE id=$1 AND status=$4', [p.id, status, cb.ResultDesc || '', 'pending'])
    }
  } catch (e) {
    console.error('callback', e)
  }
})

// 3. The app asks whether the money arrived
app.get('/tokens/mpesa/status/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM payments WHERE id = $1', [req.params.id])
    let p = rows[0]
    if (!p || p.device_id !== String(req.query.deviceId || '')) return res.status(404).json({ error: 'Not found.' })

    // If the callback never arrived, ask Safaricom directly after 40 seconds
    if (p.status === 'pending' && Date.now() - new Date(p.created_at).getTime() > 40000) {
      const ts = stamp()
      const q = await daraja('/mpesa/stkpushquery/v1/query', {
        BusinessShortCode: SHORTCODE, Password: password(ts), Timestamp: ts, CheckoutRequestID: p.checkout_id,
      })
      if (q.ResultCode !== undefined) {
        const code = Number(q.ResultCode)
        if (code === 0) await pool.query("UPDATE payments SET status='paid', receipt=COALESCE(receipt,$2) WHERE id=$1 AND status='pending'", [p.id, p.checkout_id])
        else if (code !== 4999) await pool.query('UPDATE payments SET status=$2, message=$3 WHERE id=$1 AND status=$4', [p.id, code === 1032 ? 'cancelled' : 'failed', q.ResultDesc || '', 'pending'])
        p = (await pool.query('SELECT * FROM payments WHERE id = $1', [p.id])).rows[0]
      }
    }
    res.json({ status: p.status, planId: p.plan_id, amount: p.amount, receipt: p.receipt || '', message: p.message || '' })
  } catch (e) {
    console.error('status', e)
    res.status(500).json({ error: 'Could not check the payment.' })
  }
})

app.listen(PORT, () => {
  console.log('Token server on', PORT)
  initDb()
  setInterval(() => {
    if (!dbReady) return
    pool.query("UPDATE portal_tx SET st='Failed', resp='The phone did not pick up the request.' WHERE qd AND ((st='Pending' AND created_at<now()-interval '3 minutes') OR (st='Processing' AND created_at<now()-interval '10 minutes'))").catch(() => {})
    pool.query("DELETE FROM portal_tx WHERE ts<now()-interval '8 days'").catch(() => {})
  }, 60000)
})