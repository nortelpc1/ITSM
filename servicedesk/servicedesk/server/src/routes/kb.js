import { Router } from 'express';
import { one, many, query } from '../db/index.js';
import { requireStaff, httpError } from '../auth.js';

const r = Router();
const isStaff = (u) => u.role === 'agent' || u.role === 'admin';

r.get('/', async (req, res) => {
  const params = [];
  const where = isStaff(req.user) ? [] : ['k.published'];
  if (req.query.q) { params.push(`%${req.query.q}%`); where.push(`(k.title ILIKE $${params.length} OR k.body ILIKE $${params.length})`); }
  res.json(await many(
    `SELECT k.id, k.title, left(k.body, 240) AS excerpt, k.published, k.views, k.updated_at, c.name AS category_name, u.name AS author_name
     FROM kb_articles k LEFT JOIN categories c ON c.id = k.category_id LEFT JOIN users u ON u.id = k.author_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY k.views DESC, k.updated_at DESC LIMIT 200`, params));
});

r.get('/:id', async (req, res) => {
  const a = await one(
    `UPDATE kb_articles SET views = views + 1 WHERE id = $1 ${isStaff(req.user) ? '' : 'AND published'}
     RETURNING *`, [Number(req.params.id)]);
  if (!a) throw httpError(404, 'Article not found');
  res.json(a);
});

r.post('/', requireStaff, async (req, res) => {
  const { title, body, category_id = null, published = false } = req.body;
  if (!title || !body) throw httpError(400, 'Title and content are required');
  res.status(201).json(await one(
    'INSERT INTO kb_articles(title, body, category_id, published, author_id) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [title, body, category_id || null, Boolean(published), req.user.id]));
});

r.patch('/:id', requireStaff, async (req, res) => {
  const { title, body, category_id, published } = req.body;
  const a = await one(
    `UPDATE kb_articles SET title = COALESCE($2, title), body = COALESCE($3, body),
       category_id = CASE WHEN $4::text IS NULL THEN category_id ELSE NULLIF($4::text,'')::int END,
       published = COALESCE($5, published), updated_at = now() WHERE id = $1 RETURNING *`,
    [Number(req.params.id), title ?? null, body ?? null, category_id === undefined ? null : String(category_id ?? ''), published ?? null]);
  if (!a) throw httpError(404, 'Article not found');
  res.json(a);
});

r.delete('/:id', requireStaff, async (req, res) => {
  await query('DELETE FROM kb_articles WHERE id = $1', [Number(req.params.id)]);
  res.json({ ok: true });
});

export default r;
