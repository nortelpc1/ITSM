import { useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ErrorBox } from '../components/bits.jsx';

export default function Account() {
  const { user } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  async function save(e) {
    e.preventDefault(); setError(null); setDone(false);
    try { await api('/auth/change-password', { method: 'POST', body: { current, next } }); setDone(true); setCurrent(''); setNext(''); }
    catch (err) { setError(err.message); }
  }

  return (
    <>
      <div className="page-head"><div><h1>Account</h1><p>{user.name} — {user.email}</p></div></div>
      <div className="panel" style={{ maxWidth: 440 }}>
        <div className="panel-head"><h2>Change password</h2></div>
        <form className="panel-body" onSubmit={save} style={{ display: 'grid', gap: 12 }}>
          <ErrorBox error={error} />
          {done && <div className="notice">Password changed.</div>}
          <label className="field">Current password (leave empty if you've never set one)
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </label>
          <label className="field">New password (at least 10 characters)
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} autoComplete="new-password" />
          </label>
          <div className="row end"><button className="btn primary">Change password</button></div>
        </form>
      </div>
    </>
  );
}
