export async function logChange(db, ticketId, actorId, field, oldValue, newValue) {
  const norm = (v) => (v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v));
  await db.query(
    'INSERT INTO ticket_history(ticket_id, actor_id, field, old_value, new_value) VALUES ($1,$2,$3,$4,$5)',
    [ticketId, actorId ?? null, field, norm(oldValue), norm(newValue)]
  );
}
