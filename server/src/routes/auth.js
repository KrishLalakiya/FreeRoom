import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { query } from '../config/db.js';
import { generateToken, authenticate } from '../middleware/auth.js';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Ensure users settings column exists (PRD v6)
async function ensureUserSettingsColumn() {
  try {
    await query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
    `);
  } catch (err) {
    console.error('Failed to ensure settings column on users:', err);
  }
}
ensureUserSettingsColumn();

/**
 * Parse admin users and passwords configured via environment variables.
 * Format in .env: ADMIN_USERS=email1:pass1,email2:pass2
 */
function getAdminUsersFromEnv() {
  dotenv.config({ override: true });
  const users = {};
  const raw = process.env.ADMIN_USERS || '';
  for (const entry of raw.split(',')) {
    const idx = entry.indexOf(':');
    if (idx !== -1) {
      const email = entry.slice(0, idx).trim().toLowerCase();
      const password = entry.slice(idx + 1).trim();
      if (email && password) {
        users[email] = password;
      }
    }
  }
  return users;
}

function checkIsAdminEmail(email) {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  const envAdminUsers = getAdminUsersFromEnv();
  if (envAdminUsers[normalized]) return true;

  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  return adminEmails.includes(normalized) || normalized.includes('admin');
}

/**
 * POST /api/auth/google
 * Verify Google ID token, create or find user, return JWT.
 */
router.post('/google', async (req, res) => {
  try {
    const { credential, accessToken, deviceSettings } = req.body;

    if (!credential && !accessToken) {
      return res.status(400).json({
        error: 'Missing credential',
        message: 'Google credential or access token is required.',
      });
    }

    let payload;

    if (accessToken) {
      // Fetch user profile directly from Google Identity using access token
      const googleRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!googleRes.ok) {
        throw new Error('Could not verify Google account with Google Identity Services');
      }
      payload = await googleRes.json();
    } else {
      // Verify the Google ID token
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    }

    const { sub: googleId, email, name, picture } = payload;

    // Check email domain restriction
    if (process.env.ALLOWED_EMAIL_DOMAIN) {
      const domain = email.split('@')[1];
      if (domain !== process.env.ALLOWED_EMAIL_DOMAIN) {
        return res.status(403).json({
          error: 'Invalid email domain',
          message: `Only ${process.env.ALLOWED_EMAIL_DOMAIN} emails are allowed.`,
        });
      }
    }

    const initialSettings = deviceSettings && typeof deviceSettings === 'object' ? deviceSettings : {};
    const isAdmin = checkIsAdminEmail(email);

    // Upsert user (PRD v6: device settings copied once on first sign-in; account settings win if present)
    const result = await query(`
      INSERT INTO users (email, name, google_id, avatar_url, settings, role)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        google_id = EXCLUDED.google_id,
        avatar_url = EXCLUDED.avatar_url,
        role = CASE
          WHEN users.role = 'admin' THEN 'admin'
          WHEN EXCLUDED.role = 'admin' THEN 'admin'
          ELSE users.role
        END,
        settings = CASE
          WHEN users.settings IS NOT NULL AND users.settings != '{}'::jsonb THEN users.settings
          WHEN EXCLUDED.settings IS NOT NULL AND EXCLUDED.settings != '{}'::jsonb THEN EXCLUDED.settings
          ELSE COALESCE(users.settings, '{}'::jsonb)
        END
      RETURNING id, email, name, role, avatar_url, settings;
    `, [email, name, googleId, picture, JSON.stringify(initialSettings), isAdmin ? 'admin' : 'student']);

    const user = result.rows[0];
    const token = generateToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url,
        settings: user.settings || {},
      },
    });
  } catch (err) {
    console.error('Auth error:', err);
    res.status(500).json({
      error: 'Authentication failed',
      message: 'Could not verify your identity. Please try again.',
    });
  }
});

/**
 * POST /api/auth/dev-login
 * Development-only: login with email to test without Google OAuth.
 */
router.post('/dev-login', async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(404).json({ error: 'Not found' });
  }

  const { email, name, role, deviceSettings } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const isEmailAdmin = checkIsAdminEmail(email);
  const assignedRole = role === 'admin' ? (isEmailAdmin ? 'admin' : 'student') : (isEmailAdmin ? 'admin' : (role || 'student'));
  const initialSettings = deviceSettings && typeof deviceSettings === 'object' ? deviceSettings : {};

  // PRD v6: Device settings copied once on first sign-in; account settings win if present
  const result = await query(`
    INSERT INTO users (email, name, role, settings)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (email) DO UPDATE SET
      name = COALESCE(EXCLUDED.name, users.name),
      role = CASE
        WHEN EXCLUDED.role = 'admin' THEN 'admin'
        ELSE users.role
      END,
      settings = CASE
        WHEN users.settings IS NOT NULL AND users.settings != '{}'::jsonb THEN users.settings
        WHEN EXCLUDED.settings IS NOT NULL AND EXCLUDED.settings != '{}'::jsonb THEN EXCLUDED.settings
        ELSE COALESCE(users.settings, '{}'::jsonb)
      END
    RETURNING id, email, name, role, avatar_url, settings;
  `, [email, name || email.split('@')[0], assignedRole, JSON.stringify(initialSettings)]);

  const user = result.rows[0];
  const token = generateToken(user);

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      avatar_url: user.avatar_url,
      settings: user.settings || {},
    },
  });
});

/**
 * POST /api/auth/admin-login
 * Authenticate admin with hardcoded email and password.
 */
router.post('/admin-login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Missing credentials',
        message: 'Please provide both email and password.',
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const envAdminUsers = getAdminUsersFromEnv();
    const expectedPassword = envAdminUsers[normalizedEmail];

    if (!expectedPassword || expectedPassword !== password) {
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Invalid email or password for admin portal.',
      });
    }

    const displayName = normalizedEmail.includes('krish') ? 'Krish' : 'Admin';

    // Upsert or fetch admin user from database
    const result = await query(`
      INSERT INTO users (email, name, role)
      VALUES ($1, $2, 'admin')
      ON CONFLICT (email) DO UPDATE SET
        name = COALESCE(users.name, EXCLUDED.name),
        role = 'admin'
      RETURNING id, email, name, role, avatar_url, settings;
    `, [normalizedEmail, displayName]);

    const user = result.rows[0];
    const token = generateToken(user);

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatar_url: user.avatar_url,
        settings: user.settings || {},
      },
    });
  } catch (err) {
    console.error('Admin login error:', err);
    return res.status(500).json({
      error: 'Server error',
      message: 'Failed to authenticate admin.',
    });
  }
});

/**
 * PUT /api/auth/settings
 * Update saved user settings across devices (batch, group, favouriteRooms, lastDateWindow).
 */
router.put('/settings', authenticate, async (req, res) => {
  try {
    const { settings } = req.body;
    if (!settings || typeof settings !== 'object') {
      return res.status(400).json({ error: 'Settings object is required' });
    }

    const result = await query(`
      UPDATE users
      SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb
      WHERE id = $2
      RETURNING id, email, name, role, avatar_url, settings;
    `, [JSON.stringify(settings), req.user.id]);

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      user: result.rows[0],
      settings: result.rows[0].settings || {},
    });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * GET /api/auth/me
 * Get current user profile and settings.
 */
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await query(`
      SELECT id, email, name, role, avatar_url, settings
      FROM users
      WHERE id = $1
    `, [req.user.id]);

    if (!result.rows[0]) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error('Fetch me error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;
