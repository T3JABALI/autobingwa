import rateLimit from 'express-rate-limit'
import { getSubPlan } from './portalAdmin.js'

const DAY = 86400000
const ACTIVE_DAYS = 30
const s = (v, m) => String(v ?? '').slice(0, m)
const np = (v) => {
  let p = String(v || '').replace(/[\s\-+]/g, '')
  if (/^0(7|1)\d{8}$/.test(p)) p = '254' + p.slice(1)
  else if (/^(7|1)\d{8}$/.test(p)) p = '254' + p
  return /^254(7|1)\d{8}$/.test(p) ? p : ''
}
const later = (a, b) => (!a ? b : !b ? a : new Date(a) > new Date(b) ? a : b)
const earlier = (a, b) => (!a ? b : !b ? a : new Date(a) < new Date(b) ? a : b)

async function listAuthUsers(sbAdmin) {
  const all = []
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await sbAdmin.auth.admin.listUsers({ page, perPage: 200 })
    if (error || !data || !data.users || !data.users.length) break
    all.push(...data.users)
    if (data.users.length < 200) break
  }
  return all
}

export async function initUsersTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS app_errors (
    id SERIAL PRIMARY KEY, kind TEXT NOT NULL, phone TEXT, device_id TEXT, message TEXT, ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  await pool.query(`CREATE TABLE IF NOT EXISTS error_resolved (
    key TEXT PRIMARY KEY, resolved_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
}

export function mountUsersRoutes({ app, pool, requireAdmin, sbAdmin }) {
  // The phone app can report its own errors here (no login, like /device/register)
  app.post('/app/error',
    rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false }),
    async (req, res) => {
      try {
        const b = req.body || {}
        const kind = s(b.kind, 60)
        if (!kind) return res.status(400).json({ error: 'Missing kind.' })
        await pool.query('INSERT INTO app_errors (kind,phone,device_id,message,ref) VALUES ($1,$2,$3,$4,$5)',
          [kind, s(b.phone, 20), s(b.deviceId, 64), s(b.message, 600), s(b.ref, 100)])
        res.json({ ok: true })
      } catch (e) { console.error('app error', e); res.status(500).json({ error: 'Could not save.' }) }
    })

  app.get('/admin/users', requireAdmin, async (req, res) => {
    try {
      const now = Date.now()

      /* ---------- App users: identified by email ---------- */
      if (req.query.type !== 'portal') {
        const groups = (await pool.query(`
          SELECT device_id,
                 array_agg(DISTINCT phone) AS phones,
                 MIN(created_at) AS first, MAX(created_at) AS last,
                 COUNT(*) FILTER (WHERE status='paid') AS paid_n,
                 COALESCE(SUM(amount) FILTER (WHERE status='paid'),0) AS spent,
                 COUNT(*) FILTER (WHERE status IN ('failed','cancelled')) AS failed_n
          FROM payments WHERE device_id NOT LIKE 'portal:%' GROUP BY device_id`)).rows

        const used = new Set()
        const out = []

        if (sbAdmin) {
          const authUsers = await listAuthUsers(sbAdmin)
          const { data: profs } = await sbAdmin.from('profiles').select('id,role')
          const admins = new Set((profs || []).filter((p) => p.role === 'admin').map((p) => p.id))
          for (const u of authUsers) {
            if (admins.has(u.id) || (u.app_metadata && u.app_metadata.portal)) continue
            const phones = new Set([np(u.phone), np((u.user_metadata || {}).phone)].filter(Boolean))
            const mine = groups.filter((g) => g.device_id === u.id || (g.phones || []).some((p) => phones.has(np(p))))
            let first = u.created_at || null, last = null, purchases = 0, spent = 0, failed = 0, phone = [...phones][0] || ''
            for (const g of mine) {
              used.add(g.device_id)
              first = earlier(first, g.first)
              last = later(last, g.last)
              purchases += Number(g.paid_n); spent += Number(g.spent); failed += Number(g.failed_n)
              if (!phone && g.phones && g.phones[0]) phone = g.phones[0]
            }
            const lastActive = later(last, u.last_sign_in_at || null)
            out.push({
              id: u.id, email: u.email || '', phone, joined: first, lastActive,
              active: !!lastActive && now - new Date(lastActive).getTime() < ACTIVE_DAYS * DAY,
              purchases, spent, failed,
            })
          }
        }

        // Payment devices that match no account are still listed, by phone
        for (const g of groups) {
          if (used.has(g.device_id)) continue
          out.push({
            id: g.device_id, email: '', phone: (g.phones && g.phones[0]) || '', joined: g.first, lastActive: g.last,
            active: now - new Date(g.last).getTime() < ACTIVE_DAYS * DAY,
            purchases: Number(g.paid_n), spent: Number(g.spent), failed: Number(g.failed_n),
          })
        }

        out.sort((a, b) => new Date(b.lastActive || 0) - new Date(a.lastActive || 0))
        return res.json({ users: out.slice(0, 500) })
      }

      /* ---------- Portal users ---------- */
      if (!sbAdmin) return res.json({ users: [] })
      const { data: accts } = await sbAdmin.from('portal_accounts').select('*').order('created_at', { ascending: false }).limit(300)
      const { data: devs } = await sbAdmin.from('devices').select('owner_id').not('owner_id', 'is', null)
      const count = {}
      for (const d of devs || []) count[d.owner_id] = (count[d.owner_id] || 0) + 1
      res.json({
        users: (accts || []).map((a) => {
          const exp = a.plan_exp ? new Date(a.plan_exp).getTime() : 0
          const def = getSubPlan(a.plan)
          return {
            id: a.user_id, name: a.biz || '', phone: a.phone || '', joined: a.created_at || null,
            active: exp > now, plan: def ? def.name : 'None', expires: a.plan_exp || null,
            devices: count[a.user_id] || 0,
          }
        }),
      })
    } catch (e) { console.error('admin users', e); res.status(500).json({ error: 'Could not load users.' }) }
  })

  app.get('/admin/analytics', requireAdmin, async (req, res) => {
    try {
      const since = new Date(Date.now() - 14 * DAY).toISOString()
      const items = []

      const pay = await pool.query(
        `SELECT id,phone,plan_id,amount,status,message,created_at FROM payments
         WHERE status IN ('failed','cancelled') AND created_at>=$1 ORDER BY created_at DESC LIMIT 100`, [since])
      for (const p of pay.rows) items.push({
        key: 'pay:' + p.id, kind: p.status === 'cancelled' ? 'M-Pesa payment cancelled' : 'M-Pesa payment failed',
        sev: p.status === 'cancelled' ? 'warn' : 'high', phone: p.phone, ts: p.created_at,
        msg: (p.message || 'No reason given') + ' (KSh ' + p.amount + ')', ref: p.plan_id, source: 'Payments' })

      const tx = await pool.query(
        `SELECT device_id,tx_id,phone,offer,msg,ussd,resp,ts FROM portal_tx
         WHERE st='Failed' AND ts>=$1 ORDER BY ts DESC LIMIT 100`, [since])
      for (const t of tx.rows) items.push({
        key: 'tx:' + t.device_id + ':' + t.tx_id, kind: 'USSD purchase failed', sev: 'high', phone: t.phone, ts: t.ts,
        msg: t.resp || t.msg || 'No response from the phone', ref: [t.offer, t.ussd].filter(Boolean).join(' · '), source: 'USSD' })

      if (sbAdmin) {
        const { data: cmds } = await sbAdmin.from('device_commands').select('id,device_id,type,result_msg,created_at')
          .eq('result', 'failed').gte('created_at', since).order('created_at', { ascending: false }).limit(50)
        for (const c of cmds || []) items.push({
          key: 'cmd:' + c.id, kind: 'Phone command failed (' + c.type + ')', sev: 'warn', phone: '', ts: c.created_at,
          msg: c.result_msg || 'The phone reported a failure', ref: 'Device ' + c.device_id, source: 'Phone' })
      }

      const ae = await pool.query('SELECT * FROM app_errors WHERE created_at>=$1 ORDER BY created_at DESC LIMIT 100', [since])
      for (const e of ae.rows) items.push({
        key: 'app:' + e.id, kind: e.kind, sev: 'high', phone: e.phone || '', ts: e.created_at,
        msg: e.message || '', ref: e.ref || '', source: 'App' })

      const resolved = new Map((await pool.query('SELECT key,resolved_at FROM error_resolved')).rows.map((r) => [r.key, r.resolved_at]))
      items.sort((a, b) => new Date(b.ts) - new Date(a.ts))
      const errors = items.slice(0, 120).map((i) => ({ ...i, done: resolved.has(i.key) }))

      // Success rate for today (Nairobi day)
      const d0 = new Date(Date.now() + 3 * 3600000); d0.setUTCHours(0, 0, 0, 0)
      const from = new Date(d0.getTime() - 3 * 3600000)
      const a = (await pool.query("SELECT COUNT(*) n, COUNT(*) FILTER (WHERE st='Completed') ok FROM portal_tx WHERE ts>=$1", [from])).rows[0]
      const b = (await pool.query("SELECT COUNT(*) n, COUNT(*) FILTER (WHERE status='paid') ok FROM payments WHERE created_at>=$1", [from])).rows[0]
      const n = Number(a.n) + Number(b.n), ok = Number(a.ok) + Number(b.ok)
      const weekAgo = Date.now() - 7 * DAY
      res.json({
        successRate: n ? Math.round((ok / n) * 100) : null,
        open: errors.filter((e) => !e.done).length,
        resolvedWeek: [...resolved.values()].filter((t) => new Date(t).getTime() > weekAgo).length,
        errors,
      })
    } catch (e) { console.error('admin analytics', e); res.status(500).json({ error: 'Could not load analytics.' }) }
  })

  app.post('/admin/analytics/resolve', requireAdmin, async (req, res) => {
    try {
      const key = s(req.body && req.body.key, 120)
      if (!key) return res.status(400).json({ error: 'Missing key.' })
      await pool.query('INSERT INTO error_resolved (key) VALUES ($1) ON CONFLICT DO NOTHING', [key])
      res.json({ ok: true })
    } catch (e) { console.error('resolve', e); res.status(500).json({ error: 'Could not save.' }) }
  })
}