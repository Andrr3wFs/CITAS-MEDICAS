import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from 'react-router-dom';
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import esLocale from "@fullcalendar/core/locales/es";
import AppointmentForm from "../AppointmentForm";
import api from "../api";
import { appointmentBelongsToDoctor, findDoctorByName, findDoctorByUsername } from "../doctorDirectory";
import saludSysMark from "../assets/saludsys-mark.svg";
import DoctorMedicalHistorySection from "./DoctorMedicalHistorySection";
import AdminAccessRequestsPanel from "./AdminAccessRequestsPanel";
import ToastContainer, { useToast } from "./ToastContainer";
import AdminMetricsDashboard from "./AdminMetricsDashboard";
import { Activity, BarChart3, ClipboardPenLine, ClipboardPlus, FileText, LayoutDashboard, Stethoscope, UserPlus, UsersRound } from "lucide-react";

const APPOINTMENT_ALERT_POLL_INTERVAL_MS = 30000;
const REMINDER_CHECK_INTERVAL_MS = 60000;

const emptyClinicalHistory = {
  medicalHistory: "",
  diagnosis: "",
  observations: "",
  treatment: "",
  indications: "",
  followUp: "",
  prescription: "",
};

const getClinicalHistoryFromAppointment = (appointment) => ({
  ...emptyClinicalHistory,
  ...(appointment?.clinicalHistory || {}),
  diagnosis: appointment?.clinicalHistory?.diagnosis || appointment?.diagnostico || "",
});

const hasRegisteredClinicalHistory = (appointment) =>
  Boolean(appointment?.clinicalHistory?.diagnosis || appointment?.diagnostico);

const getAlertSnapshotStorageKey = (user) => {
  const role = String(user?.role || "guest").toLowerCase();
  const username = String(user?.username || "anon").trim().toLowerCase();
  return `appointment-alert-snapshot-${role}-${username}`;
};

const parseStoredSnapshot = (value) => {
  try {
    const parsedValue = JSON.parse(value || "[]");
    return Array.isArray(parsedValue) ? parsedValue : [];
  } catch (error) {
    return [];
  }
};

const createAppointmentSnapshot = (appointment) => ({
  id: appointment.id,
  nombre: appointment.nombre || "",
  fecha: appointment.fecha || "",
  hora: appointment.hora || "",
  doctor: appointment.doctor || "",
  doctorUsername: appointment.doctorUsername || "",
  sintoma: appointment.sintoma || "",
  estado: appointment.estado || "pendiente",
});

const hasPatientAppointmentChanged = (previousAppointment, currentAppointment) => {
  const trackedFields = ["fecha", "hora", "doctor", "doctorUsername", "sintoma"];
  return trackedFields.some(
    (field) => previousAppointment?.[field] !== currentAppointment?.[field]
  );
};

const buildAutomatedAppointmentAlerts = ({ previousAppointments, currentAppointments, isDoctor }) => {
  const previousAppointmentsById = new Map(
    previousAppointments.map((appointment) => [appointment.id, appointment])
  );

  return currentAppointments.flatMap((appointment) => {
    const previousAppointment = previousAppointmentsById.get(appointment.id);

    if (isDoctor) {
      if (!previousAppointment) {
        return [{
          id: `doctor-assigned-${appointment.id}-${appointment.fecha}-${appointment.hora}`,
          type: "success",
          title: "Nueva cita asignada",
          message: `Se te asignó una nueva cita con ${appointment.nombre} para el ${appointment.fecha} a las ${appointment.hora}.`,
        }];
      }

      return [];
    }

    if (!previousAppointment) {
      return [];
    }

    const nextAlerts = [];

    if (previousAppointment.estado !== "aprobada" && appointment.estado === "aprobada") {
      nextAlerts.push({
        id: `patient-approved-${appointment.id}-${appointment.estado}`,
        type: "success",
        title: "Cita aprobada",
        message: `Tu cita con ${appointment.doctor} para el ${appointment.fecha} a las ${appointment.hora} fue aprobada.`,
        playSound: true,
      });
    }

    if (previousAppointment.estado !== "rechazada" && appointment.estado === "rechazada") {
      nextAlerts.push({
        id: `patient-rejected-${appointment.id}-${appointment.estado}`,
        type: "error",
        title: "Cita rechazada",
        message: `Tu cita con ${appointment.doctor} para el ${appointment.fecha} a las ${appointment.hora} fue rechazada. Contacta al hospital para más información.`,
      });
    }

    if (hasPatientAppointmentChanged(previousAppointment, appointment)) {
      nextAlerts.push({
        id: `patient-updated-${appointment.id}-${appointment.fecha}-${appointment.hora}-${appointment.doctor}-${appointment.sintoma}`,
        type: "warning",
        title: "Cita modificada",
        message: `Tu cita fue modificada. Revisa la nueva información de fecha, hora o doctor asignado.`,
      });
    }

    return nextAlerts;
  });
};

const mergeAlerts = (currentAlerts, nextAlerts) => {
  const knownIds = new Set(currentAlerts.map((alertItem) => alertItem.id));
  const uniqueNextAlerts = nextAlerts.filter((alertItem) => !knownIds.has(alertItem.id));
  return [...uniqueNextAlerts, ...currentAlerts].slice(0, 6);
};

const getAppointmentDateTime = (appointment) => {
  const date = appointment?.fecha || "";
  const time = appointment?.hora || "00:00";
  return `${date}T${time}:00`;
};

const getAppointmentEndDateTime = (appointment) => {
  const startDate = new Date(getAppointmentDateTime(appointment));

  if (Number.isNaN(startDate.getTime())) {
    return getAppointmentDateTime(appointment);
  }

  startDate.setMinutes(startDate.getMinutes() + 45);
  return startDate.toISOString();
};

const getCalendarEventPalette = (status) => {
  if (status === "aprobada") {
    return {
      backgroundColor: "#eadcf8",
      borderColor: "#6f34a5",
      textColor: "#44205f",
    };
  }

  if (status === "rechazada") {
    return {
      backgroundColor: "#fee2e2",
      borderColor: "#dc2626",
      textColor: "#991b1b",
    };
  }

  return {
    backgroundColor: "#fef3c7",
    borderColor: "#f59e0b",
    textColor: "#92400e",
  };
};

export default function DashboardLayout({ user, handleLogout }) {
  const canManageAppointments = user?.role === "admin" || user?.role === "secretaria";
  const isDoctor = user?.role === "doctor";
  const assignedDoctorName = user?.displayName || user?.username || "";
  const defaultTab = canManageAppointments || isDoctor ? "appointments" : "reserve";
  const [activeTab, setActiveTab] = useState(
    defaultTab
  );
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState(null);
  const [automatedAlerts, setAutomatedAlerts] = useState([]);
  const {
    toasts,
    addToast,
    dismissToast,
  } = useToast();
  const firedRemindersRef = useRef(new Set());
  const [selectedAppointment, setSelectedAppointment] = useState(null);
  const [editingAppointment, setEditingAppointment] = useState(null);
  const [medicalHistoryAppointment, setMedicalHistoryAppointment] = useState(null);
  const [medicalHistoryMode, setMedicalHistoryMode] = useState("edit");
  const [clinicalHistoryForm, setClinicalHistoryForm] = useState(emptyClinicalHistory);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const navigate = useNavigate();
  const [showAccessRequests, setShowAccessRequests] = useState(false);
  const [admissions, setAdmissions] = useState([]);
  const [beds, setBeds] = useState([]);
  const [triageForm, setTriageForm] = useState({
    patientName: user?.displayName || user?.username || "",
    patientId: user?.username || "",
    source: "urgencia",
    symptom: "",
    triageLevel: "amarillo",
    notes: "",
    appointmentId: "",
    requiresHospitalization: false,
    bedId: "",
    admissionStatus: "esperando",
  });
  const calendarRef = useRef(null);
  const [calendarInitialView] = useState(() =>
    window.innerWidth <= 640 ? "listWeek" : "timeGridWeek"
  );

  const getResponsiveView = useCallback(() => {
    return window.innerWidth <= 640 ? "listWeek" : "timeGridWeek";
  }, []);

  useEffect(() => {
    const syncCalendarView = () => {
      const api = calendarRef.current?.getApi();
      if (!api) return;
      const desired = getResponsiveView();
      if (api.view.type !== desired) {
        api.changeView(desired);
      }
    };

    window.addEventListener("resize", syncCalendarView);
    window.addEventListener("orientationchange", syncCalendarView);

    return () => {
      window.removeEventListener("resize", syncCalendarView);
      window.removeEventListener("orientationchange", syncCalendarView);
    };
  }, [getResponsiveView]);

  const fetchAppointments = async (showLoadingState = true) => {
    if (showLoadingState) {
      setLoading(true);
    }

    try {
      const res = await api.get("/appointments");
      setAppointments(res.data.appointments || []);
    } catch (err) {
      setAlert({ type: "error", message: "No se pudieron cargar las citas." });
      addToast({ type: "error", title: "Error", message: "No se pudieron cargar las citas." });
    } finally {
      if (showLoadingState) {
        setLoading(false);
      }
    }
  };

  const fetchAdmissions = async () => {
    try {
      const res = await api.get('/admissions');
      setAdmissions(res.data.admissions || []);
    } catch (err) {
      console.error('fetchAdmissions error', err);
      const errorMessage = err.response?.data?.message || err.message || 'No se pudieron cargar los registros de admisiones.';
      setAlert({ type: 'error', message: `No se pudieron cargar los registros de admisiones. ${errorMessage}` });
    }
  };

  const fetchBeds = async () => {
    try {
      const res = await api.get('/beds');
      setBeds(res.data.beds || []);
    } catch (err) {
      setAlert({ type: 'error', message: 'No se pudieron cargar las camas.' });
    }
  };

  useEffect(() => {
    fetchAppointments();
    if (isDoctor) {
      fetchAdmissions();
      fetchBeds();
    }
  }, [canManageAppointments, isDoctor]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      fetchAppointments(false);
    }, APPOINTMENT_ALERT_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab]);

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [activeTab]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(min-width: 901px)");
    const handleViewportChange = (event) => {
      if (event.matches) {
        setIsSidebarOpen(false);
      }
    };

    mediaQuery.addEventListener("change", handleViewportChange);

    return () => {
      mediaQuery.removeEventListener("change", handleViewportChange);
    };
  }, []);

  const handleAdmissionsSubmit = async (event) => {
    event.preventDefault();

    try {
      const res = await api.post('/admissions', {
        patientName: triageForm.patientName,
        patientId: triageForm.patientId,
        source: triageForm.source,
        symptom: triageForm.symptom,
        triageLevel: triageForm.triageLevel,
        notes: triageForm.notes,
        appointmentId: triageForm.appointmentId || null,
        requiresHospitalization: triageForm.requiresHospitalization,
        bedId: triageForm.bedId || null,
        admissionStatus: triageForm.admissionStatus,
      });

      setAdmissions((prev) => [res.data.admission, ...prev]);
      setAlert({ type: 'success', message: 'Registro de triaje creado correctamente.' });
      setTriageForm({
        patientName: user?.displayName || user?.username || "",
        patientId: user?.username || "",
        source: "urgencia",
        symptom: "",
        triageLevel: "amarillo",
        notes: "",
        appointmentId: "",
        requiresHospitalization: false,
        bedId: "",
        admissionStatus: "esperando",
      });
    } catch (err) {
      setAlert({
        type: 'error',
        message: err.response?.data?.message || 'No se pudo guardar el triaje.',
      });
    }
  };

  const handleNewAppointment = async (appointmentData) => {
    try {
      const nombre = user?.username || "Usuario";
      const res = await api.post("/appointments", {
        nombre,
        sintoma: appointmentData.symptom,
        fecha: appointmentData.date,
        hora: appointmentData.time,
        doctor: appointmentData.doctor,
        doctorUsername: appointmentData.doctorUsername,
        especialidad: appointmentData.specialty,
      });

      const createdAppointment = res.data.appointment;

      setAlert({ type: "success", message: "Cita reservada correctamente." });
      addToast({ type: "success", title: "Cita reservada", message: "Tu cita ha sido registrada y está pendiente de aprobación." });
      setAppointments((prev) => [...prev, createdAppointment]);
      setSelectedAppointment(createdAppointment);
      setEditingAppointment(null);
      setActiveTab("reserve");
      return true;
    } catch (err) {
      setAlert({
        type: "error",
        message:
          err.response?.data?.message || "Error al reservar la cita. Intenta de nuevo.",
      });
      addToast({ type: "error", title: "Error al reservar", message: err.response?.data?.message || "Error al reservar la cita. Intenta de nuevo." });
      return false;
    }
  };

  const visibleAppointments = useMemo(() => {
    if (canManageAppointments) {
      return appointments;
    }

    if (isDoctor) {
      return appointments.filter((apt) => appointmentBelongsToDoctor(apt, user));
    }

    return appointments.filter((apt) => apt.nombre === user?.username);
  }, [appointments, canManageAppointments, isDoctor, user]);

  const medicalHistoryEntries = useMemo(() => {
    return visibleAppointments
      .filter((apt) => apt.estado === "aprobada" && hasRegisteredClinicalHistory(apt))
      .sort((left, right) => {
        const leftDate = new Date(`${left.fecha}T${left.hora || "00:00"}`);
        const rightDate = new Date(`${right.fecha}T${right.hora || "00:00"}`);

        return rightDate - leftDate;
      });
  }, [visibleAppointments]);

  useEffect(() => {
    if (!canManageAppointments && !isDoctor && medicalHistoryEntries.length > 0) {
      setActiveTab("clinical-history");
    }
  }, [canManageAppointments, isDoctor, medicalHistoryEntries.length]);

  useEffect(() => {
    if (!canManageAppointments && !isDoctor && medicalHistoryEntries.length > 0) {
      const alertStorageKey = `medical-history-alert-seen-${user?.username || "paciente"}`;

      const lastSeenAt = Number(window.localStorage.getItem(alertStorageKey) || 0);
      const twentyFourHoursInMs = 24 * 60 * 60 * 1000;
      const hasExpired = !lastSeenAt || Date.now() - lastSeenAt >= twentyFourHoursInMs;

      if (hasExpired) {
        setAlert({
          type: "success",
          message: "Tienes una nueva historia clinica registrada. Puedes consultarla en tu apartado de historia clinica.",
        });
        addToast({ type: "info", title: "Historia clínica", message: "Tienes una nueva historia clínica registrada. Consúltala en tu apartado de historia clínica." });
        window.localStorage.setItem(alertStorageKey, String(Date.now()));
      }
    }
  }, [canManageAppointments, isDoctor, medicalHistoryEntries.length, user?.username]);

  useEffect(() => {
    if (canManageAppointments || !user?.username) {
      return;
    }

    const storageKey = getAlertSnapshotStorageKey(user);
    const previousSnapshot = parseStoredSnapshot(window.localStorage.getItem(storageKey));
    const relevantAppointments = (
      isDoctor
        ? appointments.filter((appointment) => appointmentBelongsToDoctor(appointment, user))
        : appointments.filter((appointment) => appointment.nombre === user?.username)
    ).map(createAppointmentSnapshot);

    if (previousSnapshot.length > 0) {
      const nextAlerts = buildAutomatedAppointmentAlerts({
        previousAppointments: previousSnapshot,
        currentAppointments: relevantAppointments,
        isDoctor,
      });

      if (nextAlerts.length > 0) {
        setAutomatedAlerts((currentAlerts) => mergeAlerts(currentAlerts, nextAlerts));
        setAlert({ type: "success", message: nextAlerts[0].message });
        nextAlerts.forEach((a) => addToast({
          type: a.type || "info",
          title: a.title,
          message: a.message,
          duration: 7000,
          playSound: Boolean(a.playSound),
        }));
      }
    }

    window.localStorage.setItem(storageKey, JSON.stringify(relevantAppointments));
  }, [appointments, canManageAppointments, isDoctor, user]);

  // ── Appointment reminders (1 day and 1 hour before) ──
  useEffect(() => {
    const checkReminders = () => {
      const now = Date.now();
      const ONE_HOUR = 60 * 60 * 1000;
      const ONE_DAY = 24 * ONE_HOUR;

      const upcomingApproved = visibleAppointments.filter(
        (apt) => apt.estado === "aprobada"
      );

      upcomingApproved.forEach((apt) => {
        const aptTime = new Date(`${apt.fecha}T${apt.hora || "00:00"}`).getTime();
        if (Number.isNaN(aptTime) || aptTime <= now) return;

        const diff = aptTime - now;
        const label = isDoctor
          ? `con ${apt.nombre}`
          : `con ${apt.doctor}`;

        // 1 day reminder
        if (diff <= ONE_DAY && diff > ONE_HOUR) {
          const key = `reminder-1d-${apt.id}`;
          if (!firedRemindersRef.current.has(key)) {
            firedRemindersRef.current.add(key);
            addToast({
              type: "reminder",
              title: "Recordatorio (mañana)",
              message: `Tu cita ${label} es mañana ${apt.fecha} a las ${apt.hora}.`,
              duration: 8000,
            });
          }
        }

        // 1 hour reminder
        if (diff <= ONE_HOUR) {
          const key = `reminder-1h-${apt.id}`;
          if (!firedRemindersRef.current.has(key)) {
            firedRemindersRef.current.add(key);
            addToast({
              type: "reminder",
              title: "Recordatorio (1 hora)",
              message: `Tu cita ${label} es en menos de 1 hora — ${apt.hora}.`,
              duration: 10000,
            });
          }
        }
      });
    };

    checkReminders();
    const timerId = window.setInterval(checkReminders, REMINDER_CHECK_INTERVAL_MS);
    return () => window.clearInterval(timerId);
  }, [visibleAppointments, isDoctor, addToast]);

  const doctorApprovedAppointments = useMemo(() => {
    return visibleAppointments
      .filter((apt) => apt.estado === "aprobada")
      .sort((left, right) => {
        const leftDate = new Date(`${left.fecha}T${left.hora || "00:00"}`);
        const rightDate = new Date(`${right.fecha}T${right.hora || "00:00"}`);

        return rightDate - leftDate;
      });
  }, [visibleAppointments]);

  const calendarEvents = useMemo(() => {
    return visibleAppointments.map((appointment) => {
      const palette = getCalendarEventPalette(appointment.estado);
      const title = canManageAppointments
        ? `${appointment.nombre} · ${appointment.doctor}`
        : isDoctor
          ? appointment.nombre
          : appointment.doctor;

      return {
        id: String(appointment.id),
        title,
        start: getAppointmentDateTime(appointment),
        end: getAppointmentEndDateTime(appointment),
        backgroundColor: palette.backgroundColor,
        borderColor: palette.borderColor,
        textColor: palette.textColor,
        classNames: ["calendar-appointment-event", `calendar-appointment-event-${appointment.estado}`],
        extendedProps: {
          appointment,
          status: appointment.estado,
        },
      };
    });
  }, [visibleAppointments, canManageAppointments, isDoctor]);

  const upcomingCount = visibleAppointments.length;
  const approvedCount = visibleAppointments.filter((apt) => apt.estado === "aprobada").length;
  const pendingCount = visibleAppointments.filter((apt) => apt.estado === "pendiente").length;
  const rejectedCount = visibleAppointments.filter((apt) => apt.estado === "rechazada").length;
  const selectedAppointmentHistory = selectedAppointment
    ? getClinicalHistoryFromAppointment(selectedAppointment)
    : emptyClinicalHistory;

  const closeSidebar = () => {
    setIsSidebarOpen(false);
  };

  const dismissAutomatedAlert = (alertId) => {
    setAutomatedAlerts((currentAlerts) =>
      currentAlerts.filter((alertItem) => alertItem.id !== alertId)
    );
  };

  const handleCalendarEventClick = (clickInfo) => {
    const appointment = clickInfo.event.extendedProps.appointment;
    if (appointment) {
      openAppointmentDetails(appointment);
    }
  };

  const renderCalendarEventContent = (eventInfo) => {
    const appointment = eventInfo.event.extendedProps.appointment;
    const status = eventInfo.event.extendedProps.status || "pendiente";
    const isList = eventInfo.view.type === "listWeek";
    // Prefer the event start date if available to format AM/PM
    const rawDate = eventInfo.event.start || eventInfo.event.startStr;
    let formattedTime = eventInfo.timeText;
    try {
      if (rawDate) {
        const d = rawDate instanceof Date ? rawDate : new Date(rawDate);
        formattedTime = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
      }
    } catch (e) {
      // fallback to provided timeText
      formattedTime = eventInfo.timeText;
    }

    if (isList && appointment) {
      return (
        <div className={`calendar-list-card calendar-list-card-${status}`}>
          <div className="calendar-list-card-main">
            <strong className="calendar-list-card-title">{eventInfo.event.title}</strong>
            <span className="calendar-list-card-time">{formattedTime}</span>
          </div>
          <span className={`calendar-list-badge calendar-list-badge-${status}`}>
            {status === "aprobada" ? "Aprobada" : status === "rechazada" ? "Rechazada" : "Pendiente"}
          </span>
        </div>
      );
    }

    return (
      <div className="calendar-event-content" title={eventInfo.event.title}>
        <div className="calendar-event-time" aria-hidden="true">{formattedTime}</div>
        <div className="calendar-event-body">
          <div className="calendar-event-title" title={appointment?.nombre || eventInfo.event.title}>
            {appointment?.nombre || eventInfo.event.title}
          </div>
          {appointment?.doctor && (
            <div className="calendar-event-sub" title={appointment.doctor}>
              {appointment.doctor}
            </div>
          )}
        </div>
      </div>
    );
  };

  const toggleSidebar = () => {
    setIsSidebarOpen((prev) => !prev);
  };

  const handleTabChange = (nextTab) => {
    setActiveTab(nextTab);
    closeSidebar();
  };

  const updateAppointmentInState = (updatedAppointment) => {
    setAppointments((prev) =>
      prev.map((apt) => (apt.id === updatedAppointment.id ? updatedAppointment : apt))
    );
    setSelectedAppointment((prev) =>
      prev?.id === updatedAppointment.id ? updatedAppointment : prev
    );
    setEditingAppointment((prev) =>
      prev?.id === updatedAppointment.id ? updatedAppointment : prev
    );
    setMedicalHistoryAppointment((prev) =>
      prev?.id === updatedAppointment.id ? updatedAppointment : prev
    );
  };

  const handleStatusChange = async (appointment, newStatus) => {
    try {
      const res = await api.put(`/appointments/${appointment.id}`, { estado: newStatus });
      updateAppointmentInState(res.data.appointment);
      setAlert({
        type: "success",
        message: `Cita ${newStatus === "aprobada" ? "aprobada" : "rechazada"} correctamente.`,
      });
      addToast({ type: newStatus === "aprobada" ? "success" : "warning", title: newStatus === "aprobada" ? "Aprobada" : "Rechazada", message: `Cita ${newStatus === "aprobada" ? "aprobada" : "rechazada"} correctamente.` });
    } catch (err) {
      const backendError = err.response?.data?.message || err.message || "Error al actualizar el estado de la cita.";
      setAlert({ type: "error", message: backendError });
      addToast({ type: "error", title: "Error", message: backendError });
    }
  };

  const openAppointmentDetails = (appointment) => {
    setSelectedAppointment(appointment);
    setEditingAppointment(null);
    setMedicalHistoryAppointment(null);
    setMedicalHistoryMode("edit");
    setClinicalHistoryForm(getClinicalHistoryFromAppointment(appointment));
  };

  const closeAppointmentDetails = () => {
    setSelectedAppointment(null);
  };

  const handleEditAppointment = (appointment) => {
    if (!canManageAppointments) {
      return;
    }

    setSelectedAppointment(null);
    setEditingAppointment(appointment);
    setMedicalHistoryAppointment(null);
  };

  const openMedicalHistoryEditor = (appointment) => {
    if (!appointment || appointment.estado !== "aprobada") {
      return;
    }

    setSelectedAppointment(appointment);
    setMedicalHistoryAppointment(appointment);
    setEditingAppointment(null);
    setMedicalHistoryMode("edit");
    setClinicalHistoryForm(getClinicalHistoryFromAppointment(appointment));
  };

  const openMedicalHistoryViewer = (appointment) => {
    if (!appointment || appointment.estado !== "aprobada") {
      return;
    }

    setSelectedAppointment(appointment);
    setMedicalHistoryAppointment(appointment);
    setEditingAppointment(null);
    setMedicalHistoryMode("view");
    setClinicalHistoryForm(getClinicalHistoryFromAppointment(appointment));
  };

  const openClinicalHistoryTab = () => {
    setActiveTab("clinical-history");
    closeSidebar();

    if (isDoctor && doctorApprovedAppointments.length > 0) {
      openMedicalHistoryEditor(doctorApprovedAppointments[0]);
      return;
    }

    setMedicalHistoryAppointment(null);
  };

  const openDoctorClinicalHistoryFromModal = (appointment) => {
    if (!appointment || appointment.estado !== "aprobada") {
      return;
    }

    openMedicalHistoryEditor(appointment);
    setActiveTab("clinical-history");
    closeSidebar();
  };

  const openPatientClinicalHistoryFromModal = (appointment) => {
    if (!appointment || appointment.estado !== "aprobada" || !hasRegisteredClinicalHistory(appointment)) {
      return;
    }

    setActiveTab("clinical-history");
    closeSidebar();
    setSelectedAppointment(null);
  };

  const closeMedicalHistoryForm = () => {
    setMedicalHistoryAppointment(null);
    setMedicalHistoryMode("edit");
    setClinicalHistoryForm(getClinicalHistoryFromAppointment(selectedAppointment));
  };

  const updateClinicalHistoryField = (field, value) => {
    setClinicalHistoryForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveClinicalHistory = async (event, enhancedValues = {}) => {
    event.preventDefault();

    if (!medicalHistoryAppointment) {
      return;
    }

    const nextClinicalHistory = {
      medicalHistory: clinicalHistoryForm.medicalHistory.trim(),
      diagnosis: clinicalHistoryForm.diagnosis.trim(),
      observations: clinicalHistoryForm.observations.trim(),
      treatment: clinicalHistoryForm.treatment.trim(),
      indications: clinicalHistoryForm.indications.trim(),
      followUp: clinicalHistoryForm.followUp.trim(),
      prescription: String(enhancedValues.prescription ?? clinicalHistoryForm.prescription ?? "").trim(),
    };

    if (!nextClinicalHistory.diagnosis) {
      setAlert({
        type: "error",
        message: "Debes escribir un diagnostico para guardar la historia clinica.",
      });
      addToast({ type: "error", title: "Campo requerido", message: "Debes escribir un diagnóstico para guardar la historia clínica." });
      return;
    }

    try {
      if (enhancedValues.triage) {
        await api.post("/doctor/triaje", {
          appointmentId: medicalHistoryAppointment.id,
          ...enhancedValues.triage,
        });
      }

      const res = await api.post("/doctor/historial", {
        appointmentId: medicalHistoryAppointment.id,
        ...nextClinicalHistory,
      });

      updateAppointmentInState(res.data.appointment);
      setMedicalHistoryAppointment(res.data.appointment);
      setMedicalHistoryMode("view");
      setClinicalHistoryForm(getClinicalHistoryFromAppointment(res.data.appointment));
      setAlert({ type: "success", message: "Historia clinica guardada correctamente." });
      addToast({ type: "success", title: "Guardado", message: "Historia clínica guardada correctamente." });
    } catch (err) {
      setAlert({
        type: "error",
        message: err.response?.data?.message || "No se pudo guardar la historia clinica.",
      });
      addToast({ type: "error", title: "Error", message: err.response?.data?.message || "No se pudo guardar la historia clínica." });
    }
  };

  const handleUpdateAppointment = async (appointmentData) => {
    if (!editingAppointment) {
      return false;
    }

    try {
      const updateData = {
        sintoma: appointmentData.symptom,
        fecha: appointmentData.date,
        hora: appointmentData.time,
        doctor: appointmentData.doctor,
        doctorUsername: appointmentData.doctorUsername,
        especialidad: appointmentData.specialty,
      };

      if (appointmentData.status) {
        updateData.estado = appointmentData.status;
      }

      const res = await api.put(`/appointments/${editingAppointment.id}`, updateData);

      updateAppointmentInState(res.data.appointment);
      setEditingAppointment(null);
      setAlert({ type: "success", message: "Cita actualizada correctamente." });
      addToast({ type: "success", title: "Actualizada", message: "Cita actualizada correctamente." });
      return true;
    } catch (err) {
      setAlert({ type: "error", message: "Error al actualizar la cita." });
      addToast({ type: "error", title: "Error", message: "Error al actualizar la cita." });
      return false;
    }
  };

  const handleDeleteAppointment = async (appointment) => {
    if (!canManageAppointments) {
      return;
    }

    const confirmed = window.confirm("¿Quieres eliminar esta cita?");

    if (!confirmed) {
      return;
    }

    try {
      await api.delete(`/appointments/${appointment.id}`);
      setAppointments((prev) => prev.filter((apt) => apt.id !== appointment.id));
      setSelectedAppointment((prev) => (prev?.id === appointment.id ? null : prev));
      setEditingAppointment((prev) => (prev?.id === appointment.id ? null : prev));
      setMedicalHistoryAppointment((prev) => (prev?.id === appointment.id ? null : prev));
      setAlert({ type: "success", message: "Cita eliminada correctamente." });
      addToast({ type: "success", title: "Eliminada", message: "Cita eliminada correctamente." });
    } catch (err) {
      setAlert({ type: "error", message: "Error al eliminar la cita." });
      addToast({ type: "error", title: "Error", message: "Error al eliminar la cita." });
    }
  };

  return (
    <div className="app-wrapper">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      <header className="app-header">
        <div className="brand">
          <div>
            <h1>
              <span className="brand-title-desktop">MediCenter</span>
              <span className="brand-title-mobile">MediCenter</span>
            </h1>
            <p className="brand-subtitle">Bienvenido, {user.displayName || user.username}</p>
          </div>
        </div>
        <div className="header-actions">
          <button className="btn-secondary header-logout-desktop" onClick={handleLogout}>
            Cerrar sesión
          </button>
          <div className="mobile-header-primary-actions">
            <button
              type="button"
              className={`btn-mobile-menu ${isSidebarOpen ? "is-open" : ""}`}
              onClick={toggleSidebar}
              aria-expanded={isSidebarOpen}
              aria-controls="dashboard-sidebar"
            >
              <span className="btn-mobile-menu-icon" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
              Menu
            </button>
            <button type="button" className="btn-secondary btn-mobile-logout" onClick={handleLogout}>
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>

      <div className="app-body">
        <div
          className={`app-sidebar-overlay ${isSidebarOpen ? "is-visible" : ""}`}
          onClick={closeSidebar}
          aria-hidden="true"
        />
        <aside
          id="dashboard-sidebar"
          className={`app-sidebar ${isSidebarOpen ? "is-open" : ""}`}
        >
          <div className="sidebar-section">
            <p className="sidebar-title">Secciones</p>
            <button
              className={`sidebar-link ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => handleTabChange("dashboard")}
            >
              <LayoutDashboard aria-hidden="true" size={18} strokeWidth={2} />
              <span>Resumen</span>
            </button>
            <button
              className={`sidebar-link ${activeTab === "appointments" ? "active" : ""}`}
              onClick={() => handleTabChange("appointments")}
            >
              <UsersRound aria-hidden="true" size={18} strokeWidth={2} />
              <span>{canManageAppointments ? "Todas las citas" : isDoctor ? "Mis pacientes" : "Mis citas"}</span>
            </button>
            {!canManageAppointments && (
              <button
                className={`sidebar-link ${activeTab === "clinical-history" ? "active" : ""}`}
                onClick={openClinicalHistoryTab}
              >
                <FileText aria-hidden="true" size={18} strokeWidth={2} />
                <span>{isDoctor ? "Formulario médico" : "Historia clínica"}</span>
              </button>
            )}
            {!canManageAppointments && !isDoctor && (
              <>
                <button
                  className={`sidebar-link ${activeTab === "reserve" ? "active" : ""}`}
                  onClick={() => handleTabChange("reserve")}
                >
                  <ClipboardPlus aria-hidden="true" size={18} strokeWidth={2} />
                  <span>Reservar cita</span>
                </button>
              </>
            )}
            {isDoctor && (
              <button
                className={`sidebar-link ${activeTab === "admissions" ? "active" : ""}`}
                onClick={() => handleTabChange("admissions")}
              >
                <Stethoscope aria-hidden="true" size={18} strokeWidth={2} />
                <span>Admisiones y triaje</span>
              </button>
            )}
            {isDoctor && (
              <button
                className={`sidebar-link ${activeTab === "metrics" ? "active" : ""}`}
                onClick={() => handleTabChange("metrics")}
              >
                <BarChart3 aria-hidden="true" size={18} strokeWidth={2} />
                <span>Métricas</span>
              </button>
            )}
            {canManageAppointments && user?.role === "admin" && (
              <button
                className="sidebar-link"
                onClick={() => setShowAccessRequests(true)}
              >
                <UserPlus aria-hidden="true" size={18} strokeWidth={2} />
                <span>Solicitudes de acceso</span>
              </button>
            )}
          </div>

          <div className="sidebar-footer">
            <div className="sidebar-status-heading">
              <p className="sidebar-footer-label">Estado de citas</p>
              <Activity aria-hidden="true" size={16} strokeWidth={2} />
            </div>
            <div className="sidebar-total-appointments">
              <span>Total</span>
              <strong>{upcomingCount}</strong>
            </div>
            <div className="sidebar-status-list">
              <div className="sidebar-status-badge is-pending">
                <span className="sidebar-status-dot" aria-hidden="true" />
                <span>Pendientes</span>
                <strong>{pendingCount}</strong>
              </div>
              <div className="sidebar-status-badge is-approved">
                <span className="sidebar-status-dot" aria-hidden="true" />
                <span>Aprobadas</span>
                <strong>{approvedCount}</strong>
              </div>
              <div className="sidebar-status-badge is-rejected">
                <span className="sidebar-status-dot" aria-hidden="true" />
                <span>Rechazadas</span>
                <strong>{rejectedCount}</strong>
              </div>
            </div>
          </div>
        </aside>

        <main className="app-main">
          <div className="page-header">
            {activeTab === "dashboard" && <h2>Resumen</h2>}
            {activeTab === "metrics" && isDoctor && <h2>Métricas clínicas</h2>}
            {activeTab === "appointments" && (
              <h2>{canManageAppointments ? "Gestión de citas" : isDoctor ? "Mis pacientes" : "Mis citas"}</h2>
            )}
            {activeTab === "clinical-history" && !canManageAppointments && (
              <h2>{isDoctor ? "Formulario medico" : "Historia clinica"}</h2>
            )}
            {activeTab === "reserve" && !canManageAppointments && !isDoctor && <h2>Reservar cita</h2>}
            {activeTab === "admissions" && isDoctor && <h2>Admisiones y triaje</h2>}
          </div>

          {alert && (
            <div className={`alert ${alert.type === "error" ? "alert-error" : "alert-success"}`}>
              {alert.message}
            </div>
          )}

          {automatedAlerts.length > 0 && (
            <section className="alert-feed" aria-label="Alertas automáticas">
              <div className="alert-feed-header">
                <h3>Alertas</h3>
                <span>{automatedAlerts.length}</span>
              </div>

              <div className="alert-feed-list">
                {automatedAlerts.map((alertItem) => (
                  <article
                    key={alertItem.id}
                    className={`alert alert-feed-item ${alertItem.type === "error" ? "alert-error" : "alert-success"}`}
                  >
                    <div className="alert-feed-copy">
                      <strong>{alertItem.title}</strong>
                      <p>{alertItem.message}</p>
                    </div>
                    <button
                      type="button"
                      className="alert-feed-dismiss"
                      onClick={() => dismissAutomatedAlert(alertItem.id)}
                      aria-label={`Cerrar alerta: ${alertItem.title}`}
                    >
                      ×
                    </button>
                  </article>
                ))}
              </div>
            </section>
          )}

          {activeTab === "dashboard" && (
            <section className="dashboard-cards">
              <div className="card">
                <h3>Citas totales</h3>
                <p className="card-value">{upcomingCount}</p>
                <p className="card-meta">
                  {canManageAppointments ? "Total registradas" : isDoctor ? "Citas asignadas" : "Tus citas"}
                </p>
              </div>
              <div className="card card-pending-emphasis">
                <div className="card-emphasis-icon" aria-hidden="true">!</div>
                <h3>Citas pendientes</h3>
                <p className="card-value">{pendingCount}</p>
                <p className="card-meta">
                  {canManageAppointments
                    ? "Esperando aprobación"
                    : isDoctor
                      ? "Pendientes contigo"
                      : "Pendientes de aprobación"}
                </p>
              </div>
              <div className="card card-approved-emphasis">
                <div className="card-emphasis-icon card-emphasis-icon-approved" aria-hidden="true">✓</div>
                <h3>Citas aprobadas</h3>
                <p className="card-value">{approvedCount}</p>
                <p className="card-meta">Confirmadas</p>
              </div>
              <div className="card card-rejected-emphasis">
                <div className="card-emphasis-icon card-emphasis-icon-rejected" aria-hidden="true">×</div>
                <h3>Citas rechazadas</h3>
                <p className="card-value">{rejectedCount}</p>
                <p className="card-meta">No disponibles</p>
              </div>
            </section>
          )}

          {activeTab === "metrics" && isDoctor && <AdminMetricsDashboard />}

          {activeTab === "appointments" && (
            <section className="appointments-list">
              {loading && <p>Cargando citas...</p>}
              {!loading && visibleAppointments.length === 0 && <p>No hay citas registradas.</p>}
              {!loading && visibleAppointments.length > 0 && (
                <div className="appointments-content appointments-content-calendar">
                  <div className="appointments-table-card">
                    <div className="calendar-shell">
                      <div className="calendar-shell-header">
                        <div>
                          <h3>Calendario de citas</h3>
                          <p>Vista por día o semana. Haz clic en una cita para ver sus detalles.</p>
                        </div>
                        <div className="calendar-legend" aria-label="Leyenda de estados">
                          <span className="calendar-legend-item is-approved">Aprobada</span>
                          <span className="calendar-legend-item is-rejected">Rechazada</span>
                          <span className="calendar-legend-item is-pending">Pendiente</span>
                        </div>
                      </div>

                      <div className="calendar-card">
                        <FullCalendar
                          ref={calendarRef}
                          plugins={[timeGridPlugin, dayGridPlugin, listPlugin, interactionPlugin]}
                          locale={esLocale}
                          initialView={calendarInitialView}
                          headerToolbar={{
                            left: "prev,next today",
                            center: "title",
                            right: "listWeek,timeGridDay,timeGridWeek,dayGridMonth",
                          }}
                          buttonText={{
                            today: "Hoy",
                            day: "Día",
                            week: "Semana",
                            month: "Mes",
                            list: "Lista",
                          }}
                          allDaySlot={false}
                          slotMinTime="06:00:00"
                          slotMaxTime="22:00:00"
                          height="auto"
                          events={calendarEvents}
                          eventClick={handleCalendarEventClick}
                          eventContent={renderCalendarEventContent}
                          dayMaxEventRows={3}
                          nowIndicator
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {selectedAppointment && (
                <div
                  className="appointment-modal-backdrop"
                  onClick={closeAppointmentDetails}
                  aria-hidden="true"
                >
                  <section
                    className="appointment-details-card appointment-modal"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="appointment-details-title"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="appointment-details-header">
                      <div>
                        <p className="details-eyebrow">Detalles de la cita</p>
                        <h3 id="appointment-details-title">{selectedAppointment.nombre}</h3>
                      </div>
                      <button
                        type="button"
                        className="btn-details-close"
                        onClick={closeAppointmentDetails}
                        aria-label="Cerrar detalles"
                        title="Cerrar detalles"
                      >
                        ×
                      </button>
                    </div>
                    <div className="appointment-detail-grid">
                      <div>
                        <span className="detail-label">Paciente</span>
                        <p>{selectedAppointment.nombre}</p>
                      </div>
                      <div>
                        <span className="detail-label">Estado</span>
                        <p>{selectedAppointment.estado}</p>
                      </div>
                      <div>
                        <span className="detail-label">Fecha</span>
                        <p>{selectedAppointment.fecha}</p>
                      </div>
                      <div>
                        <span className="detail-label">Hora</span>
                        <p>{selectedAppointment.hora}</p>
                      </div>
                      <div>
                        <span className="detail-label">Doctor</span>
                        <p>{selectedAppointment.doctor}</p>
                      </div>
                      <div className="appointment-detail-full">
                        <span className="detail-label">Síntoma</span>
                        <p>{selectedAppointment.sintoma}</p>
                      </div>
                      <div className="appointment-detail-full">
                        <span className="detail-label">Historial médico</span>
                        <p>{selectedAppointmentHistory.medicalHistory || "Sin historial médico registrado."}</p>
                      </div>
                    </div>

                    <div className="appointment-detail-actions">
                      {canManageAppointments && (
                        <>
                          {selectedAppointment.estado === "pendiente" && (
                            <>
                              <button
                                type="button"
                                className="btn-small btn-approve"
                                onClick={() => handleStatusChange(selectedAppointment, "aprobada")}
                              >
                                Aprobar
                              </button>
                              <button
                                type="button"
                                className="btn-small btn-reject"
                                onClick={() => handleStatusChange(selectedAppointment, "rechazada")}
                              >
                                Rechazar
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            className="btn-small btn-edit"
                            onClick={() => handleEditAppointment(selectedAppointment)}
                          >
                            Modificar
                          </button>
                          <button
                            type="button"
                            className="btn-small btn-delete"
                            onClick={() => handleDeleteAppointment(selectedAppointment)}
                          >
                            Eliminar
                          </button>
                        </>
                      )}

                      {isDoctor && !canManageAppointments && (
                        <button
                          type="button"
                          className="btn-form-secondary appointment-role-action"
                          onClick={() => openDoctorClinicalHistoryFromModal(selectedAppointment)}
                          disabled={selectedAppointment.estado !== "aprobada"}
                        >
                          {selectedAppointment.estado === "aprobada"
                            ? hasRegisteredClinicalHistory(selectedAppointment)
                              ? "Ver o editar historia clínica"
                              : "Registrar historia clínica"
                            : "Disponible al aprobarse"}
                        </button>
                      )}

                      {!canManageAppointments && !isDoctor && (
                        <button
                          type="button"
                          className="btn-form-secondary appointment-role-action"
                          onClick={() => openPatientClinicalHistoryFromModal(selectedAppointment)}
                          disabled={selectedAppointment.estado !== "aprobada" || !hasRegisteredClinicalHistory(selectedAppointment)}
                        >
                          {selectedAppointment.estado !== "aprobada"
                            ? "Disponible cuando se apruebe"
                            : hasRegisteredClinicalHistory(selectedAppointment)
                              ? "Ver historia clínica"
                              : "Historia clínica pendiente"}
                        </button>
                      )}

                      {!canManageAppointments && !isDoctor && selectedAppointment.estado === 'aprobada' && (!selectedAppointment.preConsult || !selectedAppointment.preConsult.answered) && (
                        <button
                          type="button"
                          className="btn-primary-action"
                          onClick={() => navigate(`/questionnaire/${selectedAppointment.id}`)}
                        >
                          Completar cuestionario pre-consulta
                        </button>
                      )}

                      <button
                        type="button"
                        className="btn-form-secondary appointment-role-action"
                        onClick={closeAppointmentDetails}
                      >
                        Cerrar
                      </button>
                    </div>
                  </section>
                </div>
              )}

              {editingAppointment && (
                <AppointmentForm
                  title="Editar cita"
                  submitLabel="Guardar cambios"
                  initialValues={editingAppointment}
                  appointments={appointments}
                  onSubmit={handleUpdateAppointment}
                  onCancel={() => setEditingAppointment(null)}
                  isAdmin={canManageAppointments}
                />
              )}

            </section>
          )}

          {activeTab === "clinical-history" && isDoctor && (
            <DoctorMedicalHistorySection
              assignedDoctorName={assignedDoctorName}
              appointments={doctorApprovedAppointments}
              activeAppointment={medicalHistoryAppointment}
              formValues={clinicalHistoryForm}
              formMode={medicalHistoryMode}
              onCreateForm={openMedicalHistoryEditor}
              onViewAppointment={openMedicalHistoryViewer}
              onEditAppointment={openMedicalHistoryEditor}
              onCloseForm={closeMedicalHistoryForm}
              onSave={handleSaveClinicalHistory}
              onFieldChange={updateClinicalHistoryField}
            />
          )}

          {activeTab === "clinical-history" && !isDoctor && !canManageAppointments && (
            <section className="appointments-list">
              <div className="appointments-table-card">
                <h3>Mi historia clinica</h3>
                <p>
                  Solo puedes consultar la historia clinica registrada por el doctor.
                </p>

                {medicalHistoryEntries.length === 0 ? (
                  <p>No tienes historias clinicas registradas todavia.</p>
                ) : (
                  <div className="clinical-history-readonly-list">
                    {medicalHistoryEntries.map((entry) => {
                      const history = getClinicalHistoryFromAppointment(entry);

                      return (
                        <article key={entry.id} className="clinical-history-readonly-card">
                          <div className="medical-history-form-header">
                            <div className="medical-history-header-stack">
                              <div className="medical-history-brand-lockup">
                                <div className="medical-history-brand-copy">
                                  <span className="medical-history-brand-name">MediCenter</span>
                                  <span className="medical-history-brand-tagline">Expediente hospitalario</span>
                                </div>
                              </div>
                              <div className="medical-history-identity">
                                <p className="details-eyebrow">Paciente</p>
                                <div className="medical-history-title-row">
                                  <h3>{entry.nombre}</h3>
                                  <span className="medical-history-specialty-badge">
                                    {(findDoctorByUsername(entry.doctorUsername) || findDoctorByName(entry.doctor))?.specialty || "Atención general"}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <span className={`status-badge status-${entry.estado}`}>{entry.estado}</span>
                          </div>

                          <div className="medical-history-meta">
                            <span>Fecha: {entry.fecha}</span>
                            <span>Hora: {entry.hora}</span>
                            <span>Doctor: {entry.doctor}</span>
                          </div>

                          <div className="clinical-history-readonly-grid">
                            <div>
                              <span className="detail-label">Sintoma principal</span>
                              <p>{entry.sintoma}</p>
                            </div>
                            <div>
                              <span className="detail-label">Historial medico</span>
                              <p>{history.medicalHistory || "Sin historial medico registrado."}</p>
                            </div>
                            <div>
                              <span className="detail-label">Diagnostico</span>
                              <p>{history.diagnosis || "Sin diagnostico registrado."}</p>
                            </div>
                            <div>
                              <span className="detail-label">Observaciones</span>
                              <p>{history.observations || "Sin observaciones."}</p>
                            </div>
                            <div>
                              <span className="detail-label">Tratamiento</span>
                              <p>{history.treatment || "Sin tratamiento registrado."}</p>
                            </div>
                            <div>
                              <span className="detail-label">Indicaciones</span>
                              <p>{history.indications || "Sin indicaciones registradas."}</p>
                            </div>
                            <div>
                              <span className="detail-label">Seguimiento</span>
                              <p>{history.followUp || "Sin seguimiento registrado."}</p>
                            </div>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === "reserve" && !canManageAppointments && !isDoctor && (
            <section className="appointments-list">
              <AppointmentForm
                title="Reservar cita"
                submitLabel="Reservar cita"
                appointments={appointments}
                onSubmit={handleNewAppointment}
                isAdmin={false}
              />
            </section>
          )}

          {activeTab === "admissions" && isDoctor && (
            <section className="appointments-list">
              <div className="appointments-table-card">
                <h3>Triaje y admisiones</h3>
                <p>Registra pacientes urgentes o de consulta externa, asigna prioridad según Manchester y hospitálizalos cuando sea necesario.</p>
                <form className="auth-form" onSubmit={handleAdmissionsSubmit}>
                  <div className="auth-field">
                    <label>Nombre del paciente</label>
                    <input
                      value={triageForm.patientName}
                      onChange={(event) => setTriageForm((prev) => ({ ...prev, patientName: event.target.value }))}
                      required
                    />
                  </div>
                  <div className="auth-field">
                    <label>ID / documento</label>
                    <input
                      value={triageForm.patientId}
                      onChange={(event) => setTriageForm((prev) => ({ ...prev, patientId: event.target.value }))}
                    />
                  </div>
                  <div className="auth-field">
                    <label>Origen</label>
                    <select
                      value={triageForm.source}
                      onChange={(event) => setTriageForm((prev) => ({ ...prev, source: event.target.value }))}
                    >
                      <option value="urgencia">Urgencias</option>
                      <option value="consulta externa">Consulta externa</option>
                    </select>
                  </div>
                  <div className="auth-field auth-field-wide">
                    <label>Motivo de ingreso</label>
                    <input
                      value={triageForm.symptom}
                      onChange={(event) => setTriageForm((prev) => ({ ...prev, symptom: event.target.value }))}
                      required
                    />
                  </div>
                  <div className="auth-field">
                    <label>Nivel de triaje</label>
                    <select
                      value={triageForm.triageLevel}
                      onChange={(event) => setTriageForm((prev) => ({ ...prev, triageLevel: event.target.value }))}
                    >
                      <option value="rojo">Rojo</option>
                      <option value="naranja">Naranja</option>
                      <option value="amarillo">Amarillo</option>
                      <option value="verde">Verde</option>
                      <option value="azul">Azul</option>
                    </select>
                  </div>
                  <div className="auth-field">
                    <label>Estado de ingreso</label>
                    <select
                      value={triageForm.admissionStatus}
                      onChange={(event) => setTriageForm((prev) => ({ ...prev, admissionStatus: event.target.value }))}
                    >
                      <option value="esperando">Esperando</option>
                      <option value="en_atencion">En atención</option>
                      <option value="hospitalizado">Hospitalizado</option>
                      <option value="alta">Alta</option>
                    </select>
                  </div>
                  <div className="auth-field auth-field-wide">
                    <label>Vincular a cita (opcional)</label>
                    <select
                      value={triageForm.appointmentId}
                      onChange={(event) => setTriageForm((prev) => ({ ...prev, appointmentId: event.target.value }))}
                    >
                      <option value="">-- Sin vínculo --</option>
                      {appointments.map((apt) => (
                        <option key={apt.id} value={apt.id}>{`${apt.id} · ${apt.nombre} · ${apt.fecha} ${apt.hora} · ${apt.doctor}`}</option>
                      ))}
                    </select>
                  </div>
                  <div className="auth-field">
                    <label className="auth-checkbox-row">
                      <input
                        type="checkbox"
                        checked={triageForm.requiresHospitalization}
                        onChange={(event) => setTriageForm((prev) => ({ ...prev, requiresHospitalization: event.target.checked }))}
                      />
                      Requiere hospitalización
                    </label>
                  </div>
                  {triageForm.requiresHospitalization && (
                    <div className="auth-field">
                      <label>Cama</label>
                      <select
                        value={triageForm.bedId}
                        onChange={(event) => setTriageForm((prev) => ({ ...prev, bedId: event.target.value }))}
                      >
                        <option value="">Selecciona una cama</option>
                        {beds.filter((bed) => bed.status === 'disponible').map((bed) => (
                          <option key={bed.id} value={bed.id}>{bed.name} · {bed.room} · {bed.type}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="auth-field auth-field-wide">
                    <label>Notas</label>
                    <textarea
                      value={triageForm.notes}
                      onChange={(event) => setTriageForm((prev) => ({ ...prev, notes: event.target.value }))}
                      rows="3"
                    />
                  </div>
                  <button className="auth-submit" type="submit">Guardar registro</button>
                </form>
              </div>

              <div className="appointments-table-card" style={{ marginTop: '1rem' }}>
                <h3>Disponibilidad de camas</h3>
                <div className="clinical-history-readonly-grid">
                  {beds.map((bed) => (
                    <article key={bed.id} className="clinical-history-readonly-card">
                      <h4>{bed.name}</h4>
                      <p><strong>Habitación:</strong> {bed.room}</p>
                      <p><strong>Tipo:</strong> {bed.type}</p>
                      <p><strong>Estado:</strong> {bed.status}</p>
                    </article>
                  ))}
                </div>
              </div>

              <div className="appointments-table-card" style={{ marginTop: '1rem' }}>
                <h3>Registros de admisión</h3>
                {admissions.length === 0 ? (
                  <p>No hay registros aún.</p>
                ) : (
                  <div className="clinical-history-readonly-list">
                    {admissions.map((entry) => (
                      <article key={entry.id} className="clinical-history-readonly-card">
                        <div className="medical-history-form-header">
                          <div>
                            <h4>{entry.patientName}</h4>
                            <p>{entry.patientId || 'Sin documento'}</p>
                          </div>
                          <span className={`status-badge status-triage-${entry.triageLevel}`}>{entry.triageLevel}</span>
                        </div>
                        <p><strong>Origen:</strong> {entry.source}</p>
                        <p><strong>Síntoma:</strong> {entry.symptom}</p>
                        <p><strong>Estado:</strong> {entry.status}</p>
                        <p><strong>Cama:</strong> {entry.bedName || 'Sin asignar'}</p>
                        <p><strong>Notas:</strong> {entry.notes || 'Sin observaciones'}</p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </main>

        {showAccessRequests && (
          <AdminAccessRequestsPanel
            user={user}
            onClose={() => setShowAccessRequests(false)}
          />
        )}
      </div>
    </div>
  );
}
