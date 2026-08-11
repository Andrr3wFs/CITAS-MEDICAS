const jwt = require('jsonwebtoken');

const normalizeUsername = (username) => String(username || '').trim().toLowerCase();

const getJwtSecret = () => process.env.JWT_SECRET || 'hospital-secret-key';

const authenticate = (req, res, next) => {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Token de autenticación requerido' });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
    req.user = {
      username: normalizeUsername(payload.username),
      role: String(payload.role || 'paciente').trim().toLowerCase(),
      displayName: String(payload.displayName || payload.username || '').trim(),
    };
    return next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token inválido o expirado' });
  }
};

const getRequestUserRole = (req) => {
  if (req.user?.role) {
    return req.user.role;
  }

  return String(req.headers['x-user-role'] || '').trim().toLowerCase();
};

const getRequestUsername = (req) => {
  if (req.user?.username) {
    return req.user.username;
  }

  return normalizeUsername(req.headers['x-user-username'] || req.headers['x-username']);
};

module.exports = {
  authenticate,
  getRequestUserRole,
  getRequestUsername,
  normalizeUsername,
};