import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { query } from '../config/db.js';
import { generateToken } from '../middleware/auth.js';
import dotenv from 'dotenv';

dotenv.config();

const router = Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * POST /api/auth/google
 * Verify Google ID token, create or find user, return JWT.
 */
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;

    if (!credential) {
      return res.status(400).json({
        error: 'Missing credential',
        message: 'Google credential is required.',
      });
    }

    let payload;

    // In development, allow a mock login
    if (process.env.NODE_ENV === 'development' && credential === 'dev-mock-token') {
      payload = {
        sub: 'dev-mock-google-id',
        email: 'admin@freeroom.dev',
        name: 'Dev Admin',
        picture: null,
      };
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

    // Upsert user
    const result = await query(`
      INSERT INTO users (email, name, google_id, avatar_url)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO UPDATE SET
        name = EXCLUDED.name,
        google_id = EXCLUDED.google_id,
        avatar_url = EXCLUDED.avatar_url
      RETURNING id, email, name, role, avatar_url;
    `, [email, name, googleId, picture]);

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

  const { email, name } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const result = await query(`
    INSERT INTO users (email, name)
    VALUES ($1, $2)
    ON CONFLICT (email) DO UPDATE SET name = COALESCE(EXCLUDED.name, users.name)
    RETURNING id, email, name, role, avatar_url;
  `, [email, name || email.split('@')[0]]);

  const user = result.rows[0];
  const token = generateToken(user);

  res.json({ token, user });
});

export default router;
