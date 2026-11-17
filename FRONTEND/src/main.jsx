import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import './theme.css'
import { AuthProvider } from './features/auth/AuthContext'
import Gate from './features/auth/Gate'

const setAppHeight = () =>
  document.documentElement.style.setProperty('--app-h', window.innerHeight + 'px')
setAppHeight()
window.addEventListener('resize', setAppHeight)
window.addEventListener('orientationchange', setAppHeight)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <Gate>
        <App />
      </Gate>
    </AuthProvider>
  </StrictMode>,
)