const express = require('express');
const router = express.Router();
const { users, accessRequests, saveData, normalizeUsername, hashPasswordSync, isPasswordHashed, PASSWORD_POLICY_VERSION } = require('../storage');
const { authenticate, getRequestUserRole } = require('../auth');
const { 
  sendNewAccessRequestNotification,
  sendAccessApprovedNotification,
  sendAccessRejectedNotification 
} = require('../emailService');
const { issueVerificationCode } = require('./verification');

const REGISTRATION_GRACE_PERIOD_MS = 48 * 60 * 60 * 1000;

// Get admin emails from users
const getAdminEmails = () => {
  return users
    .filter(u => u.role === 'admin')
    .map(u => u.email || u.usuario + '@hospital.local')
    .filter(email => email);
};

router.use(authenticate);

const isAdmin = (req, res, next) => {
  if (getRequestUserRole(req) !== 'admin') {
    return res.status(403).json({ success: false, message: 'Solo administradores pueden acceder a esto' });
  }
  next();
};

// Get all pending access requests
router.get('/pending', isAdmin, (req, res) => {
  const pendingRequests = accessRequests.filter(r => r.status === 'pending');
  res.json({ success: true, requests: pendingRequests });
});

// Get all access requests (pending, approved, rejected)
router.get('/all', isAdmin, (req, res) => {
  res.json({ success: true, requests: accessRequests });
});

// Get request statistics
router.get('/stats', isAdmin, (req, res) => {
  const stats = {
    pending: accessRequests.filter(r => r.status === 'pending').length,
    approved: accessRequests.filter(r => r.status === 'approved').length,
    rejected: accessRequests.filter(r => r.status === 'rejected').length,
    autoApproved: accessRequests.filter(r => r.autoApproved === true).length,
    total: accessRequests.length
  };
  res.json({ success: true, stats });
});

// Approve an access request
router.post('/approve', isAdmin, async (req, res) => {
  const requestId = req.body?.requestId;
  const adminUsername = req.user.username;

  if (!requestId) {
    return res.status(400).json({ success: false, message: 'ID de solicitud requerido' });
  }

  const request = accessRequests.find(r => r.id === requestId);
  if (!request) {
    return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
  }

  if (request.status !== 'pending') {
    return res.status(400).json({ success: false, message: 'Esta solicitud ya fue procesada' });
  }

  const registrationAvailableAt = new Date(Date.now() + REGISTRATION_GRACE_PERIOD_MS).toISOString();

  // Create the user
  users.push({
    usuario: request.usuario,
    email: request.email || request.usuario,
    password: isPasswordHashed(request.password) ? request.password : hashPasswordSync(request.password),
    role: request.role,
    nombre: request.nombre,
    emailVerified: false,
    accessClosed: true,
    registrationAvailableAt,
    approvedAt: new Date().toISOString(),
    approvedBy: adminUsername,
    passwordPolicyVersion: request.passwordPolicyVersion === PASSWORD_POLICY_VERSION ? PASSWORD_POLICY_VERSION : 0,
    passwordChangeRequired: request.passwordPolicyVersion !== PASSWORD_POLICY_VERSION,
    sessionVersion: 1,
    mfaEnabled: false,
  });

  // Update request status
  request.status = 'approved';
  request.approvedAt = new Date().toISOString();
  request.approvedBy = adminUsername;
  request.registrationAvailableAt = registrationAvailableAt;

  saveData();

  const user = users[users.length - 1];

  // Send approval and verification emails to the registration address.
  try {
    await sendAccessApprovedNotification(
      user.email,
      request
    );
    await issueVerificationCode(user);
  } catch (error) {
    console.error('Error sending approval or verification email:', error);
  }

  res.json({ 
    success: true, 
    message: `Usuario ${request.usuario} aprobado correctamente`,
    request 
  });
});

// Reject an access request
router.post('/reject', isAdmin, async (req, res) => {
  const requestId = req.body?.requestId;
  const reason = req.body?.reason || 'No especificado';
  const adminUsername = req.user.username;

  if (!requestId) {
    return res.status(400).json({ success: false, message: 'ID de solicitud requerido' });
  }

  const request = accessRequests.find(r => r.id === requestId);
  if (!request) {
    return res.status(404).json({ success: false, message: 'Solicitud no encontrada' });
  }

  if (request.status !== 'pending') {
    return res.status(400).json({ success: false, message: 'Esta solicitud ya fue procesada' });
  }

  const registrationAvailableAt = new Date(Date.now() + REGISTRATION_GRACE_PERIOD_MS).toISOString();

  // Update request status
  request.status = 'rejected';
  request.rejectionReason = reason;
  request.rejectedAt = new Date().toISOString();
  request.rejectedBy = adminUsername;
  request.registrationAvailableAt = registrationAvailableAt;

  saveData();

  // Send email notification to user
  try {
    await sendAccessRejectedNotification(
      request.usuario + '@hospital.local',
      request,
      reason
    );
  } catch (error) {
    console.error('Error sending rejection email:', error);
  }

  res.json({ 
    success: true, 
    message: `Solicitud de ${request.usuario} rechazada`,
    request 
  });
});

module.exports = router;
