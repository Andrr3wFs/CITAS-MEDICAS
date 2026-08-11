const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { users, saveData, normalizeUsername } = require('../storage');
const { sendVerificationCode } = require('../emailService');

const CODE_EXPIRY_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;

const hashCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

const createVerificationCode = () => String(crypto.randomInt(100000, 1000000));

const issueVerificationCode = async (user) => {
  const code = createVerificationCode();
  const now = Date.now();

  user.verificationCodeHash = hashCode(code);
  user.verificationCodeExpiresAt = new Date(now + CODE_EXPIRY_MS).toISOString();
  user.verificationCodeSentAt = new Date(now).toISOString();
  saveData();

  const result = await sendVerificationCode(user.email || user.usuario, code);
  if (!result.success) {
    throw new Error(result.error || 'No se pudo enviar el correo de verificación');
  }
};

router.post('/verify-email', (req, res) => {
  const username = normalizeUsername(req.body?.usuario);
  const code = String(req.body?.code || '').trim();
  const user = users.find((storedUser) => storedUser.usuario === username);

  if (!user || user.emailVerified) {
    return res.status(400).json({ success: false, message: 'La verificación no es válida.' });
  }

  if (!/^\d{6}$/.test(code) || !user.verificationCodeHash || Date.parse(user.verificationCodeExpiresAt) < Date.now()) {
    return res.status(400).json({ success: false, message: 'El código no es válido o venció.' });
  }

  if (hashCode(code) !== user.verificationCodeHash) {
    return res.status(400).json({ success: false, message: 'El código no es válido o venció.' });
  }

  user.emailVerified = true;
  user.verifiedAt = new Date().toISOString();
  delete user.verificationCodeHash;
  delete user.verificationCodeExpiresAt;
  delete user.verificationCodeSentAt;
  saveData();

  res.json({ success: true, message: 'Correo verificado correctamente.' });
});

router.post('/resend-verification-code', async (req, res) => {
  const username = normalizeUsername(req.body?.usuario);
  const user = users.find((storedUser) => storedUser.usuario === username);

  if (!user || user.emailVerified) {
    return res.status(400).json({ success: false, message: 'La verificación no está disponible para esta cuenta.' });
  }

  const elapsed = Date.now() - Date.parse(user.verificationCodeSentAt || 0);
  if (elapsed < RESEND_COOLDOWN_MS) {
    const retryAfterSeconds = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
    return res.status(429).json({ success: false, message: 'Espera antes de solicitar otro código.', retryAfterSeconds });
  }

  try {
    await issueVerificationCode(user);
    res.json({ success: true, resendAvailableAt: new Date(Date.now() + RESEND_COOLDOWN_MS).toISOString() });
  } catch (error) {
    console.error('Error sending verification email:', error);
    res.status(502).json({ success: false, message: 'No se pudo enviar el código. Intenta nuevamente.' });
  }
});

module.exports = { router, issueVerificationCode, RESEND_COOLDOWN_MS };