const express = require('express');
const router = express.Router();
const { appointments, users, accessRequests, saveData, isPasswordHashed, hashPasswordSync, PASSWORD_POLICY_VERSION } = require('../storage');
const { authenticate, getRequestUserRole } = require('../auth');
const { getAvailabilityError } = require('../appointmentAvailability');
const { auditMutation } = require('../middleware/audit');

const appointmentStatuses = ['solicitada', 'confirmada', 'reprogramada', 'rechazada'];

const requireAdmin = (req, res, next) => {
  if (getRequestUserRole(req) !== 'admin') {
    return res.status(403).json({ success: false, message: 'Solo un administrador puede realizar esta operación' });
  }

  return next();
};

const getPatientRequest = (id) => accessRequests.find((request) => String(request.id) === String(id));

router.use(authenticate, requireAdmin);

router.put('/pacientes/:id/aprobar', auditMutation({
  action: 'patient.approved',
  entityType: 'patient',
  getEntityId: (req) => req.params.id,
  getAfter: (req, res) => res.locals.approvedPatient,
}), (req, res) => {
  const request = getPatientRequest(req.params.id);

  if (!request) {
    return res.status(404).json({ success: false, message: 'Solicitud de paciente no encontrada' });
  }

  if (request.role !== 'paciente') {
    return res.status(400).json({ success: false, message: 'La solicitud no corresponde a un paciente' });
  }

  if (request.status !== 'pending') {
    return res.status(400).json({ success: false, message: 'La solicitud ya fue procesada' });
  }

  const approvedAt = new Date().toISOString();
  const patient = {
    usuario: request.usuario,
    email: request.email || request.usuario,
    password: isPasswordHashed(request.password) ? request.password : hashPasswordSync(request.password),
    role: 'paciente',
    nombre: request.nombre,
    telefono: request.telefono || '',
    documento: request.documento || '',
    fechaNacimiento: request.fechaNacimiento || '',
    direccion: request.direccion || '',
    estadoAprobacion: 'aprobado',
    approvedAt,
    approvedBy: req.user.username,
    passwordPolicyVersion: request.passwordPolicyVersion === PASSWORD_POLICY_VERSION ? PASSWORD_POLICY_VERSION : 0,
    passwordChangeRequired: request.passwordPolicyVersion !== PASSWORD_POLICY_VERSION,
    sessionVersion: 1,
    mfaEnabled: false,
  };

  if (users.some((user) => user.usuario === patient.usuario)) {
    return res.status(409).json({ success: false, message: 'Ya existe un usuario para esta solicitud' });
  }

  users.push(patient);
  request.status = 'approved';
  request.estadoAprobacion = 'aprobado';
  request.approvedAt = approvedAt;
  request.approvedBy = req.user.username;
  saveData();

  res.locals.approvedPatient = patient;
  return res.json({ success: true, patient });
});

router.get('/citas', (req, res) => {
  const { estado, pacienteId, doctorUsername, fechaDesde, fechaHasta } = req.query;

  if (estado && !appointmentStatuses.includes(estado)) {
    return res.status(400).json({ success: false, message: 'Filtro de estado inválido' });
  }

  const filteredAppointments = appointments.filter((appointment) => {
    if (estado && appointment.estado !== estado) return false;
    if (pacienteId && appointment.patientId !== String(pacienteId).trim().toLowerCase()) return false;
    if (doctorUsername && appointment.doctorUsername !== String(doctorUsername).trim().toLowerCase()) return false;
    if (fechaDesde && appointment.fecha < fechaDesde) return false;
    if (fechaHasta && appointment.fecha > fechaHasta) return false;
    return true;
  });

  return res.json({ success: true, appointments: filteredAppointments });
});

router.put('/citas/:id', auditMutation({
  action: 'admin.appointment.updated',
  entityType: 'appointment',
  getEntityId: (req) => req.params.id,
  getBefore: (req, res) => res.locals.previousAppointment,
  getAfter: (req, res) => res.locals.updatedAppointment,
}), (req, res) => {
  const appointment = appointments.find((item) => String(item.id) === String(req.params.id));

  if (!appointment) {
    return res.status(404).json({ success: false, message: 'Cita no encontrada' });
  }

  const { fecha, hora, doctor, doctorUsername, especialidad, estado } = req.body || {};
  const hasChanges = [fecha, hora, doctor, doctorUsername, especialidad, estado].some((value) => value !== undefined);

  if (!hasChanges) {
    return res.status(400).json({ success: false, message: 'Indica al menos un campo para actualizar' });
  }

  if (estado !== undefined && !appointmentStatuses.includes(estado)) {
    return res.status(400).json({ success: false, message: 'Estado de cita inválido' });
  }

  const nextAppointment = {
    ...appointment,
    fecha: fecha !== undefined ? String(fecha).trim() : appointment.fecha,
    hora: hora !== undefined ? String(hora).trim() : appointment.hora,
    doctor: doctor !== undefined ? String(doctor).trim() : appointment.doctor,
    doctorUsername: doctorUsername !== undefined ? String(doctorUsername).trim().toLowerCase() : appointment.doctorUsername,
    especialidad: especialidad !== undefined ? String(especialidad).trim() : appointment.especialidad,
    estado: estado !== undefined ? estado : appointment.estado,
  };

  const scheduleChanged = ['fecha', 'hora', 'doctor', 'doctorUsername'].some((field) => nextAppointment[field] !== appointment[field]);
  if (scheduleChanged && nextAppointment.estado !== 'rechazada') {
    const availabilityError = getAvailabilityError({
      appointments,
      doctorUsername: nextAppointment.doctorUsername,
      doctorName: nextAppointment.doctor,
      date: nextAppointment.fecha,
      time: nextAppointment.hora,
      excludeAppointmentId: appointment.id,
    });

    if (availabilityError) {
      return res.status(400).json({ success: false, message: availabilityError });
    }
  }

  res.locals.previousAppointment = { ...appointment };
  Object.assign(appointment, nextAppointment);
  saveData();
  res.locals.updatedAppointment = appointment;

  return res.json({ success: true, appointment });
});

module.exports = router;