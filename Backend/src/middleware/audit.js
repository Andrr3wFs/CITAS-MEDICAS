const { writeAuditLog } = require('../auditLogs');

const safelyWriteAuditLog = (event) => {
  try {
    writeAuditLog(event);
  } catch (error) {
    console.error('No se pudo guardar la bitácora de auditoría:', error);
  }
};

const auditMutation = ({ action, entityType, getEntityId, getBefore, getAfter, metadata }) =>
  (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;

      safelyWriteAuditLog({
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

const auditAccess = ({ action, entityType, getEntityIds, metadata }) =>
  (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;

      const entityIds = Array.from(new Set(
        (getEntityIds?.(req, res) || [])
          .filter((entityId) => entityId !== null && entityId !== undefined)
          .map((entityId) => String(entityId))
      ));

      entityIds.forEach((entityId) => {
        safelyWriteAuditLog({
          req,
          action,
          entityType,
          entityId,
          metadata: {
            accessScope: 'clinical-history',
            resourceCount: entityIds.length,
            ...(metadata?.(req, res) || {}),
          },
        });
      });
    });

    next();
  };

module.exports = { auditAccess, auditMutation };