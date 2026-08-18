const express = require('express');
const router = express.Router();
const axios = require('axios');
const { appointments, integrationConfig } = require('../storage');
const { authenticate, getRequestUserRole, getRequestUsername, normalizeUsername } = require('../auth');

router.use(authenticate);

const canIntegrate = (req) => ['admin', 'secretaria', 'doctor'].includes(getRequestUserRole(req));
const isDoctorAssignedToOrder = (req, appointment, patientId) => (
  getRequestUserRole(req) !== 'doctor'
    || (
      appointment?.doctorUsername === getRequestUsername(req)
      && appointment.patientId === normalizeUsername(patientId)
    )
);

// Create and forward a lab order using a FHIR-like ServiceRequest payload
router.post('/orders/lab', async (req, res) => {
  if (!canIntegrate(req)) {
    return res.status(403).json({ success: false, message: 'No tienes permisos para crear ordenes' });
  }

  const { patientId, patientName, orderCode, orderText, appointmentId } = req.body;

  if (!patientId || !orderCode) {
    return res.status(400).json({ success: false, message: 'patientId y orderCode son obligatorios' });
  }

  const appointment = appointmentId
    ? appointments.find((entry) => String(entry.id) === String(appointmentId))
    : null;

  if (getRequestUserRole(req) === 'doctor' && !appointmentId) {
    return res.status(400).json({ success: false, message: 'Los médicos deben indicar la cita asignada para crear una orden.' });
  }

  if (!isDoctorAssignedToOrder(req, appointment, patientId)) {
    return res.status(403).json({ success: false, message: 'Solo puedes crear órdenes para pacientes de citas asignadas.' });
  }

  const serviceRequest = {
    resourceType: 'ServiceRequest',
    status: 'active',
    intent: 'order',
    subject: {
      identifier: { value: String(patientId) },
      display: patientName || String(patientId),
    },
    code: {
      coding: [
        {
          system: 'http://loinc.org',
          code: orderCode,
          display: orderText || '',
        },
      ],
    },
    requester: {
      identifier: { value: getRequestUsername(req) },
    },
    supportingInfo: appointmentId ? [{ reference: `Appointment/${appointmentId}` }] : [],
    authoredOn: new Date().toISOString(),
  };

  const remote = integrationConfig?.labEndpoint;

  if (remote) {
    try {
      const resp = await axios.post(remote, serviceRequest, { timeout: 5000 });
      return res.json({ success: true, forwarded: true, remoteStatus: resp.status, remoteData: resp.data });
    } catch (error) {
      return res.status(502).json({ success: false, message: 'Error al enviar al laboratorio', error: String(error?.message || error) });
    }
  }

  // No remote configured: return the FHIR-like payload so the integration can be tested
  return res.json({ success: true, forwarded: false, order: serviceRequest });
});

module.exports = router;
