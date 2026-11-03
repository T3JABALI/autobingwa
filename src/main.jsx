import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import './theme.css'
import { AuthProvider } from './features/auth/AuthContext'
import Gate from './features/auth/Gate'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthProvider>
      <Gate>
        <App />
      </Gate>
    </AuthProvider>
  </StrictMode>,
)