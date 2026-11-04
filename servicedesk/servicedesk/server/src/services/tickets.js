// Core ticket logic shared by the REST API and the email intake.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool, one, many, tx } from '../db/index.js';
import { config } from '../config.js';
import { getSetting } from './settings.js';
import { addBusinessMinutes, businessMinutesBetween } from './sla.js';
import { logChange } from './history.js';
import * as mail from './mailer.js';

export const STATUSES = ['new', 'open', 'pending', 'resolved', 'closed'];
export const PRIORITIES = ['critical', 'high', 'medium', 'low'];
export const TYPES = ['incident', 'request', 'problem', 'change'];

const isStaff = (u) => u && (u.role === 'agent' || u.role === 'admin');

const TICKET_SELECT = `
  SELECT t.*,
         r.name AS requester_name, r.email AS requester_email, r.department AS requester_department,
         a.name AS assignee_name, a.email AS assignee_email,
         g.name AS group_name, c.name AS category_name,
         s.tag AS asset_tag, s.name AS asset_name,
         ap.name AS approved_by_name
  FROM tickets t
  JOIN users r ON r.id = t.requester_id
  LEFT JOIN users a ON a.id = t.assignee_id
  LEFT JOIN groups g ON g.id = t.group_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN assets s ON s.id = t.asset_id
  LEFT JOIN users ap ON ap.id = t.approved_by`;

export function getTicket(id) {
  return one(`${TICKET_SELECT} WHERE t.id = $1`, [id]);
}

export async function listTickets(filters, user) {
  const where = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  if (!isStaff(user)) where.push(`t.requester_id = ${p(user.id)}`);
  if (filters.status === 'active') where.push(`t.status IN ('new','open','pending')`);
  else if (filters.status) where.push(`t.status = ${p(filters.status)}`);
  if (filters.type) where.push(`t.type = ${p(filters.type)}`);
  if (filters.priority) where.push(`t.priority = ${p(filters.priority)}`);
  if (filters.group_id) where.push(`t.group_id = ${p(Number(filters.group_id))}`);
  if (filters.assignee === 'me') where.push(`t.assignee_id = ${p(user.id)}`);
  else if (filters.assignee === 'none') where.push('t.assignee_id IS NULL');
  else if (filters.assignee) where.push(`t.assignee_id = ${p(Number(filters.assignee))}`);
  if (filters.requester_id) where.push(`t.requester_id = ${p(Number(filters.requester_id))}`);
  if (filters.asset_id) where.push(`t.asset_id = ${p(Number(filters.asset_id))}`);
  if (filters.parent_id) where.push(`t.parent_id = ${p(Number(filters.parent_id))}`);
  if (filters.breached === 'true') where.push('(t.response_breached OR t.resolution_breached)');
  if (filters.q) {
    const q = String(filters.q).trim();
    if (/^#?\d+$/.test(q)) where.push(`t.id = ${p(Number(q.replace('#', '')))}`);
    else {
      const like = p(`%${q}%`);
      where.push(`(t.subject ILIKE ${like} OR t.description ILIKE ${like} OR r.email ILIKE ${like} OR r.name ILIKE ${like})`);
    }
  }

  const sortable = { id: 't.id', updated: 't.updated_at', created: 't.created_at', due: 't.resolution_due', priority: 't.priority' };
  const sort = sortable[filters.sort] || 't.updated_at';
  const dir = filters.dir === 'asc' ? 'ASC' : 'DESC';
  const pageSize = Math.min(Number(filters.pageSize) || 50, 200);
  const page = Math.max(Number(filters.page) || 1, 1);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const orderSql = sort === 't.priority'
    ? `CASE t.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ${dir === 'DESC' ? 'ASC' : 'DESC'}, t.id DESC`
    : `${sort} ${dir} NULLS LAST`;

  const [rows, count] = await Promise.all([
    many(`${TICKET_SELECT} ${whereSql} ORDER BY ${orderSql} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`, params),
    one(`SELECT count(*)::int AS n FROM tickets t JOIN users r ON r.id = t.requester_id ${whereSql}`, params),
  ]);
  return { rows, total: count.n, page, pageSize };
}

/** Pick a category (and its default group) by keywords found in the text. */
export async function autoCategorise(text) {
  const cats = await many("SELECT id, default_group_id, keywords FROM categories WHERE array_length(keywords, 1) > 0");
  const lower = ` ${String(text).toLowerCase()} `;
  let best = null;
  for (const c of cats) {
    const hits = c.keywords.filter((k) => k && new RegExp(`\\b${k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(lower)).length;
    if (hits && (!best || hits > best.hits)) best = { ...c, hits };
  }
  return best ? { category_id: best.id, group_id: best.default_group_id } : {};
}

async function slaTargets(priority, from) {
  const policy = await one('SELECT * FROM sla_policies WHERE priority = $1', [priority]);
  if (!policy) return { response_due: null, resolution_due: null };
  const hours = await getSetting('business_hours');
  return {
    response_due: addBusinessMinutes(from, policy.response_minutes, hours),
    resolution_due: addBusinessMinutes(from, policy.resolution_minutes, hours),
  };
}

export async function saveAttachment(db, ticketId, commentId, { filename, mimeType, buffer }) {
  const safeName = String(filename || 'file').replace(/[^\w.\- ]+/g, '_').slice(0, 150) || 'file';
  const dir = path.join(config.uploadDir, String(ticketId));
  await fs.mkdir(dir, { recursive: true });
  const storagePath = path.join(dir, `${crypto.randomUUID()}-${safeName}`);
  await fs.writeFile(storagePath, buffer);
  return (await db.query(
    `INSERT INTO attachments(ticket_id, comment_id, filename, mime_type, size_bytes, storage_path)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [ticketId, commentId, safeName, mimeType || 'application/octet-stream', buffer.length, storagePath]
  )).rows[0];
}

const CREATE_FIELDS = ['type', 'subject', 'description', 'priority', 'category_id', 'group_id', 'assignee_id',
  'asset_id', 'parent_id', 'requester_id', 'source', 'conversation_id',
  'risk', 'planned_start', 'planned_end', 'implementation_plan', 'backout_plan'];

/**
 * Create a ticket. `data.requester_id` is required.
 * @returns the full ticket row
 */
export async function createTicket(data, actor, { files = [], notify = true } = {}) {
  const t = Object.fromEntries(CREATE_FIELDS.filter((k) => data[k] !== undefined && data[k] !== '').map((k) => [k, data[k]]));
  t.type = TYPES.includes(t.type) ? t.type : 'incident';
  t.priority = PRIORITIES.includes(t.priority) ? t.priority : 'medium';
  t.subject = String(t.subject || '(no subject)').slice(0, 300);
  t.description = String(t.description || '').slice(0, 100_000);
  if (!t.category_id) {
    const guess = await autoCategorise(`${t.subject} ${t.description}`);
    if (guess.category_id) t.category_id = guess.category_id;
    if (!t.group_id && guess.group_id) t.group_id = guess.group_id;
  }
  if (!t.group_id && t.category_id) {
    const c = await one('SELECT default_group_id FROM categories WHERE id = $1', [t.category_id]);
    if (c?.default_group_id) t.group_id = c.default_group_id;
  }
  if (t.type === 'change') t.approval_status = 'pending';
  t.status = t.assignee_id ? 'open' : 'new';
  Object.assign(t, await slaTargets(t.priority, new Date()));

  const cols = Object.keys(t);
  const ticket = await tx(async (db) => {
    const row = (await db.query(
      `INSERT INTO tickets(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
      cols.map((k) => t[k])
    )).rows[0];
    await logChange(db, row.id, actor?.id, 'created', null, t.source || 'portal');
    for (const f of files) await saveAttachment(db, row.id, null, f);
    return row;
  });

  const full = await getTicket(ticket.id);
  if (notify) {
    const emailSettings = await getSetting('email');
    const requester = { name: full.requester_name, email: full.requester_email };
    const createdByRequester = !actor || actor.id === full.requester_id;
    if (emailSettings.send_acknowledgement && createdByRequester && !isNoReply(requester.email)) {
      mail.sendAcknowledgement(full, requester);
    }
    if (full.assignee_id && full.assignee_id !== actor?.id) {
      mail.sendAssigned(full, { name: full.assignee_name, email: full.assignee_email });
    }
  }
  return full;
}

export const isNoReply = (email = '') => /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster)@/i.test(email);

const UPDATE_FIELDS = {
  staff: ['subject', 'description', 'type', 'status', 'priority', 'category_id', 'assignee_id', 'group_id',
    'asset_id', 'parent_id', 'requester_id', 'risk', 'planned_start', 'planned_end', 'implementation_plan', 'backout_plan'],
  requester: ['status'], // the route only lets requesters close their own ticket
};

/** Apply a patch to a ticket with history, SLA side effects and notifications. */
export async function updateTicket(id, patch, actor) {
  const allowed = isStaff(actor) ? UPDATE_FIELDS.staff : UPDATE_FIELDS.requester;
  const before = await one('SELECT * FROM tickets WHERE id = $1', [id]);
  if (!before) return null;

  const changes = {};
  for (const k of allowed) {
    if (!(k in patch)) continue;
    let v = patch[k] === '' ? null : patch[k];
    if (k.endsWith('_id') && v !== null) v = Number(v);
    if (k === 'status' && !STATUSES.includes(v)) continue;
    if (k === 'priority' && !PRIORITIES.includes(v)) continue;
    if (k === 'type' && !TYPES.includes(v)) continue;
    const old = before[k] instanceof Date ? before[k].toISOString() : before[k];
    const neu = v && (k === 'planned_start' || k === 'planned_end') ? new Date(v).toISOString() : v;
    if (String(old ?? '') !== String(neu ?? '')) changes[k] = v;
  }
  if (Object.keys(changes).length === 0) return getTicket(id);

  const now = new Date();
  const hours = await getSetting('business_hours');
  const extra = {};

  // Assigning a new ticket moves it to Open
  if (changes.assignee_id && before.status === 'new' && !changes.status) changes.status = 'open';

  if (changes.priority) {
    const policy = await one('SELECT * FROM sla_policies WHERE priority = $1', [changes.priority]);
    if (policy) {
      extra.response_due = addBusinessMinutes(before.created_at, policy.response_minutes, hours);
      extra.resolution_due = addBusinessMinutes(before.created_at, policy.resolution_minutes, hours);
      extra.response_breached = !before.first_response_at && extra.response_due < now;
      extra.resolution_breached = extra.resolution_due < now && !['resolved', 'closed'].includes(before.status);
    }
  }

  if (changes.status) {
    const s = changes.status;
    if (s === 'pending' && !before.sla_paused_at) extra.sla_paused_at = now;
    if (s !== 'pending' && before.sla_paused_at) {
      // Leaving "pending": push due dates out by the paused business time
      const paused = businessMinutesBetween(before.sla_paused_at, now, hours);
      const respDue = extra.response_due || before.response_due;
      const resDue = extra.resolution_due || before.resolution_due;
      if (respDue && !before.first_response_at) extra.response_due = addBusinessMinutes(respDue, paused, hours);
      if (resDue) extra.resolution_due = addBusinessMinutes(resDue, paused, hours);
      extra.sla_paused_at = null;
    }
    if (s === 'resolved') {
      extra.resolved_at = now;
      const due = extra.resolution_due || before.resolution_due;
      if (due && now > new Date(due)) extra.resolution_breached = true;
    }
    if (s === 'closed') { extra.closed_at = now; if (!before.resolved_at) extra.resolved_at = now; }
    if (['new', 'open', 'pending'].includes(s)) { extra.resolved_at = null; extra.closed_at = null; }
  }

  if (changes.type === 'change' && !before.approval_status) extra.approval_status = 'pending';

  const all = { ...changes, ...extra, updated_at: now };
  const cols = Object.keys(all);
  await tx(async (db) => {
    await db.query(
      `UPDATE tickets SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
      [id, ...cols.map((k) => all[k])]
    );
    for (const k of Object.keys(changes)) await logChange(db, id, actor?.id, k, before[k], changes[k]);
  });

  const after = await getTicket(id);
  if (changes.assignee_id && changes.assignee_id !== actor?.id) {
    mail.sendAssigned(after, { name: after.assignee_name, email: after.assignee_email });
  }
  if (changes.status === 'resolved' && !isNoReply(after.requester_email)) {
    mail.sendResolved(after, { name: after.requester_name, email: after.requester_email });
  }
  return after;
}

/**
 * Add a comment. Agents' public comments are emailed to the requester; requester
 * replies reopen pending/resolved tickets and notify the assignee.
 */
export async function addComment(ticketId, { body, is_internal = false, source = 'portal', cc = [] }, author, files = []) {
  const ticket = await one('SELECT * FROM tickets WHERE id = $1', [ticketId]);
  if (!ticket) return null;
  const staff = isStaff(author);
  const internal = staff && Boolean(is_internal) && is_internal !== 'false';
  const text = String(body || '').slice(0, 100_000);
  const now = new Date();

  const comment = await tx(async (db) => {
    const c = (await db.query(
      'INSERT INTO ticket_comments(ticket_id, author_id, body, is_internal, source) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [ticketId, author.id, text, internal, source]
    )).rows[0];
    for (const f of files) await saveAttachment(db, ticketId, c.id, f);

    const sets = { updated_at: now };
    if (staff && !internal && !ticket.first_response_at && author.id !== ticket.requester_id) {
      sets.first_response_at = now;
      if (ticket.response_due && now > ticket.response_due) sets.response_breached = true;
    }
    if (staff && !internal && ticket.status === 'new') sets.status = 'open';
    const cols = Object.keys(sets);
    await db.query(`UPDATE tickets SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
      [ticketId, ...cols.map((k) => sets[k])]);
    if (sets.status) await logChange(db, ticketId, author.id, 'status', ticket.status, sets.status);
    return c;
  });

  // Requester reply on a pending/resolved ticket reopens it (handles SLA un-pausing)
  const requesterReplied = !staff || author.id === ticket.requester_id;
  if (requesterReplied && ['pending', 'resolved'].includes(ticket.status)) {
    await updateTicket(ticketId, { status: 'open' }, { ...author, role: 'agent' });
  }

  const after = await getTicket(ticketId);
  if (staff && !internal && author.id !== ticket.requester_id && !isNoReply(after.requester_email)) {
    mail.sendAgentReply(after, { name: after.requester_name, email: after.requester_email }, author, text, cc);
  }
  if (requesterReplied && after.assignee_email && after.assignee_id !== author.id) {
    mail.sendRequesterUpdate(after, { email: after.assignee_email }, { name: author.name }, text);
  }
  return comment;
}

export async function getTicketDetail(id, user) {
  const ticket = await getTicket(id);
  if (!ticket) return null;
  if (!isStaff(user) && ticket.requester_id !== user.id) return 'forbidden';
  const staff = isStaff(user);
  const [comments, attachments, history, children] = await Promise.all([
    many(`SELECT c.*, u.name AS author_name, u.role AS author_role FROM ticket_comments c
          LEFT JOIN users u ON u.id = c.author_id
          WHERE c.ticket_id = $1 ${staff ? '' : 'AND NOT c.is_internal'} ORDER BY c.created_at`, [id]),
    many(`SELECT a.id, a.comment_id, a.filename, a.mime_type, a.size_bytes, a.created_at FROM attachments a
          LEFT JOIN ticket_comments c ON c.id = a.comment_id
          WHERE a.ticket_id = $1 ${staff ? '' : 'AND (c.id IS NULL OR NOT c.is_internal)'} ORDER BY a.created_at`, [id]),
    staff ? many(`SELECT h.*, u.name AS actor_name FROM ticket_history h LEFT JOIN users u ON u.id = h.actor_id
                  WHERE h.ticket_id = $1 ORDER BY h.created_at`, [id]) : [],
    staff ? many('SELECT id, subject, status, priority FROM tickets WHERE parent_id = $1 ORDER BY id', [id]) : [],
  ]);
  return { ticket, comments, attachments, history, children };
}

export async function decideChange(id, decision, actor) {
  if (!['approved', 'rejected'].includes(decision)) throw Object.assign(new Error('Decision must be approved or rejected'), { status: 400 });
  const t = await one('SELECT * FROM tickets WHERE id = $1', [id]);
  if (!t) return null;
  if (t.type !== 'change') throw Object.assign(new Error('Only change tickets need approval'), { status: 400 });
  await tx(async (db) => {
    await db.query('UPDATE tickets SET approval_status = $2, approved_by = $3, approved_at = now(), updated_at = now() WHERE id = $1',
      [id, decision, actor.id]);
    await logChange(db, id, actor.id, 'approval_status', t.approval_status, decision);
  });
  return getTicket(id);
}

export { pool };
