import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { one } from './db/index.js';

export function signSession(user) {
  return jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: '12h' });
}

export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Sign in to continue' });
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = await one('SELECT id, email, name, role, department, active FROM users WHERE id = $1', [payload.sub]);
    if (!user || !user.active) return res.status(401).json({ error: 'Your account is inactive' });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Your session has expired — sign in again' });
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : res.status(403).json({ error: 'You do not have permission to do this' });

export const requireStaff = requireRole('agent', 'admin');
export const requireAdmin = requireRole('admin');

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}
