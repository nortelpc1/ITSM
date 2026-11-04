import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { one, query } from '../db/index.js';
import { config } from '../config.js';
import { requireAuth, signSession } from '../auth.js';
import { sendMagicLink } from '../services/mailer.js';

const r = Router();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Very small in-memory rate limiter for auth endpoints
const hits = new Map();
function limited(key, max = 10, windowMs = 15 * 60_000) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role, department: u.department });

r.post('/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (limited(`login:${req.ip}:${email}`)) return res.status(429).json({ error: 'Too many attempts — wait 15 minutes and try again' });
  const user = await one('SELECT * FROM users WHERE email = $1 AND active', [email]);
  if (!user || !user.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }
  res.json({ token: signSession(user), user: publicUser(user) });
});

// Passwordless sign-in: emails a one-time link. Always answers the same way to avoid leaking accounts.
r.post('/magic-link', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (limited(`magic:${req.ip}`, 5)) return res.status(429).json({ error: 'Too many requests — wait 15 minutes and try again' });
  const user = await one('SELECT * FROM users WHERE email = $1 AND active', [email]);
  if (user) {
    const raw = crypto.randomBytes(32).toString('base64url');
    await query("UPDATE users SET magic_token_hash = $2, magic_token_expires = now() + interval '15 minutes' WHERE id = $1",
      [user.id, sha256(raw)]);
    await sendMagicLink(user, `${config.publicUrl}/login?magic=${raw}`);
  }
  res.json({ ok: true });
});

r.post('/magic', async (req, res) => {
  const raw = String(req.body.token || '');
  const user = raw && await one(
    `UPDATE users SET magic_token_hash = NULL, magic_token_expires = NULL
     WHERE magic_token_hash = $1 AND magic_token_expires > now() AND active RETURNING *`, [sha256(raw)]);
  if (!user) return res.status(401).json({ error: 'This sign-in link has expired or was already used. Request a new one.' });
  res.json({ token: signSession(user), user: publicUser(user) });
});

r.get('/me', requireAuth, (req, res) => res.json({ user: publicUser(req.user) }));

r.post('/change-password', requireAuth, async (req, res) => {
  const { current = '', next = '' } = req.body;
  if (String(next).length < 10) return res.status(400).json({ error: 'Use at least 10 characters for the new password' });
  const u = await one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (u.password_hash && !(await bcrypt.compare(String(current), u.password_hash))) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, await bcrypt.hash(String(next), 12)]);
  res.json({ ok: true });
});

export default r;
