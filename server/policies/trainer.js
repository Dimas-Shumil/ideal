// Contract only; no real clients, lessons, assignments or CRM endpoints yet.
export function trainerScope(context, fixtures) {
  if (!context?.active || context.role !== "TRAINER")
    return Object.freeze({ clients: [], lessons: [], attachments: [] });
  const trainerId = fixtures.profiles.find((p) => p.userId === context.id)?.id;
  if (!trainerId)
    return Object.freeze({ clients: [], lessons: [], attachments: [] });
  const ids = new Set(
    fixtures.assignments
      .filter((a) => a.trainerId === trainerId && a.active)
      .map((a) => a.clientId),
  );
  const clients = fixtures.clients
    .filter((c) => ids.has(c.id))
    .map((c) => ({ id: c.id, name: c.name }));
  const lessons = fixtures.lessons
    .filter((l) => l.trainerId === trainerId)
    .map((l) => ({
      id: l.id,
      participants: l.participants.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
      })),
    }));
  const attachments = fixtures.attachments
    .filter((a) => ids.has(a.clientId))
    .map((a) => ({ id: a.id, clientId: a.clientId }));
  return { clients, lessons, attachments };
}
// All collection operations and single-object access derive from the same projection.
export function scopedRead(
  context,
  fixtures,
  resource,
  operation,
  { id, query = "" } = {},
) {
  const rows = trainerScope(context, fixtures)[resource] || [];
  const found = rows.filter(
    (r) => !query || (r.name || "").toLowerCase().includes(query.toLowerCase()),
  );
  if (operation === "count") return found.length;
  if (operation === "get") return found.find((r) => r.id === id) || null;
  return found; // list/search/export use the same scope and field allowlist
}

// Production scope: apply in the database for BOTH collections and objects.
// The related user is checked in the same SQL query, including authVersion.
export function trainerClientWhere(context) {
  if(!context?.active || context.role !== 'TRAINER' || !context.id || !Number.isInteger(context.authVersion))
    return { id: { in: [] } };
  return {
    archived: false,
    assignments: { some: {
      active: true,
      trainer: { userId: context.id, user: {
        active: true, role: 'TRAINER', authVersion: context.authVersion,
      } },
    } },
  };
}
