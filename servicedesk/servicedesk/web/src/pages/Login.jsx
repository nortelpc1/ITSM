import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { ErrorBox } from '../components/bits.jsx';

export default function Login() {
  const { signIn } = useAuth();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [mode, setMode] = useState('link');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const next = params.get('next') && params.get('next') !== '/login' ? params.get('next') : '/';

  useEffect(() => {
    const magic = params.get('magic');
    if (!magic) return;
    api('/auth/magic', { method: 'POST', body: { token: magic } })
      .then((d) => { signIn(d); nav('/', { replace: true }); })
      .catch((e) => setError(e.message));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function submit(e) {
    e.preventDefault();
    setError(null); setBusy(true);
    try {
      if (mode === 'password') {
        signIn(await api('/auth/login', { method: 'POST', body: { email, password } }));
        nav(next, { replace: true });
      } else {
        await api('/auth/magic-link', { method: 'POST', body: { email } });
        setSent(true);
      }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  return (
    <div className="login">
      <div className="panel">
        <div className="panel-body">
          <h1>Sign in to ServiceDesk</h1>
          <p className="muted">Use your work email address.</p>
          <div className="tabs" role="tablist">
            <button role="tab" aria-selected={mode === 'link'} className={mode === 'link' ? 'on' : ''} onClick={() => { setMode('link'); setSent(false); }}>Email me a link</button>
            <button role="tab" aria-selected={mode === 'password'} className={mode === 'password' ? 'on' : ''} onClick={() => setMode('password')}>Password</button>
          </div>
          <ErrorBox error={error} />
          {sent ? (
            <div className="notice">If {email} has an account, a sign-in link is on its way. It expires in 15 minutes.</div>
          ) : (
            <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
              <label className="field">Work email
                <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
              </label>
              {mode === 'password' && (
                <label className="field">Password
                  <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                </label>
              )}
              <button className="btn primary" disabled={busy}>{mode === 'password' ? 'Sign in' : 'Send sign-in link'}</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
