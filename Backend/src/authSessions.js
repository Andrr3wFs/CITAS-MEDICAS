const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const {
  authChallenges,
  saveData,
  sessions,
  users,
} = require('./storage');

const PRIVILEGED_ROLES = new Set(['admin', 'doctor']);
const MAX_CHALLENGE_ATTEMPTS = 5;

const getDurationMs = (name, fallback, minimum, maximum) => {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), minimum), maximum);
};

const SESSION_IDLE_TIMEOUT_MS = getDurationMs(
  'SESSION_IDLE_TIMEOUT_MS',
  15 * 60 * 1000,
  60 * 1000,
  60 * 60 * 1000
);
const SESSION_ABSOLUTE_TIMEOUT_MS = getDurationMs(
  'SESSION_ABSOLUTE_TIMEOUT_MS',
  8 * 60 * 60 * 1000,
  SESSION_IDLE_TIMEOUT_MS,
  24 * 60 * 60 * 1000
);
const AUTH_CHALLENGE_TIMEOUT_MS = getDurationMs(
  'AUTH_CHALLENGE_TIMEOUT_MS',
  5 * 60 * 1000,
  60 * 1000,
  15 * 60 * 1000
);

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET es obligatorio en producción.');
  }

  return secret || 'development-only-jwt-secret';
};

const isPrivilegedRole = (role) => PRIVILEGED_ROLES.has(String(role || '').trim().toLowerCase());

const removeExpiredAuthState = () => {
  const now = Date.now();
  let changed = false;

  for (let index = sessions.length - 1; index >= 0; index -= 1) {
    const session = sessions[index];
    const lastActivityAt = Date.parse(session.lastActivityAt || 0);
    const expiresAt = Date.parse(session.expiresAt || 0);
    const isIdle = !lastActivityAt || now - lastActivityAt >= SESSION_IDLE_TIMEOUT_MS;

    if (session.revokedAt || !expiresAt || expiresAt <= now || isIdle) {
      sessions.splice(index, 1);
      changed = true;
    }
  }

  for (let index = authChallenges.length - 1; index >= 0; index -= 1) {
    const challenge = authChallenges[index];
    if (challenge.consumedAt || Date.parse(challenge.expiresAt || 0) <= now) {
      authChallenges.splice(index, 1);
      changed = true;
    }
  }

  if (changed) {
    saveData();
  }
};

const createAuthChallenge = ({ username, purpose, metadata = {} }) => {
  removeExpiredAuthState();
  const now = new Date();
  const challenge = {
    id: crypto.randomUUID(),
    username: String(username || '').trim().toLowerCase(),
    purpose: String(purpose || '').trim(),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + AUTH_CHALLENGE_TIMEOUT_MS).toISOString(),
    attempts: 0,
    ...metadata,
  };

  authChallenges.push(challenge);
  saveData();
  return challenge;
};

const getAuthChallenge = (challengeId, purpose) => {
  removeExpiredAuthState();
  const challenge = authChallenges.find((entry) => (
    entry.id === String(challengeId || '').trim()
      && entry.purpose === purpose
      && !entry.consumedAt
      && Date.parse(entry.expiresAt) > Date.now()
  ));

  return challenge || null;
};

const recordChallengeFailure = (challenge) => {
  if (!challenge) return;

  challenge.attempts = Number(challenge.attempts || 0) + 1;
  if (challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) {
    challenge.consumedAt = new Date().toISOString();
    challenge.failureReason = 'maximum-attempts';
  }
  saveData();
};

const consumeAuthChallenge = (challenge) => {
  if (!challenge) return;
  challenge.consumedAt = new Date().toISOString();
  saveData();
};

const revokeUserSessions = (username, reason = 'revoked') => {
  const normalizedUsername = String(username || '').trim().toLowerCase();
  const now = new Date().toISOString();
  let changed = false;

  sessions.forEach((session) => {
    if (session.username === normalizedUsername && !session.revokedAt) {
      session.revokedAt = now;
      session.revokedReason = reason;
      changed = true;
    }
  });

  if (changed) saveData();
};

const issueSession = (user, { mfaVerified = false } = {}) => {
  removeExpiredAuthState();
  const now = new Date();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + SESSION_ABSOLUTE_TIMEOUT_MS);
  const role = String(user.role || 'paciente').trim().toLowerCase();
  const requiresMfa = isPrivilegedRole(role);

  if (requiresMfa && (!user.mfaEnabled || !mfaVerified)) {
    throw new Error('No se puede crear una sesión privilegiada sin MFA verificado.');
  }

  const session = {
    id: sessionId,
    username: user.usuario,
    sessionVersion: user.sessionVersion,
    issuedAt: now.toISOString(),
    lastActivityAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ...(mfaVerified ? { mfaVerifiedAt: now.toISOString() } : {}),
  };
  sessions.push(session);
  saveData();

  const token = jwt.sign(
    {
      username: user.usuario,
      sid: sessionId,
      sv: user.sessionVersion,
    },
    getJwtSecret(),
    { expiresIn: Math.floor(SESSION_ABSOLUTE_TIMEOUT_MS / 1000) }
  );

  return { session, token };
};

const getActiveSession = ({ sessionId, username, sessionVersion }) => {
  removeExpiredAuthState();
  const session = sessions.find((entry) => (
    entry.id === String(sessionId || '').trim()
      && entry.username === String(username || '').trim().toLowerCase()
      && Number(entry.sessionVersion) === Number(sessionVersion)
      && !entry.revokedAt
  ));

  if (!session) return null;

  const now = Date.now();
  const isExpired = Date.parse(session.expiresAt) <= now;
  const isIdle = now - Date.parse(session.lastActivityAt) >= SESSION_IDLE_TIMEOUT_MS;
  if (isExpired || isIdle) {
    session.revokedAt = new Date().toISOString();
    session.revokedReason = isExpired ? 'absolute-expiry' : 'idle-timeout';
    saveData();
    return null;
  }

  return session;
};

const recordSessionActivity = (session) => {
  session.lastActivityAt = new Date().toISOString();
  saveData();
};

const getCurrentUser = (username) => users.find((user) => user.usuario === String(username || '').trim().toLowerCase()) || null;

module.exports = {
  AUTH_CHALLENGE_TIMEOUT_MS,
  SESSION_ABSOLUTE_TIMEOUT_MS,
  SESSION_IDLE_TIMEOUT_MS,
  consumeAuthChallenge,
  createAuthChallenge,
  getActiveSession,
  getAuthChallenge,
  getCurrentUser,
  getJwtSecret,
  isPrivilegedRole,
  issueSession,
  recordChallengeFailure,
  recordSessionActivity,
  removeExpiredAuthState,
  revokeUserSessions,
};