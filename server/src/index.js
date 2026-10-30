import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import authRoutes from './routes/auth.js';
import roomRoutes from './routes/rooms.js';
import reportRoutes from './routes/reports.js';
import adminRoutes from './routes/admin.js';
import migrate from './config/migrate.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// ── Middleware ─────────────────────────────────────────────

// CORS
const allowedOrigins = [
  process.env.CLIENT_URL,
  ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173', 'http://127.0.0.1:5173'] : []),
].filter(Boolean).map((o) => o.replace(/\/$/, ''));

// This project's own Vercel preview URLs only. Adjust the name if it differs.
const previewPattern = /^https:\/\/freeroom-[a-z0-9-]+\.vercel\.app$/;

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const clean = origin.replace(/\/$/, '');
    return callback(null, allowedOrigins.includes(clean) || previewPattern.test(clean));
  },
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));

// Rate limiting
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 500 : 20,
  message: { error: 'Too many login attempts. Please try again later.' },
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: process.env.NODE_ENV === 'development' ? 5000 : 120,
  skip: (req) => process.env.NODE_ENV === 'development' || req.ip === '127.0.0.1' || req.ip === '::1',
  message: { error: 'Too many requests. Please slow down.' },
});

// ── Routes ────────────────────────────────────────────────

app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/admin-login', loginLimiter);
app.use('/api/auth/google', loginLimiter);
app.use('/api/auth', apiLimiter, authRoutes);
app.use('/api/rooms', apiLimiter, roomRoutes);
app.use('/api/reports', apiLimiter, reportRoutes);
app.use('/api/admin', apiLimiter, adminRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, '../../client/dist');
const clientIndexPath = path.join(clientDistPath, 'index.html');

// Serve client static assets if dist folder exists
if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
}

// Fallback for non-API routes
app.get('*', (req, res) => {
  if (req.originalUrl.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found', path: req.originalUrl });
  }
  if (fs.existsSync(clientIndexPath)) {
    return res.sendFile(clientIndexPath);
  }
  res.json({
    name: 'FreeRoom API',
    status: 'online',
    health: '/api/health',
    client: process.env.CLIENT_URL || 'https://freeroom-app.vercel.app',
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong.',
  });
});

// ── Start server ──────────────────────────────────────────

async function startServer() {
  if (process.env.DATABASE_URL) {
    try {
      console.log('🔄 Checking database schema & migrations...');
      await migrate();
    } catch (err) {
      console.error('⚠️ Database migration error on startup:', err.message || err);
      if (process.env.NODE_ENV === 'production') {
        console.error('FATAL: Aborting server startup due to migration failure in production.');
        process.exit(1);
      }
    }
  }

  app.listen(PORT, () => {
    console.log(`
  🏫 FreeRoom API running
  ────────────────────────
  Port:     ${PORT}
  Env:      ${process.env.NODE_ENV || 'development'}
  Client:   ${process.env.CLIENT_URL || 'http://localhost:5173'}
  ────────────────────────
    `);
  });
}

startServer();

export default app;
