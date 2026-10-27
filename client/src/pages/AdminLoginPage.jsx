import { useState } from 'react';
import { useNavigate, Navigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../services/api';
import { useGoogleLogin } from '@react-oauth/google';
import { HiOutlineLockClosed } from 'react-icons/hi';
import toast from 'react-hot-toast';

export default function AdminLoginPage() {
  const { user, login, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notAdminError, setNotAdminError] = useState(false);

  // If already logged in as admin, go to /admin
  if (user && isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  // Google OAuth for Admin
  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setLoading(true);
      setNotAdminError(false);
      try {
        const res = await authAPI.googleLogin({
          accessToken: tokenResponse.access_token,
        });
        const loggedUser = res.data.user;

        if (loggedUser.role !== 'admin') {
          login(res.data.token, loggedUser);
          setNotAdminError(true);
        } else {
          login(res.data.token, loggedUser);
          toast.success(`Welcome, ${loggedUser.name}!`);
          navigate('/admin', { replace: true });
        }
      } catch (err) {
        toast.error(err.response?.data?.message || err.message || 'Google sign-in failed');
      } finally {
        setLoading(false);
      }
    },
    onError: (err) => {
      console.error('Admin Google sign-in error:', err);
      toast.error('Google sign-in was cancelled or failed.');
    },
  });

  const handleAdminPasswordLogin = async (e) => {
    if (e) e.preventDefault();
    setNotAdminError(false);

    const emailToUse = email.trim();
    if (!emailToUse) {
      toast.error('Please enter your email address');
      return;
    }
    if (!password) {
      toast.error('Please enter your password');
      return;
    }

    setLoading(true);
    try {
      const res = await authAPI.adminLogin(emailToUse, password);
      const loggedUser = res.data.user;

      if (loggedUser.role !== 'admin') {
        login(res.data.token, loggedUser);
        setNotAdminError(true);
      } else {
        login(res.data.token, loggedUser);
        toast.success(`Welcome, ${loggedUser.name}!`);
        navigate('/admin', { replace: true });
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Invalid admin credentials');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card fade-in" style={{ maxWidth: '420px' }}>
        <div className="login-logo" style={{ background: '#111827', color: '#fff' }}>FR</div>

        <h1 className="login-title">Admin Sign-in</h1>
        <p className="login-subtitle">
          FreeRoom administration and timetable management portal.
        </p>

        {/* Non-admin error notice */}
        {(notAdminError || (user && !isAdmin)) && (
          <div
            id="admin-error-notice"
            style={{
              background: 'var(--urgent-surface-subtle, rgba(239, 68, 68, 0.1))',
              border: '1px solid var(--urgent-border-subtle, #fca5a5)',
              color: 'var(--urgent-bg, #b91c1c)',
              padding: '12px 14px',
              borderRadius: '8px',
              fontSize: '13.5px',
              fontWeight: 600,
              marginBottom: '16px',
              textAlign: 'center',
            }}
          >
            This account is not an admin account.
          </div>
        )}

        {user && !isAdmin && (
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '14px' }}>
              Signed in as <strong>{user.email}</strong>.
            </p>
            <button
              type="button"
              className="btn btn-outline btn-full"
              onClick={() => {
                logout();
                setNotAdminError(false);
              }}
            >
              Sign out and switch account
            </button>
          </div>
        )}

        {(!user || isAdmin) && (
          <>
            <button
              type="button"
              className="google-btn"
              onClick={() => googleLogin()}
              disabled={loading}
              title="Sign in with Google Admin account"
              id="admin-btn-google-login"
            >
              <svg width="18" height="18" viewBox="0 0 48 48">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              </svg>
              Sign in with Google
            </button>

            <div className="dev-login-divider">
              <span>or continue with credentials</span>
            </div>

            <form onSubmit={handleAdminPasswordLogin} style={{ textAlign: 'left' }}>
              <div className="input-group">
                <label className="form-label" htmlFor="admin-login-email">
                  Email
                </label>
                <input
                  type="email"
                  className="input-field"
                  placeholder="admin@sst.scaler.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  id="admin-login-email"
                  required
                />
              </div>

              <div className="input-group">
                <label className="form-label" htmlFor="admin-login-password">
                  Password
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="input-field"
                    placeholder="Enter password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    id="admin-login-password"
                    required
                    style={{ paddingRight: '48px' }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: '12px',
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: 600,
                    }}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="btn btn-primary btn-full btn-lg"
                disabled={loading}
                id="admin-login-submit"
                style={{ marginTop: '8px' }}
              >
                <HiOutlineLockClosed size={17} />
                {loading ? 'Signing in…' : 'Sign in as Admin'}
              </button>
            </form>
          </>
        )}

        <div style={{ marginTop: '20px', textAlign: 'center' }}>
          <Link to="/" style={{ fontSize: '13px', color: 'var(--text-secondary)', textDecoration: 'none' }}>
            ← Back to FreeRoom
          </Link>
        </div>
      </div>
    </div>
  );
}
