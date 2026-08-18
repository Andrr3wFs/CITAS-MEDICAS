const express = require('express');
const router = express.Router();
const { users, accessRequests, saveData, normalizeUsername, hashPasswordSync, PASSWORD_POLICY_VERSION } = require('../storage');
const { sendNewAccessRequestNotification } = require('../emailService');
const { validatePassword } = require('../passwordPolicy');

// Get admin emails from users
const getAdminEmails = () => {
  return users
    .filter(u => u.role === 'admin')
    .map(u => u.email || u.usuario + '@hospital.local')
    .filter(email => email);
};

const getLatestProcessedRequest = (username) => accessRequests
  .filter((request) => request.usuario === username && ['approved', 'rejected'].includes(request.status))
  .sort((firstRequest, secondRequest) => {
    const firstDate = Date.parse(firstRequest.approvedAt || firstRequest.rejectedAt || firstRequest.requestedAt || 0);
    const secondDate = Date.parse(secondRequest.approvedAt || secondRequest.rejectedAt || secondRequest.requestedAt || 0);
    return secondDate - firstDate;
  })[0];

router.post('/register', async (req, res) => {
  const normalizedUsername = normalizeUsername(req.body?.usuario);
  const normalizedPassword = String(req.body?.password || '');

  if (!normalizedUsername || !normalizedPassword) {
    return res.status(400).json({ success: false, message: 'Usuario y contraseña son obligatorios' });
  }

  const passwordValidation = validatePassword(normalizedPassword, { username: normalizedUsername });
  if (!passwordValidation.valid) {
    return res.status(400).json({
      success: false,
      message: 'La contraseña no cumple la política de seguridad.',
      passwordPolicyErrors: passwordValidation.errors,
    });
  }

  const latestProcessedRequest = getLatestProcessedRequest(normalizedUsername);
  const registrationAvailableAt = Date.parse(latestProcessedRequest?.registrationAvailableAt || 0);
  if (registrationAvailableAt > Date.now()) {
    const availableDate = new Date(registrationAvailableAt).toLocaleString('es-ES');
    return res.status(403).json({
      success: false,
      message: `Tu acceso fue cerrado. Podrás solicitar acceso nuevamente a partir del ${availableDate}.`,
      registrationAvailableAt: latestProcessedRequest.registrationAvailableAt,
    });
  }
  
  // Check if user already exists
  const existingUserIndex = users.findIndex((user) => user.usuario === normalizedUsername);
  if (existingUserIndex !== -1 && users[existingUserIndex].accessClosed && registrationAvailableAt > 0) {
    users.splice(existingUserIndex, 1);
    saveData();
  } else if (existingUserIndex !== -1) {
    return res.status(409).json({ success: false, message: 'El usuario ya existe' });
  }

  // Check if already has a pending request
  const pendingRequest = accessRequests.find(r => r.usuario === normalizedUsername && r.status === 'pending');
  if (pendingRequest) {
    return res.status(409).json({ success: false, message: 'Ya tienes una solicitud de acceso pendiente' });
  }

  const hashedPassword = hashPasswordSync(normalizedPassword);

  // Create pending request for manual approval
  const newRequest = {
    id: Date.now(),
    usuario: normalizedUsername,
    email: normalizedUsername,
    password: hashedPassword,
    status: 'pending',
    requestedAt: new Date().toISOString(),
    role: 'paciente',
    nombre: normalizedUsername,
    passwordPolicyVersion: PASSWORD_POLICY_VERSION,
  };

  accessRequests.push(newRequest);
  saveData();

  // Send email notification to admins
  try {
    const adminEmails = getAdminEmails();
    if (adminEmails.length > 0) {
      await sendNewAccessRequestNotification(adminEmails, newRequest);
    }
  } catch (error) {
    console.error('Error sending notification email:', error);
    // Don't fail the registration if email fails
  }

  res.json({ 
    success: true, 
    message: 'Solicitud de acceso enviada. El administrador revisará tu solicitud pronto.',
    status: 'pending'
  });
});

module.exports = router;