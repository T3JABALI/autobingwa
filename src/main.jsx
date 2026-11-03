import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './styles.css'
import './theme.css'
import { useAuth } from '../auth/AuthContext'; // adjust the path
const { logout } = useAuth();
// <button onClick={logout}>Sign out</button>
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
import { AuthProvider } from './features/auth/AuthContext';
import Gate from './features/auth/Gate';

// inside render, keep anything already wrapping App (router etc.) and change App to:
<AuthProvider>
  <Gate>
    <App />
  </Gate>
</AuthProvider>