const assert = require('assert/strict');
const bcrypt = require('bcrypt');
const { spawn } = require('child_process');
const fs = require('fs');
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
  const today = new Date().toISOString().slice(0, 10);
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
    authChallenges: [],
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

const enrollMfaAndGetSession = async (username, password, role) => {
  const login = await request('POST', '/login', { usuario: username, password, role });
  assert.equal(login.status, 403, `${username} debe requerir inscripción MFA.`);
  assert.equal(login.body.mfaEnrollmentRequired, true, `${username} no recibió un desafío MFA.`);

  const enrollment = await request('POST', '/auth/mfa/enrollment', { challengeId: login.body.mfaChallengeId });
  assert.equal(enrollment.status, 200, 'No se pudo emitir la configuración TOTP.');
  assert.ok(enrollment.body.manualEntryKey, 'No se emitió la clave TOTP.');

  const confirmation = await request('POST', '/auth/mfa/confirm', {
    challengeId: login.body.mfaChallengeId,
    code: authenticator.generate(enrollment.body.manualEntryKey),
  });
  assert.equal(confirmation.status, 200, 'No se pudo confirmar MFA.');
  assert.ok(confirmation.body.token, 'MFA no emitió una sesión.');
  return confirmation.body.token;
};

const run = async () => {
  writeFixture();
  const server = await startServer();

  try {
    const spoofedRole = await request('GET', '/appointments', undefined, null, { 'x-user-role': 'admin' });
    assert.equal(spoofedRole.status, 401, 'Una cabecera de rol falsificada no puede acceder a citas.');

    const anonymousPush = await request('POST', '/push/subscriptions', {
      subscription: { endpoint: 'https://example.invalid/push' },
    });
    assert.equal(anonymousPush.status, 401, 'Una suscripción push anónima no debe aceptarse.');

    const weakRegistration = await request('POST', '/register', {
      usuario: 'nuevo.paciente',
      password: '1234',
    });
    assert.equal(weakRegistration.status, 400, 'Se aceptó una contraseña débil.');
    assert.ok(Array.isArray(weakRegistration.body.passwordPolicyErrors), 'Faltan detalles de política de contraseña.');

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

    const doctorToken = await enrollMfaAndGetSession('doctor1', 'Medico#2026Clave', 'doctor');
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

    const adminToken = await enrollMfaAndGetSession('admin', 'Luna#2026Clave', 'admin');
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