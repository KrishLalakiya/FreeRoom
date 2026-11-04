import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool, types } = pg;

// DATE columns have no time zone, so keep them as 'YYYY-MM-DD' strings. The driver's default
// turns them into a local-midnight Date, which serialises to the previous day in IST
// (2026-10-29 becomes "2026-10-28T18:30:00.000Z") and showed admins the wrong dates.
const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value) => value);

const isRemoteDb = process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost') && !process.env.DATABASE_URL.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.NODE_ENV === 'production' || isRemoteDb) ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

pool.on('connect', () => {
  console.log('Connected to PostgreSQL');
});

pool.on('error', (err) => {
  // PRD v7 Section 5 Item 6: Do not call process.exit(-1) on pool error; log and allow reconnect
  console.error('Unexpected database pool error:', err.message || err);
});

export const query = (text, params) => pool.query(text, params);

export const getClient = () => pool.connect();

export default pool;
