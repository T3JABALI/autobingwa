import { useAuth } from './AuthContext';
import AuthPage from './AuthPage';
import AdminApp from '../admin/AdminApp';

export default function Gate({ children }) {
  const { user, role, loading, logout } = useAuth();
  if (loading) return null; // you can show your logo splash here
  if (!user) return <AuthPage />;
  if (role === undefined) return null; // role still loading
  if (role === 'admin') return <AdminApp email={user.email} logout={logout} />;
  return children;
}