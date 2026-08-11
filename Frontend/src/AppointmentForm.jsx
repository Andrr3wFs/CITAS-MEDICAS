import React, { useEffect, useMemo, useState } from "react";
import FullCalendar from "@fullcalendar/react";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import esLocale from "@fullcalendar/core/locales/es";
import { doctorsList, findDoctorByName, specialtiesList } from "./doctorDirectory";
import {
  APPOINTMENT_DURATION_MINUTES,
  buildAvailabilityCalendarEvents,
  getAppointmentAvailabilityError,
  getAvailableSlots,
  getDoctorAvailabilityLabel,
} from "./appointmentAvailability";

const symptomsList = [
  "Dolor en el pecho intenso",
  "Dificultad para respirar ",
  "Dolor abdominal intenso",
  "Fiebre Alta",
  "Fatiga extrema",
  "Vómitos o diarrea",
  
];


const getInitialFormState = (initialValues = {}) => {
  const selectedDoctor = findDoctorByName(initialValues.doctor);

  return {
    symptom: initialValues.symptom || initialValues.sintoma || "",
    date: initialValues.date || initialValues.fecha || "",
    time: initialValues.time || initialValues.hora || "",
    doctor: initialValues.doctor || "",
    doctorUsername: initialValues.doctorUsername || "",
    specialty: initialValues.specialty || selectedDoctor?.specialty || "",
    status: initialValues.status || initialValues.estado || "",
  };
};

export default function AppointmentForm({
  onSubmit,
  appointments = [],
  initialValues,
  title = "Book Appointment",
  submitLabel = "Book Appointment",
  onCancel,
  cancelLabel = "Cancelar",
  isAdmin = false,
}) {
  const [formValues, setFormValues] = useState(() => getInitialFormState(initialValues));
  const [error, setError] = useState("");

  useEffect(() => {
    setFormValues(getInitialFormState(initialValues));
    setError("");
  }, [initialValues]);

  const { symptom, date, time, doctor, doctorUsername, specialty, status } = formValues;
  const isPatientForm = !isAdmin;
  const selectedDoctor = useMemo(
    () => findDoctorByName(doctor) || doctorsList.find((doctorOption) => doctorOption.username === doctorUsername),
    [doctor, doctorUsername]
  );
  const availableDoctors = specialty
    ? doctorsList.filter((doctorOption) => doctorOption.specialty === specialty)
    : doctorsList;
  const isDoctorSelectDisabled = !specialty;
  const doctorPlaceholder = specialty
    ? availableDoctors.length > 0
      ? "Doctor selecto"
      : "No hay doctores para esta especialidad"
    : "Primero elige una especialidad";
  const availableSlots = useMemo(() => getAvailableSlots({
    appointments,
    doctorUsername: selectedDoctor?.username || doctorUsername,
    doctorName: selectedDoctor?.name || doctor,
    date,
    excludeAppointmentId: initialValues?.id,
  }), [appointments, date, doctor, doctorUsername, initialValues?.id, selectedDoctor?.name, selectedDoctor?.username]);
  const appointmentAvailabilityLabel = getDoctorAvailabilityLabel({
    doctorUsername: selectedDoctor?.username || doctorUsername,
    doctorName: selectedDoctor?.name || doctor,
  });
  const selectedTimeStillAvailable = availableSlots.some((slot) => slot.startTime === time);
  const canKeepInitialTime = Boolean(
    initialValues?.id
      && initialValues?.hora === time
      && initialValues?.fecha === date
      && (initialValues?.doctorUsername || "") === (selectedDoctor?.username || doctorUsername || "")
  );
  const timeOptions = selectedTimeStillAvailable || !time
    ? availableSlots
    : canKeepInitialTime
      ? [{ startTime: time, endTime: "", isLegacy: true }, ...availableSlots]
      : availableSlots;
  const availabilityEvents = useMemo(() => buildAvailabilityCalendarEvents({
    appointments,
    doctorUsername: selectedDoctor?.username || doctorUsername,
    doctorName: selectedDoctor?.name || doctor,
    date,
    excludeAppointmentId: initialValues?.id,
    selectedTime: time,
  }), [appointments, date, doctor, doctorUsername, initialValues?.id, selectedDoctor?.name, selectedDoctor?.username, time]);

  useEffect(() => {
    if (!time) {
      return;
    }

    if (!selectedTimeStillAvailable && !canKeepInitialTime) {
      updateField("time", "");
    }
  }, [canKeepInitialTime, selectedTimeStillAvailable, time]);

  const updateField = (field, value) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleSpecialtyChange = (nextSpecialty) => {
    setFormValues((prev) => {
      const selectedDoctor = findDoctorByName(prev.doctor);

      return {
        ...prev,
        specialty: nextSpecialty,
        doctorUsername:
          selectedDoctor && nextSpecialty && selectedDoctor.specialty !== nextSpecialty
            ? ""
            : prev.doctorUsername,
        doctor:
          selectedDoctor && nextSpecialty && selectedDoctor.specialty !== nextSpecialty
            ? ""
            : prev.doctor,
      };
    });

    const selectedDoctor = findDoctorByName(doctor);
    if (selectedDoctor && nextSpecialty && selectedDoctor.specialty !== nextSpecialty) {
      setError("");
    }
  };

  const resetForm = () => {
    setFormValues(getInitialFormState());
    setError("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (selectedDoctor && selectedDoctor.specialty !== specialty) {
      setError("El doctor seleccionado no pertenece a la especialidad elegida.");
      return;
    }

    if (isAdmin && !status) {
      setError("Debes seleccionar un estado para la cita.");
      return;
    }

    const availabilityError = getAppointmentAvailabilityError({
      appointments,
      doctorUsername: selectedDoctor?.username || doctorUsername,
      doctorName: selectedDoctor?.name || doctor,
      date,
      time,
      excludeAppointmentId: initialValues?.id,
    });

    if (availabilityError) {
      setError(availabilityError);
      return;
    }

    setError("");

    const submissionData = { symptom, date, time, doctor, doctorUsername, specialty };
    if (isAdmin && status) {
      submissionData.status = status;
    }

    const success = await onSubmit(submissionData);

    if (success !== false && !initialValues) {
      resetForm();
    }
  };

  return (
    <div className="appointment-form-container">
      <div className={`appointment-form-card ${isPatientForm ? "appointment-form-card-patient" : ""}`}>
        <h2 className="appointment-form-title">{title}</h2>
        {isPatientForm && (
          <p className="appointment-form-mobile-note">
            Selecciona sintomas, fecha y doctor en unos pocos pasos.
          </p>
        )}
        <form className="appointment-form" onSubmit={handleSubmit}>
          <div className="appointment-form-grid">
            <div className="appointment-field appointment-field-full">
              <label>
                <span className="appointment-field-label-content">
                  {isPatientForm && <span className="appointment-field-icon" aria-hidden="true">⚕</span>}
                  <span>Síntomas:</span>
                </span>
              </label>
              <select
                value={symptom}
                onChange={e => updateField("symptom", e.target.value)}
                required
              >
                <option value="">Síntoma selecto</option>
                {symptomsList.map(symptomOption => (
                  <option key={symptomOption} value={symptomOption}>{symptomOption}</option>
                ))}
              </select>
            </div>

            <div className="appointment-field appointment-field-compact appointment-field-date">
              <label>
                <span className="appointment-field-label-content">
                  {isPatientForm && <span className="appointment-field-icon" aria-hidden="true">📅</span>}
                  <span>Fecha:</span>
                </span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => updateField("date", e.target.value)}
                required
              />
            </div>

            <div className="appointment-field appointment-field-compact appointment-field-time">
              <label>
                <span className="appointment-field-label-content">
                  {isPatientForm && <span className="appointment-field-icon" aria-hidden="true">🕒</span>}
                  <span>Hora:</span>
                </span>
              </label>
              <select
                value={time}
                onChange={(e) => updateField("time", e.target.value)}
                disabled={!selectedDoctor || !date || timeOptions.length === 0}
                required
              >
                <option value="">
                  {!selectedDoctor || !date
                    ? "Selecciona doctor y fecha"
                    : timeOptions.length > 0
                      ? "Selecciona una hora disponible"
                      : "Sin horarios disponibles"}
                </option>
                {timeOptions.map((slot) => (
                  <option key={`${slot.startTime}-${slot.endTime || 'legacy'}`} value={slot.startTime}>
                    {slot.isLegacy
                      ? `${slot.startTime} (horario actual)`
                      : `${slot.startTime} - ${slot.endTime}`}
                  </option>
                ))}
              </select>
              <p className="appointment-field-helper">
                Las citas duran {APPOINTMENT_DURATION_MINUTES} minutos y solo se muestran horas disponibles.
              </p>
            </div>

            <div className="appointment-field">
              <label>
                <span className="appointment-field-label-content">
                  {isPatientForm && <span className="appointment-field-icon" aria-hidden="true">🩺</span>}
                  <span>Especialidad:</span>
                </span>
              </label>
              <select
                value={specialty}
                onChange={e => {
                  const newSpecialty = e.target.value;
                  handleSpecialtyChange(newSpecialty);
                  const selectedDoc = findDoctorByName(doctor);
                  if (selectedDoc && newSpecialty && selectedDoc.specialty !== newSpecialty) {
                    setError("El doctor seleccionado no pertenece a la especialidad elegida.");
                  } else {
                    setError("");
                  }
                }}
                required
              >
                <option value="">Especialidad selecta</option>
                {specialtiesList.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            <div className="appointment-field">
              <label>
                <span className="appointment-field-label-content">
                  {isPatientForm && <span className="appointment-field-icon" aria-hidden="true">👨‍⚕️</span>}
                  <span>Doctor:</span>
                </span>
              </label>
              <select
                value={doctor}
                disabled={isDoctorSelectDisabled}
                onChange={e => {
                  const selectedName = e.target.value;
                  const selectedDoctor = findDoctorByName(selectedName);
                  updateField("doctor", selectedName);
                  updateField("doctorUsername", selectedDoctor?.username || "");
                  if (selectedDoctor && specialty && selectedDoctor.specialty !== specialty) {
                    setError("El doctor seleccionado no pertenece a la especialidad elegida.");
                  } else {
                    setError("");
                  }
                }}
                required
              >
                <option value="">{doctorPlaceholder}</option>
                {availableDoctors.map((doc) => (
                  <option key={doc.name} value={doc.name}>{doc.name}</option>
                ))}
              </select>

              {isDoctorSelectDisabled && (
                <p className="appointment-field-helper">Primero elige una especialidad.</p>
              )}

              {!isDoctorSelectDisabled && selectedDoctor && (
                <p className="appointment-field-helper">Horario: {appointmentAvailabilityLabel}</p>
              )}
            </div>

            {isAdmin && (
              <div className="appointment-field">
                <label>Estado:</label>
                <select
                  value={status}
                  onChange={e => updateField("status", e.target.value)}
                >
                  <option value="">Seleccionar estado</option>
                  <option value="pendiente">Pendiente</option>
                  <option value="aprobada">Aprobada</option>
                  <option value="rechazada">Rechazada</option>
                  <option value="atendida">Atendida</option>
                  <option value="cancelada">Cancelada</option>
                  <option value="no_asistencia">No asistencia</option>
                </select>
              </div>
            )}
          </div>

          <div className="appointment-availability-card">
            <div className="appointment-availability-header">
              <div>
                <h3>Disponibilidad del doctor</h3>
                <p>
                  {selectedDoctor && date
                    ? `Agenda de ${selectedDoctor.name} para ${date}. Los bloques rojos ya están ocupados.`
                    : "Selecciona doctor y fecha para ver horarios y disponibilidad."}
                </p>
              </div>
            </div>

            {selectedDoctor && date ? (
              <div className="appointment-availability-calendar">
                <FullCalendar
                  plugins={[timeGridPlugin, interactionPlugin]}
                  locale={esLocale}
                  initialView="timeGridDay"
                  initialDate={date}
                  headerToolbar={false}
                  allDaySlot={false}
                  slotMinTime="06:00:00"
                  slotMaxTime="22:00:00"
                  height="auto"
                  events={availabilityEvents}
                />
              </div>
            ) : (
              <p className="appointment-availability-empty">
                No hay disponibilidad para mostrar todavía.
              </p>
            )}
          </div>

          {error && <div className="appointment-form-error">{error}</div>}

          <div className={`appointment-form-actions ${isPatientForm ? "appointment-form-actions-patient" : ""}`}>
            {onCancel && (
              <button type="button" className="btn-form-secondary" onClick={onCancel}>
                {cancelLabel}
              </button>
            )}
            <button type="submit">{submitLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}