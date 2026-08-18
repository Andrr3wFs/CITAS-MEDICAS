const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const {
  accessRequests,
  hashPasswordSync,
  PASSWORD_POLICY_VERSION,
  saveData,
  users,
  normalizeUsername,
} = require('../storage');
const { authenticate } = require('../auth');
const {
  consumeAuthChallenge,
  createAuthChallenge,
  getAuthChallenge,
  isPrivilegedRole,
  issueSession,
  recordChallengeFailure,
  revokeUserSessions,
} = require('../authSessions');
const { createEnrollment, createEnrollmentPresentation, verifyTotpCode } = require('../mfa');
const { validatePassword } = require('../passwordPolicy');

const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;

const getUserRole = (user) => String(user?.role || 'paciente').trim().toLowerCase();

const createChallengeForUser = (user, purpose) => createAuthChallenge({
  username: user.usuario,
  purpose,
  metadata: { sessionVersion: user.sessionVersion },
});

const isChallengeCurrentForUser = (challenge, user) => (
  Boolean(challenge)
    && Boolean(user)
    && challenge.username === user.usuario
    && Number(challenge.sessionVersion) === Number(user.sessionVersion)
);

const sendSessionResponse = (res, user, { mfaVerified = false } = {}) => {
  const { token, session } = issueSession(user, { mfaVerified });
  return res.json({
    success: true,
    token,
    username: user.usuario,
    role: getUserRole(user),
    displayName: user.nombre || user.usuario,
    sessionExpiresAt: session.expiresAt,
    idleTimeoutMs: Number(process.env.SESSION_IDLE_TIMEOUT_MS) || 15 * 60 * 1000,
  });
};

const continueAfterPrimaryFactor = (res, user) => {
  if (user.passwordChangeRequired || Number(user.passwordPolicyVersion) !== PASSWORD_POLICY_VERSION) {
    user.passwordChangeRequired = true;
    saveData();
    const challenge = createChallengeForUser(user, 'password-change');
    return res.status(403).json({
      success: false,
      passwordChangeRequired: true,
      passwordChangeChallengeId: challenge.id,
      message: 'Debes actualizar tu contraseña antes de continuar.',
    });
  }

  if (!isPrivilegedRole(getUserRole(user))) {
    return sendSessionResponse(res, user);
  }

  if (!user.mfaEnabled || !user.mfaSecret) {
    const challenge = createChallengeForUser(user, 'mfa-enrollment');
    return res.status(403).json({
      success: false,
      mfaEnrollmentRequired: true,
      mfaChallengeId: challenge.id,
      message: 'Debes configurar MFA para acceder con esta cuenta.',
    });
  }

  const challenge = createChallengeForUser(user, 'mfa-login');
  return res.status(401).json({
    success: false,
    mfaRequired: true,
    mfaChallengeId: challenge.id,
    message: 'Ingresa el código de tu aplicación de autenticación.',
  });
};

const recordFailedLogin = (user) => {
  if (!user) return;

  const failures = Number(user.failedLoginAttempts || 0) + 1;
  user.failedLoginAttempts = failures;
  user.lastFailedLoginAt = new Date().toISOString();

  if (failures >= MAX_LOGIN_FAILURES) {
    user.loginLockedUntil = new Date(Date.now() + LOGIN_LOCKOUT_MS).toISOString();
    user.failedLoginAttempts = 0;
  }

  saveData();
};

const clearFailedLogins = (user) => {
  if (!user.failedLoginAttempts && !user.lastFailedLoginAt && !user.loginLockedUntil) return;
  delete user.failedLoginAttempts;
  delete user.lastFailedLoginAt;
  delete user.loginLockedUntil;
  saveData();
};

const findChallengeUser = (challenge) => users.find((user) => user.usuario === challenge?.username) || null;

router.post('/login', (req, res) => {
  const { usuario, password } = req.body;

  const normalizedUsername = normalizeUsername(usuario);
  const normalizedPassword = String(password || '');

  // Verificar si tiene una solicitud pendiente
  const pendingRequest = accessRequests.find(
    (request) => request.usuario === normalizedUsername && request.status === 'pending'
  );

  if (pendingRequest) {
    return res.status(403).json({
      success: false,
      message: 'Tu solicitud de acceso aún está pendiente de aprobación por parte de la administración.',
    });
  }

  // Verificar si fue rechazada
  const rejectedRequest = accessRequests.find(
    (request) => request.usuario === normalizedUsername && request.status === 'rejected'
  );

  if (rejectedRequest) {
    return res.status(403).json({
      success: false,
      message: 'Tu solicitud de acceso fue rechazada.',
    });
  }

  // Buscar usuario aprobado
  const user = users.find((storedUser) => storedUser.usuario === normalizedUsername);

  const lockedUntil = Date.parse(user?.loginLockedUntil || 0);
  if (lockedUntil > Date.now()) {
    return res.status(429).json({
      success: false,
      message: 'Demasiados intentos fallidos. Espera antes de volver a intentarlo.',
      retryAfterSeconds: Math.ceil((lockedUntil - Date.now()) / 1000),
    });
  }

  if (!user || !bcrypt.compareSync(normalizedPassword, user.password)) {
    recordFailedLogin(user);
    return res.status(401).json({
      success: false,
      message: 'Credenciales incorrectas',
    });
  }

  if (user.accessClosed) {
    return res.status(403).json({
      success: false,
      registrationClosed: true,
      registrationAvailableAt: user.registrationAvailableAt,
      message: 'Este acceso fue cerrado. Podrás solicitar acceso nuevamente después del período de 2 días.',
    });
  }

  if (user.emailVerified === false) {
    return res.status(403).json({
      success: false,
      verificationRequired: true,
      username: user.usuario,
      resendAvailableAt: new Date(Date.parse(user.verificationCodeSentAt || 0) + 30000).toISOString(),
      message: 'Verifica el código enviado a tu correo para continuar.',
    });
  }

  clearFailedLogins(user);
  return continueAfterPrimaryFactor(res, user);
});

router.post('/auth/password/change', (req, res) => {
  const challenge = getAuthChallenge(req.body?.challengeId, 'password-change');
  const user = findChallengeUser(challenge);

  if (!isChallengeCurrentForUser(challenge, user)) {
    return res.status(401).json({ success: false, message: 'La solicitud para cambiar contraseña no es válida o venció.' });
  }

  const validation = validatePassword(req.body?.password, {
    username: user.usuario,
    displayName: user.nombre,
  });

  if (!validation.valid) {
    return res.status(400).json({
      success: false,
      message: 'La contraseña no cumple la política de seguridad.',
      passwordPolicyErrors: validation.errors,
    });
  }

  user.password = hashPasswordSync(req.body.password);
  user.passwordPolicyVersion = PASSWORD_POLICY_VERSION;
  user.passwordChangeRequired = false;
  user.passwordChangedAt = new Date().toISOString();
  user.sessionVersion = Number(user.sessionVersion || 1) + 1;
  clearFailedLogins(user);
  saveData();
  revokeUserSessions(user.usuario, 'password-changed');
  consumeAuthChallenge(challenge);

  return continueAfterPrimaryFactor(res, user);
});

router.post('/auth/mfa/enrollment', async (req, res) => {
  const challenge = getAuthChallenge(req.body?.challengeId, 'mfa-enrollment');
  const user = findChallengeUser(challenge);

  if (!isChallengeCurrentForUser(challenge, user) || !isPrivilegedRole(getUserRole(user)) || user.mfaEnabled) {
    return res.status(401).json({ success: false, message: 'La configuración MFA no es válida o venció.' });
  }

  try {
    if (!challenge.mfaEnrollmentSecret) {
      const enrollment = await createEnrollment(user.usuario);
      challenge.mfaEnrollmentSecret = enrollment.encryptedSecret;
      saveData();
      return res.json({
        success: true,
        challengeId: challenge.id,
        qrCodeDataUrl: enrollment.qrCodeDataUrl,
        manualEntryKey: enrollment.manualEntryKey,
        expiresAt: challenge.expiresAt,
      });
    }

    const presentation = await createEnrollmentPresentation(user.usuario, challenge.mfaEnrollmentSecret);
    return res.json({
      success: true,
      challengeId: challenge.id,
      qrCodeDataUrl: presentation.qrCodeDataUrl,
      manualEntryKey: presentation.manualEntryKey,
      expiresAt: challenge.expiresAt,
    });
  } catch (error) {
    console.error('Error al preparar MFA:', error);
    return res.status(500).json({ success: false, message: 'No se pudo preparar la configuración MFA.' });
  }
});

router.post('/auth/mfa/confirm', (req, res) => {
  const challenge = getAuthChallenge(req.body?.challengeId, 'mfa-enrollment');
  const user = findChallengeUser(challenge);

  if (!isChallengeCurrentForUser(challenge, user) || !isPrivilegedRole(getUserRole(user)) || !challenge?.mfaEnrollmentSecret) {
    return res.status(401).json({ success: false, message: 'La configuración MFA no es válida o venció.' });
  }

  try {
    if (!verifyTotpCode(challenge.mfaEnrollmentSecret, req.body?.code)) {
      recordChallengeFailure(challenge);
      return res.status(400).json({ success: false, message: 'El código MFA no es válido.' });
    }
  } catch (error) {
    recordChallengeFailure(challenge);
    return res.status(400).json({ success: false, message: 'El código MFA no es válido.' });
  }

  user.mfaSecret = challenge.mfaEnrollmentSecret;
  user.mfaEnabled = true;
  user.mfaEnrolledAt = new Date().toISOString();
  user.sessionVersion = Number(user.sessionVersion || 1) + 1;
  saveData();
  revokeUserSessions(user.usuario, 'mfa-enrolled');
  consumeAuthChallenge(challenge);

  return sendSessionResponse(res, user, { mfaVerified: true });
});

router.post('/auth/mfa/verify', (req, res) => {
  const challenge = getAuthChallenge(req.body?.challengeId, 'mfa-login');
  const user = findChallengeUser(challenge);

  if (!isChallengeCurrentForUser(challenge, user) || !isPrivilegedRole(getUserRole(user)) || !user?.mfaEnabled || !user?.mfaSecret) {
    return res.status(401).json({ success: false, message: 'La verificación MFA no es válida o venció.' });
  }

  try {
    if (!verifyTotpCode(user.mfaSecret, req.body?.code)) {
      recordChallengeFailure(challenge);
      return res.status(400).json({ success: false, message: 'El código MFA no es válido.' });
    }
  } catch (error) {
    recordChallengeFailure(challenge);
    return res.status(400).json({ success: false, message: 'El código MFA no es válido.' });
  }

  consumeAuthChallenge(challenge);
  return sendSessionResponse(res, user, { mfaVerified: true });
});

router.post('/logout', authenticate, (req, res) => {
  revokeUserSessions(req.user.username, 'logout');
  return res.json({ success: true });
});

module.exports = router;