// Background jobs: SLA breach detection and auto-closing resolved tickets.
import { many, query } from '../db/index.js';
import { getSetting } from './settings.js';
import { logChange } from './history.js';
import { sendBreachWarning } from './mailer.js';
import { pool } from '../db/index.js';

export async function checkSlaBreaches() {
  const response = await many(`
    UPDATE tickets t SET response_breached = TRUE
    WHERE NOT response_breached AND first_response_at IS NULL AND sla_paused_at IS NULL
      AND status IN ('new','open') AND response_due < now()
    RETURNING t.id, t.subject, t.assignee_id`);
  const resolution = await many(`
    UPDATE tickets t SET resolution_breached = TRUE
    WHERE NOT resolution_breached AND sla_paused_at IS NULL
      AND status IN ('new','open','pending') AND resolution_due < now()
    RETURNING t.id, t.subject, t.assignee_id`);

  for (const [kind, rows] of [['first response', response], ['resolution', resolution]]) {
    for (const t of rows) {
      await logChange(pool, t.id, null, 'sla_breach', null, kind);
      if (t.assignee_id) {
        const a = await many('SELECT email FROM users WHERE id = $1', [t.assignee_id]);
        if (a[0]) sendBreachWarning(t, a[0].email, kind);
      }
    }
  }
  return response.length + resolution.length;
}

export async function autoCloseResolved() {
  const { auto_close_days: days } = await getSetting('tickets');
  if (!days || days <= 0) return 0;
  const rows = await many(`
    UPDATE tickets SET status = 'closed', closed_at = now(), updated_at = now()
    WHERE status = 'resolved' AND resolved_at < now() - make_interval(days => $1)
    RETURNING id`, [days]);
  for (const r of rows) await logChange(pool, r.id, null, 'status', 'resolved', 'closed');
  return rows.length;
}

export function startJobs() {
  const safe = (name, fn) => async () => {
    try { await fn(); } catch (e) { console.error(`[jobs] ${name} failed:`, e.message); }
  };
  setInterval(safe('sla', checkSlaBreaches), 60_000);
  setInterval(safe('auto-close', autoCloseResolved), 60 * 60_000);
  safe('sla', checkSlaBreaches)();
}

export { query };
