import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { HiOutlineLogout, HiOutlineViewGrid, HiOutlineCog } from 'react-icons/hi';

export default function Navbar() {
  const { user, logout, isAdmin } = useAuth();
  const location = useLocation();

  if (!user) return null;

  const initials = user.name
    ? user.name.split(' ').map((n) => n[0]).join('').toUpperCase()
    : user.email[0].toUpperCase();

  return (
    <nav className="navbar">
      <div className="navbar-brand">
        <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none' }}>
          <div className="navbar-logo">FR</div>
          <span className="navbar-title">FreeRoom</span>
        </Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* Navigation links for tablet and desktop */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Link
            to="/"
            className={`btn btn-sm ${location.pathname === '/' ? 'btn-secondary' : 'btn-ghost'}`}
            style={{ fontSize: '0.8rem' }}
          >
            <HiOutlineViewGrid size={15} />
            <span style={{ display: 'inline' }}>Rooms</span>
          </Link>

          {isAdmin && (
            <Link
              to="/admin"
              className={`btn btn-sm ${location.pathname === '/admin' ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: '0.8rem' }}
              id="admin-nav-link"
            >
              <HiOutlineCog size={15} />
              <span>Admin Portal</span>
            </Link>
          )}
        </div>

        {/* User profile controls */}
        <div className="navbar-user">
          {isAdmin && (
            <span
              className="status-badge"
              style={{
                background: 'rgba(139,92,246,0.15)',
                color: '#c084fc',
                fontSize: '0.72rem',
                padding: '3px 8px',
              }}
            >
              Admin
            </span>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {user.avatar_url ? (
              <img src={user.avatar_url} alt={user.name} className="navbar-avatar" />
            ) : (
              <div className="navbar-avatar-placeholder">{initials}</div>
            )}
            <span
              style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}
              className="hide-mobile"
            >
              {user.name || user.email.split('@')[0]}
            </span>
          </div>

          <button
            className="btn btn-ghost btn-icon"
            onClick={logout}
            title="Sign out"
            id="logout-btn"
          >
            <HiOutlineLogout size={18} />
          </button>
        </div>
      </div>
    </nav>
  );
}
