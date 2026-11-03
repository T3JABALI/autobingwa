import { useCallback, useEffect, useState } from 'react'
import { App } from '@capacitor/app'
import { checkForUpdate, isNative } from './updates'

export function useUpdates() {
  const [state, setState] = useState({
    loading: true, error: '', current: null, releases: [], latest: null, available: false, mandatory: false,
  })

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const r = await checkForUpdate()
      setState({ loading: false, error: '', ...r })
    } catch {
      setState((s) => ({ ...s, loading: false, error: 'Could not check for updates. Check your internet and try again.' }))
    }
  }, [])

  useEffect(() => {
    refresh()
    if (!isNative()) return
    const sub = App.addListener('resume', refresh)
    return () => { sub.then((h) => h.remove()) }
  }, [refresh])

  return { ...state, refresh }
}