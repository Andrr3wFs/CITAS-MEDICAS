const crypto = require('crypto');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');

const MFA_ISSUER = process.env.MFA_ISSUER || 'MediCenter';

const getEncryptionKey = () => {
  const secret = process.env.MFA_ENCRYPTION_KEY || process.env.JWT_SECRET;

  if (!secret && process.env.NODE_ENV === 'production') {
    throw new Error('MFA_ENCRYPTION_KEY o JWT_SECRET es obligatorio en producción.');
  }

  return crypto.createHash('sha256').update(secret || 'development-only-mfa-key').digest();
};

const encryptMfaSecret = (secret) => {
  const initializationVector = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), initializationVector);
  const encrypted = Buffer.concat([cipher.update(String(secret), 'utf8'), cipher.final()]);
  const authenticationTag = cipher.getAuthTag();

  return [
    'v1',
    initializationVector.toString('base64url'),
    authenticationTag.toString('base64url'),
    encrypted.toString('base64url'),
  ].join('.');
};

const decryptMfaSecret = (encryptedSecret) => {
  const [version, initializationVector, authenticationTag, encrypted] = String(encryptedSecret || '').split('.');

  if (version !== 'v1' || !initializationVector || !authenticationTag || !encrypted) {
    throw new Error('El secreto MFA almacenado no tiene un formato válido.');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(initializationVector, 'base64url')
  );
  decipher.setAuthTag(Buffer.from(authenticationTag, 'base64url'));

  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
};

const createEnrollmentPresentation = async (username, encryptedSecret) => {
  const secret = decryptMfaSecret(encryptedSecret);
  const otpauthUrl = authenticator.keyuri(String(username), MFA_ISSUER, secret);
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 280,
  });

  return {
    manualEntryKey: secret,
    qrCodeDataUrl,
  };
};

const createEnrollment = async (username) => {
  const secret = authenticator.generateSecret();
  const encryptedSecret = encryptMfaSecret(secret);

  return {
    encryptedSecret,
    ...(await createEnrollmentPresentation(username, encryptedSecret)),
  };
};

const verifyTotpCode = (encryptedSecret, code) => {
  if (!/^\d{6}$/.test(String(code || '').trim())) {
    return false;
  }

  authenticator.options = { window: 1 };
  return authenticator.check(String(code).trim(), decryptMfaSecret(encryptedSecret));
};

module.exports = {
  createEnrollment,
  createEnrollmentPresentation,
  decryptMfaSecret,
  encryptMfaSecret,
  verifyTotpCode,
};