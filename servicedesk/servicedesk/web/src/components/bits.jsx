import { useCallback, useEffect, useState } from 'react';
import { duration } from '../util.js';

export const Prio = ({ p }) => <span className={`prio ${p}`}>{p}</span>;
export const Status = ({ s }) => <span className={`status ${s}`}>{s}</span>;
export const ErrorBox = ({ error }) => (error ? <div className="error-box" role="alert">{error}</div> : null);

/**
 * The SLA fuse: a bar that burns down towards the next SLA target.
 * Shows the first-response target until someone replies, then the resolution target.
 */
export function Fuse({ t, big = false }) {
  const cls = ['fuse'];
  if (big) cls.push('fuse-big');
  const done = ['resolved', 'closed'].includes(t.status);
  if (done) {
    const missed = t.resolution_breached;
    return (
      <div className={`${cls.join(' ')} ${missed ? 'bad' : ''}`}>
        <div className="fuse-track"><div className="fuse-burn" style={{ width: '100%' }} /></div>
        <div className="fuse-label">{t.resolution_due ? (missed ? 'Target missed' : 'Target met') : 'No target'}</div>
      </div>
    );
  }
  const awaitingReply = !t.first_response_at && t.response_due;
  const due = awaitingReply ? t.response_due : t.resolution_due;
  if (!due) return <span className="muted small">No target</span>;

  if (t.sla_paused_at) {
    return (
      <div className={`${cls.join(' ')} paused`}>
        <div className="fuse-track"><div className="fuse-burn" style={{ width: '100%' }} /></div>
        <div className="fuse-label">Paused while pending</div>
      </div>
    );
  }
  const start = new Date(t.created_at).getTime();
  const end = new Date(due).getTime();
  const now = Date.now();
  const used = Math.min(1, Math.max(0.02, (now - start) / Math.max(1, end - start)));
  const left = (end - now) / 60000;
  if (left < 0) cls.push('bad');
  else if (used > 0.75) cls.push('warn');
  const what = awaitingReply ? 'reply' : 'resolve';
  return (
    <div className={cls.join(' ')} title={`${awaitingReply ? 'First response' : 'Resolution'} due ${new Date(due).toLocaleString()}`}>
      <div className="fuse-track"><div className="fuse-burn" style={{ width: `${used * 100}%` }} /></div>
      <div className="fuse-label">{left < 0 ? `Overdue by ${duration(left)}` : `${duration(left)} to ${what}`}</div>
    </div>
  );
}

/** Load data from a function; returns { data, error, loading, reload }. */
export function useLoad(fn, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    fn().then((data) => setState({ data, error: null, loading: false }))
      .catch((e) => setState({ data: null, error: e.message, loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(load, [load]);
  return { ...state, reload: load };
}
