const express = require('express');
const { appointments } = require('./storage');
const { authenticate, getRequestUserRole } = require('./auth');

const router = express.Router();

const getAppointmentDate = (appointment) => {
  const date = new Date(`${appointment.fecha}T${appointment.hora || '00:00'}:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatDay = (date) => new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric' }).format(date);

router.use(authenticate);

router.get('/metrics/appointments', (req, res) => {
  if (getRequestUserRole(req) !== 'doctor') {
    return res.status(403).json({ success: false, message: 'Solo el doctor puede consultar métricas.' });
  }

  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(now.getDate() - 6);
  cutoff.setHours(0, 0, 0, 0);
  const rangeAppointments = appointments.filter((appointment) => {
    const date = getAppointmentDate(appointment);
    return date && date >= cutoff && date <= now;
  });

  const attended = appointments.filter((appointment) => appointment.estado === 'atendida').length;
  const noShow = appointments.filter((appointment) => appointment.estado === 'no_asistencia').length;
  const cancelled = appointments.filter((appointment) => appointment.estado === 'cancelada').length;
  const completedOrMissed = attended + noShow;
  const specialties = new Map();

  appointments.forEach((appointment) => {
    const specialty = String(appointment.especialidad || appointment.doctor || 'Sin especialidad').trim();
    specialties.set(specialty, (specialties.get(specialty) || 0) + 1);
  });

  const activityByDay = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(cutoff);
    date.setDate(cutoff.getDate() + index);
    const dateKey = date.toISOString().slice(0, 10);
    const daily = rangeAppointments.filter((appointment) => appointment.fecha === dateKey);

    return {
      label: formatDay(date),
      atendidas: daily.filter((appointment) => appointment.estado === 'atendida').length,
      canceladas: daily.filter((appointment) => appointment.estado === 'cancelada').length,
    };
  });

  return res.json({
    success: true,
    noShowRate: completedOrMissed ? Number(((noShow / completedOrMissed) * 100).toFixed(1)) : 0,
    noShow,
    approved: appointments.filter((appointment) => appointment.estado === 'aprobada').length,
    attended,
    cancelled,
    demandBySpecialty: Array.from(specialties, ([name, value]) => ({ name, value }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 6),
    activityByDay,
  });
});

module.exports = router;