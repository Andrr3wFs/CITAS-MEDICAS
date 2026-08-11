const express = require('express');
const router = express.Router();
const { admissions, beds, appointments, saveData, normalizeUsername } = require('../storage');
const { authenticate, getRequestUserRole } = require('../auth');

const triageLevels = ['rojo', 'naranja', 'amarillo', 'verde', 'azul'];
const admissionStatuses = ['esperando', 'en_atencion', 'hospitalizado', 'alta'];
const bedStatuses = ['disponible', 'ocupada', 'mantenimiento'];

const sanitizeText = (value) => String(value || '').trim().replace(/[<>]/g, (match) => (match === '<' ? '&lt;' : '&gt;'));

const canManageAdmissions = (req) => getRequestUserRole(req) === 'doctor';

const getNextAdmissionId = () => {
  const highestKnownId = admissions.reduce((maxId, admission) => {
    const numericId = Number(admission?.id);
    return Number.isInteger(numericId) && numericId > maxId ? numericId : maxId;
  }, 0);

  return highestKnownId + 1;
};

const getDefaultBedAssignment = (selectedBedId = null) => {
  const targetBed = beds.find((bed) => String(bed.id) === String(selectedBedId)) || beds.find((bed) => bed.status === 'disponible');

  if (!targetBed) {
    return null;
  }

  if (targetBed.status !== 'disponible') {
    return null;
  }

  targetBed.status = 'ocupada';
  return {
    id: targetBed.id,
    name: targetBed.name,
    room: targetBed.room,
    type: targetBed.type,
  };
};

const releaseBedAssignment = (bedId) => {
  if (!bedId) {
    return;
  }

  const targetBed = beds.find((bed) => String(bed.id) === String(bedId));
  if (targetBed) {
    targetBed.status = 'disponible';
  }
};

const normalizeAdmission = (admission = {}) => ({
  ...admission,
  id: Number(admission?.id) || getNextAdmissionId(),
  patientName: sanitizeText(admission?.patientName || ''),
  patientId: sanitizeText(admission?.patientId || admission?.patientName || ''),
  source: String(admission?.source || 'urgencia').trim().toLowerCase() === 'consulta externa' ? 'consulta externa' : 'urgencia',
  symptom: sanitizeText(admission?.symptom || ''),
  triageLevel: triageLevels.includes(String(admission?.triageLevel || '').trim().toLowerCase())
    ? String(admission?.triageLevel || '').trim().toLowerCase()
    : 'amarillo',
  status: admissionStatuses.includes(String(admission?.status || '').trim().toLowerCase())
    ? String(admission?.status || '').trim().toLowerCase()
    : 'esperando',
  notes: sanitizeText(admission?.notes || ''),
  appointmentId: admission?.appointmentId !== undefined && admission?.appointmentId !== null && admission?.appointmentId !== ''
    ? String(admission.appointmentId)
    : null,
  bedId: admission?.bedId ? String(admission.bedId) : null,
  bedName: sanitizeText(admission?.bedName || ''),
  createdAt: admission?.createdAt || new Date().toISOString(),
  updatedAt: admission?.updatedAt || new Date().toISOString(),
});

router.use(authenticate);

router.get('/admissions', (req, res) => {
  if (!canManageAdmissions(req)) {
    return res.status(403).json({ success: false, message: 'No tienes permisos para ver admisiones' });
  }

  return res.json({
    success: true,
    admissions: admissions.map((admission) => normalizeAdmission(admission)),
  });
});

router.get('/beds', (req, res) => {
  if (!canManageAdmissions(req)) {
    return res.status(403).json({ success: false, message: 'No tienes permisos para ver camas' });
  }

  return res.json({
    success: true,
    beds: beds.map((bed) => ({
      ...bed,
      status: bedStatuses.includes(String(bed.status || '').trim().toLowerCase())
        ? String(bed.status || '').trim().toLowerCase()
        : 'disponible',
    })),
  });
});

router.post('/admissions', (req, res) => {
  if (!canManageAdmissions(req)) {
    return res.status(403).json({ success: false, message: 'No tienes permisos para registrar admisiones' });
  }

  const {
    patientName,
    patientId,
    source,
    symptom,
    triageLevel,
    notes,
    appointmentId,
    requiresHospitalization,
    bedId,
    admissionStatus,
  } = req.body;

  if (!patientName || !symptom || !triageLevel) {
    return res.status(400).json({ success: false, message: 'Nombre, síntoma y nivel de triaje son obligatorios' });
  }

  const normalizedPatientId = sanitizeText(patientId || patientName);
  const normalizedSource = String(source || 'urgencia').trim().toLowerCase() === 'consulta externa' ? 'consulta externa' : 'urgencia';
  const normalizedTriageLevel = triageLevels.includes(String(triageLevel).trim().toLowerCase())
    ? String(triageLevel).trim().toLowerCase()
    : 'amarillo';
  const normalizedStatus = admissionStatuses.includes(String(admissionStatus || '').trim().toLowerCase())
    ? String(admissionStatus || '').trim().toLowerCase()
    : 'esperando';

  let bedAssignment = null;

  if (requiresHospitalization) {
    bedAssignment = getDefaultBedAssignment(bedId);

    if (!bedAssignment) {
      return res.status(400).json({ success: false, message: 'No hay camas disponibles para esta hospitalización' });
    }
  }

  const newAdmission = normalizeAdmission({
    id: getNextAdmissionId(),
    patientName: sanitizeText(patientName),
    patientId: normalizedPatientId,
    source: normalizedSource,
    symptom: sanitizeText(symptom),
    triageLevel: normalizedTriageLevel,
    notes: sanitizeText(notes || ''),
    appointmentId: appointmentId || null,
    bedId: bedAssignment?.id ? String(bedAssignment.id) : null,
    bedName: bedAssignment ? `${bedAssignment.name} · ${bedAssignment.room}` : '',
    status: requiresHospitalization ? 'hospitalizado' : normalizedStatus,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  admissions.push(newAdmission);
  saveData();

  // If the admission is linked to an appointment, update that appointment status
  if (newAdmission.appointmentId) {
    const targetAppointment = appointments.find((a) => String(a.id) === String(newAdmission.appointmentId));
    if (targetAppointment) {
      targetAppointment.estado = 'hospitalizado';
      targetAppointment.diagnostico = targetAppointment.diagnostico || `Hospitalizado (ingreso id ${newAdmission.id})`;
      saveData();
    }
  }

  return res.json({ success: true, admission: newAdmission });
});

// Obtener admisión por id
router.get('/admissions/:id', (req, res) => {
  if (!canManageAdmissions(req)) {
    return res.status(403).json({ success: false, message: 'No tienes permisos para ver admisiones' });
  }

  const { id } = req.params;
  const admission = admissions.find((a) => String(a.id) === String(id));
  if (!admission) {
    return res.status(404).json({ success: false, message: 'Registro de admisión no encontrado' });
  }

  return res.json({ success: true, admission: normalizeAdmission(admission) });
});

// Eliminar admisión
router.delete('/admissions/:id', (req, res) => {
  if (!canManageAdmissions(req)) {
    return res.status(403).json({ success: false, message: 'No tienes permisos para eliminar admisiones' });
  }

  const { id } = req.params;
  const idx = admissions.findIndex((a) => String(a.id) === String(id));
  if (idx === -1) {
    return res.status(404).json({ success: false, message: 'Registro de admisión no encontrado' });
  }

  const [removed] = admissions.splice(idx, 1);
  // Liberar cama si existía
  if (removed?.bedId) {
    releaseBedAssignment(removed.bedId);
  }

  // If linked appointment was marked hospitalizado, revert to pendiente
  if (removed?.appointmentId) {
    const targetAppointment = appointments.find((a) => String(a.id) === String(removed.appointmentId));
    if (targetAppointment && targetAppointment.estado === 'hospitalizado') {
      targetAppointment.estado = 'pendiente';
    }
  }

  saveData();
  return res.json({ success: true, message: 'Registro eliminado', admission: removed });
});

router.put('/admissions/:id', (req, res) => {
  if (!canManageAdmissions(req)) {
    return res.status(403).json({ success: false, message: 'No tienes permisos para actualizar admisiones' });
  }

  const { id } = req.params;
  const admission = admissions.find((entry) => String(entry.id) === String(id));

  if (!admission) {
    return res.status(404).json({ success: false, message: 'Registro de admisión no encontrado' });
  }

  const {
    patientName,
    patientId,
    source,
    symptom,
    triageLevel,
    notes,
    appointmentId,
    requiresHospitalization,
    bedId,
    status,
  } = req.body;

  let nextBedId = admission.bedId || null;
  let nextBedName = admission.bedName || '';

  if (admission.bedId && status && String(status).trim().toLowerCase() === 'alta') {
    releaseBedAssignment(admission.bedId);
    nextBedId = null;
    nextBedName = '';
  } else if (requiresHospitalization && !admission.bedId) {
    const bedAssignment = getDefaultBedAssignment(bedId);
    if (!bedAssignment) {
      return res.status(400).json({ success: false, message: 'No hay camas disponibles para esta hospitalización' });
    }
    nextBedId = String(bedAssignment.id);
    nextBedName = `${bedAssignment.name} · ${bedAssignment.room}`;
  } else if (bedId && String(bedId) !== String(admission.bedId)) {
    if (admission.bedId) {
      releaseBedAssignment(admission.bedId);
    }
    const bedAssignment = getDefaultBedAssignment(bedId);
    if (!bedAssignment) {
      return res.status(400).json({ success: false, message: 'La cama seleccionada no está disponible' });
    }
    nextBedId = String(bedAssignment.id);
    nextBedName = `${bedAssignment.name} · ${bedAssignment.room}`;
  }

  if (patientName !== undefined) {
    admission.patientName = sanitizeText(patientName);
  }
  if (patientId !== undefined) {
    admission.patientId = sanitizeText(patientId);
  }
  if (source !== undefined) {
    admission.source = String(source).trim().toLowerCase() === 'consulta externa' ? 'consulta externa' : 'urgencia';
  }
  if (symptom !== undefined) {
    admission.symptom = sanitizeText(symptom);
  }
  if (triageLevel !== undefined) {
    admission.triageLevel = triageLevels.includes(String(triageLevel).trim().toLowerCase())
      ? String(triageLevel).trim().toLowerCase()
      : admission.triageLevel;
  }
  if (notes !== undefined) {
    admission.notes = sanitizeText(notes);
  }
  if (appointmentId !== undefined) {
    admission.appointmentId = appointmentId || null;
  }
  if (status !== undefined) {
    admission.status = admissionStatuses.includes(String(status).trim().toLowerCase())
      ? String(status).trim().toLowerCase()
      : admission.status;
  }
  admission.bedId = nextBedId;
  admission.bedName = nextBedName;
  admission.updatedAt = new Date().toISOString();

  saveData();
  return res.json({ success: true, admission: normalizeAdmission(admission) });
});

module.exports = router;
