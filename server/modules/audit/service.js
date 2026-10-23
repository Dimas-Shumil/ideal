export function audit(
  tx,
  action,
  { actorId = null, targetId = null, requestId = null } = {},
) {
  return tx.auditEvent.create({
    data: { action, actorId, targetId, requestId },
  });
}
