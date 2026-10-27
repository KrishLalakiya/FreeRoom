import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authAPI } from '../services/api';
import { useGoogleLogin } from '@react-oauth/google';
import { HiOutlineMail } from 'react-icons/hi';
import toast from 'react-hot-toast';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo') || '/';

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setLoading(true);
      try {
        const res = await authAPI.googleLogin({ accessToken: tokenResponse.access_token });
        login(res.data.token, res.data.user);
        toast.success(`Welcome, ${res.data.user.name}!`);
        navigate(returnTo);
      } catch (err) {
        toast.error(err.response?.data?.message || err.message || 'Google sign-in failed');
      } finally {
        setLoading(false);
      }
    },
    onError: (error) => {
      console.error('Google sign-in error:', error);
      toast.error('Google sign-in was cancelled or failed');
    },
  });

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    if (!email.trim()) {
      toast.error('Please enter an email');
      return;
    }

    setLoading(true);
    try {
      const res = await authAPI.devLogin(email.trim(), name.trim() || undefined);
      login(res.data.token, res.data.user);
      toast.success(`Welcome, ${res.data.user.name}!`);
      if (res.data.user.role === 'admin') {
        navigate('/admin');
      } else {
        navigate(returnTo);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card fade-in">
        <div className="login-logo">FR</div>

        <h1 className="login-title">FreeRoom</h1>
        <p className="login-subtitle">
          See which classrooms are empty right now and how long they stay free.
        </p>

        <button
          type="button"
          className="google-btn"
          onClick={() => googleLogin()}
          disabled={loading}
          title="Sign in with your Google account"
          id="btn-google-login"
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
          <span>or continue with email</span>
        </div>

        <form onSubmit={handleEmailLogin} style={{ textAlign: 'left' }}>
          <div className="input-group">
            <label className="form-label" htmlFor="login-email">Email</label>
            <input
              type="email"
              className="input-field"
              placeholder="you@sst.scaler.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              id="login-email"
            />
          </div>
          <div className="input-group">
            <label className="form-label" htmlFor="login-name">Name (optional)</label>
            <input
              type="text"
              className="input-field"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              id="login-name"
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-full btn-lg"
            disabled={loading}
            id="login-submit"
          >
            <HiOutlineMail size={17} />
            {loading ? 'Signing in...' : 'Continue'}
          </button>
        </form>

        <button
          type="button"
          className="btn btn-outline btn-full btn-lg"
          style={{ marginTop: '10px' }}
          onClick={() => navigate(returnTo)}
          id="btn-continue-guest"
        >
          Continue without account
        </button>
      </div>
    </div>
  );
}
