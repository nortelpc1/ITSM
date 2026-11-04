import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ErrorBox, Fuse, Prio, Status, useLoad } from '../components/bits.jsx';
import { ago } from '../util.js';

const STAFF_VIEWS = [
  ['mine', 'Assigned to me', { status: 'active', assignee: 'me' }],
  ['unassigned', 'Unassigned', { status: 'active', assignee: 'none' }],
  ['active', 'All active', { status: 'active' }],
  ['breached', 'SLA breached', { status: 'active', breached: 'true' }],
  ['resolved', 'Resolved', { status: 'resolved' }],
  ['all', 'Everything', {}],
];
const USER_VIEWS = [
  ['active', 'Open', { status: 'active' }],
  ['resolved', 'Resolved', { status: 'resolved' }],
  ['all', 'All', {}],
];

export default function Tickets() {
  const { isStaff } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const views = isStaff ? STAFF_VIEWS : USER_VIEWS;
  const view = params.get('view') || (isStaff ? 'active' : 'active');
  const [q, setQ] = useState(params.get('q') || '');
  const type = params.get('type') || '';
  const page = Number(params.get('page') || 1);
  const sort = params.get('sort') || 'updated';
  const dir = params.get('dir') || 'desc';
  const base = (views.find((v) => v[0] === view) || views[0])[2];

  useEffect(() => { const t = setTimeout(() => set({ q, page: '' }), 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line

  const { data, error, loading } = useLoad(
    () => api(`/tickets${qs({ ...base, type, q: params.get('q'), page, sort, dir })}`),
    [view, type, params.get('q'), page, sort, dir]
  );

  function set(patch) {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) (v ? next.set(k, v) : next.delete(k));
    setParams(next, { replace: true });
  }
  const pages = data ? Math.ceil(data.total / data.pageSize) : 1;

  return (
    <>
      <div className="page-head">
        <div><h1>{isStaff ? 'Tickets' : 'My tickets'}</h1>{data && <p>{data.total} {data.total === 1 ? 'ticket' : 'tickets'}</p>}</div>
        <Link className="btn primary" to="/tickets/new">{isStaff ? 'New ticket' : 'Report an issue'}</Link>
      </div>
      <div className="tabs" role="tablist">
        {views.map(([key, label]) => (
          <button key={key} role="tab" aria-selected={view === key} className={view === key ? 'on' : ''} onClick={() => set({ view: key, page: '' })}>{label}</button>
        ))}
      </div>
      <div className="toolbar">
        <input type="search" placeholder="Search subject, requester or #number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search tickets" />
        {isStaff && (
          <select value={type} onChange={(e) => set({ type: e.target.value, page: '' })} aria-label="Ticket type">
            <option value="">All types</option><option value="incident">Incidents</option><option value="request">Requests</option>
            <option value="problem">Problems</option><option value="change">Changes</option>
          </select>
        )}
        <select value={`${sort}:${dir}`} onChange={(e) => { const [s, d] = e.target.value.split(':'); set({ sort: s, dir: d }); }} aria-label="Sort">
          <option value="updated:desc">Recently updated</option><option value="created:desc">Newest first</option>
          <option value="due:asc">Due soonest</option><option value="priority:desc">Highest priority</option>
        </select>
      </div>
      <ErrorBox error={error} />
      <div className="panel">
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>#</th><th>Subject</th>{isStaff && <th>Requester</th>}<th>Priority</th><th>Status</th>
              {isStaff && <th>Assignee</th>}<th>SLA</th><th>Updated</th>
            </tr></thead>
            <tbody>
              {data?.rows.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => nav(`/tickets/${t.id}`)}>
                  <td className="id">{t.id}</td>
                  <td>
                    <Link className="subject" to={`/tickets/${t.id}`} onClick={(e) => e.stopPropagation()}>{t.subject}</Link>
                    <div className="small muted"><span className="type-tag">{t.type}</span>{t.category_name && ` in ${t.category_name}`}{t.source === 'email' && ' by email'}</div>
                  </td>
                  {isStaff && <td>{t.requester_name}<div className="small muted">{t.requester_department}</div></td>}
                  <td><Prio p={t.priority} /></td>
                  <td><Status s={t.status} /></td>
                  {isStaff && <td>{t.assignee_name || <span className="muted">{t.group_name || 'Nobody'}</span>}</td>}
                  <td><Fuse t={t} /></td>
                  <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{ago(t.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data && data.rows.length === 0 && !loading && (
            <div className="empty">{params.get('q') ? 'No tickets match your search.' : 'No tickets here.'} {!isStaff && <Link to="/tickets/new">Report an issue</Link>}</div>
          )}
        </div>
      </div>
      {pages > 1 && (
        <div className="row end" style={{ marginTop: 12 }}>
          <button className="btn small" disabled={page <= 1} onClick={() => set({ page: String(page - 1) })}>Previous</button>
          <span className="small muted">Page {page} of {pages}</span>
          <button className="btn small" disabled={page >= pages} onClick={() => set({ page: String(page + 1) })}>Next</button>
        </div>
      )}
    </>
  );
}
