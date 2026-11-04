import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { one, many, query, tx } from '../db/index.js';
import { requireAdmin, httpError } from '../auth.js';
import { getSetting, setSetting } from '../services/settings.js';
import { config } from '../config.js';
import { status as emailStatus, pollMailbox } from '../services/emailIngest.js';

const r = Router();

// ---- users (agents can list/search for requester lookup; admins manage) ----
r.get('/users', async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(u.name ILIKE $1 OR u.email ILIKE $1)`); }
  if (req.query.role) { params.push(req.query.role); where.push(`u.role = $${params.length}`); }
  res.json(await many(
    `SELECT u.id, u.email, u.name, u.role, u.department, u.phone, u.active, u.created_at,
            (u.password_hash IS NOT NULL) AS has_password,
            coalesce(array_agg(gm.group_id) FILTER (WHERE gm.group_id IS NOT NULL), '{}') AS group_ids
     FROM users u LEFT JOIN group_members gm ON gm.user_id = u.id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     GROUP BY u.id ORDER BY u.name LIMIT 500`, params));
});

r.post('/users', requireAdmin, async (req, res) => {
  const { email, name, role = 'requester', department = null, phone = null, password } = req.body;
  if (!email || !name) throw httpError(400, 'Name and email are required');
  if (!['admin', 'agent', 'requester'].includes(role)) throw httpError(400, 'Role must be admin, agent or requester');
  const hash = password ? await bcrypt.hash(String(password), 12) : null;
  try {
    const u = await one(
      `INSERT INTO users(email, name, role, department, phone, password_hash) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, email, name, role, department, phone, active`,
      [String(email).toLowerCase().trim(), name, role, department, phone, hash]);
    await setGroups(u.id, req.body.group_ids);
    res.status(201).json(u);
  } catch (e) {
    if (e.code === '23505') throw httpError(409, `${email} already has an account`);
    throw e;
  }
});

r.patch('/users/:id', requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { name, role, department, phone, active, password } = req.body;
  if (id === req.user.id && (role && role !== 'admin' || active === false)) {
    throw httpError(400, 'You cannot remove your own admin access');
  }
  const u = await one(
    `UPDATE users SET name = COALESCE($2, name), role = COALESCE($3, role), department = COALESCE($4, department),
       phone = COALESCE($5, phone), active = COALESCE($6, active),
       password_hash = COALESCE($7, password_hash)
     WHERE id = $1 RETURNING id, email, name, role, department, phone, active`,
    [id, name ?? null, role ?? null, department ?? null, phone ?? null, active ?? null,
      password ? await bcrypt.hash(String(password), 12) : null]);
  if (!u) throw httpError(404, 'User not found');
  if (req.body.group_ids) await setGroups(id, req.body.group_ids);
  res.json(u);
});

async function setGroups(userId, groupIds) {
  if (!Array.isArray(groupIds)) return;
  await tx(async (db) => {
    await db.query('DELETE FROM group_members WHERE user_id = $1', [userId]);
    for (const g of groupIds) await db.query('INSERT INTO group_members(group_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [Number(g), userId]);
  });
}

// ---- groups ----
r.get('/groups', async (req, res) => {
  res.json(await many(
    `SELECT g.*, coalesce(json_agg(json_build_object('id', u.id, 'name', u.name)) FILTER (WHERE u.id IS NOT NULL), '[]') AS members
     FROM groups g LEFT JOIN group_members gm ON gm.group_id = g.id LEFT JOIN users u ON u.id = gm.user_id
     GROUP BY g.id ORDER BY g.name`));
});
r.post('/groups', requireAdmin, async (req, res) => {
  if (!req.body.name) throw httpError(400, 'Group name is required');
  res.status(201).json(await one('INSERT INTO groups(name, description) VALUES ($1,$2) RETURNING *', [req.body.name, req.body.description || null]));
});
r.patch('/groups/:id', requireAdmin, async (req, res) => {
  res.json(await one('UPDATE groups SET name = COALESCE($2,name), description = COALESCE($3,description) WHERE id = $1 RETURNING *',
    [Number(req.params.id), req.body.name ?? null, req.body.description ?? null]));
});
r.delete('/groups/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM groups WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

// ---- categories ----
r.get('/categories', async (req, res) => {
  res.json(await many(`SELECT c.*, g.name AS default_group_name FROM categories c LEFT JOIN groups g ON g.id = c.default_group_id ORDER BY c.name`));
});
const kw = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => s.trim().toLowerCase()).filter(Boolean);
r.post('/categories', requireAdmin, async (req, res) => {
  if (!req.body.name) throw httpError(400, 'Category name is required');
  res.status(201).json(await one('INSERT INTO categories(name, parent_id, default_group_id, keywords) VALUES ($1,$2,$3,$4) RETURNING *',
    [req.body.name, req.body.parent_id || null, req.body.default_group_id || null, kw(req.body.keywords)]));
});
r.patch('/categories/:id', requireAdmin, async (req, res) => {
  const { name, default_group_id, keywords } = req.body;
  res.json(await one(
    `UPDATE categories SET name = COALESCE($2,name),
       default_group_id = CASE WHEN $3::text IS NULL THEN default_group_id ELSE NULLIF($3::text,'')::int END,
       keywords = COALESCE($4, keywords) WHERE id = $1 RETURNING *`,
    [Number(req.params.id), name ?? null, default_group_id === undefined ? null : String(default_group_id ?? ''),
      keywords === undefined ? null : kw(keywords)]));
});
r.delete('/categories/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM categories WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

// ---- SLA policies ----
r.get('/sla', async (req, res) => {
  res.json(await many(`SELECT * FROM sla_policies ORDER BY CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END`));
});
r.put('/sla', requireAdmin, async (req, res) => {
  for (const p of req.body || []) {
    const resp = Number(p.response_minutes);
    const reso = Number(p.resolution_minutes);
    if (!(resp > 0 && reso > 0)) throw httpError(400, `Targets for ${p.priority} must be positive numbers of minutes`);
    await query('UPDATE sla_policies SET response_minutes = $2, resolution_minutes = $3 WHERE priority = $1', [p.priority, resp, reso]);
  }
  res.json({ ok: true });
});

// ---- settings ----
const SETTING_KEYS = ['business_hours', 'email', 'tickets'];
r.get('/settings', requireAdmin, async (req, res) => {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = await getSetting(k);
  res.json(out);
});
r.put('/settings', requireAdmin, async (req, res) => {
  for (const k of SETTING_KEYS) if (req.body[k]) await setSetting(k, req.body[k]);
  res.json({ ok: true });
});

// ---- email intake status ----
r.get('/email/status', requireAdmin, async (req, res) => {
  res.json({
    enabled: config.graphEnabled,
    mailbox: config.graph.mailbox || null,
    pollSeconds: config.graph.pollSeconds,
    ...emailStatus,
    recent: await many(`SELECT e.*, t.subject AS ticket_subject FROM email_messages e LEFT JOIN tickets t ON t.id = e.ticket_id
                        ORDER BY e.id DESC LIMIT 50`),
  });
});
r.post('/email/poll', requireAdmin, async (req, res) => {
  if (!config.graphEnabled) throw httpError(400, 'Microsoft 365 is not configured. Set the M365_* environment variables and restart.');
  try {
    res.json({ fetched: await pollMailbox() });
  } catch (e) {
    emailStatus.lastError = e.message;
    throw httpError(502, e.message);
  }
});

export default r;
