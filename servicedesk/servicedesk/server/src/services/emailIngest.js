// Turns emails in the Microsoft 365 support mailbox into tickets and ticket replies.
import { config } from '../config.js';
import { one, query } from '../db/index.js';
import * as graphApi from './graph.js';
import { getSetting } from './settings.js';
import { TAG_RE } from './mailer.js';
import { createTicket, addComment, isNoReply } from './tickets.js';

export const status = { lastPollAt: null, lastSuccessAt: null, lastError: null, processed: 0 };
const failures = new Map(); // messageId -> attempts

// ---------- pure helpers (unit tested) ----------

export function headerMap(msg) {
  const map = {};
  for (const h of msg.internetMessageHeaders || []) map[h.name.toLowerCase()] = h.value;
  return map;
}

/** Detects out-of-office replies, bounces and other automated mail that must not create tickets. */
export function autoReplyReason(msg, headers) {
  const auto = headers['auto-submitted'];
  if (auto && auto.toLowerCase() !== 'no') return 'auto-submitted';
  if (headers['x-autoreply'] || headers['x-autorespond']) return 'auto-reply header';
  const precedence = (headers.precedence || '').toLowerCase();
  if (['bulk', 'junk', 'list', 'auto_reply'].includes(precedence)) return `precedence ${precedence}`;
  if (headers['list-id'] || headers['list-unsubscribe']) return 'mailing list';
  const subject = (msg.subject || '').toLowerCase();
  if (/^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|undeliverable|delivery status notification|mail delivery failed)/.test(subject)) {
    return 'auto-reply subject';
  }
  const from = (msg.from?.emailAddress?.address || '').toLowerCase();
  if (/^(mailer-daemon|postmaster)@/.test(from)) return 'bounce';
  return null;
}

export function cleanSubject(subject = '') {
  let s = subject.replace(TAG_RE, ' ');
  // Strip any number of RE:/FW:/AW:/RV: prefixes
  for (let i = 0; i < 5; i++) s = s.replace(/^\s*(re|fw|fwd|aw|wg|rv|sv|tr)\s*(\[\d+\])?\s*:\s*/i, '');
  return s.replace(/\s+/g, ' ').trim() || '(no subject)';
}

export function ticketIdFromSubject(subject = '') {
  const m = subject.match(TAG_RE);
  return m ? Number(m[1]) : null;
}

export function referencedMessageIds(headers) {
  const raw = `${headers['in-reply-to'] || ''} ${headers.references || ''}`;
  return [...new Set(raw.match(/<[^>]+>/g) || [])];
}

export function domainAllowed(email, allowed) {
  if (!allowed || allowed.length === 0) return true;
  const domain = email.split('@')[1]?.toLowerCase();
  return allowed.some((d) => domain === d.toLowerCase().replace(/^@/, ''));
}

// ---------- threading & requester lookup ----------

async function findTicketForMessage(msg, headers) {
  const tagged = ticketIdFromSubject(msg.subject);
  if (tagged) {
    const t = await one('SELECT id, status FROM tickets WHERE id = $1', [tagged]);
    if (t) return t;
  }
  const refs = referencedMessageIds(headers);
  if (refs.length) {
    const t = await one(
      `SELECT t.id, t.status FROM email_messages e JOIN tickets t ON t.id = e.ticket_id
       WHERE e.internet_message_id = ANY($1) ORDER BY e.id DESC LIMIT 1`, [refs]);
    if (t) return t;
  }
  if (msg.conversationId) {
    const t = await one('SELECT id, status FROM tickets WHERE conversation_id = $1 ORDER BY id DESC LIMIT 1', [msg.conversationId]);
    if (t) return t;
  }
  return null;
}

async function findOrCreateUser(address, name, settings) {
  const email = address.toLowerCase();
  const existing = await one('SELECT * FROM users WHERE email = $1', [email]);
  if (existing) return existing.active ? existing : null;
  if (!settings.auto_create_requesters) return null;
  return one(
    `INSERT INTO users(email, name, role) VALUES ($1, $2, 'requester')
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING *`,
    [email, (name || email.split('@')[0]).slice(0, 120)]
  );
}

// ---------- main processing ----------

/**
 * Process one Graph message. Returns an outcome string.
 * `api` is injectable for tests; it defaults to the real Graph client.
 */
export async function processMessage(msg, api = graphApi) {
  const headers = headerMap(msg);
  const fromAddr = (msg.from?.emailAddress?.address || msg.sender?.emailAddress?.address || '').toLowerCase();
  const fromName = msg.from?.emailAddress?.name || '';
  const settings = await getSetting('email');
  const record = (ticketId, outcome) =>
    query(
      `INSERT INTO email_messages(internet_message_id, ticket_id, direction, from_address, subject, outcome)
       VALUES ($1,$2,'in',$3,$4,$5) ON CONFLICT (internet_message_id) DO NOTHING`,
      [msg.internetMessageId || null, ticketId, fromAddr, (msg.subject || '').slice(0, 300), outcome]
    );

  if (msg.internetMessageId) {
    const dup = await one('SELECT id FROM email_messages WHERE internet_message_id = $1', [msg.internetMessageId]);
    if (dup) return 'skipped:duplicate';
  }
  if (!fromAddr) { await record(null, 'skipped:no sender'); return 'skipped:no sender'; }
  if (fromAddr === config.graph.mailbox) { await record(null, 'skipped:own mailbox'); return 'skipped:own mailbox'; }

  const auto = autoReplyReason(msg, headers);
  if (auto) { await record(null, `skipped:${auto}`); return `skipped:${auto}`; }
  if (!domainAllowed(fromAddr, settings.allowed_domains)) { await record(null, 'skipped:domain not allowed'); return 'skipped:domain not allowed'; }

  const user = await findOrCreateUser(fromAddr, fromName, settings);
  if (!user) { await record(null, 'skipped:unknown or inactive sender'); return 'skipped:unknown or inactive sender'; }

  // Attachments (inline images such as signatures are ignored)
  const files = [];
  if (msg.hasAttachments) {
    const maxBytes = config.maxAttachmentMb * 1024 * 1024;
    for (const a of await api.getFileAttachments(msg.id)) {
      if (a.isInline || !a.contentBytes) continue;
      const buffer = Buffer.from(a.contentBytes, 'base64');
      if (buffer.length > maxBytes) continue;
      files.push({ filename: a.name, mimeType: a.contentType, buffer });
    }
  }

  const fullBody = (msg.body?.content || '').trim();
  const newPart = (msg.uniqueBody?.content || '').trim() || fullBody;
  const existing = await findTicketForMessage(msg, headers);

  if (existing && existing.status !== 'closed') {
    await addComment(existing.id, { body: newPart || '(empty email)', source: 'email' }, user, files);
    await record(existing.id, 'appended');
    return `appended:${existing.id}`;
  }

  const priority = msg.importance === 'high' ? 'high' : settings.default_priority || 'medium';
  const description = existing
    ? `Follow-up to closed ticket #${existing.id}\n\n${fullBody}`
    : fullBody;
  const ticket = await createTicket(
    {
      subject: cleanSubject(msg.subject),
      description,
      priority,
      requester_id: user.id,
      source: 'email',
      conversation_id: msg.conversationId || null,
    },
    user,
    { files, notify: !isNoReply(fromAddr) }
  );
  await record(ticket.id, 'created');
  return `created:${ticket.id}`;
}

export async function pollMailbox(api = graphApi) {
  status.lastPollAt = new Date();
  const messages = await api.listUnreadMessages(25);
  for (const msg of messages) {
    try {
      const outcome = await processMessage(msg, api);
      await api.markRead(msg.id);
      await api.moveToFolder(msg.id, config.graph.processedFolder).catch((e) =>
        console.warn('[email] could not move message:', e.message));
      failures.delete(msg.id);
      status.processed++;
      console.log(`[email] ${msg.internetMessageId || msg.id} -> ${outcome}`);
    } catch (err) {
      const n = (failures.get(msg.id) || 0) + 1;
      failures.set(msg.id, n);
      console.error(`[email] failed to process message (attempt ${n}):`, err);
      if (n >= 3) {
        // Give up so one bad email doesn't block the queue; it stays in the Inbox, marked read.
        await api.markRead(msg.id).catch(() => {});
        await query(
          "INSERT INTO email_messages(internet_message_id, direction, from_address, subject, outcome) VALUES ($1,'in',$2,$3,$4) ON CONFLICT DO NOTHING",
          [msg.internetMessageId || null, msg.from?.emailAddress?.address || null, msg.subject || '', `failed: ${String(err.message).slice(0, 200)}`]
        ).catch(() => {});
        failures.delete(msg.id);
      }
    }
  }
  status.lastSuccessAt = new Date();
  status.lastError = null;
  return messages.length;
}

export function startEmailPolling() {
  if (!config.graphEnabled) {
    console.log('[email] Microsoft 365 not configured — email intake disabled.');
    return;
  }
  console.log(`[email] Polling ${config.graph.mailbox} every ${config.graph.pollSeconds}s`);
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await pollMailbox(); }
    catch (err) { status.lastError = err.message; console.error('[email] poll failed:', err.message); }
    finally { running = false; }
  };
  tick();
  setInterval(tick, config.graph.pollSeconds * 1000);
}
