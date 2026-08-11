const APPOINTMENT_DURATION_MINUTES = 45;

const BUSY_APPOINTMENT_STATUSES = new Set(['pendiente', 'aprobada']);

const doctorProfiles = [
  { username: 'doctor1', name: 'Dr. García' },
  { username: 'doctor2', name: 'Dra. Martínez' },
  { username: 'doctor3', name: 'Dr. López' },
  { username: 'doctor4', name: 'Dra. Fernández' },
];

const doctorSchedules = {
  doctor1: [
    { day: 1, start: '08:00', end: '14:00' },
    { day: 1, start: '15:00', end: '18:00' },
    { day: 2, start: '08:00', end: '14:00' },
    { day: 2, start: '15:00', end: '18:00' },
    { day: 3, start: '08:00', end: '14:00' },
    { day: 3, start: '15:00', end: '18:00' },
    { day: 4, start: '08:00', end: '14:00' },
    { day: 4, start: '15:00', end: '18:00' },
    { day: 5, start: '08:00', end: '14:00' },
    { day: 5, start: '15:00', end: '18:00' },
  ],
  doctor2: [
    { day: 1, start: '09:00', end: '14:00' },
    { day: 1, start: '15:00', end: '19:00' },
    { day: 2, start: '09:00', end: '14:00' },
    { day: 2, start: '15:00', end: '19:00' },
    { day: 3, start: '09:00', end: '14:00' },
    { day: 3, start: '15:00', end: '19:00' },
    { day: 4, start: '09:00', end: '14:00' },
    { day: 4, start: '15:00', end: '19:00' },
    { day: 5, start: '09:00', end: '14:00' },
    { day: 5, start: '15:00', end: '19:00' },
  ],
  doctor3: [
    { day: 1, start: '08:00', end: '15:00' },
    { day: 2, start: '08:00', end: '15:00' },
    { day: 3, start: '08:00', end: '15:00' },
    { day: 4, start: '08:00', end: '15:00' },
    { day: 5, start: '08:00', end: '15:00' },
    { day: 6, start: '08:00', end: '15:00' },
  ],
  doctor4: [
    { day: 1, start: '10:00', end: '14:00' },
    { day: 1, start: '15:00', end: '20:00' },
    { day: 2, start: '10:00', end: '14:00' },
    { day: 2, start: '15:00', end: '20:00' },
    { day: 3, start: '10:00', end: '14:00' },
    { day: 3, start: '15:00', end: '20:00' },
    { day: 4, start: '10:00', end: '14:00' },
    { day: 4, start: '15:00', end: '20:00' },
    { day: 5, start: '10:00', end: '14:00' },
    { day: 5, start: '15:00', end: '20:00' },
  ],
};

const normalizeValue = (value) => String(value || '').trim().toLowerCase();

const toMinutes = (timeValue) => {
  const [hours, minutes] = String(timeValue || '00:00').split(':').map(Number);
  return (hours * 60) + minutes;
};

const overlaps = (leftStart, leftEnd, rightStart, rightEnd) => leftStart < rightEnd && leftEnd > rightStart;

const getDoctorProfile = ({ doctorUsername, doctorName }) => {
  const normalizedDoctorUsername = normalizeValue(doctorUsername);
  const normalizedDoctorName = normalizeValue(doctorName);

  return doctorProfiles.find((doctor) => (
    normalizeValue(doctor.username) === normalizedDoctorUsername
      || normalizeValue(doctor.name) === normalizedDoctorName
  ));
};

const getDoctorWorkingWindows = ({ doctorUsername, doctorName, date }) => {
  if (!date) {
    return [];
  }

  const doctorProfile = getDoctorProfile({ doctorUsername, doctorName });

  if (!doctorProfile) {
    return [];
  }

  const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
  return (doctorSchedules[doctorProfile.username] || []).filter((windowItem) => windowItem.day === dayOfWeek);
};

const getBusyAppointments = ({ appointments, doctorUsername, doctorName, date, excludeAppointmentId }) => {
  const doctorProfile = getDoctorProfile({ doctorUsername, doctorName });
  const normalizedDoctorUsername = normalizeValue(doctorProfile?.username || doctorUsername);
  const normalizedDoctorName = normalizeValue(doctorProfile?.name || doctorName);

  return appointments
    .filter((appointment) => appointment?.fecha === date)
    .filter((appointment) => appointment?.id != excludeAppointmentId)
    .filter((appointment) => BUSY_APPOINTMENT_STATUSES.has(appointment?.estado))
    .filter((appointment) => (
      normalizeValue(appointment?.doctorUsername) === normalizedDoctorUsername
        || normalizeValue(appointment?.doctor) === normalizedDoctorName
    ))
    .map((appointment) => ({
      ...appointment,
      startMinutes: toMinutes(appointment.hora),
      endMinutes: toMinutes(appointment.hora) + APPOINTMENT_DURATION_MINUTES,
    }));
};

const getAvailabilityError = ({ appointments, doctorUsername, doctorName, date, time, excludeAppointmentId }) => {
  if (!doctorUsername && !doctorName) {
    return 'Selecciona un doctor válido';
  }

  if (!date || !time) {
    return 'La fecha y la hora son obligatorias';
  }

  const workingWindows = getDoctorWorkingWindows({ doctorUsername, doctorName, date });

  if (workingWindows.length === 0) {
    return 'La cita está fuera del horario de atención del doctor';
  }

  const appointmentStart = toMinutes(time);
  const appointmentEnd = appointmentStart + APPOINTMENT_DURATION_MINUTES;
  const isWithinWorkingHours = workingWindows.some((windowItem) => (
    appointmentStart >= toMinutes(windowItem.start)
      && appointmentEnd <= toMinutes(windowItem.end)
  ));

  if (!isWithinWorkingHours) {
    return 'La cita está fuera del horario de atención del doctor';
  }

  const busyAppointments = getBusyAppointments({
    appointments,
    doctorUsername,
    doctorName,
    date,
    excludeAppointmentId,
  });

  const hasConflict = busyAppointments.some((appointment) => (
    overlaps(appointmentStart, appointmentEnd, appointment.startMinutes, appointment.endMinutes)
  ));

  if (hasConflict) {
    return 'Ya existe otra cita ocupando ese horario';
  }

  return '';
};

module.exports = {
  APPOINTMENT_DURATION_MINUTES,
  getAvailabilityError,
};