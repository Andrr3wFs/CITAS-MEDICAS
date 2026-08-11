const { auditLogs, saveData } = require('./storage');

const MAX_AUDIT_VALUE_LENGTH = 500;

const redactValue = (value) => {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object') {
    return String(value).slice(0, MAX_AUDIT_VALUE_LENGTH);
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !['password', 'token', 'authorization'].includes(key.toLowerCase()))
      .map(([key, entry]) => [key, redactValue(entry)])
  );
};

const writeAuditLog = ({ req, action, entityType, entityId = null, before, after, metadata = {} }) => {
  const auditLog = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    actorUsername: req.user?.username || 'system',
    actorRole: req.user?.role || 'system',
    action,
    entityType,
    entityId: entityId === null ? null : String(entityId),
    before: redactValue(before),
    after: redactValue(after),
    metadata: redactValue({ ...metadata, ip: req.ip }),
    createdAt: new Date().toISOString(),
  };

  auditLogs.unshift(auditLog);
  saveData();
  return auditLog;
};

module.exports = { writeAuditLog };