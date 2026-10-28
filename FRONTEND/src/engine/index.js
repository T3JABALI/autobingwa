import { createEngine } from './engine.js'
import {
  loadTransactions, addTransaction, updateTransaction, deleteTransaction,
} from '../features/home/dataStore.js'

function readJson(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null')
    return v === null ? fallback : v
  } catch (e) {
    return fallback
  }
}

// Connects the engine to your saved transactions
const store = {
  list: loadTransactions,
  add: addTransaction,
  update: (id, patch) => {
    updateTransaction(id, patch)
    return loadTransactions().find((t) => t.id === id)
  },
  remove: deleteTransaction,
}

// Stand-in for the phone while testing in the browser. The Android plugin replaces it in Stage 3.
const simulatedBridge = {
  async runUssd({ ussd, mode }) {
    await new Promise((r) => setTimeout(r, mode === 'Express' ? 1500 : 3500))
    const ok = Math.random() > 0.2 // about 1 in 5 fail, so you can test retry
    return {
      ok,
      responses: [
        {
          input: ussd,
          text: ok
            ? 'Your request is being processed. You will receive an SMS shortly.'
            : 'Request failed. Please try again later.',
        },
      ],
    }
  },
}

export const engine = createEngine({
  store,
  bridge: simulatedBridge,
  getOffers: () => readJson('myOffers', []),
  getMode: () => readJson('settings:config', {}).mode || 'Express',
})

engine.recover()
const timer = setInterval(() => engine.tick(), 30000) // starts scheduled transactions when their time comes
if (import.meta.hot) import.meta.hot.dispose(() => clearInterval(timer))

// Testing helper (only while developing): type fakeSms(19) in the browser console
if (import.meta.env.DEV) {
  window.fakeSms = (amount = 19, phone = '0712345678', name = 'TEST CUSTOMER') => {
    const code = ('TST' + Math.random().toString(36).slice(2, 9).toUpperCase()).padEnd(10, 'X')
    return engine.ingest(
      `${code} Confirmed. on 28/10/26 at 10:00 AM Ksh${amount}.00 received from 254${phone.slice(1)} ${name}. New M-PESA balance is Ksh1,000.00.`
    )
  }
}