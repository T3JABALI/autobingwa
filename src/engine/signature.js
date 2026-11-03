// A signature = what each step of an offer's USSD path should contain.
// Menu steps are matched by the text of the option, so a reshuffled menu still works.

export const LEARN_PHONE = '0700000000'
const LITERAL = new Set(['0', '00'])           // back / next page: typed as they are
const isPhone = (v) => v === 'AB' || v === LEARN_PHONE

export const norm = (s) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// "5:Bingwa Sokoni" / "3. 250MBs Ksh24" -> [{ n: '5', text: 'Bingwa Sokoni' }, ...]
export function parseMenu(text) {
  const out = []
  for (const line of String(text || '').split('\n')) {
    const m = line.trim().match(/^(\d{1,2})(?:\s*[:.)\-]\s*|\s+)(.+)$/)
    if (m) out.push({ n: m[1], text: m[2].trim() })
  }
  return out
}

// screens[i] = the screen shown BEFORE steps[i] was typed
export function buildSignature(screens, steps) {
  const list = steps.map((raw, i) => {
    const v = String(raw)
    if (isPhone(v)) return { kind: 'input', value: 'AB' }
    if (LITERAL.has(v)) return { kind: 'literal', value: v }
    const opt = parseMenu(screens[i]).find((o) => o.n === v)
    if (!opt) return { kind: 'literal', value: v, unmatched: true }
    return { kind: 'menu', hint: v, label: norm(opt.text) }
  })
  return {
    version: 1,
    learnedAt: Date.now(),
    steps: list,
    complete: list.length > 0 && !list.some((s) => s.unmatched),
  }
}

// For one saved menu step and the menu on screen now: which number to type?
// Returns { value, moved } or null when it is not found, or not unique (never guess).
export function pickOption(step, screen) {
  const opts = parseMenu(screen)
  const exact = opts.filter((o) => norm(o.text) === step.label)
  if (exact.length === 1) return { value: exact[0].n, moved: exact[0].n !== step.hint }
  if (exact.length > 1) return null

  const want = step.label.split(' ')
  const near = opts.filter((o) => {
    const have = norm(o.text).split(' ')
    const shared = want.filter((w) => have.includes(w)).length
    const covers = want.every((w) => have.includes(w)) || have.every((w) => want.includes(w))
    return covers && shared >= Math.min(2, want.length)
  })
  if (near.length === 1) return { value: near[0].n, moved: near[0].n !== step.hint }
  return null
}