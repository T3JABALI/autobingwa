import { useAuth } from './AuthContext';
import AuthPage from './AuthPage';

export default function Gate({ children }) {
  const { user, loading } = useAuth();
  if (loading) return null; // you can show your logo splash here
  return user ? children : <AuthPage />;
}