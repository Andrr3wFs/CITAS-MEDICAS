const assert = require('assert/strict');
const bcrypt = require('bcrypt');
const { spawn } = require('child_process');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const os = require('os');
const path = require('path');
const { authenticator } = require('otplib');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const PORT = 5199;
const dataFile = path.join(os.tmpdir(), `hospital-security-test-${process.pid}.json`);

const createUser = (usuario, password, role, nombre, overrides = {}) => ({
  usuario,
  password: bcrypt.hashSync(password, 10),
  role,
  nombre,
  sessionVersion: 1,
  mfaEnabled: false,
  passwordPolicyVersion: 1,
  passwordChangeRequired: false,
  ...(role === 'paciente' ? { estadoAprobacion: 'aprobado' } : {}),
  ...overrides,
});

const writeFixture = () => {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const fixture = {
    appointments: [
      {
        id: 1,
        nombre: 'pacientea',
        patientId: 'pacientea',
        doctor: 'Doctor Uno',
        doctorUsername: 'doctor1',
        fecha: today,
        hora: '09:00',
        especialidad: 'General',
        estado: 'atendida',
        diagnostico: 'Diagnóstico privado A',
        clinicalHistory: { diagnosis: 'Diagnóstico privado A' },
      },
      {
        id: 2,
        nombre: 'pacienteb',
        patientId: 'pacienteb',
        doctor: 'Doctor Dos',
        doctorUsername: 'doctor2',
        fecha: today,
        hora: '10:00',
        especialidad: 'Cardiología',
        estado: 'atendida',
        diagnostico: 'Diagnóstico privado B',
        clinicalHistory: { diagnosis: 'Diagnóstico privado B' },
      },
    ],
    users: [
      createUser('admin', 'Luna#2026Clave', 'admin', 'Operaciones'),
      createUser('doctor1', 'Medico#2026Clave', 'doctor', 'Doctor Uno'),
      createUser('doctor2', 'Segundo#2026Medico', 'doctor', 'Doctor Dos'),
      createUser('pacientea', 'Brisa#2026Fuerte', 'paciente', 'Paciente A'),
      createUser('pacienteb', 'Nube#2026Fuerte', 'paciente', 'Paciente B'),
      createUser('legado', 'Antigua#2026Clave', 'paciente', 'Cuenta Legada', { passwordPolicyVersion: undefined }),
    ],
    pushSubscriptions: [],
    notificationConfig: {},
    accessRequests: [],
    admissions: [],
    beds: [],
    auditLogs: [],
    sessions: [],
    authChallenges: [
      {
        id: 'recoverable-mfa-enrollment',
        username: 'doctor2',
        purpose: 'mfa-enrollment',
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
        attempts: 0,
        sessionVersion: 1,
        mfaEnrollmentSecret: 'v1.invalid.invalid.invalid',
      },
    ],
    integrationConfig: {},
  };

  fs.writeFileSync(dataFile, JSON.stringify(fixture, null, 2));
};

const startServer = () => new Promise((resolve, reject) => {
  const server = spawn(process.execPath, [path.join(ROOT_DIR, 'index.js')], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOSPITAL_DATA_FILE: dataFile,
      JWT_SECRET: 'security-test-jwt-secret',
      MFA_ENCRYPTION_KEY: 'security-test-mfa-encryption-key',
      DISABLE_EMAIL_NOTIFICATIONS: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const timer = setTimeout(() => reject(new Error('El servidor de prueba no inició a tiempo.')), 30000);

  server.stdout.on('data', (chunk) => {
    if (chunk.toString().includes('Servidor corriendo')) {
      clearTimeout(timer);
      resolve(server);
    }
  });
  server.stderr.on('data', (chunk) => process.stderr.write(chunk));
  server.on('exit', (code) => {
    clearTimeout(timer);
    reject(new Error(`El servidor de prueba terminó prematuramente (${code}).`));
  });
});

const request = async (method, pathname, body, token, additionalHeaders = {}) => {
  const response = await fetch(`http://127.0.0.1:${PORT}/api${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...additionalHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  return { status: response.status, body: await response.json() };
};

const getPersistedSession = (token) => {
  const sessionId = jwt.decode(token)?.sid;
  const persistedData = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  return persistedData.sessions.find((session) => session.id === sessionId) || null;
};

const assertMfaVerifiedSession = (token, username) => {
  const session = getPersistedSession(token);
  assert.equal(session?.username, username, `No se encontró la sesión de ${username}.`);
  assert.ok(Number.isFinite(Date.parse(session?.mfaVerifiedAt || '')), `${username} no registró mfaVerifiedAt.`);
};

const getPreviousStepCode = (secret) => authenticator.clone({ epoch: Date.now() - 59 * 1000 }).generate(secret);

const enrollMfaAndGetSession = async (username, password, role) => {
  const login = await request('POST', '/login', { usuario: username, password, role });
  assert.equal(login.status, 403, `${username} debe requerir inscripción MFA.`);
  assert.equal(login.body.mfaEnrollmentRequired, true, `${username} no recibió un desafío MFA.`);

  const enrollment = await request('POST', '/auth/mfa/enrollment', { challengeId: login.body.mfaChallengeId });
  assert.equal(enrollment.status, 200, 'No se pudo emitir la configuración TOTP.');
  assert.ok(enrollment.body.manualEntryKey, 'No se emitió la clave TOTP.');

  const persistedEnrollmentChallenge = JSON.parse(fs.readFileSync(dataFile, 'utf8')).authChallenges.find(
    (challenge) => challenge.id === login.body.mfaChallengeId
  );
  const persistedEnrollmentUser = JSON.parse(fs.readFileSync(dataFile, 'utf8')).users.find(
    (user) => user.usuario === username
  );
  assert.ok(persistedEnrollmentUser?.mfaSecretTemp, 'No se persistió el secreto MFA temporal en el usuario.');
  assert.equal(persistedEnrollmentUser?.mfaEnrollmentChallengeId, login.body.mfaChallengeId, 'El secreto MFA temporal no está vinculado al desafío.');
  assert.equal(persistedEnrollmentChallenge?.tempMfaSecret, undefined, 'El secreto MFA temporal debe residir en el usuario.');
  assert.equal(persistedEnrollmentChallenge?.mfaEnrollmentSecret, undefined, 'El secreto MFA temporal conservó el campo heredado.');

  const repeatedEnrollment = await request('POST', '/auth/mfa/enrollment', { challengeId: login.body.mfaChallengeId });
  assert.equal(repeatedEnrollment.status, 200, 'No se pudo recuperar la inscripción MFA pendiente.');
  assert.equal(repeatedEnrollment.body.manualEntryKey, enrollment.body.manualEntryKey, 'El QR y la confirmación no usan el mismo secreto temporal.');

  const missingCode = await request('POST', '/auth/mfa/confirm', {
    challengeId: login.body.mfaChallengeId,
  });
  assert.equal(missingCode.status, 400, 'La confirmación MFA incompleta debe rechazarse.');
  assert.equal(missingCode.body.reason, 'missing-mfa-fields', 'Falta el motivo de cuerpo MFA incompleto.');

  const malformedCode = await request('POST', '/auth/mfa/confirm', {
    challengeId: login.body.mfaChallengeId,
    code: '12ab34',
  });
  assert.equal(malformedCode.status, 400, 'Un código MFA mal formado debe rechazarse.');
  assert.equal(malformedCode.body.reason, 'invalid-mfa-code-format', 'Falta el motivo de formato MFA inválido.');

  const validCode = getPreviousStepCode(enrollment.body.manualEntryKey);
  const invalidCode = `${(Number(validCode[0]) + 1) % 10}${validCode.slice(1)}`;
  const rejectedCode = await request('POST', '/auth/mfa/confirm', {
    challengeId: login.body.mfaChallengeId,
    code: invalidCode,
  });
  assert.equal(rejectedCode.status, 400, 'Un código MFA inválido debe rechazarse.');
  assert.equal(rejectedCode.body.reason, 'invalid-or-expired-mfa-code', 'Falta el motivo de código MFA inválido.');

  const confirmation = await request('POST', '/auth/mfa/confirm', {
    challengeId: login.body.mfaChallengeId,
    code: validCode,
  });
  assert.equal(confirmation.status, 200, 'No se pudo confirmar MFA.');
  assert.ok(confirmation.body.token, 'MFA no emitió una sesión.');
  const activatedUser = JSON.parse(fs.readFileSync(dataFile, 'utf8')).users.find(
    (user) => user.usuario === username
  );
  assert.equal(activatedUser?.mfaSecret, persistedEnrollmentUser.mfaSecretTemp, 'No se activó el secreto MFA temporal validado.');
  assert.equal(activatedUser?.mfaSecretTemp, undefined, 'El secreto MFA temporal no se eliminó después de activarlo.');
  assertMfaVerifiedSession(confirmation.body.token, username);
  return { token: confirmation.body.token, manualEntryKey: enrollment.body.manualEntryKey };
};

const run = async () => {
  writeFixture();
  const server = await startServer();

  try {
    const spoofedRole = await request('GET', '/appointments', undefined, null, { 'x-user-role': 'admin' });
    assert.equal(spoofedRole.status, 401, 'Una cabecera de rol falsificada no puede acceder a citas.');

    const missingTemporarySecret = await request('POST', '/auth/mfa/confirm', {
      challengeId: 'recoverable-mfa-enrollment',
      code: '123456',
    });
    assert.equal(missingTemporarySecret.status, 400, 'Un desafío MFA sin secreto temporal debe rechazarse.');
    assert.equal(missingTemporarySecret.body.reason, 'missing-active-mfa-secret', 'Falta el motivo de secreto MFA temporal ausente.');

    const anonymousPush = await request('POST', '/push/subscriptions', {
      subscription: { endpoint: 'https://example.invalid/push' },
    });
    assert.equal(anonymousPush.status, 401, 'Una suscripción push anónima no debe aceptarse.');

    const recoveredEnrollment = await request('POST', '/auth/mfa/enrollment', {
      challengeId: 'recoverable-mfa-enrollment',
    });
    assert.equal(recoveredEnrollment.status, 200, 'Una inscripción MFA incompleta no pudo regenerarse.');
    assert.ok(recoveredEnrollment.body.qrCodeDataUrl, 'La inscripción MFA regenerada no incluye QR.');
    const recoveredChallenge = JSON.parse(fs.readFileSync(dataFile, 'utf8')).authChallenges.find(
      (challenge) => challenge.id === 'recoverable-mfa-enrollment'
    );
    assert.notEqual(recoveredChallenge?.mfaEnrollmentSecret, 'v1.invalid.invalid.invalid', 'El secreto MFA dañado no fue reemplazado.');

    const weakRegistration = await request('POST', '/register', {
      nombre: 'Paciente nuevo',
      usuario: 'nuevo.paciente',
      password: '1234',
    });
    assert.equal(weakRegistration.status, 400, 'Se aceptó una contraseña débil.');
    assert.ok(Array.isArray(weakRegistration.body.passwordPolicyErrors), 'Faltan detalles de política de contraseña.');

    const missingNameRegistration = await request('POST', '/register', {
      usuario: 'sin.nombre',
      password: 'Brisa#2026Fuerte',
    });
    assert.equal(missingNameRegistration.status, 400, 'Se aceptó un registro sin nombre completo.');

    const namedRegistration = await request('POST', '/register', {
      nombre: 'Alicia Mendez',
      usuario: 'alicia.mendez@medicenter.test',
      password: 'Canyon!42Birch2026',
    });
    assert.equal(namedRegistration.status, 200, 'Se rechazó un registro con nombre completo válido.');
    const persistedRegistration = JSON.parse(fs.readFileSync(dataFile, 'utf8')).accessRequests.find(
      (requestEntry) => requestEntry.usuario === 'alicia.mendez@medicenter.test'
    );
    assert.equal(persistedRegistration?.nombre, 'Alicia Mendez', 'El nombre completo no se guardó en la solicitud.');

    const legacyLogin = await request('POST', '/login', { usuario: 'legado', password: 'Antigua#2026Clave' });
    assert.equal(legacyLogin.status, 403, 'La cuenta heredada debe renovar su contraseña.');
    assert.equal(legacyLogin.body.passwordChangeRequired, true, 'Falta el desafío de cambio de contraseña.');

    const legacyChange = await request('POST', '/auth/password/change', {
      challengeId: legacyLogin.body.passwordChangeChallengeId,
      password: 'Brisa#2026Fuerte',
    });
    assert.equal(legacyChange.status, 200, 'La renovación de contraseña válida fue rechazada.');

    const mismatchedPortal = await request('POST', '/login', {
      usuario: 'pacientea',
      password: 'Brisa#2026Fuerte',
      role: 'doctor',
    });
    assert.equal(mismatchedPortal.status, 403, 'Un paciente pudo acceder al portal médico.');

    const patientLogin = await request('POST', '/login', {
      usuario: 'pacientea',
      password: 'Brisa#2026Fuerte',
      role: 'patient',
    });
    assert.equal(patientLogin.status, 200, 'El paciente no obtuvo sesión.');
    const patientToken = patientLogin.body.token;

    const appointmentList = await request('GET', '/appointments', undefined, patientToken);
    assert.equal(appointmentList.status, 200, 'El paciente no pudo consultar sus citas.');
    assert.deepEqual(appointmentList.body.appointments.map((appointment) => appointment.id), [1], 'El paciente recibió citas ajenas.');

    const foreignAppointment = await request('GET', '/appointments/2', undefined, patientToken);
    assert.equal(foreignAppointment.status, 403, 'El paciente accedió a una cita ajena.');

    const foreignHistory = await request('GET', '/paciente/historial', undefined, patientToken);
    assert.equal(foreignHistory.status, 200, 'El paciente no pudo consultar su propio historial.');
    assert.deepEqual(foreignHistory.body.history.map((entry) => entry.appointmentId), [1], 'El historial del paciente contiene datos ajenos.');

    const doctorSchedule = await request('GET', '/doctor/citas', undefined, patientToken);
    assert.equal(doctorSchedule.status, 403, 'El paciente accedió a horarios de médicos.');

    const doctorEnrollment = await enrollMfaAndGetSession('doctor1', 'Medico#2026Clave', 'doctor');
    const doctorToken = doctorEnrollment.token;
    const doctorMetrics = await request('GET', '/metrics/appointments', undefined, doctorToken);
    assert.equal(doctorMetrics.status, 200, 'El médico MFA no pudo consultar sus métricas.');
    assert.equal(doctorMetrics.body.attended, 1, 'Las métricas del médico incluyen citas ajenas.');
    assert.equal(doctorMetrics.body.demandBySpecialty.some((entry) => entry.name === 'Cardiología'), false, 'Las métricas filtraron información ajena.');

    const foreignLabOrder = await request('POST', '/orders/lab', {
      patientId: 'pacienteb',
      appointmentId: 2,
      orderCode: '1234',
    }, doctorToken);
    assert.equal(foreignLabOrder.status, 403, 'El médico creó una orden para una cita ajena.');

    const ownLabOrder = await request('POST', '/orders/lab', {
      patientId: 'pacientea',
      appointmentId: 1,
      orderCode: '1234',
    }, doctorToken);
    assert.equal(ownLabOrder.status, 200, 'El médico no pudo crear una orden de su cita asignada.');

    const doctorLogin = await request('POST', '/login', {
      usuario: 'doctor1',
      password: 'Medico#2026Clave',
      role: 'doctor',
    });
    assert.equal(doctorLogin.status, 401, 'El médico con MFA habilitado no recibió un desafío de inicio de sesión.');
    assert.equal(doctorLogin.body.mfaRequired, true, 'Falta el desafío MFA de inicio de sesión del médico.');

    const doctorMfaLogin = await request('POST', '/auth/mfa/verify', {
      challengeId: doctorLogin.body.mfaChallengeId,
      code: getPreviousStepCode(doctorEnrollment.manualEntryKey),
    });
    assert.equal(doctorMfaLogin.status, 200, 'El código TOTP con una ventana anterior fue rechazado al iniciar sesión.');
    assertMfaVerifiedSession(doctorMfaLogin.body.token, 'doctor1');

    const doctorMfaMetrics = await request('GET', '/metrics/appointments', undefined, doctorMfaLogin.body.token);
    assert.equal(doctorMfaMetrics.status, 200, 'La sesión MFA del médico fue rechazada por el middleware.');

    const adminEnrollment = await enrollMfaAndGetSession('admin', 'Luna#2026Clave', 'admin');
    const adminToken = adminEnrollment.token;
    const adminAppointments = await request('GET', '/admin/citas', undefined, adminToken);
    assert.equal(adminAppointments.status, 200, 'El administrador MFA no pudo acceder a su ruta.');

    const logout = await request('POST', '/logout', undefined, adminToken);
    assert.equal(logout.status, 200, 'No se pudo cerrar sesión en el servidor.');
    const revokedSession = await request('GET', '/admin/citas', undefined, adminToken);
    assert.equal(revokedSession.status, 401, 'La sesión revocada mantiene acceso.');
  } finally {
    server.kill();
    fs.rmSync(dataFile, { force: true });
  }
};

run()
  .then(() => console.log('security-auth-check: ok'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });