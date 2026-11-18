// The app's database. IndexedDB is the phone's real storage, with no 5 MB limit like localStorage.
const DB_NAME = 'autobingwa-db'
const TX = 'tx'
const CUST = 'cust'
let db = null
let chain = Promise.resolve()

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      const d = req.result
      if (!d.objectStoreNames.contains(TX)) d.createObjectStore(TX, { keyPath: 'id' })
      if (!d.objectStoreNames.contains(CUST)) d.createObjectStore(CUST, { keyPath: 'key' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(new Error('database blocked'))
  })
}

async function run(store, mode, fn) {
  if (!db) db = await open()
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    t.oncomplete = () => resolve(req ? req.result : undefined)
    t.onabort = () => reject(t.error || new Error('database write cancelled'))
    t.onerror = () => reject(t.error)
  })
}

// Every action goes through one line, so writes always happen in the order they were made
function queue(fn) {
  const p = chain.then(fn)
  chain = p.catch(() => {})
  return p
}

// Resolves when every write made so far has really been stored
export const settled = () => chain

export const loadRows = () =>
  queue(() => run(TX, 'readonly', (s) => s.getAll())).then((rows) =>
    rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  )

export const putRows = (rows) =>
  rows.length ? queue(() => run(TX, 'readwrite', (s) => { rows.forEach((r) => s.put(r)) })) : Promise.resolve()

export const deleteRows = (ids) =>
  ids.length ? queue(() => run(TX, 'readwrite', (s) => { ids.forEach((id) => s.delete(id)) })) : Promise.resolve()

export const loadCustomerRows = () => queue(() => run(CUST, 'readonly', (s) => s.getAll()))

export const putCustomers = (rows) =>
  rows.length ? queue(() => run(CUST, 'readwrite', (s) => { rows.forEach((r) => s.put(r)) })) : Promise.resolve()