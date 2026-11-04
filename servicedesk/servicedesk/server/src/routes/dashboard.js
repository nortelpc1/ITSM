import { Router } from 'express';
import { one, many } from '../db/index.js';

const r = Router();

r.get('/', async (req, res) => {
  const me = req.user.id;
  const [counts, byPriority, byGroup, daily, sla, response, myQueue] = await Promise.all([
    one(`SELECT
        count(*) FILTER (WHERE status IN ('new','open','pending'))::int AS active,
        count(*) FILTER (WHERE status = 'new')::int AS new,
        count(*) FILTER (WHERE status IN ('new','open','pending') AND assignee_id IS NULL)::int AS unassigned,
        count(*) FILTER (WHERE status IN ('new','open','pending') AND assignee_id = $1)::int AS mine,
        count(*) FILTER (WHERE status IN ('new','open','pending') AND (response_breached OR resolution_breached))::int AS breached,
        count(*) FILTER (WHERE status IN ('new','open') AND sla_paused_at IS NULL
                         AND resolution_due BETWEEN now() AND now() + interval '4 hours')::int AS due_soon,
        count(*) FILTER (WHERE resolved_at >= date_trunc('day', now()))::int AS resolved_today
      FROM tickets`, [me]),
    many(`SELECT priority, count(*)::int AS n FROM tickets WHERE status IN ('new','open','pending') GROUP BY priority`),
    many(`SELECT coalesce(g.name, 'No group') AS name, count(*)::int AS n FROM tickets t LEFT JOIN groups g ON g.id = t.group_id
          WHERE t.status IN ('new','open','pending') GROUP BY 1 ORDER BY 2 DESC`),
    many(`SELECT to_char(d, 'YYYY-MM-DD') AS day,
            (SELECT count(*)::int FROM tickets WHERE created_at >= d AND created_at < d + interval '1 day') AS created,
            (SELECT count(*)::int FROM tickets WHERE resolved_at >= d AND resolved_at < d + interval '1 day') AS resolved
          FROM generate_series(date_trunc('day', now()) - interval '13 days', date_trunc('day', now()), interval '1 day') d`),
    one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE NOT resolution_breached)::int AS met
         FROM tickets WHERE resolved_at >= now() - interval '30 days'`),
    one(`SELECT round(avg(extract(epoch FROM first_response_at - created_at) / 60))::int AS avg_minutes
         FROM tickets WHERE first_response_at >= now() - interval '30 days'`),
    many(`SELECT id, subject, priority, status, created_at, first_response_at, response_due, resolution_due, response_breached, resolution_breached, sla_paused_at
          FROM tickets WHERE assignee_id = $1 AND status IN ('new','open','pending')
          ORDER BY resolution_due NULLS LAST LIMIT 10`, [me]),
  ]);
  res.json({
    counts, byPriority, byGroup, daily, myQueue,
    slaCompliance: sla.total ? Math.round((sla.met / sla.total) * 100) : null,
    avgFirstResponseMinutes: response.avg_minutes,
  });
});

export default r;
