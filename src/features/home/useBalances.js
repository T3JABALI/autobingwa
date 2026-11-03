import { useEffect, useState } from 'react'
import {
  getAirtimeBalance, airtimeUsedToday, commissionThisWeek, commissionByDay,
} from '../../engine/balances.js'

function snapshot() {
  const now = Date.now()
  const { values, today } = commissionByDay(now)
  return {
    airtime: getAirtimeBalance(), // { value, slot, t } or null if never refreshed
    used: airtimeUsedToday(now),
    week: commissionThisWeek(now),
    days: values, // 7 values, Sun to Sat, null for days not reached yet
    today,
  }
}

// Redraws when new balances or commission messages arrive, and again at midnight.
export default function useBalances() {
  const [data, setData] = useState(snapshot)

  useEffect(() => {
    const refresh = () => setData(snapshot())
    window.addEventListener('ab-balances', refresh)
    document.addEventListener('visibilitychange', refresh)

    let timer
    const arm = () => {
      const next = new Date()
      next.setHours(24, 0, 1, 0) // one second after midnight
      timer = setTimeout(() => {
        refresh()
        arm()
      }, next.getTime() - Date.now())
    }
    arm()

    return () => {
      window.removeEventListener('ab-balances', refresh)
      document.removeEventListener('visibilitychange', refresh)
      clearTimeout(timer)
    }
  }, [])

  return data
}