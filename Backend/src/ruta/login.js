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
const {
  createEnrollment,
  createEnrollmentPresentation,
  MfaSecretDecryptionError,
  verifyTotpCode,
} = require('../mfa');
const { validatePassword } = require('../passwordPolicy');

const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const LOGIN_PORTAL_ROLES = new Set(['paciente', 'doctor', 'admin']);
const LOGIN_PORTAL_ROLE_ALIASES = new Map([
  ['patient', 'paciente'],
  ['paciente', 'paciente'],
  ['doctor', 'doctor'],
  ['admin', 'admin'],
]);

const getUserRole = (user) => String(user?.role || 'paciente').trim().toLowerCase();
const normalizePortalRole = (role) => {
  const normalizedRole = String(role || '').trim().toLowerCase();
  return LOGIN_PORTAL_ROLE_ALIASES.get(normalizedRole) || normalizedRole;
};

const canAccessPortal = (userRole, portalRole) => {
  if (!portalRole) return true;

  if (portalRole === 'admin') {
    return ['admin', 'secretaria'].includes(userRole);
  }

  return userRole === portalRole;
};

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
const MFA_CODE_PATTERN = /^\d{6}$/;

const getLegacyTemporaryMfaSecret = (challenge) => String(
  challenge?.tempMfaSecret || challenge?.mfaEnrollmentSecret || ''
).trim();

const getLegacyTemporaryMfaSecretSource = (challenge) => {
  if (challenge?.tempMfaSecret) return 'tempMfaSecret';
  if (challenge?.mfaEnrollmentSecret) return 'legacy-mfaEnrollmentSecret';
  return null;
};

const getUserTemporaryMfaSecret = (user) => String(user?.mfaSecretTemp || '').trim();
const isUserTemporaryMfaSecretBoundToChallenge = (user, challenge) => (
  Boolean(getUserTemporaryMfaSecret(user))
    && user?.mfaEnrollmentChallengeId === challenge?.id
);

const getMfaConfirmationRequest = (body) => {
  const requestBody = body && typeof body === 'object' ? body : {};

  return {
    challengeId: String(requestBody.challengeId || '').trim(),
    code: String(requestBody.code || '').trim(),
    requestFields: Object.keys(requestBody),
  };
};

const getMfaConfirmationLogDetails = ({ challengeId, code, requestFields, challenge, user }) => ({
  requestFields,
  hasChallengeId: Boolean(challengeId),
  challengeIdPrefix: challengeId ? `${challengeId.slice(0, 8)}...` : null,
  codeLength: code.length,
  codeFormatValid: MFA_CODE_PATTERN.test(code),
  challengeFound: Boolean(challenge),
  userFound: Boolean(user),
  hasTemporarySecret: Boolean(getUserTemporaryMfaSecret(user)),
  temporarySecretBoundToChallenge: isUserTemporaryMfaSecretBoundToChallenge(user, challenge),
  legacyTemporarySecretSource: getLegacyTemporaryMfaSecretSource(challenge),
  serverTime: new Date().toISOString(),
});

const respondToMfaVerificationError = (res, challenge, error) => {
  if (error instanceof MfaSecretDecryptionError) {
    console.error(`No se pudo descifrar el secreto MFA de ${challenge?.username || 'un usuario'}. Verifica MFA_ENCRYPTION_KEY.`);
    return res.status(500).json({
      success: false,
      message: 'No se pudo validar la configuración MFA. Solicita al administrador que reinicie tu configuración MFA.',
    });
  }

  console.error('MFA verification failed unexpectedly:', {
    challengeFound: Boolean(challenge),
    errorName: error?.name || 'UnknownError',
  });
  recordChallengeFailure(challenge);
  return res.status(500).json({
    success: false,
    reason: 'mfa-verification-failed',
    message: 'No se pudo validar el código MFA. Inténtalo nuevamente.',
  });
};

router.post('/login', (req, res) => {
  const { usuario, password } = req.body;

  const normalizedUsername = normalizeUsername(usuario);
  const normalizedPassword = String(password || '');
  const portalRole = normalizePortalRole(req.body?.role ?? req.body?.portalRole);

  if (portalRole && !LOGIN_PORTAL_ROLES.has(portalRole)) {
    return res.status(400).json({
      success: false,
      message: 'El tipo de acceso seleccionado no es válido.',
    });
  }

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

  if (!canAccessPortal(getUserRole(user), portalRole)) {
    return res.status(403).json({
      success: false,
      message: 'Esta cuenta no tiene acceso al portal seleccionado.',
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

  const createEnrollmentForChallenge = async () => {
    const enrollment = await createEnrollment(user.usuario);
    user.mfaSecretTemp = enrollment.encryptedSecret;
    user.mfaEnrollmentChallengeId = challenge.id;
    user.mfaEnrollmentStartedAt = new Date().toISOString();
    delete challenge.tempMfaSecret;
    delete challenge.mfaEnrollmentSecret;
    saveData();

    console.log('[MFA SETUP] Secret temporal persistido:', {
      username: user.usuario,
      challengeIdPrefix: `${challenge.id.slice(0, 8)}...`,
      hasTemporarySecret: true,
    });
    return enrollment;
  };

  try {
    const legacyTemporaryMfaSecret = getLegacyTemporaryMfaSecret(challenge);
    if (legacyTemporaryMfaSecret && !getUserTemporaryMfaSecret(user)) {
      user.mfaSecretTemp = legacyTemporaryMfaSecret;
      user.mfaEnrollmentChallengeId = challenge.id;
      user.mfaEnrollmentStartedAt = new Date().toISOString();
      delete challenge.tempMfaSecret;
      delete challenge.mfaEnrollmentSecret;
      saveData();
    }

    const hasCurrentTemporarySecret = isUserTemporaryMfaSecretBoundToChallenge(user, challenge);
    const enrollment = hasCurrentTemporarySecret
      ? await createEnrollmentPresentation(user.usuario, getUserTemporaryMfaSecret(user))
      : await createEnrollmentForChallenge();

    return res.json({
      success: true,
      challengeId: challenge.id,
      qrCodeDataUrl: enrollment.qrCodeDataUrl,
      manualEntryKey: enrollment.manualEntryKey,
      expiresAt: challenge.expiresAt,
    });
  } catch (error) {
    if (error instanceof MfaSecretDecryptionError) {
      console.warn(`Se regeneró una inscripción MFA incompleta para ${user.usuario} porque su secreto no pudo descifrarse.`);

      try {
        const enrollment = await createEnrollmentForChallenge();
        return res.json({
          success: true,
          challengeId: challenge.id,
          qrCodeDataUrl: enrollment.qrCodeDataUrl,
          manualEntryKey: enrollment.manualEntryKey,
          expiresAt: challenge.expiresAt,
        });
      } catch (regenerationError) {
        console.error('Error al regenerar MFA:', regenerationError);
      }
    }

    console.error('Error al preparar MFA:', error);
    return res.status(500).json({ success: false, message: 'No se pudo preparar la configuración MFA.' });
  }
});

router.post('/auth/mfa/confirm', (req, res) => {
  const { challengeId, code, requestFields } = getMfaConfirmationRequest(req.body);
  let logDetails = getMfaConfirmationLogDetails({ challengeId, code, requestFields });

  console.log('MFA confirm request:', logDetails);

  if (!challengeId || !code) {
    console.warn('MFA confirm rejected: missing required fields.', logDetails);
    return res.status(400).json({
      success: false,
      reason: 'missing-mfa-fields',
      message: 'Debes enviar challengeId y un código MFA de seis dígitos.',
    });
  }

  if (!MFA_CODE_PATTERN.test(code)) {
    console.warn('MFA confirm rejected: invalid code format.', logDetails);
    return res.status(400).json({
      success: false,
      reason: 'invalid-mfa-code-format',
      message: 'El código MFA debe contener exactamente seis dígitos.',
    });
  }

  const challenge = getAuthChallenge(challengeId, 'mfa-enrollment');
  const user = findChallengeUser(challenge);
  const temporaryMfaSecret = getUserTemporaryMfaSecret(user);
  logDetails = getMfaConfirmationLogDetails({ challengeId, code, requestFields, challenge, user });

  if (!isChallengeCurrentForUser(challenge, user) || !isPrivilegedRole(getUserRole(user))) {
    console.warn('MFA confirm rejected: enrollment challenge is invalid or expired.', logDetails);
    return res.status(401).json({
      success: false,
      reason: 'invalid-or-expired-mfa-challenge',
      message: 'La configuración MFA no es válida o venció.',
    });
  }

  if (!temporaryMfaSecret || !isUserTemporaryMfaSecretBoundToChallenge(user, challenge)) {
    console.warn('MFA confirm rejected: no active temporary secret for the user.', logDetails);
    return res.status(400).json({
      success: false,
      reason: 'missing-active-mfa-secret',
      message: 'No se encontró un secreto MFA activo para este usuario.',
    });
  }

  try {
    console.log('[MFA CONFIRM] User ID:', user.usuario);
    console.log('[MFA CONFIRM] Secret en BD:', {
      present: true,
      encrypted: temporaryMfaSecret.startsWith('v1.'),
      boundToChallenge: user.mfaEnrollmentChallengeId === challenge.id,
    });
    console.log('[MFA CONFIRM] Token recibido:', {
      redacted: true,
      length: code.length,
      formatValid: MFA_CODE_PATTERN.test(code),
    });

    const isCodeValid = verifyTotpCode(temporaryMfaSecret, code);
    console.log('[MFA CONFIRM] Resultado validación:', isCodeValid);

    if (!isCodeValid) {
      recordChallengeFailure(challenge);
      return res.status(400).json({
        success: false,
        reason: 'invalid-or-expired-mfa-code',
        message: 'Código inválido o expirado.',
      });
    }
  } catch (error) {
    return respondToMfaVerificationError(res, challenge, error);
  }

  user.mfaSecret = temporaryMfaSecret;
  user.mfaEnabled = true;
  user.mfaEnrolledAt = new Date().toISOString();
  user.sessionVersion = Number(user.sessionVersion || 1) + 1;
  delete user.mfaSecretTemp;
  delete user.mfaEnrollmentChallengeId;
  delete user.mfaEnrollmentStartedAt;
  delete challenge.tempMfaSecret;
  delete challenge.mfaEnrollmentSecret;
  saveData();
  revokeUserSessions(user.usuario, 'mfa-enrolled');
  consumeAuthChallenge(challenge);

  console.log('MFA confirm accepted:', {
    challengeIdPrefix: `${challengeId.slice(0, 8)}...`,
    serverTime: new Date().toISOString(),
  });
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
    return respondToMfaVerificationError(res, challenge, error);
  }

  consumeAuthChallenge(challenge);
  return sendSessionResponse(res, user, { mfaVerified: true });
});

router.post('/logout', authenticate, (req, res) => {
  revokeUserSessions(req.user.username, 'logout');
  return res.json({ success: true });
});

module.exports = router;