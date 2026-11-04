import { useEffect } from 'react'
import { startPortalSync, stopPortalSync } from './portalSync.js'

// Draws nothing. Keeps this phone's live data flowing to the portal while the app is open.
export default function PortalSync() {
  useEffect(() => {
    startPortalSync()
    return () => stopPortalSync()
  }, [])
  return null
}