const jwt = require('jsonwebtoken');
const {
  getActiveSession,
  getCurrentUser,
  getJwtSecret,
  isPrivilegedRole,
  recordSessionActivity,
} = require('./authSessions');

const normalizeUsername = (username) => String(username || '').trim().toLowerCase();

const authenticate = (req, res, next) => {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token de autenticación requerido' });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
    const username = normalizeUsername(payload.username);
    const user = getCurrentUser(username);
    const session = getActiveSession({
      sessionId: payload.sid,
      username,
      sessionVersion: payload.sv,
    });

    if (!user || !session || user.sessionVersion !== Number(payload.sv) || user.passwordChangeRequired) {
      return res.status(401).json({ success: false, message: 'La sesión no está activa. Inicia sesión nuevamente.' });
    }

    const role = String(user.role || 'paciente').trim().toLowerCase();
    if (isPrivilegedRole(role) && (!user.mfaEnabled || !session.mfaVerifiedAt)) {
      return res.status(401).json({ success: false, message: 'La sesión no cumple el requisito de MFA.' });
    }

    req.user = {
      username,
      role,
      displayName: String(user.nombre || user.usuario).trim(),
      sessionId: session.id,
    };
    recordSessionActivity(session);
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
  }
};

const getRequestUserRole = (req) => {
  return req.user?.role || '';
};

const getRequestUsername = (req) => {
  return req.user?.username || '';
};

module.exports = {
  authenticate,
  getRequestUserRole,
  getRequestUsername,
  normalizeUsername,
};