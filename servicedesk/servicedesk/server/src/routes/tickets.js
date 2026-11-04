import { Router } from 'express';
import fs from 'node:fs';
import multer from 'multer';
import { config } from '../config.js';
import { one, many } from '../db/index.js';
import { requireStaff, httpError } from '../auth.js';
import * as svc from '../services/tickets.js';

const r = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxAttachmentMb * 1024 * 1024, files: 10 } });
const toFiles = (req) => (req.files || []).map((f) => ({ filename: f.originalname, mimeType: f.mimetype, buffer: f.buffer }));
const isStaff = (u) => u.role === 'agent' || u.role === 'admin';

r.get('/', async (req, res) => {
  res.json(await svc.listTickets(req.query, req.user));
});

r.post('/', upload.array('files'), async (req, res) => {
  const b = req.body;
  if (!String(b.subject || '').trim()) throw httpError(400, 'Add a subject so the team knows what the ticket is about');
  const data = isStaff(req.user)
    ? { ...b, requester_id: b.requester_id || req.user.id, source: 'agent' }
    : { subject: b.subject, description: b.description, type: b.type === 'request' ? 'request' : 'incident',
        priority: ['low', 'medium', 'high'].includes(b.priority) ? b.priority : 'medium',
        category_id: b.category_id, asset_id: b.asset_id, requester_id: req.user.id, source: 'portal' };
  if (data.requester_id) data.requester_id = Number(data.requester_id);
  const ticket = await svc.createTicket(data, req.user, { files: toFiles(req) });
  res.status(201).json(ticket);
});

r.get('/:id', async (req, res) => {
  const detail = await svc.getTicketDetail(Number(req.params.id), req.user);
  if (!detail) throw httpError(404, 'Ticket not found');
  if (detail === 'forbidden') throw httpError(403, 'You can only view your own tickets');
  res.json(detail);
});

r.patch('/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!isStaff(req.user)) {
    const t = await one('SELECT requester_id FROM tickets WHERE id = $1', [id]);
    if (!t || t.requester_id !== req.user.id) throw httpError(403, 'You can only change your own tickets');
    if (req.body.status !== 'closed' || Object.keys(req.body).length !== 1) throw httpError(403, 'You can only close your own ticket');
    return res.json(await svc.updateTicket(id, { status: 'closed' }, { ...req.user, role: 'agent' }));
  }
  const updated = await svc.updateTicket(id, req.body, req.user);
  if (!updated) throw httpError(404, 'Ticket not found');
  res.json(updated);
});

r.post('/:id/comments', upload.array('files'), async (req, res) => {
  const id = Number(req.params.id);
  const t = await one('SELECT requester_id FROM tickets WHERE id = $1', [id]);
  if (!t) throw httpError(404, 'Ticket not found');
  if (!isStaff(req.user) && t.requester_id !== req.user.id) throw httpError(403, 'You can only reply to your own tickets');
  if (!String(req.body.body || '').trim() && !(req.files || []).length) throw httpError(400, 'Write a reply or attach a file');
  const cc = String(req.body.cc || '').split(/[,;\s]+/).filter((e) => /^[^@\s]+@[^@\s]+$/.test(e));
  const comment = await svc.addComment(id, { body: req.body.body || '', is_internal: req.body.is_internal === 'true' || req.body.is_internal === true, cc }, req.user, toFiles(req));
  res.status(201).json(comment);
});

r.post('/:id/approval', requireStaff, async (req, res) => {
  if (req.user.role !== 'admin') throw httpError(403, 'Only administrators can approve changes');
  const t = await svc.decideChange(Number(req.params.id), req.body.decision, req.user);
  if (!t) throw httpError(404, 'Ticket not found');
  res.json(t);
});

export default r;

// Attachment download (mounted separately at /api/attachments)
export const attachments = Router();
attachments.get('/:id', async (req, res) => {
  const a = await one(
    `SELECT a.*, t.requester_id, c.is_internal FROM attachments a JOIN tickets t ON t.id = a.ticket_id
     LEFT JOIN ticket_comments c ON c.id = a.comment_id WHERE a.id = $1`, [Number(req.params.id)]);
  if (!a) throw httpError(404, 'File not found');
  if (!isStaff(req.user) && (a.requester_id !== req.user.id || a.is_internal)) throw httpError(403, 'You cannot open this file');
  if (!fs.existsSync(a.storage_path)) throw httpError(410, 'This file is no longer stored on the server');
  res.setHeader('Content-Type', a.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(a.filename)}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(a.storage_path).pipe(res);
});

export const lookups = Router();
lookups.get('/', async (req, res) => {
  const staff = isStaff(req.user);
  const [categories, groups, agents, assets] = await Promise.all([
    many('SELECT id, name, parent_id FROM categories ORDER BY name'),
    staff ? many('SELECT id, name FROM groups ORDER BY name') : [],
    staff ? many("SELECT id, name, email FROM users WHERE role IN ('agent','admin') AND active ORDER BY name") : [],
    staff
      ? many("SELECT id, tag, name FROM assets WHERE status <> 'retired' ORDER BY tag")
      : many('SELECT id, tag, name FROM assets WHERE assigned_to = $1 ORDER BY tag', [req.user.id]),
  ]);
  res.json({ categories, groups, agents, assets, statuses: svc.STATUSES, priorities: svc.PRIORITIES, types: svc.TYPES });
});
