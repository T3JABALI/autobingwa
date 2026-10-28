import { createEngine, parseMpesa } from './engine.js'

const rows = []
const store = {
  add: (t) => { rows.push(t); return t },
  update: (id, patch) => { const t = rows.find((r) => r.id === id); Object.assign(t, patch); return t },
  list: () => rows,
  remove: (id) => { const i = rows.findIndex((r) => r.id === id); if (i >= 0) rows.splice(i, 1) },
}
const log = []
let calls = 0
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const bridge = {
  async runUssd({ ussd }) {
    log.push(`start ${ussd}`)
    await sleep(60)
    calls += 1
    const ok = !(ussd.includes('0722000001') && calls < 3) // first two attempts fail for this number
    log.push(`end ${ussd} ${ok ? 'ok' : 'fail'}`)
    return { ok, responses: [{ input: ussd, text: ok ? 'Done' : 'Failed' }] }
  },
}
const offers = [
  { id: 1, enabled: true, price: 19, safPrice: 19, ussd: '*180*5*2*AB*1*1#', autoRetry: true, retryCount: 2, smart: true },
  { id: 2, enabled: true, price: 20, safPrice: 20, ussd: '*180*5*2*AB*2*1#', autoRetry: false },
]
let t = 1000
const eng = createEngine({ store, bridge, getOffers: () => offers, now: () => ++t })
const sms = (code, amt, phone, name) => `${code} Confirmed. on 26/10/26 at 11:34 PM Ksh${amt}.00 received from 254${phone.slice(1)} ${name}. New Account balance is Ksh1,000.00.`

console.log('parse:', JSON.stringify(parseMpesa(sms('HRK7DFRFKN', 20, '0797609585', 'SYDNEY WANGWE'))))

// 1. automation OFF: saved as Paused / Unmatched
eng.ingest(sms('AAAAAAAAA1', 19, '0797609585', 'JOY ONE'))
eng.ingest(sms('AAAAAAAAA2', 77, '0711111111', 'NO OFFER'))
eng.ingest(sms('AAAAAAAAA1', 19, '0797609585', 'JOY ONE')) // duplicate SMS
console.log('stopped ->', rows.map((r) => `${r.mpesaId}:${r.status}`).join(' '), 'paused:', eng.pausedCount())

// 2. start, process paused ones
eng.start()
eng.releasePaused('process')
// 3. burst arrives while one is processing, one needs retries
eng.ingest(sms('BBBBBBBBB1', 19, '0722000001', 'RETRY GUY'))
eng.ingest(sms('BBBBBBBBB2', 20, '0733000002', 'THIRD'))
eng.ingest(sms('BBBBBBBBB3', 19, '0744000003', 'FOURTH'))
await sleep(1200)
console.log('after run ->', rows.map((r) => `${r.mpesaId}:${r.status}(${r.attempts})`).join(' '))
const overlap = log.some((l, i) => l.startsWith('start') && log.slice(0, i).filter((x) => x.startsWith('start')).length - log.slice(0, i).filter((x) => x.startsWith('end')).length > 0)
console.log('two at once?', overlap)
console.log(log.join('\n'))

// 4. stop, new SMS becomes Paused; retry works on a Completed one
eng.stop()
eng.ingest(sms('CCCCCCCCC1', 19, '0755000004', 'LATER'))
console.log('stopped again ->', rows.find((r) => r.mpesaId === 'CCCCCCCCC1').status)
eng.retry(rows[0].id)
await sleep(200)
console.log('retried completed ->', rows[0].status, rows[0].attempts)
