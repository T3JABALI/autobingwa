const KEY = 'autorenew:schedules'
const DONE = 'autorenew:done'
const HOUR = 3600 * 1000

function read(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(v) ? v : []
  } catch (e) {
    return []
  }
}
function write(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list))
  } catch (e) {
    console.error('renewals: could not save', e)
  }
}

export const loadSchedules = () => read(KEY)
export const saveSchedules = (list) => write(KEY, list)

// One run per day, same clock time. A non-renewing entry has exactly one run.
export function expandRuns(entry) {
  const count = entry.autoRenew ? Math.max(1, Number(entry.days) || 1) : 1
  const runs = []
  for (let i = 0; i < count; i++) {
    const d = new Date(entry.startAt)
    d.setDate(d.getDate() + i)
    runs.push({ runId: `${entry.id}:${i}`, day: i + 1, of: count, at: d.getTime() })
  }
  return runs
}

// Runs whose time has come and that have not been done.
// Runs missed by more than graceHours are returned as `missed`, not bought late.
export function dueRuns(now = Date.now(), graceHours = 6) {
  const done = new Set(read(DONE))
  const due = []
  const missed = []
  for (const entry of loadSchedules()) {
    for (const run of expandRuns(entry)) {
      if (done.has(run.runId) || run.at > now) continue
      if (now - run.at > graceHours * HOUR) missed.push({ entry, run })
      else due.push({ entry, run })
    }
  }
  return { due, missed }
}

// Call this BEFORE dialing, so a crash can never buy the same run twice.
export function markDone(runId) {
  const done = read(DONE)
  if (!done.includes(runId)) write(DONE, [...done, runId])
}

export function removeSchedule(id) {
  saveSchedules(loadSchedules().filter((e) => e.id !== id))
}