// Outbound notifications. Uses Microsoft Graph when configured; otherwise logs to the console.
import { config } from '../config.js';
import { query } from '../db/index.js';
import { sendMail as graphSend } from './graph.js';

export const ticketTag = (id) => `[Ticket #${id}]`;
// Accepts "[Ticket #123]" and the short form "[#123]"
export const TAG_RE = /\[(?:ticket\s*)?#(\d+)\]/i;

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paragraphs = (text = '') => esc(text).replace(/\r?\n/g, '<br>');
const ticketUrl = (id) => `${config.publicUrl}/tickets/${id}`;

function layout(inner, footer) {
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f3f5f8;font-family:Segoe UI,Arial,sans-serif;color:#1d2733">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #dde3ea;border-radius:6px;padding:24px">
  ${inner}
  <p style="margin-top:28px;font-size:12px;color:#6b7785">${footer || 'Reply to this email to add a comment to your ticket. Please keep the ticket number in the subject.'}</p>
  </div></body></html>`;
}

async function deliver({ to, cc, subject, html, ticketId }) {
  if (!to || (Array.isArray(to) && to.length === 0)) return;
  try {
    if (config.graphEnabled) {
      await graphSend({ to, cc, subject, html });
    } else {
      console.log(`[mail:disabled] to=${[].concat(to).join(',')} subject="${subject}"`);
    }
    await query(
      "INSERT INTO email_messages(ticket_id, direction, from_address, subject, outcome) VALUES ($1,'out',$2,$3,'sent')",
      [ticketId || null, config.graph.mailbox || null, subject]
    );
  } catch (err) {
    console.error('[mail] send failed:', err.message);
    await query(
      "INSERT INTO email_messages(ticket_id, direction, from_address, subject, outcome) VALUES ($1,'out',$2,$3,$4)",
      [ticketId || null, config.graph.mailbox || null, subject, `failed: ${err.message.slice(0, 200)}`]
    ).catch(() => {});
  }
}

export function sendAcknowledgement(ticket, requester) {
  return deliver({
    ticketId: ticket.id,
    to: requester.email,
    subject: `${ticketTag(ticket.id)} ${ticket.subject}`,
    html: layout(`
      <p>Hello ${esc(requester.name)},</p>
      <p>We've received your request and logged it as <strong>ticket #${ticket.id}</strong>. Our IT team will get back to you soon.</p>
      <p style="padding:12px;background:#f3f5f8;border-radius:4px"><strong>${esc(ticket.subject)}</strong></p>
      <p><a href="${ticketUrl(ticket.id)}">View your ticket</a></p>`),
  });
}

export function sendAgentReply(ticket, requester, agent, body, cc = []) {
  return deliver({
    ticketId: ticket.id,
    to: requester.email,
    cc,
    subject: `RE: ${ticketTag(ticket.id)} ${ticket.subject}`,
    html: layout(`
      <p>${paragraphs(body)}</p>
      <p style="color:#6b7785">— ${esc(agent.name)}, IT Support</p>
      <p><a href="${ticketUrl(ticket.id)}">View ticket #${ticket.id}</a></p>`),
  });
}

export function sendResolved(ticket, requester) {
  return deliver({
    ticketId: ticket.id,
    to: requester.email,
    subject: `${ticketTag(ticket.id)} Resolved: ${ticket.subject}`,
    html: layout(`
      <p>Hello ${esc(requester.name)},</p>
      <p>Your ticket <strong>#${ticket.id}</strong> has been marked as resolved.</p>
      <p>If the problem isn't fixed, just reply to this email and the ticket will reopen.</p>
      <p><a href="${ticketUrl(ticket.id)}">View ticket #${ticket.id}</a></p>`),
  });
}

export function sendAssigned(ticket, agent) {
  return deliver({
    ticketId: ticket.id,
    to: agent.email,
    subject: `Assigned to you: ${ticketTag(ticket.id)} ${ticket.subject}`,
    html: layout(`
      <p>Ticket <strong>#${ticket.id}</strong> (${esc(ticket.priority)} priority) has been assigned to you.</p>
      <p style="padding:12px;background:#f3f5f8;border-radius:4px"><strong>${esc(ticket.subject)}</strong><br>${paragraphs((ticket.description || '').slice(0, 600))}</p>
      <p><a href="${ticketUrl(ticket.id)}">Open ticket</a></p>`, 'This is an automatic notification from ServiceDesk.'),
  });
}

export function sendBreachWarning(ticket, agentEmail, kind) {
  return deliver({
    ticketId: ticket.id,
    to: agentEmail,
    subject: `SLA breached (${kind}): ${ticketTag(ticket.id)} ${ticket.subject}`,
    html: layout(`
      <p>The <strong>${kind}</strong> target for ticket <strong>#${ticket.id}</strong> has passed.</p>
      <p><a href="${ticketUrl(ticket.id)}">Open ticket</a></p>`, 'This is an automatic notification from ServiceDesk.'),
  });
}

export function sendMagicLink(user, link) {
  return deliver({
    to: user.email,
    subject: 'Your ServiceDesk sign-in link',
    html: layout(`
      <p>Hello ${esc(user.name)},</p>
      <p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#1f5f8b;color:#fff;border-radius:4px;text-decoration:none">Sign in to ServiceDesk</a></p>
      <p>This link works once and expires in 15 minutes. If you didn't ask for it, ignore this email.</p>`,
      'This is an automatic message from ServiceDesk.'),
  });
}

export function sendRequesterUpdate(ticket, agent, requester, body) {
  return deliver({
    ticketId: ticket.id,
    to: agent.email,
    subject: `New reply from ${requester.name}: ${ticketTag(ticket.id)} ${ticket.subject}`,
    html: layout(`
      <p><strong>${esc(requester.name)}</strong> replied on ticket <strong>#${ticket.id}</strong>:</p>
      <p style="padding:12px;background:#f3f5f8;border-radius:4px">${paragraphs(body.slice(0, 2000))}</p>
      <p><a href="${ticketUrl(ticket.id)}">Open ticket</a></p>`, 'This is an automatic notification from ServiceDesk.'),
  });
}
