import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBox, useLoad } from '../components/bits.jsx';
import { cap, fmtDate } from '../util.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function Users() {
  const users = useLoad(() => api('/admin/users'), []);
  const groups = useLoad(() => api('/admin/groups'), []);
  const [edit, setEdit] = useState(null);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState('staff');

  async function save(e) {
    e.preventDefault(); setError(null);
    const body = { name: edit.name, email: edit.email, role: edit.role, department: edit.department || null, group_ids: edit.group_ids || [] };
    if (edit.password) body.password = edit.password;
    if (edit.id) body.active = edit.active;
    try {
      await api(edit.id ? `/admin/users/${edit.id}` : '/admin/users', { method: edit.id ? 'PATCH' : 'POST', body });
      setEdit(null); users.reload(); groups.reload();
    } catch (err) { setError(err.message); }
  }
  const rows = (users.data || []).filter((u) => filter === 'all' || (filter === 'staff' ? u.role !== 'requester' : u.role === 'requester'));

  return (
    <>
      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Show">
          <option value="staff">IT staff</option><option value="requester">Employees</option><option value="all">Everyone</option>
        </select>
        <span style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => setEdit({ role: 'agent', group_ids: [], active: true })}>Add person</button>
      </div>
      {edit && (
        <form className="panel" onSubmit={save} style={{ marginBottom: 14 }}>
          <div className="panel-head"><h2>{edit.id ? edit.name : 'Add person'}</h2><button type="button" className="linkish" onClick={() => setEdit(null)}>Close</button></div>
          <div className="panel-body form-grid">
            {error && <div className="wide"><ErrorBox error={error} /></div>}
            <label className="field">Name<input required value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></label>
            <label className="field">Email<input required type="email" disabled={!!edit.id} value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></label>
            <label className="field">Role
              <select value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value })}>
                <option value="requester">Employee — opens tickets</option><option value="agent">Agent — works tickets</option><option value="admin">Admin — full access</option>
              </select>
            </label>
            <label className="field">Department<input value={edit.department || ''} onChange={(e) => setEdit({ ...edit, department: e.target.value })} /></label>
            <label className="field">{edit.id ? 'New password (optional)' : 'Password (optional — they can sign in by email link)'}
              <input type="password" autoComplete="new-password" value={edit.password || ''} onChange={(e) => setEdit({ ...edit, password: e.target.value })} />
            </label>
            {edit.id && <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Account active</label>}
            {edit.role !== 'requester' && (
              <div className="wide"><span className="small muted">Groups</span>
                <div className="row">{(groups.data || []).map((g) => (
                  <label key={g.id} className="check"><input type="checkbox" checked={(edit.group_ids || []).includes(g.id)}
                    onChange={(e) => setEdit({ ...edit, group_ids: e.target.checked ? [...(edit.group_ids || []), g.id] : edit.group_ids.filter((x) => x !== g.id) })} /> {g.name}</label>
                ))}</div>
              </div>
            )}
            <div className="row end wide"><button className="btn primary">Save person</button></div>
          </div>
        </form>
      )}
      <div className="panel"><div className="table-wrap"><table>
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Department</th><th>Status</th></tr></thead>
        <tbody>{rows.map((u) => (
          <tr key={u.id} className="clickable" onClick={() => { setError(null); setEdit({ ...u, password: '' }); }}>
            <td className="subject">{u.name}</td><td>{u.email}</td><td>{cap(u.role)}</td><td>{u.department || '—'}</td>
            <td>{u.active ? 'Active' : <span className="muted">Inactive</span>}</td>
          </tr>
        ))}</tbody>
      </table></div></div>
    </>
  );
}

function Groups() {
  const groups = useLoad(() => api('/admin/groups'), []);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const add = async (e) => {
    e.preventDefault(); setError(null);
    try { await api('/admin/groups', { method: 'POST', body: { name } }); setName(''); groups.reload(); } catch (err) { setError(err.message); }
  };
  return (
    <>
      <ErrorBox error={error} />
      <form className="toolbar" onSubmit={add}>
        <input placeholder="New group name, e.g. Network team" value={name} onChange={(e) => setName(e.target.value)} required style={{ maxWidth: 320 }} />
        <button className="btn primary">Add group</button>
      </form>
      <div className="panel"><div className="table-wrap"><table>
        <thead><tr><th>Group</th><th>Members</th><th /></tr></thead>
        <tbody>{(groups.data || []).map((g) => (
          <tr key={g.id}>
            <td className="subject">{g.name}</td>
            <td>{g.members.map((m) => m.name).join(', ') || <span className="muted">No members — add them under People</span>}</td>
            <td style={{ textAlign: 'right' }}><button className="btn small danger" onClick={async () => { if (confirm(`Delete ${g.name}?`)) { await api(`/admin/groups/${g.id}`, { method: 'DELETE' }); groups.reload(); } }}>Delete</button></td>
          </tr>
        ))}</tbody>
      </table></div></div>
    </>
  );
}

function Categories() {
  const cats = useLoad(() => api('/admin/categories'), []);
  const groups = useLoad(() => api('/admin/groups'), []);
  const [draft, setDraft] = useState({ name: '', keywords: '', default_group_id: '' });
  const [error, setError] = useState(null);
  const run = (p) => p.then(() => { setError(null); cats.reload(); }).catch((e) => setError(e.message));
  return (
    <>
      <p className="muted">Incoming emails are sorted into a category when their subject or body contains one of its keywords. The category's group then receives the ticket.</p>
      <ErrorBox error={error} />
      <div className="panel"><div className="table-wrap"><table>
        <thead><tr><th>Category</th><th>Keywords (comma separated)</th><th>Routes to group</th><th /></tr></thead>
        <tbody>
          {(cats.data || []).map((c) => (
            <tr key={c.id}>
              <td><input defaultValue={c.name} onBlur={(e) => e.target.value !== c.name && run(api(`/admin/categories/${c.id}`, { method: 'PATCH', body: { name: e.target.value } }))} /></td>
              <td><input defaultValue={c.keywords.join(', ')} onBlur={(e) => run(api(`/admin/categories/${c.id}`, { method: 'PATCH', body: { keywords: e.target.value } }))} /></td>
              <td><select value={c.default_group_id || ''} onChange={(e) => run(api(`/admin/categories/${c.id}`, { method: 'PATCH', body: { default_group_id: e.target.value } }))}>
                <option value="">None</option>{(groups.data || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></td>
              <td><button className="btn small danger" onClick={() => confirm(`Delete ${c.name}?`) && run(api(`/admin/categories/${c.id}`, { method: 'DELETE' }))}>Delete</button></td>
            </tr>
          ))}
          <tr>
            <td><input placeholder="New category" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></td>
            <td><input placeholder="printer, toner, scan" value={draft.keywords} onChange={(e) => setDraft({ ...draft, keywords: e.target.value })} /></td>
            <td><select value={draft.default_group_id} onChange={(e) => setDraft({ ...draft, default_group_id: e.target.value })}>
              <option value="">None</option>{(groups.data || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></td>
            <td><button className="btn small primary" disabled={!draft.name} onClick={() => run(api('/admin/categories', { method: 'POST', body: draft }).then(() => setDraft({ name: '', keywords: '', default_group_id: '' })))}>Add</button></td>
          </tr>
        </tbody>
      </table></div></div>
    </>
  );
}

function Sla() {
  const { data, reload } = useLoad(() => api('/admin/sla'), []);
  const [rows, setRows] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (data) setRows(data); }, [data]);
  if (!rows) return null;
  const set = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = () => api('/admin/sla', { method: 'PUT', body: rows }).then(() => { setMsg({ ok: 'SLA targets saved. They apply to new tickets and priority changes.' }); reload(); }).catch((e) => setMsg({ err: e.message }));
  return (
    <>
      <p className="muted">Targets count business minutes only (see Business hours). Time spent in Pending doesn't count.</p>
      {msg?.ok && <div className="notice">{msg.ok}</div>}<ErrorBox error={msg?.err} />
      <div className="panel"><div className="table-wrap"><table>
        <thead><tr><th>Priority</th><th>First response (minutes)</th><th>Resolution (minutes)</th></tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.priority}>
            <td><span className={`prio ${r.priority}`}>{r.priority}</span></td>
            <td><input type="number" min="1" value={r.response_minutes} onChange={(e) => set(i, 'response_minutes', e.target.value)} /></td>
            <td><input type="number" min="1" value={r.resolution_minutes} onChange={(e) => set(i, 'resolution_minutes', e.target.value)} /></td>
          </tr>
        ))}</tbody>
      </table></div></div>
      <div className="row end" style={{ marginTop: 12 }}><button className="btn primary" onClick={save}>Save targets</button></div>
    </>
  );
}

function Settings() {
  const { data } = useLoad(() => api('/admin/settings'), []);
  const [s, setS] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => { if (data) setS(data); }, [data]);
  if (!s) return null;
  const bh = s.business_hours;
  const em = s.email;
  const setBh = (p) => setS({ ...s, business_hours: { ...bh, ...p } });
  const setEm = (p) => setS({ ...s, email: { ...em, ...p } });
  const list = (v) => v.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
  const save = () => api('/admin/settings', { method: 'PUT', body: s }).then(() => setMsg({ ok: 'Settings saved.' })).catch((e) => setMsg({ err: e.message }));

  return (
    <div style={{ display: 'grid', gap: 16, maxWidth: 760 }}>
      {msg?.ok && <div className="notice">{msg.ok}</div>}<ErrorBox error={msg?.err} />
      <div className="panel">
        <div className="panel-head"><h2>Business hours</h2></div>
        <div className="panel-body form-grid">
          <div className="wide"><span className="small muted">Working days</span>
            <div className="row">{DAYS.map((d, i) => (
              <label key={d} className="check"><input type="checkbox" checked={bh.workdays.includes(i)}
                onChange={(e) => setBh({ workdays: e.target.checked ? [...bh.workdays, i].sort() : bh.workdays.filter((x) => x !== i) })} /> {d}</label>
            ))}</div>
          </div>
          <label className="field">Opens<input type="time" value={bh.start} onChange={(e) => setBh({ start: e.target.value })} /></label>
          <label className="field">Closes<input type="time" value={bh.end} onChange={(e) => setBh({ end: e.target.value })} /></label>
          <label className="field wide">Holidays (YYYY-MM-DD, comma separated)
            <input value={(bh.holidays || []).join(', ')} onChange={(e) => setBh({ holidays: list(e.target.value) })} placeholder="2026-12-25, 2027-01-01" />
          </label>
          <p className="small muted wide">Times use the server's time zone (the TZ setting in .env). Untick every day to run SLAs around the clock.</p>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Email intake</h2></div>
        <div className="panel-body form-grid">
          <label className="field wide">Only accept email from these domains (empty = anyone)
            <input value={(em.allowed_domains || []).join(', ')} onChange={(e) => setEm({ allowed_domains: list(e.target.value) })} placeholder="yourcompany.com" />
          </label>
          <label className="field">Default priority
            <select value={em.default_priority} onChange={(e) => setEm({ default_priority: e.target.value })}>
              {['critical', 'high', 'medium', 'low'].map((p) => <option key={p} value={p}>{cap(p)}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={em.auto_create_requesters} onChange={(e) => setEm({ auto_create_requesters: e.target.checked })} /> Create accounts for new senders</label>
          <label className="check"><input type="checkbox" checked={em.send_acknowledgement} onChange={(e) => setEm({ send_acknowledgement: e.target.checked })} /> Email a ticket number to the sender</label>
        </div>
      </div>
      <div className="panel">
        <div className="panel-head"><h2>Tickets</h2></div>
        <div className="panel-body">
          <label className="field" style={{ maxWidth: 300 }}>Close resolved tickets after (days, 0 = never)
            <input type="number" min="0" value={s.tickets.auto_close_days} onChange={(e) => setS({ ...s, tickets: { ...s.tickets, auto_close_days: Number(e.target.value) } })} />
          </label>
        </div>
      </div>
      <div className="row end"><button className="btn primary" onClick={save}>Save settings</button></div>
    </div>
  );
}

function Email() {
  const { data, error, reload } = useLoad(() => api('/admin/email/status'), []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const poll = async () => {
    setBusy(true); setMsg(null);
    try { const r = await api('/admin/email/poll', { method: 'POST' }); setMsg({ ok: `Checked the mailbox — ${r.fetched} new ${r.fetched === 1 ? 'email' : 'emails'}.` }); reload(); }
    catch (e) { setMsg({ err: e.message }); } finally { setBusy(false); }
  };
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  return (
    <>
      <div className="panel" style={{ marginBottom: 14 }}>
        <div className="panel-body">
          {data.enabled ? (
            <dl className="kv">
              <dt>Mailbox</dt><dd><strong>{data.mailbox}</strong>, checked every {data.pollSeconds} seconds</dd>
              <dt>Last check</dt><dd>{fmtDate(data.lastPollAt)}{data.lastSuccessAt && ` (last success ${fmtDate(data.lastSuccessAt)})`}</dd>
              <dt>Problem</dt><dd style={{ color: data.lastError ? 'var(--bad)' : undefined }}>{data.lastError || 'None'}</dd>
            </dl>
          ) : (
            <p>Email intake is off. Set <code>M365_TENANT_ID</code>, <code>M365_CLIENT_ID</code>, <code>M365_CLIENT_SECRET</code> and <code>M365_MAILBOX</code> in the server's .env file and restart. The README explains the Microsoft 365 setup.</p>
          )}
          {msg?.ok && <div className="notice" style={{ marginTop: 10 }}>{msg.ok}</div>}<ErrorBox error={msg?.err} />
          {data.enabled && <div className="row" style={{ marginTop: 12 }}><button className="btn" disabled={busy} onClick={poll}>Check mailbox now</button></div>}
        </div>
      </div>
      <div className="panel"><div className="panel-head"><h2>Recent email activity</h2></div><div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Direction</th><th>Address</th><th>Subject</th><th>Result</th></tr></thead>
        <tbody>{data.recent.map((e) => (
          <tr key={e.id}>
            <td className="small" style={{ whiteSpace: 'nowrap' }}>{fmtDate(e.created_at)}</td>
            <td>{e.direction === 'in' ? 'Received' : 'Sent'}</td>
            <td className="small">{e.from_address}</td>
            <td>{e.ticket_id ? <Link to={`/tickets/${e.ticket_id}`}>{e.subject}</Link> : e.subject}</td>
            <td className="small" style={{ color: String(e.outcome).startsWith('failed') ? 'var(--bad)' : undefined }}>{e.outcome}</td>
          </tr>
        ))}</tbody>
      </table>{data.recent.length === 0 && <div className="empty">No email activity yet.</div>}</div></div>
    </>
  );
}

const TABS = [['people', 'People', Users], ['groups', 'Groups', Groups], ['categories', 'Categories & routing', Categories],
  ['sla', 'SLA targets', Sla], ['settings', 'Business hours & email', Settings], ['email', 'Mailbox status', Email]];

export default function Admin() {
  const [tab, setTab] = useState('people');
  const Current = TABS.find((t) => t[0] === tab)[2];
  return (
    <>
      <div className="page-head"><div><h1>Administration</h1></div></div>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      <Current />
    </>
  );
}
