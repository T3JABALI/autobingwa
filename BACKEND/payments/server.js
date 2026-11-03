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
app.use(express.json())
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
    const { data: acct } = await sbAdmin.from('portal_accounts').select('*').eq('user_id', data.user.id).maybeSingle()
    if (!acct) return res.status(403).json({ error: 'No portal account' })
    req.user = data.user
    req.acct = acct // biz, plan and phone for this portal user
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
})