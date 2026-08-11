const express = require('express');
const router = express.Router();
const { appointments, saveData } = require('./storage');
const { authenticate, getRequestUserRole, getRequestUsername } = require('./auth');
const { auditMutation } = require('./middleware/audit');

const sanitizeText = (value) => String(value || '').trim().replace(/[<>]/g, (match) => (match === '<' ? '&lt;' : '&gt;'));

const createEmptyClinicalHistory = () => ({
  medicalHistory: '',
  diagnosis: '',
  observations: '',
  treatment: '',
  indications: '',
  followUp: '',
  prescription: '',
  consultationNotes: '',
});

const todayDate = () => new Date().toISOString().slice(0, 10);

const requireDoctor = (req, res, next) => {
  if (getRequestUserRole(req) !== 'doctor') {
    return res.status(403).json({ success: false, message: 'Solo un doctor puede realizar esta operación' });
  }

  return next();
};

const getAssignedAppointment = (appointmentId, doctorUsername) => appointments.find((appointment) => (
  String(appointment.id) === String(appointmentId)
    && appointment.doctorUsername === doctorUsername
));

router.use(authenticate, requireDoctor);

router.get('/citas', (req, res) => {
  const doctorUsername = getRequestUsername(req);
  const requestedDate = String(req.query.fecha || '').trim();
  const date = requestedDate === 'hoy' ? todayDate() : requestedDate;

  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ success: false, message: 'La fecha debe ser "hoy" o tener formato YYYY-MM-DD' });
  }

  const doctorAppointments = appointments.filter((appointment) => (
    appointment.doctorUsername === doctorUsername && (!date || appointment.fecha === date)
  ));

  return res.json({ success: true, appointments: doctorAppointments });
});

router.post('/triaje', auditMutation({
  action: 'doctor.triage.saved',
  entityType: 'appointment',
  getEntityId: (req) => req.body?.appointmentId,
  getBefore: (req, res) => res.locals.previousTriage,
  getAfter: (req, res) => res.locals.savedTriage,
}), (req, res) => {
  const { appointmentId, temperatura, presionArterial, frecuenciaCardiaca, frecuenciaRespiratoria, saturacionOxigeno, peso, altura, notas } = req.body || {};

  if (!appointmentId) {
    return res.status(400).json({ success: false, message: 'appointmentId es obligatorio' });
  }

  const appointment = getAssignedAppointment(appointmentId, getRequestUsername(req));
  if (!appointment) {
    return res.status(404).json({ success: false, message: 'Cita asignada no encontrada' });
  }

  const triage = {
    temperatura: sanitizeText(temperatura),
    presionArterial: sanitizeText(presionArterial),
    frecuenciaCardiaca: sanitizeText(frecuenciaCardiaca),
    frecuenciaRespiratoria: sanitizeText(frecuenciaRespiratoria),
    saturacionOxigeno: sanitizeText(saturacionOxigeno),
    peso: sanitizeText(peso),
    altura: sanitizeText(altura),
    notas: sanitizeText(notas),
    recordedAt: new Date().toISOString(),
    recordedBy: getRequestUsername(req),
  };

  res.locals.previousTriage = appointment.triage || null;
  appointment.triage = triage;
  saveData();
  res.locals.savedTriage = triage;

  return res.json({ success: true, triage });
});

router.post('/historial', auditMutation({
  action: 'doctor.clinical_history.saved',
  entityType: 'appointment',
  getEntityId: (req) => req.body?.appointmentId,
  getBefore: (req, res) => res.locals.previousClinicalHistory,
  getAfter: (req, res) => res.locals.savedClinicalHistory,
}), (req, res) => {
  const { appointmentId, medicalHistory, diagnosis, observations, treatment, indications, followUp, prescription, consultationNotes } = req.body || {};

  if (!appointmentId || !sanitizeText(diagnosis)) {
    return res.status(400).json({ success: false, message: 'appointmentId y diagnosis son obligatorios' });
  }

  const appointment = getAssignedAppointment(appointmentId, getRequestUsername(req));
  if (!appointment) {
    return res.status(404).json({ success: false, message: 'Cita asignada no encontrada' });
  }

  res.locals.previousClinicalHistory = appointment.clinicalHistory || null;
  const clinicalHistory = {
    ...createEmptyClinicalHistory(),
    ...(appointment.clinicalHistory || {}),
    medicalHistory: sanitizeText(medicalHistory ?? appointment.clinicalHistory?.medicalHistory),
    diagnosis: sanitizeText(diagnosis),
    observations: sanitizeText(observations ?? appointment.clinicalHistory?.observations),
    treatment: sanitizeText(treatment ?? appointment.clinicalHistory?.treatment),
    indications: sanitizeText(indications ?? appointment.clinicalHistory?.indications),
    followUp: sanitizeText(followUp ?? appointment.clinicalHistory?.followUp),
    prescription: sanitizeText(prescription ?? appointment.clinicalHistory?.prescription),
    consultationNotes: sanitizeText(consultationNotes ?? appointment.clinicalHistory?.consultationNotes),
    updatedAt: new Date().toISOString(),
    updatedBy: getRequestUsername(req),
  };

  appointment.clinicalHistory = clinicalHistory;
  appointment.diagnostico = clinicalHistory.diagnosis;
  appointment.estado = 'atendida';
  saveData();
  res.locals.savedClinicalHistory = clinicalHistory;

  return res.json({ success: true, appointment });
});

router.get('/metricas', (req, res) => {
  const doctorUsername = getRequestUsername(req);
  const doctorAppointments = appointments.filter((appointment) => appointment.doctorUsername === doctorUsername);
  const countByStatus = (status) => doctorAppointments.filter((appointment) => appointment.estado === status).length;
  const attended = countByStatus('atendida');
  const pending = doctorAppointments.filter((appointment) => ['pendiente', 'aprobada', 'confirmada', 'solicitada', 'reprogramada'].includes(appointment.estado)).length;
  const noShow = countByStatus('no_asistencia');
  const rejected = countByStatus('rechazada');
  const cancelled = countByStatus('cancelada');
  const completedOrMissed = attended + noShow;

  return res.json({
    success: true,
    metrics: {
      total: doctorAppointments.length,
      atendidas: attended,
      pendientes: pending,
      noAsistencia: noShow,
      rechazadas: rejected,
      canceladas: cancelled,
      tasaAtencion: doctorAppointments.length ? Number(((attended / doctorAppointments.length) * 100).toFixed(1)) : 0,
      tasaNoAsistencia: completedOrMissed ? Number(((noShow / completedOrMissed) * 100).toFixed(1)) : 0,
    },
  });
});

module.exports = router;