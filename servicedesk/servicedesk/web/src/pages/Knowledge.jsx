import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ErrorBox, useLoad } from '../components/bits.jsx';
import { fmtDate } from '../util.js';

function Editor({ article, categories, onDone }) {
  const [f, setF] = useState(article || { title: '', body: '', published: false });
  const [error, setError] = useState(null);
  async function save(e) {
    e.preventDefault(); setError(null);
    try {
      const body = { title: f.title, body: f.body, category_id: f.category_id || '', published: f.published };
      const saved = await api(article ? `/kb/${article.id}` : '/kb', { method: article ? 'PATCH' : 'POST', body });
      onDone(saved);
    } catch (err) { setError(err.message); }
  }
  return (
    <form className="panel" onSubmit={save}>
      <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
        <ErrorBox error={error} />
        <label className="field">Title<input required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="How to reset your VPN connection" /></label>
        <label className="field">Category
          <select value={f.category_id || ''} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            <option value="">None</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="field">Content<textarea rows={14} required value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Write the steps in plain language. Users see this before opening a ticket." /></label>
        <div className="row end">
          <label className="check"><input type="checkbox" checked={f.published} onChange={(e) => setF({ ...f, published: e.target.checked })} /> Visible to all employees</label>
          <button type="button" className="btn" onClick={() => onDone(null)}>Cancel</button>
          <button className="btn primary">Save article</button>
        </div>
      </div>
    </form>
  );
}

function Article({ id }) {
  const { isStaff } = useAuth();
  const nav = useNavigate();
  const [editing, setEditing] = useState(false);
  const { data, error, reload } = useLoad(() => api(`/kb/${id}`), [id]);
  const cats = useLoad(() => api('/lookups'), []);
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  if (editing) return <Editor article={data} categories={cats.data?.categories || []} onDone={() => { setEditing(false); reload(); }} />;
  return (
    <>
      <p className="small"><Link to="/kb">Back to knowledge base</Link></p>
      <div className="page-head">
        <div><h1>{data.title}</h1><p>Updated {fmtDate(data.updated_at, false)}{!data.published && ' — draft, only IT staff can see it'}</p></div>
        {isStaff && (
          <div className="row">
            <button className="btn" onClick={() => setEditing(true)}>Edit article</button>
            <button className="btn danger" onClick={async () => { if (confirm('Delete this article?')) { await api(`/kb/${id}`, { method: 'DELETE' }); nav('/kb'); } }}>Delete</button>
          </div>
        )}
      </div>
      <div className="panel"><div className="panel-body article">{data.body}</div></div>
      {!isStaff && <p style={{ marginTop: 14 }}>Didn't help? <Link to="/tickets/new">Report an issue</Link></p>}
    </>
  );
}

export default function Knowledge() {
  const { id } = useParams();
  const { isStaff } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const list = useLoad(() => (id ? Promise.resolve([]) : api(`/kb${qs({ q })}`)), [q, id]);
  const cats = useLoad(() => api('/lookups'), []);

  if (id) return <Article id={id} />;
  if (creating) return <Editor categories={cats.data?.categories || []} onDone={(a) => { setCreating(false); if (a) nav(`/kb/${a.id}`); }} />;

  return (
    <>
      <div className="page-head">
        <div><h1>Knowledge base</h1><p>Answers to common IT questions</p></div>
        {isStaff && <button className="btn primary" onClick={() => setCreating(true)}>Write an article</button>}
      </div>
      <div className="toolbar"><input type="search" placeholder="Search articles" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search articles" /></div>
      <ErrorBox error={list.error} />
      <div className="panel">
        {(list.data || []).map((a) => (
          <Link key={a.id} to={`/kb/${a.id}`} style={{ display: 'block', padding: '12px 16px', borderBottom: '1px solid var(--line-2)', color: 'inherit' }}>
            <div className="subject">{a.title}{!a.published && <span className="muted small"> — draft</span>}</div>
            <div className="small muted">{a.category_name || 'General'}, {a.views} views</div>
          </Link>
        ))}
        {list.data?.length === 0 && <div className="empty">{q ? 'No articles match your search.' : isStaff ? 'No articles yet. Write the first one for your most common question.' : 'No articles yet.'}</div>}
      </div>
    </>
  );
}
