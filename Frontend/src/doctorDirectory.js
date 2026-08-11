export const specialtiesList = [
  "Cardiología",
  "Gastroenterología",
  "Pediatría",
  "Medicina Interna",
];

export const doctorsList = [
  { username: "doctor1", name: "Dr. García", specialty: "Cardiología" },
  { username: "doctor2", name: "Dra. Martínez", specialty: "Gastroenterología" },
  { username: "doctor3", name: "Dr. López", specialty: "Pediatría" },
  { username: "doctor4", name: "Dra. Fernández", specialty: "Medicina Interna" },
];

const normalizeValue = (value) => String(value || "").trim().toLowerCase();

export const findDoctorByName = (doctorName) =>
  doctorsList.find((doctor) => normalizeValue(doctor.name) === normalizeValue(doctorName));

export const findDoctorByUsername = (doctorUsername) =>
  doctorsList.find((doctor) => normalizeValue(doctor.username) === normalizeValue(doctorUsername));

export const appointmentBelongsToDoctor = (appointment, user) => {
  const username = normalizeValue(user?.username);
  const displayName = normalizeValue(user?.displayName || user?.username);

  if (!appointment) {
    return false;
  }

  if (normalizeValue(appointment.doctorUsername) === username) {
    return true;
  }

  if (normalizeValue(appointment.doctor) === displayName) {
    return true;
  }

  const doctorProfile = findDoctorByUsername(username);

  if (!doctorProfile) {
    return false;
  }

  return normalizeValue(appointment.doctor) === normalizeValue(doctorProfile.name);
};