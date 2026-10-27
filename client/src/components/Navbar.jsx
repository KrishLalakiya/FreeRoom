import { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

/* ── Inline SVG Icons matching the FreeRoom UI design ─────────────────────── */
function IconClock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15 15" />
    </svg>
  );
}

function IconSearch() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="20" y1="20" x2="16.35" y2="16.35" />
    </svg>
  );
}

function IconCalendar() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="17" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function IconGrid() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
      <circle cx="17" cy="9" r="2.6" />
      <path d="M16.5 14c2.7.2 4.5 2 4.5 5" />
    </svg>
  );
}

function IconCog() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function IconMoon({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function IconSun({ className = '' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4.5" />
      <line x1="12" y1="2" x2="12" y2="4.5" />
      <line x1="12" y1="19.5" x2="12" y2="22" />
      <line x1="4.22" y1="4.22" x2="6" y2="6" />
      <line x1="18" y1="18" x2="19.78" y2="19.78" />
      <line x1="2" y1="12" x2="4.5" y2="12" />
      <line x1="19.5" y1="12" x2="22" y2="12" />
      <line x1="4.22" y1="19.78" x2="6" y2="18" />
      <line x1="18" y1="6" x2="19.78" y2="4.22" />
    </svg>
  );
}

export default function Navbar() {
  const { user, logout, isAdmin } = useAuth();
  const { theme, setTheme, toggleTheme, isDark } = useTheme();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(false);
  const [themeTooltipOpen, setThemeTooltipOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const menuRef = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuOpen(false);
        setRenaming(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : (user?.email ? user.email[0].toUpperCase() : 'S');

  const handleRename = () => {
    if (!newName.trim() || !user) return;
    const updated = { ...user, name: newName.trim() };
    localStorage.setItem('freeroom_user', JSON.stringify(updated));
    window.location.reload();
  };

  const isFreeNowActive = location.pathname === '/';
  const isFindActive = location.pathname.startsWith('/find');
  const isGroupActive = location.pathname.startsWith('/my-group');
  const isRoomsActive = location.pathname.startsWith('/rooms') || location.pathname.startsWith('/room/');
  const isAdminActive = location.pathname.startsWith('/admin');

  return (
    <>
      {/* ── TOP HEADER (PC & Mobile brand bar) ──────────────── */}
      <header className="app-header">
        <div className="header-left">
          <Link to="/" className="brand-logo" aria-label="FreeRoom Home">
            FreeRoom
          </Link>
          <nav className="pc-nav" aria-label="Main Navigation">
            <Link to="/" className={`pc-nav-item${isFreeNowActive ? ' active' : ''}`}>
              Free now
            </Link>
            <Link to="/find" className={`pc-nav-item${isFindActive ? ' active' : ''}`}>
              Find a room
            </Link>
            <Link to="/my-group" className={`pc-nav-item${isGroupActive ? ' active' : ''}`}>
              My group
            </Link>
          </nav>
        </div>

        <div className="header-right-actions">
          <div
            className="theme-toggle-wrap"
            onMouseEnter={() => setThemeTooltipOpen(true)}
            onMouseLeave={() => setThemeTooltipOpen(false)}
          >
            <button
              type="button"
              className="theme-quick-btn"
              onClick={toggleTheme}
              onFocus={() => setThemeTooltipOpen(true)}
              onBlur={() => setThemeTooltipOpen(false)}
              aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            >
              {isDark ? <IconSun /> : <IconMoon />}
            </button>
            <div
              className={`theme-tooltip${themeTooltipOpen ? ' visible' : ''}`}
              role="tooltip"
            >
              {isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            </div>
          </div>

          {/* PRD v6 Section 4: Sign in button where avatar would be for guests; avatar menu for signed-in */}
          {user ? (
            <div className="avatar-wrap" ref={menuRef}>
              <button
                className="avatar-btn"
                title={`Profile ${initials}`}
                aria-label="Account menu"
                onClick={() => {
                  if (window.innerWidth <= 768) {
                    setMobileSheetOpen(true);
                  } else {
                    setMenuOpen((v) => !v);
                  }
                  setRenaming(false);
                }}
              >
                {user.avatar_url ? (
                  <img src={user.avatar_url} alt={user.name} className="avatar-img" />
                ) : (
                  initials
                )}
              </button>

              {/* PC Account Dropdown Menu */}
              {menuOpen && (
                <div className="account-dropdown">
                  <div className="account-info">
                    <div className="account-name">{user.name || 'Student'}</div>
                    <div className="account-email">{user.email}</div>
                </div>
                <div className="account-divider" />
                {renaming ? (
                  <div className="rename-box">
                    <input
                      className="rename-input"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="Display name"
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                    />
                    <button className="account-menu-item" style={{ fontWeight: 600 }} onClick={handleRename}>
                      Save
                    </button>
                    <button className="account-menu-item" onClick={() => setRenaming(false)}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    className="account-menu-item"
                    onClick={() => { setNewName(user.name || ''); setRenaming(true); }}
                  >
                    ✏️ Rename
                  </button>
                )}

                {/* Profile Preference: Current vs Dark vs Darker */}
                <div className="account-preference-section">
                  <div className="account-preference-header">
                    <span className="account-preference-title">Theme preference</span>
                    <span className="account-preference-badge">
                      {theme === 'darker' ? 'Darker' : (theme === 'dark' ? 'Dark' : 'Current')}
                    </span>
                  </div>
                  <div className="theme-toggle-pills" role="radiogroup" aria-label="Theme preference">
                    <button
                      type="button"
                      className={`theme-pill-btn${theme === 'light' ? ' active' : ''}`}
                      onClick={() => setTheme('light')}
                      role="radio"
                      aria-checked={theme === 'light'}
                    >
                      <span className="theme-icon">☀️</span> Current
                    </button>
                    <button
                      type="button"
                      className={`theme-pill-btn${theme === 'dark' ? ' active' : ''}`}
                      onClick={() => setTheme('dark')}
                      role="radio"
                      aria-checked={theme === 'dark'}
                    >
                      <span className="theme-icon">🌙</span> Dark
                    </button>
                    <button
                      type="button"
                      className={`theme-pill-btn${theme === 'darker' ? ' active' : ''}`}
                      onClick={() => setTheme('darker')}
                      role="radio"
                      aria-checked={theme === 'darker'}
                    >
                      <span className="theme-icon">🌑</span> Darker
                    </button>
                  </div>
                </div>

                <div className="account-divider" />
                <button
                  className="account-menu-item account-menu-item-danger"
                  onClick={logout}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
        ) : (
          <Link
            to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}
            className="btn-header-signin"
            id="header-signin-btn"
          >
            Sign in
          </Link>
        )}
      </div>
    </header>

    {/* ── MOBILE ACCOUNT SHEET ─────────────────────────────── */}
    {mobileSheetOpen && user && (
      <div
        className="mobile-sheet-backdrop"
          onClick={() => { setMobileSheetOpen(false); setRenaming(false); }}
        >
          <div className="mobile-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="account-info">
              <div className="account-name">{user.name || 'Student'}</div>
              <div className="account-email">{user.email}</div>
            </div>
            <div className="account-divider" />
            {renaming ? (
              <div className="rename-box">
                <input
                  className="rename-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Display name"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleRename()}
                />
                <button className="account-menu-item" style={{ fontWeight: 600 }} onClick={handleRename}>
                  Save
                </button>
                <button className="account-menu-item" onClick={() => setRenaming(false)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="account-menu-item"
                onClick={() => { setNewName(user.name || ''); setRenaming(true); }}
              >
                ✏️ Rename
              </button>
            )}

            {/* Profile Preference: Current vs Dark vs Darker */}
            <div className="account-preference-section">
              <div className="account-preference-header">
                <span className="account-preference-title">Theme preference</span>
                <span className="account-preference-badge">
                  {theme === 'darker' ? 'Darker' : (theme === 'dark' ? 'Dark' : 'Current')}
                </span>
              </div>
              <div className="theme-toggle-pills" role="radiogroup" aria-label="Theme preference">
                <button
                  type="button"
                  className={`theme-pill-btn${theme === 'light' ? ' active' : ''}`}
                  onClick={() => setTheme('light')}
                  role="radio"
                  aria-checked={theme === 'light'}
                >
                  <span className="theme-icon">☀️</span> Current
                </button>
                <button
                  type="button"
                  className={`theme-pill-btn${theme === 'dark' ? ' active' : ''}`}
                  onClick={() => setTheme('dark')}
                  role="radio"
                  aria-checked={theme === 'dark'}
                >
                  <span className="theme-icon">🌙</span> Dark
                </button>
                <button
                  type="button"
                  className={`theme-pill-btn${theme === 'darker' ? ' active' : ''}`}
                  onClick={() => setTheme('darker')}
                  role="radio"
                  aria-checked={theme === 'darker'}
                >
                  <span className="theme-icon">🌑</span> Darker
                </button>
              </div>
            </div>

            <div className="account-divider" />
            <button
              className="account-menu-item account-menu-item-danger"
              onClick={() => { setMobileSheetOpen(false); logout(); }}
            >
              Sign out
            </button>
          </div>
        </div>
      )}

      {/* ── MOBILE BOTTOM NAVIGATION ─────────────────────────── */}
      <nav className="mobile-bottom-nav" aria-label="Mobile Bottom Navigation">
        <Link to="/" className={`bottom-nav-item${isFreeNowActive ? ' active' : ''}`}>
          <IconClock />
          <span>Free now</span>
        </Link>
        <Link to="/find" className={`bottom-nav-item${isFindActive ? ' active' : ''}`}>
          <IconCalendar />
          <span>Find a room</span>
        </Link>
        <Link to="/my-group" className={`bottom-nav-item${isGroupActive ? ' active' : ''}`}>
          <IconUsers />
          <span>My group</span>
        </Link>
      </nav>
    </>
  );
}
