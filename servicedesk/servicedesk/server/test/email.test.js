// Integration test for email intake. Needs a PostgreSQL database in DATABASE_URL.
process.env.NODE_ENV = 'test';
process.env.M365_MAILBOX = 'support@corp.com';
import test from 'node:test';
import assert from 'node:assert/strict';

const { migrate } = await import('../src/db/migrate.js');
const { pool, one } = await import('../src/db/index.js');
const ingest = await import('../src/services/emailIngest.js');

const mock = {
  moved: [], read: [],
  async listUnreadMessages() { return this.queue.splice(0); },
  async getFileAttachments() {
    return [
      { '@odata.type': '#microsoft.graph.fileAttachment', name: 'screenshot.png', contentType: 'image/png', isInline: false, contentBytes: Buffer.from('png').toString('base64') },
      { '@odata.type': '#microsoft.graph.fileAttachment', name: 'logo.png', contentType: 'image/png', isInline: true, contentBytes: 'AA==' },
    ];
  },
  async markRead(id) { this.read.push(id); },
  async moveToFolder(id) { this.moved.push(id); },
  queue: [],
};

const uid = Date.now();
const msg = (o) => ({
  id: `m-${Math.random()}`, internetMessageId: `<${Math.random()}@mail>`, conversationId: null,
  from: { emailAddress: { address: `printer.user.${uid}@corp.com`, name: 'Printer User' } },
  subject: 'Printer on 3rd floor is jammed', importance: 'normal', hasAttachments: false,
  body: { content: 'It keeps jamming.' }, uniqueBody: null, internetMessageHeaders: [], ...o,
});

test.before(async () => { await migrate(); });
test.after(async () => { await pool.end(); });

test('pure helpers', () => {
  assert.equal(ingest.cleanSubject('RE: FW: [Ticket #12] Laptop broken'), 'Laptop broken');
  assert.equal(ingest.ticketIdFromSubject('Re: [Ticket #42] x'), 42);
  assert.equal(ingest.ticketIdFromSubject('Re: [#7] x'), 7);
  assert.equal(ingest.autoReplyReason({ subject: 'Automatic reply: hi' }, {}), 'auto-reply subject');
  assert.equal(ingest.autoReplyReason({ subject: 'x' }, { 'auto-submitted': 'auto-replied' }), 'auto-submitted');
  assert.equal(ingest.autoReplyReason({ subject: 'x' }, { 'auto-submitted': 'no' }), null);
  assert.equal(ingest.domainAllowed('a@corp.com', ['corp.com']), true);
  assert.equal(ingest.domainAllowed('a@gmail.com', ['corp.com']), false);
});

test('new email creates a ticket with requester, category and attachment', async () => {
  const m = msg({ hasAttachments: true, conversationId: `conv-${uid}`, importance: 'high' });
  mock.queue.push(m);
  await ingest.pollMailbox(mock);
  const t = await one('SELECT t.*, u.email FROM tickets t JOIN users u ON u.id = t.requester_id WHERE t.conversation_id = $1', [`conv-${uid}`]);
  assert.ok(t, 'ticket created');
  assert.equal(t.source, 'email');
  assert.equal(t.priority, 'high');
  assert.equal(t.email, `printer.user.${uid}@corp.com`);
  const cat = await one('SELECT name FROM categories WHERE id = $1', [t.category_id]);
  assert.equal(cat.name, 'Hardware');
  const files = await one('SELECT count(*)::int AS n FROM attachments WHERE ticket_id = $1', [t.id]);
  assert.equal(files.n, 1, 'inline image skipped');
  assert.ok(mock.read.includes(m.id) && mock.moved.includes(m.id));
});

test('reply with ticket tag is appended, not a new ticket', async () => {
  const t = await one('SELECT id FROM tickets WHERE conversation_id = $1', [`conv-${uid}`]);
  const before = await one('SELECT count(*)::int AS n FROM tickets');
  const out = await ingest.processMessage(msg({ subject: `RE: [Ticket #${t.id}] Printer`, uniqueBody: { content: 'Still jammed' }, body: { content: 'Still jammed\n\n> quoted' } }), mock);
  assert.equal(out, `appended:${t.id}`);
  const after = await one('SELECT count(*)::int AS n FROM tickets');
  assert.equal(after.n, before.n);
  const c = await one('SELECT body FROM ticket_comments WHERE ticket_id = $1 ORDER BY id DESC LIMIT 1', [t.id]);
  assert.equal(c.body, 'Still jammed');
});

test('reply in the same Outlook conversation threads without a tag', async () => {
  const t = await one('SELECT id FROM tickets WHERE conversation_id = $1', [`conv-${uid}`]);
  const out = await ingest.processMessage(msg({ subject: 'RE: Printer on 3rd floor is jammed', conversationId: `conv-${uid}` }), mock);
  assert.equal(out, `appended:${t.id}`);
});

test('out-of-office replies and duplicates are skipped', async () => {
  const ooo = msg({ subject: 'Automatic reply: [Ticket #1] x' });
  assert.equal(await ingest.processMessage(ooo, mock), 'skipped:auto-reply subject');
  assert.equal(await ingest.processMessage(ooo, mock), 'skipped:duplicate');
  assert.equal(await ingest.processMessage(msg({ from: { emailAddress: { address: 'support@corp.com' } } }), mock), 'skipped:own mailbox');
});
