import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ErrorBox, useLoad } from '../components/bits.jsx';

function RequesterPicker({ value, onChange }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState([]);
  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    const t = setTimeout(() => api(`/admin/users${qs({ q })}`).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [q]);
  if (value) {
    return (
      <div className="row"><strong>{value.name}</strong><span className="muted">{value.email}</span>
        <button type="button" className="linkish small" onClick={() => onChange(null)}>Change</button></div>
    );
  }
  return (
    <div>
      <input placeholder="Search by name or email — leave empty to log it for yourself" value={q} onChange={(e) => setQ(e.target.value)} />
      {results.length > 0 && (
        <div className="panel" style={{ marginTop: 4 }}>
          {results.slice(0, 8).map((u) => (
            <button type="button" key={u.id} className="linkish" style={{ display: 'block', padding: '6px 10px', textAlign: 'left', width: '100%' }} onClick={() => { onChange(u); setQ(''); }}>
              {u.name} <span className="muted small">{u.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NewTicket() {
  const { isStaff } = useAuth();
  const nav = useNavigate();
  const lookups = useLoad(() => api('/lookups'), []);
  const L = lookups.data || { categories: [], groups: [], agents: [], assets: [] };
  const [f, setF] = useState({ type: 'incident', priority: 'medium', subject: '', description: '' });
  const [requester, setRequester] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef();
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Suggest knowledge base articles as the subject is typed
  useEffect(() => {
    if (f.subject.trim().length < 4) { setSuggestions([]); return; }
    const t = setTimeout(() => api(`/kb${qs({ q: f.subject.trim().split(/\s+/).slice(0, 3).join(' ') })}`)
      .then((a) => setSuggestions(a.filter((x) => x.published).slice(0, 4))).catch(() => {}), 400);
    return () => clearTimeout(t);
  }, [f.subject]);

  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const form = new FormData();
      for (const [k, v] of Object.entries(f)) if (v) form.append(k, v);
      if (requester) form.append('requester_id', requester.id);
      for (const file of fileRef.current.files) form.append('files', file);
      const t = await api('/tickets', { method: 'POST', form });
      nav(`/tickets/${t.id}`);
    } catch (err) { setError(err.message); setBusy(false); }
  }

  return (
    <>
      <div className="page-head"><div><h1>{isStaff ? 'New ticket' : 'Report an issue'}</h1>
        <p>{isStaff ? 'Log a ticket on behalf of someone, or for yourself.' : 'Tell IT what\u2019s wrong. You can also email the support address.'}</p></div></div>
      <form className="panel" onSubmit={submit}>
        <div className="panel-body form-grid">
          {error && <div className="wide"><ErrorBox error={error} /></div>}
          {isStaff && <label className="field wide">Requester<RequesterPicker value={requester} onChange={setRequester} /></label>}
          <label className="field wide">Subject
            <input required value={f.subject} onChange={set('subject')} placeholder="For example: Laptop won't connect to VPN" maxLength={300} />
          </label>
          {suggestions.length > 0 && (
            <div className="suggest wide">These articles might solve it right away:
              <ul>{suggestions.map((s) => <li key={s.id}><Link to={`/kb/${s.id}`} target="_blank">{s.title}</Link></li>)}</ul>
            </div>
          )}
          <label className="field wide">Description
            <textarea rows={6} value={f.description} onChange={set('description')} placeholder="What happened, when it started, and any error messages" />
          </label>
          <label className="field">Type
            <select value={f.type} onChange={set('type')}>
              <option value="incident">Something is broken</option>
              <option value="request">I need something</option>
              {isStaff && <option value="problem">Problem (root cause)</option>}
              {isStaff && <option value="change">Change</option>}
            </select>
          </label>
          <label className="field">{isStaff ? 'Priority' : 'How urgent is it?'}
            <select value={f.priority} onChange={set('priority')}>
              {isStaff && <option value="critical">Critical</option>}
              <option value="high">{isStaff ? 'High' : 'High — I can\u2019t work'}</option>
              <option value="medium">{isStaff ? 'Medium' : 'Medium — slowing me down'}</option>
              <option value="low">{isStaff ? 'Low' : 'Low — whenever possible'}</option>
            </select>
          </label>
          <label className="field">Category
            <select value={f.category_id || ''} onChange={set('category_id')}>
              <option value="">{isStaff ? 'Detect automatically' : 'Not sure'}</option>
              {L.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {L.assets.length > 0 && (
            <label className="field">{isStaff ? 'Asset' : 'Which device?'}
              <select value={f.asset_id || ''} onChange={set('asset_id')}>
                <option value="">None</option>{L.assets.map((a) => <option key={a.id} value={a.id}>{a.tag} — {a.name}</option>)}
              </select>
            </label>
          )}
          {isStaff && (
            <>
              <label className="field">Group
                <select value={f.group_id || ''} onChange={set('group_id')}>
                  <option value="">From category</option>{L.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
              </label>
              <label className="field">Assignee
                <select value={f.assignee_id || ''} onChange={set('assignee_id')}>
                  <option value="">Nobody yet</option>{L.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            </>
          )}
          <label className="field wide">Attachments (screenshots help)
            <input ref={fileRef} type="file" multiple />
          </label>
          <div className="row end wide">
            <Link className="btn" to="/tickets">Cancel</Link>
            <button className="btn primary" disabled={busy}>{isStaff ? 'Create ticket' : 'Submit'}</button>
          </div>
        </div>
      </form>
    </>
  );
}
