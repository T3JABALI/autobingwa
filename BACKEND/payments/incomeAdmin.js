import crypto from 'crypto'
import rateLimit from 'express-rate-limit'
import { getTokenPlan } from './tokenAdmin.js'
import { getSubPlan } from './portalAdmin.js'

const EAT = 3 * 3600000, DAY = 86400000
const str = (v, max = 500) => String(v ?? '').slice(0, max)

// Every payment in one list: M-Pesa tokens, M-Pesa portal subscriptions, airtime payments
const INC = `WITH inc AS (
  SELECT id, 'token'::text AS kind, 'mpesa'::text AS method, amount, status, created_at, phone, plan_id AS item, receipt AS ref, device_id AS who FROM payments
  UNION ALL
  SELECT id, 'portal', 'mpesa', amount, status, created_at, phone, plan_id, receipt, user_id FROM portal_payments
  UNION ALL
  SELECT id, kind, 'airtime', amount, status, created_at, phone, item, ref, who FROM airtime_payments
)`

const STATUS = { paid: 'Completed', pending: 'Pending', failed: 'Failed', cancelled: 'Cancelled' }

export async function initIncomeTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS airtime_payments (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'token', amount INT NOT NULL, status TEXT NOT NULL DEFAULT 'paid',
    phone TEXT, item TEXT, ref TEXT, who TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS airtime_payments_ref ON airtime_payments (ref) WHERE ref IS NOT NULL')
  await pool.query('CREATE INDEX IF NOT EXISTS airtime_payments_ts ON airtime_payments (created_at DESC)')
}

// Saves one airtime payment. The same ref is never saved twice. Never throws.
export async function recordAirtime(pool, { kind = 'token', amount, item, ref, who, phone }) {
  try {
    await pool.query(
      'INSERT INTO airtime_payments (id,kind,amount,item,ref,who,phone) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING',
      [crypto.randomUUID(), kind, Math.round(Number(amount) || 0), item || null, ref || null, who || null, phone || null])
  } catch (e) { console.error('recordAirtime', e.message) }
}

// Nairobi week (Monday to Sunday) and month
function clock() {
  const sh = new Date(Date.now() + EAT)
  const dow = (sh.getUTCDay() + 6) % 7
  const todayMs = Date.UTC(sh.getUTCFullYear(), sh.getUTCMonth(), sh.getUTCDate())
  return { dow, monMs: todayMs - dow * DAY, month: sh.toISOString().slice(0, 7) }
}
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10)

async function itemLabel(pool, kind, item, cache) {
  if (!item) return ''
  const k = kind + ':' + item
  if (k in cache) return cache[k]
  let v = item
  try {
    if (kind === 'portal') { const p = getSubPlan(item); if (p && p.name) v = p.name }
    else { const p = await getTokenPlan(pool, item); if (p && p.label) v = p.label }
  } catch { /* keep the id */ }
  cache[k] = v
  return v
}

async function listTx(pool, sbAdmin, o) {
  const where = [], params = []
  if (['token', 'portal'].includes(o.kind)) { params.push(o.kind); where.push(`kind = $${params.length}`) }
  if (['mpesa', 'airtime'].includes(o.method)) { params.push(o.method); where.push(`method = $${params.length}`) }
  const st = { completed: 'paid', pending: 'pending', failed: 'failed', cancelled: 'cancelled' }[o.status]
  if (st) { params.push(st); where.push(`status = $${params.length}`) }
  const q = str(o.q, 60).trim()
  if (q) {
    const lk = (s) => '%' + s.replace(/[\\%_]/g, '\\$&') + '%'
    params.push(lk(q))
    let cond = `phone ILIKE $${params.length} OR ref ILIKE $${params.length} OR id ILIKE $${params.length}`
    const digits = q.replace(/[\s+-]/g, '')
    if (/^\d{4,}$/.test(digits)) { params.push(lk(digits.replace(/^(254|0)/, ''))); cond += ` OR phone ILIKE $${params.length}` }
    where.push(`(${cond})`)
  }
  const limit = Math.min(60, Math.max(1, Number(o.limit) || 30)), offset = Math.max(0, Number(o.offset) || 0)
  params.push(limit + 1, offset)
  const r = await pool.query(
    `${INC} SELECT * FROM inc ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params)
  const rows = r.rows.slice(0, limit)

  // Portal subscribers: show the business name
  const names = {}
  const ids = [...new Set(rows.filter((x) => x.kind === 'portal' && x.who).map((x) => x.who))]
  if (sbAdmin && ids.length) {
    try {
      const { data } = await sbAdmin.from('portal_accounts').select('user_id,biz,phone').in('user_id', ids)
      for (const a of data || []) names[a.user_id] = a.biz || ''
    } catch (e) { console.error('income names', e.message) }
  }
  const cache = {}
  const tx = []
  for (const x of rows) {
    const ref = x.ref && !String(x.ref).startsWith('ws_CO_') ? x.ref : ''
    tx.push({
      key: x.id,
      id: ref || '#' + String(x.id).slice(0, 8).toUpperCase(),
      kind: x.kind === 'portal' ? 'portal' : 'token',
      method: x.method,
      amount: x.amount,
      status: STATUS[x.status] || 'Pending',
      ts: new Date(x.created_at).toISOString(),
      phone: x.phone || '',
      name: x.kind === 'portal' ? names[x.who] || '' : '',
      item: await itemLabel(pool, x.kind === 'portal' ? 'portal' : 'token', x.item, cache),
    })
  }
  return { tx, more: r.rows.length > limit }
}

export function mountIncomeRoutes({ app, pool, requireAdmin, sbAdmin }) {
  // The app reports an airtime token payment after the airtime transfer was confirmed on the phone
  app.post('/tokens/airtime/record',
    rateLimit({ windowMs: 60 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }),
    async (req, res) => {
      try {
        const b = req.body || {}
        const pack = await getTokenPlan(pool, b.packId)
        const ref = str(b.ref, 64).trim()
        if (!pack || !pack.price) return res.status(400).json({ error: 'Unknown plan.' })
        if (ref.length < 6) return res.status(400).json({ error: 'Missing reference.' })
        await recordAirtime(pool, { kind: 'token', amount: pack.price, item: b.packId, ref, who: str(b.deviceId, 64), phone: str(b.phone, 20) })
        res.json({ ok: true })
      } catch (e) { console.error('airtime record', e); res.status(500).json({ error: 'Could not record the payment.' }) }
    })

  // Home: this month's totals and the 5 latest payments
  app.get('/admin/income/summary', requireAdmin, async (req, res) => {
    try {
      const c = clock()
      const m = await pool.query(
        `${INC} SELECT method, SUM(amount)::int AS amt, COUNT(*)::int AS n FROM inc
         WHERE status='paid' AND to_char(created_at AT TIME ZONE 'Africa/Nairobi','YYYY-MM') = $1 GROUP BY method`, [c.month])
      const get = (k) => m.rows.find((r) => r.method === k) || { amt: 0, n: 0 }
      const a = get('airtime'), p = get('mpesa')
      const recent = await listTx(pool, sbAdmin, { limit: 5 })
      res.json({ month: c.month, airtime: a.amt, airtimeN: a.n, mpesa: p.amt, mpesaN: p.n, total: a.amt + p.amt, recent: recent.tx })
    } catch (e) { console.error('income summary', e); res.status(500).json({ error: 'Could not load the income.' }) }
  })

  // Income dashboard: this week and last week, day by day (Monday to Sunday)
  app.get('/admin/income/week', requireAdmin, async (req, res) => {
    try {
      const c = clock()
      const from = new Date(c.monMs - 7 * DAY - EAT).toISOString()
      const r = await pool.query(
        `${INC} SELECT to_char(created_at AT TIME ZONE 'Africa/Nairobi','YYYY-MM-DD') AS d, kind, method, SUM(amount)::int AS amt
         FROM inc WHERE status='paid' AND created_at >= $1 GROUP BY 1,2,3`, [from])
      const keys = Array.from({ length: 14 }, (_, i) => isoDay(c.monMs - 7 * DAY + i * DAY))
      const at = Object.fromEntries(keys.map((k, i) => [k, i]))
      const z = () => Array(14).fill(0)
      const S = { total: z(), token: z(), portal: z(), mpesa: z(), airtime: z() }
      for (const x of r.rows) {
        const i = at[x.d]
        if (i === undefined) continue
        S.total[i] += x.amt
        if (S[x.kind]) S[x.kind][i] += x.amt
        if (S[x.method]) S[x.method][i] += x.amt
      }
      const split = (a) => ({ last: a.slice(0, 7), this: a.slice(7) })
      res.json({
        today: c.dow, thisStart: keys[7], lastStart: keys[0],
        total: split(S.total), tokens: split(S.token), portal: split(S.portal), mpesa: split(S.mpesa), airtime: split(S.airtime),
      })
    } catch (e) { console.error('income week', e); res.status(500).json({ error: 'Could not load the weekly income.' }) }
  })

  // Every payment, with search and filters
  app.get('/admin/income/transactions', requireAdmin, async (req, res) => {
    try {
      res.json(await listTx(pool, sbAdmin, {
        limit: req.query.limit, offset: req.query.offset, kind: req.query.kind, method: req.query.method,
        status: req.query.status, q: req.query.q,
      }))
    } catch (e) { console.error('income tx', e); res.status(500).json({ error: 'Could not load the transactions.' }) }
  })
}