// Minimal Microsoft Graph client using the OAuth2 client-credentials flow.
// Requires an Entra app with application permissions Mail.ReadWrite and Mail.Send,
// restricted to the support mailbox (see README → "Restrict the app to one mailbox").
import { config } from '../config.js';

const GRAPH = 'https://graph.microsoft.com/v1.0';
let token = null; // { value, expiresAt }
const folderIds = new Map();

async function getToken() {
  if (token && Date.now() < token.expiresAt - 60_000) return token.value;
  const { tenantId, clientId, clientSecret } = config.graph;
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Graph token request failed: ${data.error_description || res.status}`);
  token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return token.value;
}

export async function graph(path, { method = 'GET', body, headers = {} } = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(path.startsWith('http') ? path : GRAPH + path, {
      method,
      headers: {
        Authorization: `Bearer ${await getToken()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429 || res.status === 503 || res.status === 504) {
      const wait = Number(res.headers.get('retry-after') || 2 ** attempt * 2);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (res.status === 401 && attempt === 0) { token = null; continue; }
    if (res.status === 202 || res.status === 204) return null;
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.error?.message || res.statusText;
      throw new Error(`Graph ${method} ${path} failed (${res.status}): ${msg}`);
    }
    return data;
  }
  throw new Error(`Graph ${method} ${path} kept being throttled`);
}

const mb = () => `/users/${encodeURIComponent(config.graph.mailbox)}`;

/** Unread messages in the Inbox, oldest first. Bodies are returned as plain text. */
export async function listUnreadMessages(limit = 25) {
  const select = [
    'id', 'subject', 'from', 'sender', 'toRecipients', 'ccRecipients', 'receivedDateTime',
    'internetMessageId', 'conversationId', 'hasAttachments', 'importance',
    'body', 'uniqueBody', 'internetMessageHeaders',
  ].join(',');
  const data = await graph(
    `${mb()}/mailFolders/inbox/messages?$filter=isRead eq false&$top=${limit}&$select=${select}`,
    { headers: { Prefer: 'outlook.body-content-type="text"' } }
  );
  return (data?.value || []).sort((a, b) => new Date(a.receivedDateTime) - new Date(b.receivedDateTime));
}

export async function getFileAttachments(messageId) {
  const data = await graph(`${mb()}/messages/${messageId}/attachments`);
  return (data?.value || []).filter((a) => a['@odata.type'] === '#microsoft.graph.fileAttachment');
}

export async function markRead(messageId) {
  await graph(`${mb()}/messages/${messageId}`, { method: 'PATCH', body: { isRead: true } });
}

async function folderId(name) {
  if (folderIds.has(name)) return folderIds.get(name);
  const safe = name.replace(/'/g, "''");
  const found = await graph(`${mb()}/mailFolders?$filter=displayName eq '${encodeURIComponent(safe)}'`);
  let id = found?.value?.[0]?.id;
  if (!id) id = (await graph(`${mb()}/mailFolders`, { method: 'POST', body: { displayName: name } })).id;
  folderIds.set(name, id);
  return id;
}

export async function moveToFolder(messageId, name) {
  await graph(`${mb()}/messages/${messageId}/move`, { method: 'POST', body: { destinationId: await folderId(name) } });
}

/**
 * Send an email from the support mailbox.
 * @param {{to: string|string[], cc?: string[], subject: string, html: string,
 *          attachments?: {name: string, contentType: string, contentBytes: string}[]}} msg
 */
export async function sendMail({ to, cc = [], subject, html, attachments = [] }) {
  const rcpt = (list) => [].concat(list).filter(Boolean).map((address) => ({ emailAddress: { address } }));
  await graph(`${mb()}/sendMail`, {
    method: 'POST',
    body: {
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: rcpt(to),
        ccRecipients: rcpt(cc),
        attachments: attachments.map((a) => ({ '@odata.type': '#microsoft.graph.fileAttachment', ...a })),
        // Asks well-behaved mail servers not to send out-of-office replies back to us
        internetMessageHeaders: [{ name: 'X-Auto-Response-Suppress', value: 'All' }],
      },
      saveToSentItems: true,
    },
  });
}
