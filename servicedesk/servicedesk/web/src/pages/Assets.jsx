import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ErrorBox, Prio, Status, useLoad } from '../components/bits.jsx';
import { cap, fmtDate } from '../util.js';

const TYPES = ['laptop', 'desktop', 'monitor', 'phone', 'tablet', 'printer', 'server', 'network', 'software', 'other'];
const STATUSES = { in_stock: 'In stock', in_use: 'In use', repair: 'In repair', retired: 'Retired' };

function AssetForm({ asset, users, onSaved, onCancel }) {
  const { isAdmin } = useAuth();
  const [f, setF] = useState(asset || { type: 'laptop', status: 'in_use' });
  const [error, setError] = useState(null);
  const detail = useLoad(() => (asset ? api(`/assets/${asset.id}`) : Promise.resolve(null)), [asset?.id]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save(e) {
    e.preventDefault(); setError(null);
    const body = { ...f };
    for (const k of ['id', 'assigned_name', 'assigned_email', 'open_tickets', 'created_at', 'updated_at']) delete body[k];
    try {
      await api(asset ? `/assets/${asset.id}` : '/assets', { method: asset ? 'PATCH' : 'POST', body });
      onSaved();
    } catch (err) { setError(err.message); }
  }
  async function remove() {
    if (!confirm(`Delete asset ${asset.tag}? Tickets keep their history but lose the link.`)) return;
    await api(`/assets/${asset.id}`, { method: 'DELETE' }).then(onSaved).catch((e) => setError(e.message));
  }
  const field = (k, label, type = 'text') => (
    <label className="field">{label}<input type={type} value={f[k] ?? ''} onChange={set(k)} /></label>
  );

  return (
    <form className="panel" onSubmit={save} style={{ marginBottom: 16 }}>
      <div className="panel-head"><h2>{asset ? `${asset.tag} — ${asset.name}` : 'Add an asset'}</h2><button type="button" className="linkish" onClick={onCancel}>Close</button></div>
      <div className="panel-body form-grid">
        {error && <div className="wide"><ErrorBox error={error} /></div>}
        <label className="field">Asset tag<input required value={f.tag || ''} onChange={set('tag')} placeholder="LT-0042" /></label>
        <label className="field">Name<input required value={f.name || ''} onChange={set('name')} placeholder="Dell Latitude 7450" /></label>
        <label className="field">Type<select value={f.type} onChange={set('type')}>{TYPES.map((t) => <option key={t} value={t}>{cap(t)}</option>)}</select></label>
        <label className="field">Status<select value={f.status} onChange={set('status')}>{Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field">Assigned to
          <select value={f.assigned_to || ''} onChange={set('assigned_to')}>
            <option value="">Nobody</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
          </select>
        </label>
        {field('location', 'Location')}
        {field('manufacturer', 'Manufacturer')}
        {field('model', 'Model')}
        {field('serial_number', 'Serial number')}
        {field('purchase_date', 'Purchase date', 'date')}
        {field('warranty_end', 'Warranty ends', 'date')}
        <label className="field wide">Notes<textarea rows={3} value={f.notes || ''} onChange={set('notes')} /></label>
        <div className="row end wide">
          {asset && isAdmin && <button type="button" className="btn danger" onClick={remove}>Delete asset</button>}
          <button className="btn primary">{asset ? 'Save changes' : 'Add asset'}</button>
        </div>
        {detail.data && (
          <div className="wide">
            <h3 style={{ marginBottom: 6 }}>Tickets for this asset</h3>
            {detail.data.tickets.length === 0 ? <p className="muted small">None yet.</p> : detail.data.tickets.map((t) => (
              <div key={t.id} className="row small" style={{ marginBottom: 4 }}>
                <Link to={`/tickets/${t.id}`}>#{t.id} {t.subject}</Link><Status s={t.status} /><Prio p={t.priority} /><span className="muted">{fmtDate(t.created_at, false)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </form>
  );
}

export default function Assets() {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | asset
  const list = useLoad(() => api(`/assets${qs({ q, status })}`), [q, status]);
  const users = useLoad(() => api('/admin/users'), []);
  const warrantySoon = (d) => d && new Date(d) < new Date(Date.now() + 60 * 864e5);

  return (
    <>
      <div className="page-head">
        <div><h1>Assets</h1><p>Hardware and software your team supports</p></div>
        <button className="btn primary" onClick={() => setEditing('new')}>Add asset</button>
      </div>
      {editing && (
        <AssetForm key={editing === 'new' ? 'new' : editing.id} asset={editing === 'new' ? null : editing} users={users.data || []}
          onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); list.reload(); }} />
      )}
      <div className="toolbar">
        <input type="search" placeholder="Search tag, name, serial or person" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search assets" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>{Object.entries(STATUSES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      <ErrorBox error={list.error} />
      <div className="panel"><div className="table-wrap">
        <table>
          <thead><tr><th>Tag</th><th>Name</th><th>Type</th><th>Status</th><th>Assigned to</th><th>Location</th><th>Warranty</th><th>Open tickets</th></tr></thead>
          <tbody>
            {(list.data || []).map((a) => (
              <tr key={a.id} className="clickable" onClick={() => setEditing(a)}>
                <td className="id">{a.tag}</td>
                <td className="subject">{a.name}<div className="small muted">{[a.manufacturer, a.model].filter(Boolean).join(' ')}</div></td>
                <td>{cap(a.type)}</td>
                <td>{STATUSES[a.status]}</td>
                <td>{a.assigned_name || <span className="muted">—</span>}</td>
                <td>{a.location || <span className="muted">—</span>}</td>
                <td style={warrantySoon(a.warranty_end) ? { color: 'var(--warn)' } : undefined}>{a.warranty_end ? fmtDate(a.warranty_end, false) : '—'}</td>
                <td>{a.open_tickets || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.data?.length === 0 && <div className="empty">No assets yet. Add your first laptop or server to link it to tickets.</div>}
      </div></div>
    </>
  );
}
