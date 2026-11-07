// Loads the Smart plans catalog from the server and remembers the last copy for offline use.
// Same server address as the admin screen, no slash at the end.
const API = 'https://autobingwa-payments.onrender.com'
const KEY = 'smart:catalog'

function readCache() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || 'null')
    return c && Array.isArray(c.plans) ? c : null
  } catch (e) {
    return null
  }
}
function writeCache(c) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c))
  } catch (e) {
    console.error('smart catalog: could not save', e)
  }
}

export const cachedCatalog = () => readCache()

// Returns { version, groups, plans }. If the server cannot be reached, the last saved copy (or null).
export async function loadCatalog() {
  const cached = readCache()
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), 15000)
  try {
    const r = await fetch(`${API}/smart/catalog${cached ? '?v=' + encodeURIComponent(cached.version) : ''}`, { signal: ctl.signal })
    if (!r.ok) throw new Error('Catalog request failed (' + r.status + ')')
    const j = await r.json()
    if (j.unchanged && cached) return cached
    if (!Array.isArray(j.plans)) throw new Error('Bad catalog')
    const c = { version: j.version, groups: j.groups || [], plans: j.plans, at: Date.now() }
    writeCache(c)
    return c
  } catch (e) {
    console.error('smart catalog', e.message || e)
    return cached
  } finally {
    clearTimeout(timer)
  }
}