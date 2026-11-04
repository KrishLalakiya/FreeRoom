import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import bcrypt from 'bcryptjs';
import express from 'express';

const db = vi.hoisted(() => ({ query: null }));

vi.mock('../../src/config/db.js', () => {
  const query = (...args) => db.query(...args);
  return { query, getClient: vi.fn(), default: { query } };
});

const { default: authRouter } = await import('../../src/routes/auth.js');

let server;
let baseUrl;
const original = { adminUsers: process.env.ADMIN_USERS, nodeEnv: process.env.NODE_ENV };
const hashed = bcrypt.hashSync('correct-password', 4);

const post = async (path, body) => {
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRouter);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});

afterAll(() => {
  process.env.ADMIN_USERS = original.adminUsers ?? '';
  process.env.NODE_ENV = original.nodeEnv;
  return new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  process.env.ADMIN_USERS = `hashed@test:${hashed},plain@test:plain-password`;
  db.query = vi.fn(async (_sql, params) => ({
    rows: [{ id: 1, email: params[0], name: 'Admin', role: 'admin', avatar_url: null, settings: {} }],
  }));
});

describe('POST /admin-login', () => {
  it('signs in with the password behind a bcrypt hash', async () => {
    const res = await post('/admin-login', { email: 'hashed@test', password: 'correct-password' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
  });

  it('rejects a wrong password', async () => {
    const res = await post('/admin-login', { email: 'hashed@test', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('never accepts a plain-text ADMIN_USERS entry, and logs the real cause', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post('/admin-login', { email: 'plain@test', password: 'plain-password' });
    expect(res.status).toBe(401);
    expect(logged.mock.calls.flat().join(' ')).toContain('not a bcrypt hash');
    logged.mockRestore();
  });

  it('does not log configuration errors for unknown emails', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post('/admin-login', { email: 'nobody@test', password: 'x' });
    expect(res.status).toBe(401);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it('rejects non-string credentials', async () => {
    const res = await post('/admin-login', { email: { a: 1 }, password: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('POST /dev-login', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  it('does not exist in production', async () => {
    process.env.NODE_ENV = 'production';
    const res = await post('/dev-login', { email: 'a@test' });
    expect(res.status).toBe(404);
  });

  it('ignores a requested role, so nobody can make themselves an admin', async () => {
    await post('/dev-login', { email: 'student@test', role: 'admin' });
    expect(db.query.mock.calls[0][1][2]).toBe('student');
  });

  it('answers with an error when the database fails, rather than leaving a rejected promise', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.query = vi.fn().mockRejectedValue(new Error('database down'));
    const res = await post('/dev-login', { email: 'a@test' });
    expect(res.status).toBe(500);
    logged.mockRestore();
  });
});
