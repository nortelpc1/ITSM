import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { ErrorBox, Fuse, Prio, Status, useLoad } from '../components/bits.jsx';
import { duration } from '../util.js';

export default function Dashboard() {
  const { data, error } = useLoad(() => api('/dashboard'), []);
  const nav = useNavigate();
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const c = data.counts;
  const maxDay = Math.max(1, ...data.daily.map((d) => Math.max(d.created, d.resolved)));
  const maxGroup = Math.max(1, ...data.byGroup.map((g) => g.n));
  const prio = Object.fromEntries(data.byPriority.map((p) => [p.priority, p.n]));

  return (
    <>
      <div className="page-head">
        <div><h1>Dashboard</h1><p>{c.active} active tickets, {c.resolved_today} resolved today</p></div>
        <Link className="btn primary" to="/tickets/new">New ticket</Link>
      </div>

      <div className="stats">
        <Link className="stat" to="/tickets?view=mine"><div className="n">{c.mine}</div><div className="l">Assigned to me</div></Link>
        <Link className="stat" to="/tickets?view=unassigned"><div className="n">{c.unassigned}</div><div className="l">Unassigned</div></Link>
        <Link className={`stat ${c.breached ? 'alert' : ''}`} to="/tickets?view=breached"><div className="n">{c.breached}</div><div className="l">SLA breached</div></Link>
        <Link className="stat" to="/tickets?view=active&sort=due&dir=asc"><div className="n">{c.due_soon}</div><div className="l">Due in 4 hours</div></Link>
        <div className="stat"><div className="n">{data.slaCompliance ?? '—'}{data.slaCompliance != null && '%'}</div><div className="l">SLA met, last 30 days</div></div>
        <div className="stat"><div className="n">{data.avgFirstResponseMinutes != null ? duration(data.avgFirstResponseMinutes) : '—'}</div><div className="l">Avg. first response</div></div>
      </div>

      <div className="dash-grid">
        <div className="panel">
          <div className="panel-head"><h2>My queue</h2><Link to="/tickets?view=mine">See all</Link></div>
          {data.myQueue.length === 0 ? <div className="empty">Nothing assigned to you. Pick up something from Unassigned.</div> : (
            <div className="table-wrap"><table><tbody>
              {data.myQueue.map((t) => (
                <tr key={t.id} className="clickable" onClick={() => nav(`/tickets/${t.id}`)}>
                  <td className="id">#{t.id}</td>
                  <td><div className="subject">{t.subject}</div><Prio p={t.priority} /> <Status s={t.status} /></td>
                  <td style={{ width: 160 }}><Fuse t={t} /></td>
                </tr>
              ))}
            </tbody></table></div>
          )}
        </div>

        <div style={{ display: 'grid', gap: 16 }}>
          <div className="panel">
            <div className="panel-head"><h2>Last 14 days</h2></div>
            <div className="panel-body">
              <div className="bars" role="img" aria-label="Tickets created and resolved per day">
                {data.daily.map((d) => (
                  <div className="day" key={d.day} title={`${d.day}: ${d.created} created, ${d.resolved} resolved`}>
                    <div className="c" style={{ height: `${(d.created / maxDay) * 100}%` }} />
                    <div className="r" style={{ height: `${(d.resolved / maxDay) * 100}%` }} />
                  </div>
                ))}
              </div>
              <div className="legend"><span><i style={{ background: 'var(--brand)' }} />Created</span><span><i style={{ background: 'var(--ok)' }} />Resolved</span></div>
            </div>
          </div>
          <div className="panel">
            <div className="panel-head"><h2>Active by group</h2></div>
            <div className="panel-body">
              {data.byGroup.length === 0 && <span className="muted">No active tickets.</span>}
              {data.byGroup.map((g) => (
                <div className="hbar" key={g.name}><span>{g.name}</span><div className="t"><div className="f" style={{ width: `${(g.n / maxGroup) * 100}%` }} /></div><span className="muted">{g.n}</span></div>
              ))}
              <div className="row" style={{ marginTop: 12, gap: 16 }}>
                {['critical', 'high', 'medium', 'low'].map((p) => <span key={p}><Prio p={p} /> <strong>{prio[p] || 0}</strong></span>)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
