import { one, query } from '../db/index.js';
import { DEFAULT_SETTINGS } from '../db/migrate.js';

const cache = new Map();
const TTL_MS = 30_000;

export async function getSetting(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const row = await one('SELECT value FROM settings WHERE key = $1', [key]);
  const value = { ...(DEFAULT_SETTINGS[key] || {}), ...(row?.value || {}) };
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function setSetting(key, value) {
  await query(
    'INSERT INTO settings(key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
    [key, value]
  );
  cache.delete(key);
}
