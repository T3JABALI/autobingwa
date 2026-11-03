// "*180*5*2*AB*1*1#" -> first "*180#" (hidden), steps ["5","2",phone,"1","1"]
export function splitUssd(template, phone) {
  const t = String(template || '').trim().replace(/\s+/g, '')
  const parts = t.replace(/^\*/, '').replace(/#$/, '').split('*').filter((p) => p !== '')
  if (parts.length === 0) return null
  return {
    first: '*' + parts[0] + '#',
    steps: parts.slice(1).map((p) => (/^ab$/i.test(p) ? phone : p)),
  }
}