const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const router = express.Router();
const { users, accessRequests, normalizeUsername } = require('./storage');

const getJwtSecret = () => process.env.JWT_SECRET || 'hospital-secret-key';

router.post('/login', (req, res) => {
  const { usuario, password } = req.body;

  const normalizedUsername = normalizeUsername(usuario);
  const normalizedPassword = String(password || '');

  // Verificar si tiene una solicitud pendiente
  const pendingRequest = accessRequests.find(
    (request) => request.usuario === normalizedUsername && request.status === 'pending'
  );

  if (pendingRequest) {
    return res.status(403).json({
      success: false,
      message: 'Tu solicitud de acceso aún está pendiente de aprobación por parte de la administración.',
    });
  }

  // Verificar si fue rechazada
  const rejectedRequest = accessRequests.find(
    (request) => request.usuario === normalizedUsername && request.status === 'rejected'
  );

  if (rejectedRequest) {
    return res.status(403).json({
      success: false,
      message: 'Tu solicitud de acceso fue rechazada.',
    });
  }

  // Buscar usuario aprobado
  const user = users.find((storedUser) => storedUser.usuario === normalizedUsername);

  if (!user || !bcrypt.compareSync(normalizedPassword, user.password)) {
    return res.status(401).json({
      success: false,
      message: 'Credenciales incorrectas',
    });
  }

  if (user.accessClosed) {
    return res.status(403).json({
      success: false,
      registrationClosed: true,
      registrationAvailableAt: user.registrationAvailableAt,
      message: 'Este acceso fue cerrado. Podrás solicitar acceso nuevamente después del período de 2 días.',
    });
  }

  if (user.emailVerified === false) {
    return res.status(403).json({
      success: false,
      verificationRequired: true,
      username: user.usuario,
      resendAvailableAt: new Date(Date.parse(user.verificationCodeSentAt || 0) + 30000).toISOString(),
      message: 'Verifica el código enviado a tu correo para continuar.',
    });
  }

  const token = jwt.sign(
    {
      username: user.usuario,
      role: user.role || 'paciente',
      displayName: user.nombre || user.usuario,
    },
    getJwtSecret(),
    { expiresIn: '8h' }
  );

  res.json({
    success: true,
    token,
    username: user.usuario,
    role: user.role || 'paciente',
    displayName: user.nombre || user.usuario,
  });
});

module.exports = router;
