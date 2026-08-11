const { writeAuditLog } = require('../auditLogs');

const auditMutation = ({ action, entityType, getEntityId, getBefore, getAfter, metadata }) =>
  (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;

      writeAuditLog({
        req,
        action,
        entityType,
        entityId: getEntityId?.(req, res),
        before: getBefore?.(req, res),
        after: getAfter?.(req, res),
        metadata: metadata?.(req, res),
      });
    });

    next();
  };

module.exports = { auditMutation };