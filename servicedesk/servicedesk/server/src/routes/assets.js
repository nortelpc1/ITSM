import { Router } from 'express';
import { one, many, query } from '../db/index.js';
import { requireAdmin, httpError } from '../auth.js';

const r = Router();
const FIELDS = ['tag', 'name', 'type', 'status', 'manufacturer', 'model', 'serial_number', 'assigned_to',
  'location', 'purchase_date', 'warranty_end', 'notes'];
const clean = (body) => Object.fromEntries(FIELDS.filter((k) => k in body).map((k) => [k, body[k] === '' ? null : body[k]]));

r.get('/', async (req, res) => {
  const params = [];
  const where = [];
  if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(a.tag ILIKE $1 OR a.name ILIKE $1 OR a.serial_number ILIKE $1 OR u.name ILIKE $1)`); }
  if (req.query.status) { params.push(req.query.status); where.push(`a.status = $${params.length}`); }
  if (req.query.type) { params.push(req.query.type); where.push(`a.type = $${params.length}`); }
  res.json(await many(
    `SELECT a.*, u.name AS assigned_name,
            (SELECT count(*)::int FROM tickets t WHERE t.asset_id = a.id AND t.status IN ('new','open','pending')) AS open_tickets
     FROM assets a LEFT JOIN users u ON u.id = a.assigned_to
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.tag LIMIT 500`, params));
});

r.get('/:id', async (req, res) => {
  const asset = await one('SELECT a.*, u.name AS assigned_name, u.email AS assigned_email FROM assets a LEFT JOIN users u ON u.id = a.assigned_to WHERE a.id = $1', [Number(req.params.id)]);
  if (!asset) throw httpError(404, 'Asset not found');
  const tickets = await many('SELECT id, subject, status, priority, created_at FROM tickets WHERE asset_id = $1 ORDER BY id DESC LIMIT 50', [asset.id]);
  res.json({ asset, tickets });
});

r.post('/', async (req, res) => {
  const a = clean(req.body);
  if (!a.tag || !a.name) throw httpError(400, 'Asset tag and name are required');
  const cols = Object.keys(a);
  try {
    res.status(201).json(await one(
      `INSERT INTO assets(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
      cols.map((k) => a[k])));
  } catch (e) {
    if (e.code === '23505') throw httpError(409, `Asset tag ${a.tag} is already in use`);
    throw e;
  }
});

r.patch('/:id', async (req, res) => {
  const a = clean(req.body);
  const cols = Object.keys(a);
  if (!cols.length) throw httpError(400, 'Nothing to update');
  const row = await one(
    `UPDATE assets SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`,
    [Number(req.params.id), ...cols.map((k) => a[k])]);
  if (!row) throw httpError(404, 'Asset not found');
  res.json(row);
});

r.delete('/:id', requireAdmin, async (req, res) => {
  await query('DELETE FROM assets WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

export default r;
