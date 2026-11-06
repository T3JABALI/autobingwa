import ExcelJS from 'exceljs'
import rateLimit from 'express-rate-limit'

export const BATCH = 2000

const DEFAULT_PLANS = [
  { id: 'd2', name: '2 Devices', price: 100, max: 2, history: 3, days: 31, sort: 1,
    features: ['2 devices paired', '3 days of portal history', '31 days of access'] },
  { id: 'd4', name: '4 Devices', price: 200, max: 4, history: 5, days: 31, sort: 2,
    features: ['4 devices paired', '5 days of portal history', '31 days of access'] },
  { id: 'unl', name: 'Unlimited Plan', price: 400, max: 1000, history: 7, days: 31, sort: 3,
    features: ['Unlimited devices paired', '7 days of portal history', '31 days of access'] },
]

// Kept in memory so planInfo() stays instant. Includes inactive plans, so old subscribers keep working.
let cache = new Map()
const fromRow = (r) => ({
  id: r.id, name: r.name, price: r.price, max: r.max_devices, history: r.history_days, days: r.days,
  features: Array.isArray(r.features) ? r.features : [], active: r.active, sort: r.sort_order,
})
async function reloadPlans(pool) {
  const { rows } = await pool.query('SELECT * FROM portal_plans ORDER BY sort_order, created_at')
  cache = new Map(rows.map((r) => [r.id, fromRow(r)]))
}
export const getSubPlan = (id) => cache.get(String(id)) || null
export const activePlans = () => [...cache.values()].filter((p) => p.active).sort((a, b) => a.sort - b.sort)

export async function initPortalTables(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS portal_plans (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, price INT NOT NULL, max_devices INT NOT NULL,
    history_days INT NOT NULL, days INT NOT NULL, features JSONB NOT NULL DEFAULT '[]',
    active BOOLEAN NOT NULL DEFAULT true, sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  const { rows } = await pool.query('SELECT count(*)::int AS n FROM portal_plans')
  if (!rows[0].n) {
    for (const p of DEFAULT_PLANS)
      await pool.query(
        'INSERT INTO portal_plans (id,name,price,max_devices,history_days,days,features,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [p.id, p.name, p.price, p.max, p.history, p.days, JSON.stringify(p.features), p.sort])
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS contacts (
    phone TEXT PRIMARY KEY, seq BIGINT NOT NULL UNIQUE, name TEXT NOT NULL DEFAULT '',
    sources TEXT[] NOT NULL DEFAULT '{}',
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(), last_seen TIMESTAMPTZ NOT NULL DEFAULT now())`)
  await reloadPlans(pool)
}

/* ---------------- Contacts ---------------- */
function normPhone(input) {
  let p = String(input || '').replace(/[\s\-+]/g, '')
  if (/^0(7|1)\d{8}$/.test(p)) p = '254' + p.slice(1)
  else if (/^(7|1)\d{8}$/.test(p)) p = '254' + p
  return /^254(7|1)\d{8}$/.test(p) ? p : null
}
const cleanName = (n) =>
  String(n || '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
    .toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase())

// Saves new contacts with the next running number. The lock makes the numbering gap-free,
// so every batch holds exactly 2000 contacts. Returns how many were NEW.
export async function upsertContacts(pool, list, source) {
  const byPhone = new Map()
  for (const c of list || []) {
    const phone = normPhone(c && c.phone)
    if (!phone) continue
    const name = cleanName(c.name)
    if (!byPhone.has(phone) || (name && !byPhone.get(phone))) byPhone.set(phone, name)
  }
  if (!byPhone.size) return 0
  const client = await pool.connect()
  let added = 0
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(7001)')
    for (const [phone, name] of byPhone) {
      const r = await client.query(
        `INSERT INTO contacts (seq, phone, name, sources)
         VALUES ((SELECT COALESCE(MAX(seq),0)+1 FROM contacts), $1, $2, ARRAY[$3::text])
         ON CONFLICT (phone) DO UPDATE SET
           last_seen = now(),
           name = CASE WHEN contacts.name = '' THEN EXCLUDED.name ELSE contacts.name END,
           sources = CASE WHEN $3::text = ANY(contacts.sources) OR COALESCE(array_length(contacts.sources,1),0) >= 20
                          THEN contacts.sources ELSE array_append(contacts.sources, $3::text) END
         RETURNING (xmax = 0) AS inserted`, [phone, name, source])
      if (r.rows[0] && r.rows[0].inserted) added++
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
  return added
}

// Used by the phone sync: every Completed transaction is a client who bought
export const saveContactsFromTx = (pool, devId, recent) =>
  upsertContacts(pool,
    (recent || []).filter((t) => t.st === 'Completed' && t.phone)
      .map((t) => ({ name: t.name === 'Quick Dial' ? '' : t.name, phone: t.phone })),
    'dev:' + devId)

const batchRange = (n) => [(n - 1) * BATCH + 1, n * BATCH]
const FORMATS = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv', vcf: 'text/vcard', json: 'application/json', txt: 'text/plain',
}
const safeCell = (v) => (/^[=+\-@\t\r]/.test(String(v)) ? "'" + v : String(v)) // stops spreadsheet formula tricks
const csvCell = (v) => '"' + safeCell(v).replace(/"/g, '""') + '"'
const vEsc = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\r?\n/g, ' ')

async function buildExport(rows, format) {
  const batchOf = (r) => Math.floor((Number(r.seq) - 1) / BATCH) + 1
  if (format === 'csv') {
    const lines = ['No,Name,Phone,Batch,First seen,Last seen']
    for (const r of rows)
      lines.push([r.seq, csvCell(r.name), csvCell(r.phone), batchOf(r), r.first_seen.toISOString(), r.last_seen.toISOString()].join(','))
    return Buffer.from('\ufeff' + lines.join('\r\n'), 'utf8') // BOM so Excel reads the names correctly
  }
  if (format === 'vcf')
    return Buffer.from(rows.map((r) => `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${vEsc(r.name || 'Client ' + r.phone)}\r\nTEL;TYPE=CELL:+${r.phone}\r\nEND:VCARD`).join('\r\n') + '\r\n', 'utf8')
  if (format === 'json')
    return Buffer.from(JSON.stringify(rows.map((r) => ({ no: Number(r.seq), name: r.name, phone: r.phone, batch: batchOf(r) })), null, 2), 'utf8')
  if (format === 'txt') return Buffer.from(rows.map((r) => r.phone).join('\r\n') + '\r\n', 'utf8')
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Contacts')
  ws.columns = [
    { header: 'No', key: 'no', width: 8 }, { header: 'Name', key: 'name', width: 30 },
    { header: 'Phone', key: 'phone', width: 16 }, { header: 'Batch', key: 'batch', width: 8 },
    { header: 'First seen', key: 'first', width: 20 }, { header: 'Last seen', key: 'last', width: 20 },
  ]
  ws.getRow(1).font = { bold: true }
  for (const r of rows)
    ws.addRow({ no: Number(r.seq), name: safeCell(r.name), phone: String(r.phone), batch: batchOf(r), first: r.first_seen, last: r.last_seen })
  ws.getColumn('phone').numFmt = '@'
  return Buffer.from(await wb.xlsx.writeBuffer())
}

/* ---------------- Routes ---------------- */
export function mountPortalAdminRoutes({ app, pool, requireAdmin, sbAdmin }) {
  /* ----- Portal subscription plans ----- */
  const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null }

  function parsePlan(b, base) {
    const has = (k) => b[k] !== undefined
    const o = { ...base }
    if (has('name')) { o.name = String(b.name).trim().slice(0, 40); if (!o.name) return { error: 'Enter the plan name.' } }
    if (has('price')) { o.price = int(b.price, 1, 100000); if (o.price === null) return { error: 'Enter a price between 1 and 100,000.' } }
    if (has('max')) { o.max = int(b.max, 1, 1000); if (o.max === null) return { error: 'Devices must be between 1 and 1000.' } }
    if (has('history')) { o.history = int(b.history, 1, 7); if (o.history === null) return { error: 'History must be 1 to 7 days (the server keeps 8 days).' } }
    if (has('days')) { o.days = int(b.days, 1, 366); if (o.days === null) return { error: 'Access days must be between 1 and 366.' } }
    if (has('sort')) { o.sort = int(b.sort, 0, 9999); if (o.sort === null) return { error: 'Order must be a number.' } }
    if (has('active')) o.active = !!b.active
    if (has('features')) {
      if (!Array.isArray(b.features)) return { error: 'Features must be a list.' }
      o.features = b.features.map((f) => String(f).trim().slice(0, 80)).filter(Boolean).slice(0, 12)
    }
    return { plan: o }
  }

  app.get('/admin/portal/plans', requireAdmin, async (req, res) => {
    try {
      const now = new Date().toISOString()
      const plans = [...cache.values()].sort((a, b) => a.sort - b.sort)
      for (const p of plans) {
        const { count } = await sbAdmin.from('portal_accounts').select('user_id', { count: 'exact', head: true }).eq('plan', p.id).gt('plan_exp', now)
        p.subscribers = count || 0
      }
      res.json({ plans })
    } catch (e) { console.error('admin plans', e); res.status(500).json({ error: 'Could not load the plans.' }) }
  })

  app.post('/admin/portal/plans', requireAdmin, async (req, res) => {
    try {
      const b = req.body || {}
      const r = parsePlan(b, { name: '', price: 0, max: 1, history: 3, days: 31, sort: cache.size + 1, active: true, features: [] })
      if (r.error) return res.status(400).json({ error: r.error })
      const p = r.plan
      if (!p.name || !p.price) return res.status(400).json({ error: 'Enter the plan name and price.' })
      const id = 'p' + Date.now().toString(36)
      await pool.query(
        'INSERT INTO portal_plans (id,name,price,max_devices,history_days,days,features,active,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
        [id, p.name, p.price, p.max, p.history, p.days, JSON.stringify(p.features), p.active, p.sort])
      await reloadPlans(pool)
      res.json({ ok: true, id })
    } catch (e) { console.error('admin plan add', e); res.status(500).json({ error: 'Could not add the plan.' }) }
  })

  app.put('/admin/portal/plans/:id', requireAdmin, async (req, res) => {
    try {
      const cur = getSubPlan(req.params.id)
      if (!cur) return res.status(404).json({ error: 'Plan not found.' })
      const r = parsePlan(req.body || {}, cur)
      if (r.error) return res.status(400).json({ error: r.error })
      const p = r.plan
      await pool.query(
        'UPDATE portal_plans SET name=$2,price=$3,max_devices=$4,history_days=$5,days=$6,features=$7,active=$8,sort_order=$9 WHERE id=$1',
        [cur.id, p.name, p.price, p.max, p.history, p.days, JSON.stringify(p.features), p.active, p.sort])
      await reloadPlans(pool)
      res.json({ ok: true })
    } catch (e) { console.error('admin plan edit', e); res.status(500).json({ error: 'Could not save the plan.' }) }
  })

  /* ----- Contacts (admin) ----- */
  app.get('/admin/contacts/batches', requireAdmin, async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT COUNT(*)::int AS total FROM contacts')
      const total = rows[0].total
      const n = Math.ceil(total / BATCH), batches = []
      for (let i = 1; i <= n; i++) {
        const count = i < n ? BATCH : total - BATCH * (n - 1)
        batches.push({ batch: i, count, full: count === BATCH })
      }
      res.json({ total, size: BATCH, batches })
    } catch (e) { console.error('contacts batches', e); res.status(500).json({ error: 'Could not load the contacts.' }) }
  })

  app.get('/admin/contacts/batch/:n', requireAdmin, async (req, res) => {
    try {
      const n = int(req.params.n, 1, 100000)
      if (!n) return res.status(400).json({ error: 'Bad batch number.' })
      const [from, to] = batchRange(n)
      const page = int(req.query.page, 1, 100000) || 1, per = 100
      const params = [from, to]
      let where = 'seq BETWEEN $1 AND $2'
      const q = String(req.query.q || '').trim().slice(0, 40)
      if (q) {
        params.push('%' + q.replace(/[\\%_]/g, '\\$&') + '%')
        where += ' AND (name ILIKE $3 OR phone ILIKE $3)'
      }
      const total = (await pool.query(`SELECT COUNT(*)::int AS c FROM contacts WHERE ${where}`, params)).rows[0].c
      const { rows } = await pool.query(
        `SELECT seq, name, phone, last_seen FROM contacts WHERE ${where} ORDER BY seq LIMIT ${per} OFFSET ${(page - 1) * per}`, params)
      res.json({ total, page, pages: Math.max(1, Math.ceil(total / per)),
        contacts: rows.map((r) => ({ no: Number(r.seq), name: r.name, phone: r.phone, last: r.last_seen })) })
    } catch (e) { console.error('contacts batch', e); res.status(500).json({ error: 'Could not load the batch.' }) }
  })

  app.get('/admin/contacts/export', requireAdmin, async (req, res) => {
    try {
      const format = String(req.query.format || 'xlsx')
      if (!FORMATS[format]) return res.status(400).json({ error: 'Unknown format.' })
      const all = req.query.batch === 'all'
      let rows, label
      if (all) {
        rows = (await pool.query('SELECT * FROM contacts ORDER BY seq')).rows
        label = 'all'
      } else {
        const n = int(req.query.batch, 1, 100000)
        if (!n) return res.status(400).json({ error: 'Bad batch number.' })
        const [from, to] = batchRange(n)
        rows = (await pool.query('SELECT * FROM contacts WHERE seq BETWEEN $1 AND $2 ORDER BY seq', [from, to])).rows
        label = 'batch-' + n
      }
      if (!rows.length) return res.status(404).json({ error: 'There are no contacts to export yet.' })
      const buf = await buildExport(rows, format)
      res.json({ filename: `autobingwa-contacts-${label}.${format}`, mime: FORMATS[format], base64: buf.toString('base64'), count: rows.length })
    } catch (e) { console.error('contacts export', e); res.status(500).json({ error: 'Could not build the export.' }) }
  })

  /* ----- Contacts (from the app, no login: the app identifies itself with its deviceId) ----- */
  app.post('/contacts/ingest',
    rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }),
    async (req, res) => {
      try {
        const b = req.body || {}
        const dev = String(b.deviceId || '').slice(0, 64)
        if (!dev) return res.status(400).json({ error: 'Missing device.' })
        const list = Array.isArray(b.contacts) ? b.contacts.slice(0, 200) : []
        const added = await upsertContacts(pool, list, 'app:' + dev)
        res.json({ ok: true, added })
      } catch (e) { console.error('contacts ingest', e); res.status(500).json({ error: 'Could not save.' }) }
    })
}