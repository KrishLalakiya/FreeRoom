import { query } from '../config/db.js';

let cachedSettings = null;
let lastFetch = 0;
const CACHE_TTL_MS = 10000;

/**
 * Get all system settings with fallbacks and environment variable overrides.
 */
export async function getSystemSettings() {
  const now = Date.now();
  if (cachedSettings && (now - lastFetch < CACHE_TTL_MS)) {
    return { ...cachedSettings };
  }

  const defaults = {
    chain_min_free_minutes: parseInt(process.env.CHAIN_MIN_FREE_MINUTES || '15', 10),
    buffer_minutes: parseInt(process.env.BUFFER_MINUTES || '0', 10),
    chain_enabled: process.env.CHAIN_ENABLED !== 'false',
  };

  try {
    const res = await query('SELECT key, value FROM system_settings');
    const dbSettings = {};
    for (const row of res.rows) {
      dbSettings[row.key] = row.value;
    }

    cachedSettings = {
      chain_min_free_minutes: typeof dbSettings.chain_min_free_minutes === 'number'
        ? dbSettings.chain_min_free_minutes
        : defaults.chain_min_free_minutes,
      buffer_minutes: typeof dbSettings.buffer_minutes === 'number'
        ? dbSettings.buffer_minutes
        : defaults.buffer_minutes,
      chain_enabled: typeof dbSettings.chain_enabled === 'boolean'
        ? dbSettings.chain_enabled
        : defaults.chain_enabled,
    };
    lastFetch = now;
    return { ...cachedSettings };
  } catch (err) {
    console.warn('Failed to load system settings from DB, using defaults:', err.message);
    return { ...defaults };
  }
}

/**
 * Update system settings (Admin only).
 */
export async function updateSystemSettings(updates) {
  const allowedKeys = ['chain_min_free_minutes', 'buffer_minutes', 'chain_enabled'];
  for (const [key, value] of Object.entries(updates)) {
    if (allowedKeys.includes(key)) {
      await query(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, JSON.stringify(value)]
      );
    }
  }
  cachedSettings = null;
  lastFetch = 0;
  return getSystemSettings();
}

