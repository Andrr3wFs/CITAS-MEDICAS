const express = require('express');
const router = express.Router();
const { appointments, users, accessRequests, saveData, normalizeUsername, hashPasswordSync, PASSWORD_POLICY_VERSION } = require('../storage');
const { authenticate, getRequestUserRole, getRequestUsername } = require('../auth');
const { getAvailabilityError } = require('../appointmentAvailability');
const { auditMutation } = require('../middleware/audit');
const { validatePassword } = require('../passwordPolicy');

const sanitizeText = (value) => String(value || '').trim().replace(/[<>]/g, (match) => (match === '<' ? '&lt;' : '&gt;'));
const patientAppointmentStatuses = ['solicitada', 'aprobada', 'rechazada', 'cancelada', 'pendiente', 'atendida'];

const getNextAppointmentId = () => appointments.reduce((highestId, appointment) => {
  const id = Number(appointment.id);
  return Number.isInteger(id) && id > highestId ? id : highestId;
}, 0) + 1;

const isApprovedPatient = (user) => (
  user?.role === 'paciente'
    && !user.accessClosed
    && (
      user.estadoAprobacion === 'aprobado'
      || Boolean(user.approvedAt)
      || accessRequests.some((request) => request.usuario === user.usuario && request.status === 'approved')
    )
);

const requireApprovedPatient = (req, res, next) => {
  if (getRequestUserRole(req) !== 'paciente') {
    return res.status(403).json({ success: false, message: 'Solo un paciente puede realizar esta operación' });
  }

  const patient = users.find((user) => user.usuario === getRequestUsername(req));
  if (!isApprovedPatient(patient)) {
    return res.status(403).json({ success: false, message: 'Tu cuenta debe ser aprobada por un administrador antes de continuar' });
  }

  req.patient = patient;
  return next();
};

const getPatientAppointment = (appointmentId, patientId) => appointments.find((appointment) => (
  String(appointment.id) === String(appointmentId) && appointment.patientId === patientId
));

router.post('/registro', (req, res) => {
  const usuario = normalizeUsername(req.body?.usuario);
  const password = String(req.body?.password || '');
  const nombre = sanitizeText(req.body?.nombre || usuario);
  const email = sanitizeText(req.body?.email);

  if (!usuario || !password || !nombre) {
    return res.status(400).json({ success: false, message: 'usuario, password y nombre son obligatorios' });
  }

  const passwordValidation = validatePassword(password, { username: usuario, displayName: nombre });
  if (!passwordValidation.valid) {
    return res.status(400).json({
      success: false,
      message: 'La contraseña no cumple la política de seguridad.',
      passwordPolicyErrors: passwordValidation.errors,
    });
  }

  if (users.some((user) => user.usuario === usuario) || accessRequests.some((request) => request.usuario === usuario && request.status === 'pending')) {
    return res.status(409).json({ success: false, message: 'Ya existe una cuenta o solicitud pendiente con este usuario' });
  }

  const request = {
    id: Date.now(),
    usuario,
    password: hashPasswordSync(password),
    role: 'paciente',
    nombre,
    email,
    telefono: sanitizeText(req.body?.telefono),
    documento: sanitizeText(req.body?.documento),
    fechaNacimiento: sanitizeText(req.body?.fechaNacimiento),
    direccion: sanitizeText(req.body?.direccion),
    status: 'pending',
    estadoAprobacion: 'pendiente_aprobacion',
    requestedAt: new Date().toISOString(),
    passwordPolicyVersion: PASSWORD_POLICY_VERSION,
  };

  accessRequests.push(request);
  saveData();
  return res.status(201).json({ success: true, requestId: request.id, estadoCuenta: request.estadoAprobacion });
});

router.use(authenticate, requireApprovedPatient);

router.post('/citas', auditMutation({
  action: 'patient.appointment.requested',
  entityType: 'appointment',
  getEntityId: (req, res) => res.locals.createdAppointment?.id,
  getAfter: (req, res) => res.locals.createdAppointment,
}), (req, res) => {
  const { sintoma, fecha, hora, doctor, doctorUsername, especialidad } = req.body || {};

  if (![sintoma, fecha, hora, doctor].every((value) => sanitizeText(value))) {
    return res.status(400).json({ success: false, message: 'sintoma, fecha, hora y doctor son obligatorios' });
  }

  const normalizedDoctorUsername = normalizeUsername(doctorUsername);
  const availabilityError = getAvailabilityError({
    appointments,
    doctorUsername: normalizedDoctorUsername,
    doctorName: doctor,
    date: sanitizeText(fecha),
    time: sanitizeText(hora),
  });
  if (availabilityError) {
    return res.status(400).json({ success: false, message: availabilityError });
  }

  const appointment = {
    id: getNextAppointmentId(),
    nombre: req.patient.nombre || req.patient.usuario,
    patientId: req.patient.usuario,
    sintoma: sanitizeText(sintoma),
    fecha: sanitizeText(fecha),
    hora: sanitizeText(hora),
    doctor: sanitizeText(doctor),
    doctorUsername: normalizedDoctorUsername,
    especialidad: sanitizeText(especialidad),
    estado: 'solicitada',
    diagnostico: '',
    clinicalHistory: {},
    preConsult: { answered: false, answers: null },
  };

  appointments.push(appointment);
  saveData();
  res.locals.createdAppointment = appointment;
  return res.status(201).json({ success: true, appointment });
});

router.get('/citas', (req, res) => {
  const estado = String(req.query.estado || '').trim();
  if (estado && !patientAppointmentStatuses.includes(estado)) {
    return res.status(400).json({ success: false, message: 'Estado de cita inválido' });
  }

  const patientAppointments = appointments.filter((appointment) => (
    appointment.patientId === req.patient.usuario && (!estado || appointment.estado === estado)
  ));
  return res.json({ success: true, appointments: patientAppointments });
});

router.put('/citas/:id/cancelar', auditMutation({
  action: 'patient.appointment.cancelled',
  entityType: 'appointment',
  getEntityId: (req) => req.params.id,
  getBefore: (req, res) => res.locals.previousAppointment,
  getAfter: (req, res) => res.locals.updatedAppointment,
}), (req, res) => {
  const appointment = getPatientAppointment(req.params.id, req.patient.usuario);
  if (!appointment) {
    return res.status(404).json({ success: false, message: 'Cita no encontrada' });
  }

  if (!['solicitada', 'pendiente', 'aprobada'].includes(appointment.estado)) {
    return res.status(400).json({ success: false, message: 'Esta cita no puede cancelarse' });
  }

  res.locals.previousAppointment = { ...appointment };
  const { solicitarReprogramacion, motivo } = req.body || {};
  if (solicitarReprogramacion === true) {
    appointment.reprogramacionSolicitada = {
      motivo: sanitizeText(motivo),
      requestedAt: new Date().toISOString(),
      requestedBy: req.patient.usuario,
    };
  } else {
    appointment.estado = 'cancelada';
    appointment.cancelledAt = new Date().toISOString();
    appointment.cancelledBy = req.patient.usuario;
    appointment.cancellationReason = sanitizeText(motivo);
  }

  saveData();
  res.locals.updatedAppointment = appointment;
  return res.json({ success: true, appointment });
});

router.get('/historial', (req, res) => {
  const history = appointments
    .filter((appointment) => appointment.patientId === req.patient.usuario && appointment.estado === 'atendida')
    .filter((appointment) => appointment.clinicalHistory?.diagnosis || appointment.diagnostico)
    .map((appointment) => ({
      appointmentId: appointment.id,
      fecha: appointment.fecha,
      hora: appointment.hora,
      doctor: appointment.doctor,
      especialidad: appointment.especialidad,
      triaje: appointment.triage || null,
      history: appointment.clinicalHistory,
    }));

  return res.json({ success: true, history });
});

module.exports = router;