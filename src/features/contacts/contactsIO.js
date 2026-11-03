import * as XLSX from 'xlsx'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { parsePhone } from '../quickdial/ussd.js'

const intl = (p) => '+254' + p.slice(1)
const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
const vEsc = (v) => String(v ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, ' ').replace(/([,;])/g, '\\$1')

// Android app: write the file, then open the share sheet (save to Files, WhatsApp, Drive...).
// Browser: normal download.
async function deliver(name, mime, { text, base64 }) {
  if (Capacitor.isNativePlatform()) {
    const res = await Filesystem.writeFile(
      base64
        ? { path: name, data: base64, directory: Directory.Cache }
        : { path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 }
    )
    try {
      await Share.share({ title: name, url: res.uri, dialogTitle: 'Save or share your contacts' })
    } catch (e) {
      if (!/cancel/i.test(String(e && e.message ? e.message : e))) throw e
    }
    return
  }
  const blob = base64
    ? new Blob([Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))], { type: mime })
    : new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function exportContacts(list, format) {
  const base = `contacts-${new Date().toISOString().slice(0, 10)}`
  if (format === 'csv') {
    const rows = [['Name', 'Phone', 'Email', 'Source'], ...list.map((c) => [c.name, intl(c.phone), c.email, c.source])]
    return deliver(`${base}.csv`, 'text/csv', { text: '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') })
  }
  if (format === 'xlsx') {
    const sheet = XLSX.utils.json_to_sheet(
      list.map((c) => ({ Name: c.name, Phone: intl(c.phone), Email: c.email || '', Source: c.source }))
    )
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, sheet, 'Contacts')
    const b64 = XLSX.write(book, { bookType: 'xlsx', type: 'base64' })
    return deliver(`${base}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', { base64: b64 })
  }
  if (format === 'vcf') {
    const cards = list
      .map((c) =>
        `BEGIN:VCARD\r\nVERSION:3.0\r\nFN:${vEsc(c.name)}\r\nTEL;TYPE=CELL:${intl(c.phone)}\r\n${c.email ? `EMAIL:${vEsc(c.email)}\r\n` : ''}END:VCARD`
      )
      .join('\r\n')
    return deliver(`${base}.vcf`, 'text/vcard', { text: cards })
  }
  return deliver(`${base}.json`, 'application/json', { text: JSON.stringify(list, null, 2) })
}

// ---------- Import ----------
function splitCsvLine(line) {
  const out = []
  let cur = ''
  let q = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (q) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else q = false
      } else cur += ch
    } else if (ch === '"') q = true
    else if (ch === ',' || ch === ';' || ch === '\t') { out.push(cur); cur = '' }
    else cur += ch
  }
  out.push(cur)
  return out
}

// A table (array of rows) from a CSV or a spreadsheet becomes contacts
function rowsFromTable(table) {
  const rows = table.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim()))
  if (!rows.length) return []
  const header = rows[0].map((h) => String(h ?? '').trim().toLowerCase())
  let nameIdx = header.findIndex((h) => /name/.test(h))
  let phoneIdx = header.findIndex((h) => /phone|number|tel|mobile|cell/.test(h))
  const emailIdx = header.findIndex((h) => /mail/.test(h))
  const sourceIdx = header.findIndex((h) => /source|list|type/.test(h))
  let start = 1
  if (phoneIdx < 0) {
    // no header row: use the first column that holds phone numbers
    const width = Math.max(...rows.map((r) => r.length))
    for (let i = 0; i < width; i++) {
      if (rows.slice(0, 5).some((r) => parsePhone(String(r[i] ?? '')))) { phoneIdx = i; break }
    }
    if (phoneIdx < 0) return []
    if (nameIdx < 0 || nameIdx === phoneIdx) nameIdx = phoneIdx === 0 ? 1 : 0
    start = parsePhone(String(rows[0][phoneIdx] ?? '')) ? 0 : 1
  }
  const out = []
  for (let i = start; i < rows.length; i++) {
    const r = rows[i]
    const phone = parsePhone(String(r[phoneIdx] ?? ''))
    if (!phone) continue
    const name = (nameIdx >= 0 && nameIdx !== phoneIdx && String(r[nameIdx] ?? '').trim()) || phone
    out.push({
      name,
      phone,
      email: emailIdx >= 0 ? String(r[emailIdx] ?? '').trim() : '',
      source: sourceIdx >= 0 && /sitelink/i.test(String(r[sourceIdx] ?? '')) ? 'sitelink' : 'local',
    })
  }
  return out
}

function rowsFromVcf(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '')
  const out = []
  unfolded.split(/BEGIN:VCARD/i).slice(1).forEach((card) => {
    let fn = ((card.match(/^FN[^:\r\n]*:(.*)$/im) || [])[1] || '').trim()
    if (!fn) {
      const n = ((card.match(/^N[^:\r\n]*:(.*)$/im) || [])[1] || '').split(';')
      fn = [n[1], n[0]].filter(Boolean).join(' ').trim()
    }
    const tel = (card.match(/^TEL[^:\r\n]*:(.*)$/im) || [])[1] || ''
    const mail = (card.match(/^EMAIL[^:\r\n]*:(.*)$/im) || [])[1] || ''
    const phone = parsePhone(tel)
    if (phone) out.push({ name: fn.replace(/\\([,;])/g, '$1') || phone, phone, email: mail.trim(), source: 'local' })
  })
  return out
}

function rowsFromJson(text) {
  const data = JSON.parse(text)
  const arr = Array.isArray(data) ? data : data.contacts || data.clients || []
  const out = []
  arr.forEach((o) => {
    if (!o || typeof o !== 'object') return
    const phone = parsePhone(String(o.phone ?? o.Phone ?? o.number ?? o.tel ?? o.mobile ?? ''))
    if (!phone) return
    out.push({
      name: String(o.name ?? o.Name ?? o.fullName ?? '').trim() || phone,
      phone,
      email: String(o.email ?? o.Email ?? '').trim(),
      source: /sitelink/i.test(String(o.source ?? '')) ? 'sitelink' : 'local',
    })
  })
  return out
}

// Reads .csv, .xlsx, .xls, .vcf and .json files. Returns [{ name, phone, email, source }]
export async function importFile(file) {
  const ext = String(file.name || '').split('.').pop().toLowerCase()
  if (ext === 'xlsx' || ext === 'xls') {
    const book = XLSX.read(await file.arrayBuffer(), { type: 'array' })
    const sheet = book.Sheets[book.SheetNames[0]]
    return rowsFromTable(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }))
  }
  const text = (await file.text()).replace(/^\uFEFF/, '')
  if (ext === 'json') return rowsFromJson(text)
  if (ext === 'vcf' || ext === 'vcard' || /^\s*BEGIN:VCARD/i.test(text)) return rowsFromVcf(text)
  return rowsFromTable(text.split(/\r?\n/).filter((l) => l.trim()).map(splitCsvLine))
}