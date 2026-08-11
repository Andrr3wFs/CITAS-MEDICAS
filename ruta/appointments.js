// src/routes/appointments.js
const express = require('express');
const router = express.Router();
const { appointments, saveData } = require('./storage');
const { getAvailabilityError } = require('../appointmentAvailability');
const { sendPushNotificationToUsers } = require('../pushNotifications');
const { authenticate, getRequestUserRole, getRequestUsername, normalizeUsername } = require('../auth');
const { auditMutation } = require('../middleware/audit');

const allowedStatuses = ['pendiente', 'aprobada', 'rechazada', 'atendida', 'cancelada', 'no_asistencia'];

const createEmptyClinicalHistory = () => ({
  medicalHistory: '',
  diagnosis: '',
  observations: '',
  treatment: '',
  indications: '',
  followUp: '',
});

const sanitizeText = (value) =>
  String(value || '').trim().replace(/[<>]/g, (match) => (match === '<' ? '&lt;' : '&gt;'));

const canManageAppointments = (req) => ['admin', 'secretaria'].includes(getRequestUserRole(req));
const canWriteMedicalHistory = (req) => getRequestUserRole(req) === 'doctor';
const isDoctorAssignedToAppointment = (req, appointment) =>
  getRequestUserRole(req) === 'doctor' && appointment?.doctorUsername === getRequestUsername(req);
const isPatientOwner = (req, appointment) => appointment?.patientId === getRequestUsername(req);

const filterAppointmentsByUser = (appointmentsList, req) => {
  const role = getRequestUserRole(req);

  if (['admin', 'secretaria'].includes(role)) {
    return appointmentsList;
  }

  if (role === 'doctor') {
    return appointmentsList.filter((appointment) => appointment.doctorUsername === getRequestUsername(req));
  }

  return appointmentsList.filter((appointment) => appointment.patientId === getRequestUsername(req));
};

router.use(authenticate);

const getNextAppointmentId = () => {
  const highestKnownId = appointments.reduce((maxId, appointment) => {
    const numericId = Number(appointment?.id);
    return Number.isInteger(numericId) && numericId > maxId ? numericId : maxId;
  }, 0);

  return highestKnownId + 1;
};

const normalizeClinicalHistory = (history = {}, currentHistory = {}) => ({
  ...createEmptyClinicalHistory(),
  ...currentHistory,
  medicalHistory: String(history.medicalHistory ?? currentHistory.medicalHistory ?? '').trim(),
  diagnosis: String(history.diagnosis ?? currentHistory.diagnosis ?? '').trim(),
  observations: String(history.observations ?? currentHistory.observations ?? '').trim(),
  treatment: String(history.treatment ?? currentHistory.treatment ?? '').trim(),
  indications: String(history.indications ?? currentHistory.indications ?? '').trim(),
  followUp: String(history.followUp ?? currentHistory.followUp ?? '').trim(),
});

const sendNotificationSafely = async (usernames, payload) => {
  try {
    await sendPushNotificationToUsers(usernames, payload);
  } catch (error) {
    // Ignore push transport failures so appointment updates still succeed.
  }
};

// Crear nueva cita
router.post('/appointments', auditMutation({
  action: 'appointment.created',
  entityType: 'appointment',
  getEntityId: (req, res) => res.locals.createdAppointment?.id,
  getAfter: (req, res) => res.locals.createdAppointment,
}), async (req, res) => {
  if (getRequestUserRole(req) !== 'paciente') {
    return res.status(403).json({ success: false, message: 'Solo los pacientes pueden solicitar citas' });
  }

  const { sintoma, fecha, hora, doctor, doctorUsername, especialidad } = req.body;
  const nombre = sanitizeText(req.user.username || '');

  if (!nombre || !sintoma || !fecha || !hora || !doctor) {
    return res.status(400).json({ success: false, message: 'Todos los campos son obligatorios' });
  }

  const normalizedDoctorUsername = sanitizeText(doctorUsername || '');
  const availabilityError = getAvailabilityError({
    appointments,
    doctorUsername: normalizedDoctorUsername,
    doctorName: doctor,
    date: fecha,
    time: hora,
  });

  if (availabilityError) {
    return res.status(400).json({ success: false, message: availabilityError });
  }

  const newAppointment = {
    id: getNextAppointmentId(),
    nombre,
    patientId: normalizeUsername(nombre),
    sintoma: sanitizeText(sintoma),
    fecha: sanitizeText(fecha),
    hora: sanitizeText(hora),
    doctor: sanitizeText(doctor),
    doctorUsername: normalizedDoctorUsername,
    especialidad: sanitizeText(especialidad),
    estado: 'pendiente',
    diagnostico: '',
    clinicalHistory: createEmptyClinicalHistory(),
    preConsult: { answered: false, answers: null },
  };
  appointments.push(newAppointment);
  saveData();
  res.locals.createdAppointment = newAppointment;

  if (normalizedDoctorUsername) {
    await sendNotificationSafely([normalizedDoctorUsername], {
      title: 'Nueva cita asignada',
      message: `Tienes una nueva cita con ${nombre} el ${fecha} a las ${hora}.`,
      tag: `doctor-assigned-${newAppointment.id}`,
      url: '/dashboard',
    });
  }

  res.json({ success: true, appointment: newAppointment });
});

// Obtener todas las citas
router.get('/appointments', (req, res) => {
  const visibleAppointments = filterAppointmentsByUser(appointments, req);
  res.json({ success: true, appointments: visibleAppointments });
});

router.get('/appointments/:id', (req, res) => {
  const { id } = req.params;
  const appointment = appointments.find((a) => a.id == id);

  if (!appointment) {
    return res.status(404).json({ success: false, message: 'Cita no encontrada' });
  }

  if (canManageAppointments(req) || isDoctorAssignedToAppointment(req, appointment) || isPatientOwner(req, appointment)) {
    return res.json({ success: true, appointment });
  }

  return res.status(403).json({ success: false, message: 'No tienes permisos para ver esta cita' });
});

// Actualizar estado de cita
router.put('/appointments/:id', auditMutation({
  action: 'appointment.updated',
  entityType: 'appointment',
  getEntityId: (req) => req.params.id,
  getBefore: (req, res) => res.locals.previousAppointment,
  getAfter: (req, res) => res.locals.updatedAppointment,
}), async (req, res) => {
  const { id } = req.params;
  const { nombre, sintoma, fecha, hora, doctor, doctorUsername, especialidad, estado, diagnostico, clinicalHistory } = req.body;
  const appointment = appointments.find(a => a.id == id);

  const wantsAppointmentChanges = [nombre, sintoma, fecha, hora, doctor, doctorUsername, especialidad, estado].some(
    (value) => value !== undefined
  );
  const wantsDiagnosisChange = diagnostico !== undefined || clinicalHistory !== undefined;

  if (wantsAppointmentChanges && !canManageAppointments(req)) {
    return res.status(403).json({ success: false, message: 'No tienes permisos para editar citas' });
  }

  if (wantsDiagnosisChange && !canWriteMedicalHistory(req)) {
    return res.status(403).json({ success: false, message: 'Solo el doctor puede registrar diagnosticos' });
  }

  if (wantsDiagnosisChange && !isDoctorAssignedToAppointment(req, appointment)) {
    return res.status(403).json({ success: false, message: 'Solo el doctor asignado puede actualizar esta historia clínica' });
  }

  if (!appointment) {
    return res.status(404).json({ success: false, message: 'Cita no encontrada' });
  }

  if (estado !== undefined && !allowedStatuses.includes(estado)) {
    return res.status(400).json({ success: false, message: 'Estado inválido' });
  }

  const nextAppointmentState = {
    ...appointment,
    nombre: nombre !== undefined ? nombre : appointment.nombre,
    sintoma: sintoma !== undefined ? sintoma : appointment.sintoma,
    fecha: fecha !== undefined ? fecha : appointment.fecha,
    hora: hora !== undefined ? hora : appointment.hora,
    doctor: doctor !== undefined ? doctor : appointment.doctor,
    doctorUsername: doctorUsername !== undefined ? doctorUsername : appointment.doctorUsername,
    especialidad: especialidad !== undefined ? especialidad : appointment.especialidad,
    estado: estado !== undefined ? estado : appointment.estado,
  };

  const shouldValidateAvailability = nextAppointmentState.estado !== 'rechazada' && [fecha, hora, doctor, doctorUsername, estado].some(
    (value) => value !== undefined
  );

  if (shouldValidateAvailability) {
    const availabilityError = getAvailabilityError({
      appointments,
      doctorUsername: nextAppointmentState.doctorUsername,
      doctorName: nextAppointmentState.doctor,
      date: nextAppointmentState.fecha,
      time: nextAppointmentState.hora,
      excludeAppointmentId: appointment.id,
    });

    if (availabilityError) {
      return res.status(400).json({ success: false, message: availabilityError });
    }
  }

  const previousAppointment = {
    nombre: appointment.nombre,
    sintoma: appointment.sintoma,
    fecha: appointment.fecha,
    hora: appointment.hora,
    doctor: appointment.doctor,
    doctorUsername: appointment.doctorUsername,
    especialidad: appointment.especialidad,
    estado: appointment.estado,
    diagnostico: appointment.diagnostico,
    clinicalHistory: appointment.clinicalHistory,
  };
  res.locals.previousAppointment = previousAppointment;

  if (nombre !== undefined) {
    appointment.nombre = nombre;
  }

  if (sintoma !== undefined) {
    appointment.sintoma = sintoma;
  }

  if (fecha !== undefined) {
    appointment.fecha = fecha;
  }

  if (hora !== undefined) {
    appointment.hora = hora;
  }

  if (doctor !== undefined) {
    appointment.doctor = doctor;
  }

  if (doctorUsername !== undefined) {
    appointment.doctorUsername = doctorUsername;
  }

  if (especialidad !== undefined) {
    appointment.especialidad = sanitizeText(especialidad);
  }

  if (estado !== undefined) {
    appointment.estado = estado;
  }

  if (clinicalHistory !== undefined || diagnostico !== undefined) {
    const normalizedHistory = normalizeClinicalHistory(
      clinicalHistory !== undefined ? clinicalHistory : { diagnosis: diagnostico },
      appointment.clinicalHistory || createEmptyClinicalHistory()
    );

    if (!normalizedHistory.diagnosis) {
      return res.status(400).json({ success: false, message: 'El diagnostico es obligatorio' });
    }

    appointment.clinicalHistory = normalizedHistory;
    appointment.diagnostico = normalizedHistory.diagnosis;
  }

  saveData();
  res.locals.updatedAppointment = appointment;

  const patientUsername = appointment.nombre;
  const scheduleChanged = previousAppointment.fecha !== appointment.fecha
    || previousAppointment.hora !== appointment.hora
    || previousAppointment.doctor !== appointment.doctor
    || previousAppointment.sintoma !== appointment.sintoma;
  const doctorAssignmentChanged = previousAppointment.doctorUsername !== appointment.doctorUsername;
  const statusChanged = previousAppointment.estado !== appointment.estado;
  const diagnosisChanged = previousAppointment.diagnostico !== appointment.diagnostico;

  if (statusChanged && appointment.estado === 'aprobada') {
    // ensure pre-consult questionnaire is available for the patient
    appointment.preConsult = appointment.preConsult || { answered: false, answers: null };

    await sendNotificationSafely([patientUsername], {
      title: 'Cita aprobada',
      message: `Tu cita con ${appointment.doctor} para el ${appointment.fecha} a las ${appointment.hora} fue aprobada. Completa el cuestionario pre-consulta.`,
      tag: `appointment-approved-${appointment.id}`,
      url: `/questionnaire/${appointment.id}`,
    });
  }

  if (statusChanged && appointment.estado === 'rechazada') {
    await sendNotificationSafely([patientUsername], {
      title: 'Cita rechazada',
      message: `Tu cita con ${appointment.doctor} para el ${appointment.fecha} a las ${appointment.hora} fue rechazada.`,
      tag: `appointment-rejected-${appointment.id}`,
      url: '/dashboard',
    });
  }

  if (!statusChanged && scheduleChanged) {
    await sendNotificationSafely([patientUsername], {
      title: 'Cita actualizada',
      message: `Tu cita fue actualizada. Revisa la nueva fecha ${appointment.fecha}, hora ${appointment.hora} y doctor ${appointment.doctor}.`,
      tag: `appointment-updated-${appointment.id}`,
      url: '/dashboard',
    });
  }

  if (doctorAssignmentChanged && appointment.doctorUsername) {
    await sendNotificationSafely([appointment.doctorUsername], {
      title: 'Cita reasignada',
      message: `Se te asignó la cita de ${appointment.nombre} para el ${appointment.fecha} a las ${appointment.hora}.`,
      tag: `appointment-doctor-${appointment.id}`,
      url: '/dashboard',
    });
  }

  if (diagnosisChanged && appointment.diagnostico) {
    await sendNotificationSafely([patientUsername], {
      title: 'Historia clínica actualizada',
      message: `Tu historia clínica de la cita del ${appointment.fecha} ya está disponible para consulta.`,
      tag: `clinical-history-${appointment.id}`,
      url: '/dashboard',
    });
  }

  res.json({ success: true, appointment });
});

// --- Pre-consult questionnaire endpoints ---
router.get('/appointments/:id/questionnaire', (req, res) => {
  const { id } = req.params;
  const appointment = appointments.find((a) => a.id == id);

  if (!appointment) {
    return res.status(404).json({ success: false, message: 'Cita no encontrada' });
  }

  if (canManageAppointments(req) || isDoctorAssignedToAppointment(req, appointment) || isPatientOwner(req, appointment)) {
    return res.json({ success: true, questionnaire: appointment.preConsult || { answered: false, answers: null } });
  }

  return res.status(403).json({ success: false, message: 'No tienes permisos para ver este cuestionario' });
});

router.post('/appointments/:id/questionnaire', async (req, res) => {
  const { id } = req.params;
  const appointment = appointments.find((a) => a.id == id);

  if (!appointment) {
    return res.status(404).json({ success: false, message: 'Cita no encontrada' });
  }

  if (!isPatientOwner(req, appointment)) {
    return res.status(403).json({ success: false, message: 'Solo el paciente puede enviar este cuestionario' });
  }

  const { allergies, medications, familyHistory, smoke, alcohol } = req.body;

  const answers = {
    allergies: sanitizeText(allergies),
    medications: sanitizeText(medications),
    familyHistory: sanitizeText(familyHistory),
    smoke: sanitizeText(smoke),
    alcohol: sanitizeText(alcohol),
  };

  appointment.preConsult = {
    answered: true,
    answers,
    submittedAt: new Date().toISOString(),
    submittedBy: req.user.username,
  };

  saveData();

  // Notify assigned doctor that questionnaire is ready
  if (appointment.doctorUsername) {
    await sendNotificationSafely([appointment.doctorUsername], {
      title: 'Cuestionario pre-consulta completado',
      message: `El paciente ${appointment.nombre} completó el cuestionario de la cita ${appointment.fecha} ${appointment.hora}.`,
      tag: `questionnaire-submitted-${appointment.id}`,
      url: '/dashboard',
    });
  }

  res.json({ success: true, questionnaire: appointment.preConsult });
});

router.delete('/appointments/:id', (req, res) => {
  if (!canManageAppointments(req)) {
    return res.status(403).json({ success: false, message: 'No tienes permisos para eliminar citas' });
  }

  const { id } = req.params;
  const appointmentIndex = appointments.findIndex(a => a.id == id);

  if (appointmentIndex === -1) {
    return res.status(404).json({ success: false, message: 'Cita no encontrada' });
  }

  const [deletedAppointment] = appointments.splice(appointmentIndex, 1);
  saveData();
  res.json({ success: true, appointment: deletedAppointment });
});

module.exports = router;