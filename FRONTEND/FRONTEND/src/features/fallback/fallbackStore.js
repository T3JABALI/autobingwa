const KEY = 'fallback:config'
const EMPTY = { active: true, delay: 0, mappings: [] }
export const MAX_DELAY = 5

export function loadFallback() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (saved && Array.isArray(saved.mappings)) return { ...EMPTY, ...saved }
  } catch (e) {
    console.error('Could not read fallback plans', e)
  }
  return EMPTY
}

export function saveFallback(config) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config))
  } catch (e) {
    console.error('Could not save fallback plans', e)
  }
}

// trigger: 'recommended' | 'failed'. Returns the mapping, or null if paused or none matches.
export function findFallback(primaryId, trigger) {
  const config = loadFallback()
  if (!config.active) return null
  return (
    config.mappings.find(
      (m) => String(m.primaryId) === String(primaryId) && m.trigger === trigger
    ) || null
  )
}

// Minutes to wait before the backup goes out (0 = instant), never more than MAX_DELAY
export function fallbackDelayMinutes() {
  const n = Math.round(Number(loadFallback().delay) || 0)
  return Math.min(MAX_DELAY, Math.max(0, n))
}