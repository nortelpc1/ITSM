import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, downloadAttachment } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ErrorBox, Fuse, Prio, Status, useLoad } from '../components/bits.jsx';
import { ago, cap, fileSize, fmtDate } from '../util.js';

const FIELD_LABELS = {
  created: 'created the ticket', status: 'changed status', priority: 'changed priority', assignee_id: 'changed assignee',
  group_id: 'changed group', category_id: 'changed category', type: 'changed type', approval_status: 'set approval',
  sla_breach: 'SLA breached', subject: 'edited the subject', asset_id: 'linked an asset', parent_id: 'linked a problem',
};

function Files({ files }) {
  const [err, setErr] = useState(null);
  if (!files.length) return null;
  return (
    <div className="files">
      {files.map((f) => (
        <button key={f.id} className="file" onClick={() => downloadAttachment(f.id, f.filename).catch((e) => setErr(e.message))}>
          {f.filename} <span className="muted">{fileSize(f.size_bytes)}</span>
        </button>
      ))}
      {err && <span className="small" style={{ color: 'var(--bad)' }}>{err}</span>}
    </div>
  );
}

function Composer({ ticketId, isStaff, onSent }) {
  const [body, setBody] = useState('');
  const [internal, setInternal] = useState(false);
  const [cc, setCc] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [fileCount, setFileCount] = useState(0);
  const fileRef = useRef();

  async function send(statusAfter) {
    setBusy(true); setError(null);
    try {
      const form = new FormData();
      form.append('body', body);
      form.append('is_internal', String(internal));
      if (cc) form.append('cc', cc);
      for (const f of fileRef.current.files) form.append('files', f);
      if (body.trim() || fileRef.current.files.length) await api(`/tickets/${ticketId}/comments`, { method: 'POST', form });
      if (statusAfter) await api(`/tickets/${ticketId}`, { method: 'PATCH', body: { status: statusAfter } });
      setBody(''); setCc(''); fileRef.current.value = ''; setFileCount(0);
      onSent();
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className={`panel composer ${internal ? 'internal-mode' : ''}`}>
      <ErrorBox error={error} />
      <textarea
        aria-label={internal ? 'Internal note' : 'Reply'}
        placeholder={internal ? 'Internal note — only IT staff can see this' : isStaff ? 'Reply to the requester (sent by email)' : 'Add a reply'}
        value={body} onChange={(e) => setBody(e.target.value)}
      />
      <div className="bar">
        {isStaff && <label className="check"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal note</label>}
        {isStaff && !internal && <input style={{ maxWidth: 220, padding: '4px 8px' }} placeholder="CC (optional)" value={cc} onChange={(e) => setCc(e.target.value)} aria-label="CC email addresses" />}
        <input ref={fileRef} type="file" multiple onChange={(e) => setFileCount(e.target.files.length)} style={{ width: 'auto', border: 0, padding: 0 }} aria-label="Attach files" />
        <span style={{ flex: 1 }} />
        {isStaff && !internal && <button className="btn" disabled={busy} onClick={() => send('pending')}>Send and wait for reply</button>}
        {isStaff && !internal && <button className="btn" disabled={busy} onClick={() => send('resolved')}>Send and resolve</button>}
        <button className="btn primary" disabled={busy || (!body.trim() && !fileCount)} onClick={() => send(null)}>
          {internal ? 'Add note' : 'Send reply'}
        </button>
      </div>
    </div>
  );
}

function Select({ label, value, onChange, children }) {
  return (
    <label className="field">{label}
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value)}>{children}</select>
    </label>
  );
}

function ChangePanel({ t, save, isAdmin, reload }) {
  const [error, setError] = useState(null);
  const decide = (decision) => api(`/tickets/${t.id}/approval`, { method: 'POST', body: { decision } }).then(reload).catch((e) => setError(e.message));
  const local = (v) => (v ? new Date(v).toISOString().slice(0, 16) : '');
  return (
    <div className="panel">
      <div className="panel-head"><h3>Change details</h3><span className={`status ${t.approval_status === 'approved' ? 'resolved' : t.approval_status === 'rejected' ? 'closed' : 'pending'}`}>{t.approval_status || 'pending'}</span></div>
      <div className="panel-body props">
        <ErrorBox error={error} />
        <Select label="Risk" value={t.risk} onChange={(v) => save({ risk: v })}>
          <option value="">Not assessed</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
        </Select>
        <label className="field">Planned start<input type="datetime-local" defaultValue={local(t.planned_start)} onBlur={(e) => save({ planned_start: e.target.value ? new Date(e.target.value).toISOString() : '' })} /></label>
        <label className="field">Planned end<input type="datetime-local" defaultValue={local(t.planned_end)} onBlur={(e) => save({ planned_end: e.target.value ? new Date(e.target.value).toISOString() : '' })} /></label>
        <label className="field">Implementation plan<textarea defaultValue={t.implementation_plan || ''} onBlur={(e) => save({ implementation_plan: e.target.value })} /></label>
        <label className="field">Back-out plan<textarea defaultValue={t.backout_plan || ''} onBlur={(e) => save({ backout_plan: e.target.value })} /></label>
        {t.approved_by_name && <p className="small muted">{cap(t.approval_status)} by {t.approved_by_name}, {fmtDate(t.approved_at)}</p>}
        {isAdmin && (
          <div className="row">
            <button className="btn primary small" onClick={() => decide('approved')}>Approve change</button>
            <button className="btn danger small" onClick={() => decide('rejected')}>Reject change</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function TicketDetail() {
  const { id } = useParams();
  const { user, isStaff, isAdmin } = useAuth();
  const { data, error, reload } = useLoad(() => api(`/tickets/${id}`), [id]);
  const lookups = useLoad(() => api('/lookups'), []);
  const [saveError, setSaveError] = useState(null);

  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const { ticket: t, comments, attachments, history, children } = data;
  const L = lookups.data || { groups: [], agents: [], categories: [], assets: [] };
  const filesFor = (commentId) => attachments.filter((a) => a.comment_id === commentId);

  const save = (patch) =>
    api(`/tickets/${t.id}`, { method: 'PATCH', body: patch }).then(() => { setSaveError(null); reload(); }).catch((e) => setSaveError(e.message));

  return (
    <>
      <p className="small"><Link to="/tickets">Back to tickets</Link></p>
      <div className="page-head">
        <div>
          <div className="ticket-title"><span className="id">#{t.id}</span><h1>{t.subject}</h1></div>
          <p>
            <span className="type-tag">{t.type}</span> from <strong>{t.requester_name}</strong> ({t.requester_email})
            {' '}{t.source === 'email' ? 'by email' : t.source === 'agent' ? 'logged by IT' : 'via the portal'}, {fmtDate(t.created_at)}
          </p>
        </div>
        <div className="row">
          <Status s={t.status} /> <Prio p={t.priority} />
          {isStaff && t.assignee_id !== user.id && <button className="btn small" onClick={() => save({ assignee_id: user.id })}>Assign to me</button>}
          {!isStaff && t.status !== 'closed' && <button className="btn small" onClick={() => save({ status: 'closed' })}>Close ticket</button>}
        </div>
      </div>
      <ErrorBox error={saveError} />

      <div className="ticket-layout">
        <section>
          <div className="msg">
            <div className="msg-head"><strong>{t.requester_name}</strong><span className="muted">{fmtDate(t.created_at)}</span></div>
            <div className="msg-body">{t.description || <span className="muted">No description.</span>}</div>
            <Files files={filesFor(null)} />
          </div>
          <div className="thread">
            {comments.map((c) => {
              const staffMsg = c.author_role === 'agent' || c.author_role === 'admin';
              return (
                <article key={c.id} className={`msg ${c.is_internal ? 'internal' : staffMsg ? 'staff' : ''}`}>
                  <div className="msg-head">
                    <span><strong>{c.author_name || 'System'}</strong>{c.is_internal && <span className="muted"> — internal note</span>}{c.source === 'email' && <span className="muted"> — by email</span>}</span>
                    <span className="muted" title={fmtDate(c.created_at)}>{ago(c.created_at)}</span>
                  </div>
                  <div className="msg-body">{c.body}</div>
                  <Files files={filesFor(c.id)} />
                </article>
              );
            })}
          </div>
          {t.status !== 'closed' || isStaff ? <Composer ticketId={t.id} isStaff={isStaff} onSent={reload} /> : (
            <div className="notice" style={{ marginTop: 16 }}>This ticket is closed. <Link to="/tickets/new">Report a new issue</Link> if you still need help.</div>
          )}
        </section>

        <aside className="side">
          <div className="panel">
            <div className="panel-head"><h3>Service level</h3></div>
            <div className="panel-body">
              <Fuse t={t} big />
              <dl className="kv" style={{ marginTop: 12 }}>
                <dt>First reply</dt><dd>{t.first_response_at ? fmtDate(t.first_response_at) : `due ${fmtDate(t.response_due)}`}{t.response_breached && <strong style={{ color: 'var(--bad)' }}> missed</strong>}</dd>
                <dt>Resolution</dt><dd>{t.resolved_at ? fmtDate(t.resolved_at) : `due ${fmtDate(t.resolution_due)}`}{t.resolution_breached && <strong style={{ color: 'var(--bad)' }}> missed</strong>}</dd>
              </dl>
            </div>
          </div>

          {isStaff ? (
            <div className="panel">
              <div className="panel-head"><h3>Details</h3></div>
              <div className="panel-body props">
                <Select label="Status" value={t.status} onChange={(v) => save({ status: v })}>
                  {['new', 'open', 'pending', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}
                </Select>
                <Select label="Priority" value={t.priority} onChange={(v) => save({ priority: v })}>
                  {['critical', 'high', 'medium', 'low'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}
                </Select>
                <Select label="Type" value={t.type} onChange={(v) => save({ type: v })}>
                  {['incident', 'request', 'problem', 'change'].map((s) => <option key={s} value={s}>{cap(s)}</option>)}
                </Select>
                <Select label="Group" value={t.group_id} onChange={(v) => save({ group_id: v })}>
                  <option value="">No group</option>{L.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </Select>
                <Select label="Assignee" value={t.assignee_id} onChange={(v) => save({ assignee_id: v })}>
                  <option value="">Nobody</option>{L.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </Select>
                <Select label="Category" value={t.category_id} onChange={(v) => save({ category_id: v })}>
                  <option value="">None</option>{L.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
                <Select label="Asset" value={t.asset_id} onChange={(v) => save({ asset_id: v })}>
                  <option value="">None</option>{L.assets.map((a) => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
                </Select>
                {t.type !== 'problem' && (
                  <label className="field">Caused by problem #
                    <input type="number" min="1" defaultValue={t.parent_id || ''} onBlur={(e) => save({ parent_id: e.target.value })} placeholder="Problem ticket number" />
                  </label>
                )}
              </div>
            </div>
          ) : (
            <div className="panel">
              <div className="panel-head"><h3>Details</h3></div>
              <div className="panel-body">
                <dl className="kv">
                  <dt>Status</dt><dd><Status s={t.status} /></dd>
                  <dt>Handled by</dt><dd>{t.assignee_name || t.group_name || 'Waiting for IT'}</dd>
                  <dt>Category</dt><dd>{t.category_name || '—'}</dd>
                  <dt>Updated</dt><dd>{ago(t.updated_at)}</dd>
                </dl>
              </div>
            </div>
          )}

          {isStaff && t.type === 'change' && <ChangePanel t={t} save={save} isAdmin={isAdmin} reload={reload} />}

          {isStaff && t.type === 'problem' && (
            <div className="panel">
              <div className="panel-head"><h3>Linked incidents</h3><span className="muted small">{children.length}</span></div>
              <div className="panel-body">
                {children.length === 0 ? <p className="small muted">Link incidents by entering #{t.id} in their "Caused by problem" field.</p> :
                  children.map((c) => <div key={c.id} className="small"><Link to={`/tickets/${c.id}`}>#{c.id} {c.subject}</Link> <Status s={c.status} /></div>)}
              </div>
            </div>
          )}

          {t.parent_id && isStaff && <div className="notice small">Part of problem <Link to={`/tickets/${t.parent_id}`}>#{t.parent_id}</Link></div>}

          {isStaff && (
            <details className="panel">
              <summary className="panel-head" style={{ cursor: 'pointer' }}><h3>History</h3><span className="muted small">{history.length} events</span></summary>
              <div className="panel-body history">
                {history.map((h) => (
                  <div key={h.id}>
                    <strong>{h.actor_name || 'System'}</strong> {FIELD_LABELS[h.field] || `changed ${h.field}`}
                    {h.field === 'status' || h.field === 'priority' || h.field === 'type' || h.field === 'approval_status' || h.field === 'sla_breach'
                      ? <> {h.old_value && <>from {h.old_value} </>}to {h.new_value}</> : null}
                    <div className="muted">{fmtDate(h.created_at)}</div>
                  </div>
                ))}
              </div>
            </details>
          )}
        </aside>
      </div>
    </>
  );
}
