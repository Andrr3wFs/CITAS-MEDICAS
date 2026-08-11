// src/storage.js
// Almacenamiento compartido con persistencia local

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

const HASHED_PASSWORD_REGEX = /^\$2[aby]\$.{56}$/;

const createEmptyClinicalHistory = () => ({
  medicalHistory: '',
  diagnosis: '',
  observations: '',
  treatment: '',
  indications: '',
  followUp: '',
});

const dataFilePath = path.join(__dirname, 'data.json');

const defaultAppointments = [];
const defaultPushSubscriptions = [];
const defaultAdmissions = [];
const defaultBeds = [
  { id: 1, name: 'C-101', room: 'Pabellón A', type: 'general', status: 'disponible' },
  { id: 2, name: 'C-102', room: 'Pabellón A', type: 'uci', status: 'disponible' },
  { id: 3, name: 'C-201', room: 'Pabellón B', type: 'general', status: 'disponible' },
  { id: 4, name: 'C-202', room: 'Pabellón B', type: 'maternidad', status: 'ocupada' },
];

const defaultUsers = [
  { usuario: 'admin', password: '1234', role: 'admin', nombre: 'Admin' },
  { usuario: 'doctor1', password: '1234', role: 'doctor', nombre: 'Dr. García' },
  { usuario: 'doctor2', password: '1234', role: 'doctor', nombre: 'Dra. Martínez' },
  { usuario: 'doctor3', password: '1234', role: 'doctor', nombre: 'Dr. López' },
  { usuario: 'doctor4', password: '1234', role: 'doctor', nombre: 'Dra. Fernández' },
];

const normalizeText = (value) =>
  String(value || '').trim().replace(/[<>]/g, (match) => (match === '<' ? '&lt;' : '&gt;'));

const normalizeUsername = (username) => String(username || '').trim().toLowerCase();

const hashPasswordSync = (password) => bcrypt.hashSync(String(password), 10);
const isPasswordHashed = (value) => HASHED_PASSWORD_REGEX.test(String(value || ''));

const normalizeUser = (user = {}) => {
  const normalizedUsuario = normalizeUsername(user?.usuario);
  const rawPassword = String(user?.password || '');

  return {
    role: 'paciente',
    nombre: user?.nombre || user?.usuario || 'Paciente',
    ...user,
    ...(user?.role === 'paciente' && !user?.estadoAprobacion ? { estadoAprobacion: 'aprobado' } : {}),
    usuario: normalizedUsuario,
    password: isPasswordHashed(rawPassword) ? rawPassword : hashPasswordSync(rawPassword),
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
  users: defaultUsers.map(normalizeUser),
  pushSubscriptions: normalizePushSubscriptions(defaultPushSubscriptions),
  notificationConfig: normalizeNotificationConfig(),
  accessRequests: [],
  admissions: defaultAdmissions,
  beds: defaultBeds,
  auditLogs: [],
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
          if (!isPasswordHashed(String(user?.password || '')) || (user?.role === 'paciente' && !user?.estadoAprobacion)) {
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
const integrationConfig = storedData.integrationConfig || { labEndpoint: '' };

const saveData = () => {
  writeDataFile({ appointments, users, pushSubscriptions, notificationConfig, accessRequests, admissions, beds, auditLogs, integrationConfig });
};

module.exports = { appointments, users, pushSubscriptions, notificationConfig, accessRequests, admissions, beds, auditLogs, integrationConfig, saveData, normalizeUsername, isPasswordHashed, hashPasswordSync };

