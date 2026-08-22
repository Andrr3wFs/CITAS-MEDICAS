const crypto = require('crypto');
const { auditLogs, saveData } = require('./storage');

const AUDIT_LOG_VERSION = 1;
const MAX_CHANGED_FIELDS = 40;
const MAX_CHANGE_DEPTH = 4;
const MAX_METADATA_VALUE_LENGTH = 120;
const SAFE_METADATA_KEYS = new Set([
  'accessScope',
  'resourceCount',
  'reason',
  'source',
]);
const PROTECTED_FIELD_NAMES = new Set([
  'password',
  'token',
  'authorization',
  'medicalhistory',
  'diagnosis',
  'diagnostico',
  'observations',
  'treatment',
  'indications',
  'followup',
  'prescription',
  'consultationnotes',
  'notes',
  'sintoma',
  'documento',
  'email',
  'telefono',
  'direccion',
]);

let warnedAboutAuditKeyFallback = false;

const getAuditSigningKey = () => {
  const configuredKey = String(process.env.AUDIT_LOG_HMAC_KEY || '').trim();
  if (configuredKey) return configuredKey;

  const fallbackKey = String(process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET || '').trim();
  if (fallbackKey) {
    if (!warnedAboutAuditKeyFallback) {
      console.warn('AUDIT_LOG_HMAC_KEY no está configurada; la cadena de auditoría usa una clave de respaldo. Configura una clave exclusiva antes de producción.');
      warnedAboutAuditKeyFallback = true;
    }
    return fallbackKey;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUDIT_LOG_HMAC_KEY es obligatoria para firmar la auditoría en producción.');
  }

  return 'development-only-audit-log-key';
};

const getAuditKeyId = () => String(process.env.AUDIT_LOG_KEY_ID || 'default').trim().slice(0, 64);
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const stableStringify = (value) => {
  if (value === undefined) return '"[undefined]"';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;

  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(',')}}`;
};

const redactFieldPath = (path) => {
  const segments = String(path || '').split('.');
  const lastSegment = String(segments[segments.length - 1] || '').toLowerCase();

  if (PROTECTED_FIELD_NAMES.has(lastSegment)) {
    return `${segments.slice(0, -1).join('.')}${segments.length > 1 ? '.' : ''}[protected]`;
  }

  return path || 'record';
};

const collectChangedFields = (before, after, path = '', depth = 0, fields = []) => {
  if (fields.length >= MAX_CHANGED_FIELDS) return fields;
  if (Object.is(before, after)) return fields;

  if (isPlainObject(before) && isPlainObject(after) && depth < MAX_CHANGE_DEPTH) {
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
    keys.forEach((key) => {
      collectChangedFields(before[key], after[key], path ? `${path}.${key}` : key, depth + 1, fields);
    });
    return fields;
  }

  if (isPlainObject(before) && before && depth < MAX_CHANGE_DEPTH) {
    Object.keys(before).sort().forEach((key) => {
      collectChangedFields(before[key], undefined, path ? `${path}.${key}` : key, depth + 1, fields);
    });
    return fields;
  }

  if (isPlainObject(after) && after && depth < MAX_CHANGE_DEPTH) {
    Object.keys(after).sort().forEach((key) => {
      collectChangedFields(undefined, after[key], path ? `${path}.${key}` : key, depth + 1, fields);
    });
    return fields;
  }

  const redactedPath = redactFieldPath(path);
  if (!fields.includes(redactedPath)) fields.push(redactedPath);
  return fields;
};

const summarizeChanges = (before, after) => {
  const changedFields = collectChangedFields(before, after);

  return {
    changedFields,
    truncated: changedFields.length >= MAX_CHANGED_FIELDS,
  };
};

const sanitizeMetadata = (metadata = {}) => {
  if (!isPlainObject(metadata)) return {};

  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => SAFE_METADATA_KEYS.has(key))
      .map(([key, value]) => {
        if (typeof value === 'boolean' || typeof value === 'number') return [key, value];
        return [key, String(value || '').slice(0, MAX_METADATA_VALUE_LENGTH)];
      })
  );
};

const hmac = (value) => crypto.createHmac('sha256', getAuditSigningKey()).update(value).digest('base64url');
const getSourceIpReference = (req) => hmac(`ip:${String(req.ip || '').trim()}`).slice(0, 32);

const getRequestMetadata = (req, metadata) => ({
  ...sanitizeMetadata(metadata),
  method: String(req.method || '').toUpperCase(),
  route: String(req.baseUrl || '') + String(req.route?.path || ''),
  httpStatus: Number(req.res?.statusCode || 0),
  sourceIpReference: getSourceIpReference(req),
});

const getIntegrityPayload = (auditLog) => ({
  id: auditLog.id,
  version: auditLog.version,
  keyId: auditLog.keyId,
  actorUsername: auditLog.actorUsername,
  actorRole: auditLog.actorRole,
  action: auditLog.action,
  entityType: auditLog.entityType,
  entityId: auditLog.entityId,
  outcome: auditLog.outcome,
  changes: auditLog.changes,
  metadata: auditLog.metadata,
  createdAt: auditLog.createdAt,
  previousHash: auditLog.previousHash,
});

const createIntegrityHash = (auditLog) => hmac(stableStringify(getIntegrityPayload(auditLog)));
const hashesMatch = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const writeAuditLog = ({
  req,
  action,
  entityType,
  entityId = null,
  before,
  after,
  metadata = {},
  outcome = 'success',
}) => {
  const previousHash = auditLogs[0]?.integrityHash || null;
  const auditLog = {
    id: crypto.randomUUID(),
    version: AUDIT_LOG_VERSION,
    keyId: getAuditKeyId(),
    actorUsername: String(req.user?.username || 'system').slice(0, 160),
    actorRole: String(req.user?.role || 'system').slice(0, 80),
    action: String(action || 'unknown').slice(0, 160),
    entityType: String(entityType || 'unknown').slice(0, 80),
    entityId: entityId === null ? null : String(entityId).slice(0, 160),
    outcome: String(outcome || 'success').slice(0, 40),
    changes: summarizeChanges(before, after),
    metadata: getRequestMetadata(req, metadata),
    createdAt: new Date().toISOString(),
    previousHash,
  };

  auditLog.integrityHash = createIntegrityHash(auditLog);
  auditLogs.unshift(auditLog);
  saveData();
  return auditLog;
};

const verifyAuditLogChain = (entries = auditLogs) => {
  const signedEntries = Array.isArray(entries) ? entries.filter((entry) => entry?.integrityHash) : [];
  const legacyEntries = Array.isArray(entries) ? entries.length - signedEntries.length : 0;
  const issues = [];
  let previousHash = null;

  signedEntries.slice().reverse().forEach((entry) => {
    if (entry.version !== AUDIT_LOG_VERSION) {
      issues.push({ id: entry.id, reason: 'unsupported-version' });
      return;
    }

    if (entry.previousHash !== previousHash) {
      issues.push({ id: entry.id, reason: 'previous-hash-mismatch' });
    }

    if (!hashesMatch(entry.integrityHash, createIntegrityHash(entry))) {
      issues.push({ id: entry.id, reason: 'integrity-hash-mismatch' });
    }

    previousHash = entry.integrityHash;
  });

  return {
    valid: issues.length === 0,
    signedEntries: signedEntries.length,
    legacyEntries,
    issues,
  };
};

module.exports = {
  verifyAuditLogChain,
  writeAuditLog,
};