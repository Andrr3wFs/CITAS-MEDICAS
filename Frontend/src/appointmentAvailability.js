import { findDoctorByName, findDoctorByUsername } from "./doctorDirectory";

export const APPOINTMENT_DURATION_MINUTES = 45;
export const APPOINTMENT_SLOT_STEP_MINUTES = 15;

const BUSY_APPOINTMENT_STATUSES = new Set(["pendiente", "aprobada"]);

const doctorSchedules = {
  doctor1: {
    label: "Lunes a viernes · 08:00-14:00 y 15:00-18:00",
    windows: [
      { day: 1, start: "08:00", end: "14:00" },
      { day: 1, start: "15:00", end: "18:00" },
      { day: 2, start: "08:00", end: "14:00" },
      { day: 2, start: "15:00", end: "18:00" },
      { day: 3, start: "08:00", end: "14:00" },
      { day: 3, start: "15:00", end: "18:00" },
      { day: 4, start: "08:00", end: "14:00" },
      { day: 4, start: "15:00", end: "18:00" },
      { day: 5, start: "08:00", end: "14:00" },
      { day: 5, start: "15:00", end: "18:00" },
    ],
  },
  doctor2: {
    label: "Lunes a viernes · 09:00-14:00 y 15:00-19:00",
    windows: [
      { day: 1, start: "09:00", end: "14:00" },
      { day: 1, start: "15:00", end: "19:00" },
      { day: 2, start: "09:00", end: "14:00" },
      { day: 2, start: "15:00", end: "19:00" },
      { day: 3, start: "09:00", end: "14:00" },
      { day: 3, start: "15:00", end: "19:00" },
      { day: 4, start: "09:00", end: "14:00" },
      { day: 4, start: "15:00", end: "19:00" },
      { day: 5, start: "09:00", end: "14:00" },
      { day: 5, start: "15:00", end: "19:00" },
    ],
  },
  doctor3: {
    label: "Lunes a sábado · 08:00-15:00",
    windows: [
      { day: 1, start: "08:00", end: "15:00" },
      { day: 2, start: "08:00", end: "15:00" },
      { day: 3, start: "08:00", end: "15:00" },
      { day: 4, start: "08:00", end: "15:00" },
      { day: 5, start: "08:00", end: "15:00" },
      { day: 6, start: "08:00", end: "15:00" },
    ],
  },
  doctor4: {
    label: "Lunes a viernes · 10:00-14:00 y 15:00-20:00",
    windows: [
      { day: 1, start: "10:00", end: "14:00" },
      { day: 1, start: "15:00", end: "20:00" },
      { day: 2, start: "10:00", end: "14:00" },
      { day: 2, start: "15:00", end: "20:00" },
      { day: 3, start: "10:00", end: "14:00" },
      { day: 3, start: "15:00", end: "20:00" },
      { day: 4, start: "10:00", end: "14:00" },
      { day: 4, start: "15:00", end: "20:00" },
      { day: 5, start: "10:00", end: "14:00" },
      { day: 5, start: "15:00", end: "20:00" },
    ],
  },
};

const normalizeValue = (value) => String(value || "").trim().toLowerCase();

const toMinutes = (timeValue) => {
  const [hours, minutes] = String(timeValue || "00:00").split(":").map(Number);
  return (hours * 60) + minutes;
};

const toTimeString = (totalMinutes) => {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
};

const addMinutesToTime = (timeValue, minutesToAdd) => toTimeString(toMinutes(timeValue) + minutesToAdd);

const getDateDay = (dateValue) => new Date(`${dateValue}T00:00:00`).getDay();

const overlaps = (leftStart, leftEnd, rightStart, rightEnd) => leftStart < rightEnd && leftEnd > rightStart;

const resolveDoctorProfile = ({ doctorUsername, doctorName }) => (
  findDoctorByUsername(doctorUsername) || findDoctorByName(doctorName)
);

export const getDoctorAvailabilityLabel = ({ doctorUsername, doctorName }) => {
  const doctorProfile = resolveDoctorProfile({ doctorUsername, doctorName });
  return doctorSchedules[doctorProfile?.username]?.label || "Horario no configurado";
};

export const getDoctorWorkingWindows = ({ doctorUsername, doctorName, date }) => {
  if (!date) {
    return [];
  }

  const doctorProfile = resolveDoctorProfile({ doctorUsername, doctorName });
  const schedule = doctorSchedules[doctorProfile?.username];

  if (!schedule) {
    return [];
  }

  const dayOfWeek = getDateDay(date);
  return schedule.windows.filter((windowItem) => windowItem.day === dayOfWeek);
};

export const getBusyAppointments = ({ appointments, doctorUsername, doctorName, date, excludeAppointmentId }) => {
  const doctorProfile = resolveDoctorProfile({ doctorUsername, doctorName });
  const normalizedDoctorUsername = normalizeValue(doctorProfile?.username || doctorUsername);
  const normalizedDoctorName = normalizeValue(doctorProfile?.name || doctorName);

  return appointments
    .filter((appointment) => appointment?.fecha === date)
    .filter((appointment) => appointment?.id !== excludeAppointmentId)
    .filter((appointment) => BUSY_APPOINTMENT_STATUSES.has(appointment?.estado))
    .filter((appointment) => {
      const appointmentDoctorUsername = normalizeValue(appointment?.doctorUsername);
      const appointmentDoctorName = normalizeValue(appointment?.doctor);

      return appointmentDoctorUsername === normalizedDoctorUsername
        || appointmentDoctorName === normalizedDoctorName;
    })
    .map((appointment) => ({
      ...appointment,
      startMinutes: toMinutes(appointment.hora),
      endMinutes: toMinutes(appointment.hora) + APPOINTMENT_DURATION_MINUTES,
    }));
};

export const getAvailableSlots = ({
  appointments,
  doctorUsername,
  doctorName,
  date,
  excludeAppointmentId,
}) => {
  const workingWindows = getDoctorWorkingWindows({ doctorUsername, doctorName, date });
  const busyAppointments = getBusyAppointments({
    appointments,
    doctorUsername,
    doctorName,
    date,
    excludeAppointmentId,
  });

  return workingWindows.flatMap((windowItem) => {
    const availableSlots = [];
    const windowStart = toMinutes(windowItem.start);
    const windowEnd = toMinutes(windowItem.end);

    for (
      let slotStart = windowStart;
      slotStart + APPOINTMENT_DURATION_MINUTES <= windowEnd;
      slotStart += APPOINTMENT_SLOT_STEP_MINUTES
    ) {
      const slotEnd = slotStart + APPOINTMENT_DURATION_MINUTES;
      const hasConflict = busyAppointments.some((appointment) => (
        overlaps(slotStart, slotEnd, appointment.startMinutes, appointment.endMinutes)
      ));

      if (!hasConflict) {
        availableSlots.push({
          startTime: toTimeString(slotStart),
          endTime: toTimeString(slotEnd),
        });
      }
    }

    return availableSlots;
  });
};

export const getAppointmentAvailabilityError = ({
  appointments,
  doctorUsername,
  doctorName,
  date,
  time,
  excludeAppointmentId,
}) => {
  if (!doctorUsername && !doctorName) {
    return "Selecciona un doctor para revisar la disponibilidad.";
  }

  const workingWindows = getDoctorWorkingWindows({ doctorUsername, doctorName, date });

  if (!date) {
    return "Selecciona una fecha para ver horarios disponibles.";
  }

  if (workingWindows.length === 0) {
    return "El doctor no atiende en la fecha seleccionada.";
  }

  if (!time) {
    return "Selecciona una hora disponible.";
  }

  const appointmentStart = toMinutes(time);
  const appointmentEnd = appointmentStart + APPOINTMENT_DURATION_MINUTES;
  const isWithinWorkingHours = workingWindows.some((windowItem) => (
    appointmentStart >= toMinutes(windowItem.start)
      && appointmentEnd <= toMinutes(windowItem.end)
  ));

  if (!isWithinWorkingHours) {
    return "La hora seleccionada está fuera del horario del doctor.";
  }

  const busyAppointments = getBusyAppointments({
    appointments,
    doctorUsername,
    doctorName,
    date,
    excludeAppointmentId,
  });

  const hasBusyConflict = busyAppointments.some((appointment) => (
    overlaps(appointmentStart, appointmentEnd, appointment.startMinutes, appointment.endMinutes)
  ));

  if (hasBusyConflict) {
    return "La hora seleccionada ya está ocupada. Elige otra disponible.";
  }

  return "";
};

export const buildAvailabilityCalendarEvents = ({
  appointments,
  doctorUsername,
  doctorName,
  date,
  excludeAppointmentId,
  selectedTime,
}) => {
  if (!date) {
    return [];
  }

  const workingWindows = getDoctorWorkingWindows({ doctorUsername, doctorName, date });
  const busyAppointments = getBusyAppointments({
    appointments,
    doctorUsername,
    doctorName,
    date,
    excludeAppointmentId,
  });
  const selectedStart = selectedTime ? toMinutes(selectedTime) : null;

  const workingEvents = workingWindows.map((windowItem, index) => ({
    id: `working-window-${index}`,
    start: `${date}T${windowItem.start}:00`,
    end: `${date}T${windowItem.end}:00`,
    display: "background",
    backgroundColor: "rgba(34, 197, 94, 0.16)",
  }));

  const busyEvents = busyAppointments.map((appointment) => ({
    id: `busy-${appointment.id}`,
    title: `Ocupada · ${appointment.nombre}`,
    start: `${date}T${appointment.hora}:00`,
    end: `${date}T${addMinutesToTime(appointment.hora, APPOINTMENT_DURATION_MINUTES)}:00`,
    backgroundColor: "#fecaca",
    borderColor: "#dc2626",
    textColor: "#991b1b",
  }));

  const selectedEvent = selectedStart === null
    ? []
    : [{
      id: "selected-slot",
      title: "Horario seleccionado",
      start: `${date}T${selectedTime}:00`,
      end: `${date}T${addMinutesToTime(selectedTime, APPOINTMENT_DURATION_MINUTES)}:00`,
      backgroundColor: "#dbeafe",
      borderColor: "#2563eb",
      textColor: "#1d4ed8",
    }];

  return [...workingEvents, ...busyEvents, ...selectedEvent];
};