import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import './theme.css'
import { AuthProvider } from './features/auth/AuthContext'
import Gate from './features/auth/Gate'
import { initTransactions } from './features/home/dataStore.js'

const setAppHeight = () =>
  document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px')
setAppHeight()
window.addEventListener('resize', setAppHeight)
window.addEventListener('orientationchange', setAppHeight)

async function start() {
  await initTransactions() // load the transactions first, before the engine starts
  const { default: App } = await import('./App.jsx')
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <AuthProvider>
        <Gate>
          <App />
        </Gate>
      </AuthProvider>
    </StrictMode>,
  )
}
start()