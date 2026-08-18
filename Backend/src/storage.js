// src/storage.js
// Almacenamiento compartido con persistencia local

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { validatePassword } = require('./passwordPolicy');

const HASHED_PASSWORD_REGEX = /^\$2[aby]\$.{56}$/;
const PASSWORD_POLICY_VERSION = 1;

const createEmptyClinicalHistory = () => ({
  medicalHistory: '',
  diagnosis: '',
  observations: '',
  treatment: '',
  indications: '',
  followUp: '',
});

const dataFilePath = process.env.HOSPITAL_DATA_FILE || path.join(__dirname, 'data.json');

const defaultAppointments = [];
const defaultPushSubscriptions = [];
const defaultAdmissions = [];
const defaultBeds = [
  { id: 1, name: 'C-101', room: 'Pabellón A', type: 'general', status: 'disponible' },
  { id: 2, name: 'C-102', room: 'Pabellón A', type: 'uci', status: 'disponible' },
  { id: 3, name: 'C-201', room: 'Pabellón B', type: 'general', status: 'disponible' },
  { id: 4, name: 'C-202', room: 'Pabellón B', type: 'maternidad', status: 'ocupada' },
];

const getBootstrapUsers = () => {
  const password = String(process.env.BOOTSTRAP_ADMIN_PASSWORD || '');
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin';
  const displayName = process.env.BOOTSTRAP_ADMIN_NAME || 'Administrador inicial';

  if (!password) {
    return [];
  }

  const validation = validatePassword(password, { username, displayName });
  if (!validation.valid) {
    throw new Error(`BOOTSTRAP_ADMIN_PASSWORD no cumple la política: ${validation.errors.join(' ')}`);
  }

  return [{
    usuario: username,
    password,
    role: 'admin',
    nombre: displayName,
    passwordPolicyVersion: PASSWORD_POLICY_VERSION,
  }];
};

const normalizeText = (value) =>
  String(value || '').trim().replace(/[<>]/g, (match) => (match === '<' ? '&lt;' : '&gt;'));

const normalizeUsername = (username) => String(username || '').trim().toLowerCase();

const hashPasswordSync = (password) => bcrypt.hashSync(String(password), 10);
const isPasswordHashed = (value) => HASHED_PASSWORD_REGEX.test(String(value || ''));

const normalizeUser = (user = {}) => {
  const normalizedUsuario = normalizeUsername(user?.usuario);
  const rawPassword = String(user?.password || '');
  const parsedSessionVersion = Number(user?.sessionVersion);

  return {
    role: 'paciente',
    nombre: user?.nombre || user?.usuario || 'Paciente',
    ...user,
    ...(user?.role === 'paciente' && !user?.estadoAprobacion ? { estadoAprobacion: 'aprobado' } : {}),
    usuario: normalizedUsuario,
    password: isPasswordHashed(rawPassword) ? rawPassword : hashPasswordSync(rawPassword),
    mfaEnabled: user?.mfaEnabled === true,
    passwordChangeRequired: user?.passwordChangeRequired === true,
    sessionVersion: Number.isInteger(parsedSessionVersion) && parsedSessionVersion > 0 ? parsedSessionVersion : 1,
  };
};

const normalizeAccessRequest = (request = {}) => {
  const normalizedRequest = {
    ...request,
    usuario: normalizeUsername(request?.usuario),
    nombre: request?.nombre || request?.usuario || '',
  };
  const rawPassword = String(normalizedRequest.password || '');

  return {
    ...normalizedRequest,
    password: isPasswordHashed(rawPassword) ? rawPassword : hashPasswordSync(rawPassword),
  };
};

const normalizeAppointment = (appointment) => {
  const clinicalHistory = {
    ...createEmptyClinicalHistory(),
    ...(appointment?.clinicalHistory || {}),
  };

  clinicalHistory.diagnosis = normalizeText(clinicalHistory.diagnosis || appointment?.diagnostico || '');
  clinicalHistory.medicalHistory = normalizeText(clinicalHistory.medicalHistory);
  clinicalHistory.observations = normalizeText(clinicalHistory.observations);
  clinicalHistory.treatment = normalizeText(clinicalHistory.treatment);
  clinicalHistory.indications = normalizeText(clinicalHistory.indications);
  clinicalHistory.followUp = normalizeText(clinicalHistory.followUp);

  const normalizedNombre = normalizeText(appointment?.nombre || '');

  return {
    ...appointment,
    nombre: normalizedNombre,
    patientId: normalizeUsername(normalizedNombre),
    sintoma: normalizeText(appointment?.sintoma),
    fecha: normalizeText(appointment?.fecha),
    hora: normalizeText(appointment?.hora),
    doctor: normalizeText(appointment?.doctor),
    doctorUsername: normalizeUsername(appointment?.doctorUsername || appointment?.doctor),
    especialidad: normalizeText(appointment?.especialidad),
    diagnostico: normalizeText(appointment?.diagnostico || clinicalHistory.diagnosis),
    clinicalHistory,
  };
};

const normalizePushSubscription = (entry = {}) => {
  const endpoint = String(entry?.subscription?.endpoint || entry?.endpoint || '').trim();

  if (!endpoint) {
    return null;
  }

  return {
    username: normalizeUsername(entry?.username),
    role: String(entry?.role || 'paciente').trim().toLowerCase(),
    displayName: String(entry?.displayName || entry?.username || 'Paciente').trim(),
    subscription: entry.subscription,
    createdAt: entry.createdAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || new Date().toISOString(),
  };
};

const normalizePushSubscriptions = (subscriptions = []) => {
  const entriesByEndpoint = new Map();

  subscriptions.forEach((entry) => {
    const normalizedEntry = normalizePushSubscription(entry);

    if (!normalizedEntry) {
      return;
    }

    entriesByEndpoint.set(normalizedEntry.subscription.endpoint, normalizedEntry);
  });

  return Array.from(entriesByEndpoint.values());
};

const normalizeNotificationConfig = (notificationConfig = {}) => ({
  subject: String(notificationConfig?.subject || 'mailto:admin@saludvida.local').trim(),
  vapidKeys: {
    publicKey: String(notificationConfig?.vapidKeys?.publicKey || '').trim(),
    privateKey: String(notificationConfig?.vapidKeys?.privateKey || '').trim(),
  },
});

const normalizeIntegrationConfig = (integrationConfig = {}) => ({
  labEndpoint: String(integrationConfig?.labEndpoint || '').trim(),
});

const normalizeSession = (session = {}) => {
  const id = String(session?.id || '').trim();
  const username = normalizeUsername(session?.username);
  const expiresAt = String(session?.expiresAt || '').trim();

  if (!id || !username || !Number.isFinite(Date.parse(expiresAt))) {
    return null;
  }

  return {
    ...session,
    id,
    username,
    expiresAt,
    issuedAt: String(session?.issuedAt || new Date().toISOString()),
    lastActivityAt: String(session?.lastActivityAt || session?.issuedAt || new Date().toISOString()),
  };
};

const normalizeAuthChallenge = (challenge = {}) => {
  const id = String(challenge?.id || '').trim();
  const username = normalizeUsername(challenge?.username);
  const purpose = String(challenge?.purpose || '').trim();
  const expiresAt = String(challenge?.expiresAt || '').trim();

  if (!id || !username || !purpose || !Number.isFinite(Date.parse(expiresAt))) {
    return null;
  }

  return {
    ...challenge,
    id,
    username,
    purpose,
    expiresAt,
    attempts: Number.isInteger(Number(challenge?.attempts)) ? Number(challenge.attempts) : 0,
  };
};

const normalizeAppointments = (appointments = []) => {
  const usedIds = new Set();
  let nextGeneratedId = 1;

  return appointments.map((appointment) => {
    const normalizedAppointment = normalizeAppointment(appointment);
    const parsedId = Number(normalizedAppointment?.id);
    const hasValidUniqueId = Number.isInteger(parsedId) && parsedId > 0 && !usedIds.has(parsedId);

    if (hasValidUniqueId) {
      usedIds.add(parsedId);
      nextGeneratedId = Math.max(nextGeneratedId, parsedId + 1);
      return normalizedAppointment;
    }

    while (usedIds.has(nextGeneratedId)) {
      nextGeneratedId += 1;
    }

    usedIds.add(nextGeneratedId);

    return {
      ...normalizedAppointment,
      id: nextGeneratedId++,
    };
  });
};

const buildDefaultData = () => ({
  appointments: normalizeAppointments(defaultAppointments),
  users: getBootstrapUsers().map(normalizeUser),
  pushSubscriptions: normalizePushSubscriptions(defaultPushSubscriptions),
  notificationConfig: normalizeNotificationConfig(),
  accessRequests: [],
  admissions: defaultAdmissions,
  beds: defaultBeds,
  auditLogs: [],
  sessions: [],
  authChallenges: [],
  integrationConfig: normalizeIntegrationConfig(),
});

const writeDataFile = (data) => {
  fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2), 'utf8');
};

const loadData = () => {
  if (!fs.existsSync(dataFilePath)) {
    const defaultData = buildDefaultData();
    writeDataFile(defaultData);
    return defaultData;
  }

  try {
    const rawData = fs.readFileSync(dataFilePath, 'utf8');
    const parsedData = JSON.parse(rawData || '{}');
    let hasUpdates = false;

    const users = Array.isArray(parsedData.users)
      ? parsedData.users.map((user) => {
          const normalized = normalizeUser(user);
          const requiresPasswordChange = normalized.passwordChangeRequired
            || Number(user?.passwordPolicyVersion) !== PASSWORD_POLICY_VERSION;

          if (requiresPasswordChange) {
            normalized.passwordChangeRequired = true;
          }

          if (
            !isPasswordHashed(String(user?.password || ''))
            || (user?.role === 'paciente' && !user?.estadoAprobacion)
            || normalized.passwordChangeRequired !== (user?.passwordChangeRequired === true)
            || normalized.sessionVersion !== Number(user?.sessionVersion || 1)
            || normalized.mfaEnabled !== (user?.mfaEnabled === true)
          ) {
            hasUpdates = true;
          }
          return normalized;
        })
      : buildDefaultData().users;

    const accessRequests = Array.isArray(parsedData.accessRequests)
      ? parsedData.accessRequests.map((request) => {
          const normalized = normalizeAccessRequest(request);
          if (!isPasswordHashed(String(request?.password || ''))) {
            hasUpdates = true;
          }
          return normalized;
        })
      : buildDefaultData().accessRequests;

    const sessions = Array.isArray(parsedData.sessions)
      ? parsedData.sessions
          .map(normalizeSession)
          .filter((session) => session && !session.revokedAt && Date.parse(session.expiresAt) > Date.now())
      : [];

    const authChallenges = Array.isArray(parsedData.authChallenges)
      ? parsedData.authChallenges
          .map(normalizeAuthChallenge)
          .filter((challenge) => challenge && !challenge.consumedAt && Date.parse(challenge.expiresAt) > Date.now())
      : [];

    if (!Array.isArray(parsedData.sessions) || !Array.isArray(parsedData.authChallenges)) {
      hasUpdates = true;
    }

    const storedData = {
      appointments: Array.isArray(parsedData.appointments)
        ? normalizeAppointments(parsedData.appointments)
        : buildDefaultData().appointments,
      users,
      pushSubscriptions: Array.isArray(parsedData.pushSubscriptions)
        ? normalizePushSubscriptions(parsedData.pushSubscriptions)
        : buildDefaultData().pushSubscriptions,
      notificationConfig: normalizeNotificationConfig(parsedData.notificationConfig),
      accessRequests,
      admissions: Array.isArray(parsedData.admissions) ? parsedData.admissions : buildDefaultData().admissions,
      beds: Array.isArray(parsedData.beds) ? parsedData.beds : buildDefaultData().beds,
      auditLogs: Array.isArray(parsedData.auditLogs) ? parsedData.auditLogs : [],
      sessions,
      authChallenges,
      integrationConfig: normalizeIntegrationConfig(parsedData.integrationConfig || {}),
    };

    if (hasUpdates) {
      writeDataFile(storedData);
    }

    return storedData;
  } catch (error) {
    const defaultData = buildDefaultData();
    writeDataFile(defaultData);
    return defaultData;
  }
};

const storedData = loadData();
const appointments = storedData.appointments;
const users = storedData.users;
const pushSubscriptions = storedData.pushSubscriptions;
const notificationConfig = storedData.notificationConfig;
const accessRequests = storedData.accessRequests;
const admissions = storedData.admissions;
const beds = storedData.beds;
const auditLogs = storedData.auditLogs;
const sessions = storedData.sessions;
const authChallenges = storedData.authChallenges;
const integrationConfig = storedData.integrationConfig || { labEndpoint: '' };

const saveData = () => {
  writeDataFile({
    appointments,
    users,
    pushSubscriptions,
    notificationConfig,
    accessRequests,
    admissions,
    beds,
    auditLogs,
    sessions,
    authChallenges,
    integrationConfig,
  });
};

module.exports = {
  appointments,
  users,
  pushSubscriptions,
  notificationConfig,
  accessRequests,
  admissions,
  beds,
  auditLogs,
  sessions,
  authChallenges,
  integrationConfig,
  PASSWORD_POLICY_VERSION,
  saveData,
  normalizeUsername,
  isPasswordHashed,
  hashPasswordSync,
};

