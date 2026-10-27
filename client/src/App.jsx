import { BrowserRouter as Router, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { GoogleOAuthProvider } from '@react-oauth/google';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import AdminPage from './pages/AdminPage';
import AdminLoginPage from './pages/AdminLoginPage';
import './index.css';

function RoomRedirect() {
  const { id } = useParams();
  return <Navigate to={`/find?mode=room&room=${id}`} replace />;
}

function AdminRoute({ children }) {
  const { user, loading, isAdmin } = useAuth();

  if (loading) {
    return (
      <div className="loading-spinner" style={{ minHeight: '100vh' }}>
        <div className="spinner" />
      </div>
    );
  }

  if (!user || !isAdmin) {
    return <Navigate to="/admin/login" replace />;
  }

  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={<LoginPage />}
      />
      <Route
        path="/"
        element={<DashboardPage defaultTab="now" />}
      />
      <Route
        path="/find"
        element={<DashboardPage defaultTab="window" />}
      />
      <Route
        path="/my-group"
        element={<DashboardPage defaultTab="group" />}
      />
      <Route
        path="/rooms"
        element={<Navigate to="/find?mode=room" replace />}
      />
      <Route
        path="/room/:id"
        element={<RoomRedirect />}
      />
      <Route
        path="/admin/login"
        element={<AdminLoginPage />}
      />
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminPage />
          </AdminRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '522405551486-fvprjk2l4neb39omnvu5kvq0ejvev8i2.apps.googleusercontent.com';

  return (
    <GoogleOAuthProvider clientId={googleClientId}>
      <ThemeProvider>
        <AuthProvider>
          <Router>
            <Toaster
              position="top-center"
              toastOptions={{
                duration: 3000,
                style: {
                  background: 'var(--bg-card)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                  boxShadow: 'var(--shadow-md)',
                },
              }}
            />
            <AppRoutes />
          </Router>
        </AuthProvider>
      </ThemeProvider>
    </GoogleOAuthProvider>
  );
}
