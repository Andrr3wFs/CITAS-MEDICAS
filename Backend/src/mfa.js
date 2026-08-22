const crypto = require('crypto');
const { authenticator } = require('otplib');
const QRCode = require('qrcode');

const MFA_ISSUER = process.env.MFA_ISSUER || 'MediCenter';
const MFA_TOTP_WINDOW = 2;
const MFA_SECRET_PATTERN = /^[A-Z2-7]+={0,6}$/i;

class MfaSecretDecryptionError extends Error {
  constructor() {
    super('No se pudo descifrar el secreto MFA almacenado.');
    this.name = 'MfaSecretDecryptionError';
  }
}

const getEncryptionKey = () => {
  const mfaEncryptionKey = String(process.env.MFA_ENCRYPTION_KEY || '').trim();
  const fallbackSecret = String(process.env.JWT_SECRET || '').trim();

  if (!mfaEncryptionKey && process.env.NODE_ENV === 'production') {
    throw new Error('MFA_ENCRYPTION_KEY es obligatorio en producción.');
  }

  return crypto.createHash('sha256').update(
    mfaEncryptionKey || fallbackSecret || 'development-only-mfa-key'
  ).digest();
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
  try {
    const [version, initializationVector, authenticationTag, encrypted] = String(encryptedSecret || '').split('.');

    if (version !== 'v1' || !initializationVector || !authenticationTag || !encrypted) {
      throw new MfaSecretDecryptionError();
    }

    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      getEncryptionKey(),
      Buffer.from(initializationVector, 'base64url')
    );
    decipher.setAuthTag(Buffer.from(authenticationTag, 'base64url'));

    const secret = Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8');

    if (!MFA_SECRET_PATTERN.test(secret)) {
      throw new MfaSecretDecryptionError();
    }

    return secret;
  } catch (error) {
    if (error instanceof MfaSecretDecryptionError) {
      throw error;
    }

    throw new MfaSecretDecryptionError();
  }
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
  const normalizedCode = String(code || '').trim();

  if (!/^\d{6}$/.test(normalizedCode)) {
    return false;
  }

  const secret = decryptMfaSecret(encryptedSecret);
  const totpAuthenticator = authenticator.clone();

  totpAuthenticator.options = {
    ...totpAuthenticator.options,
    window: MFA_TOTP_WINDOW,
  };

  return totpAuthenticator.verify({ token: normalizedCode, secret });
};

module.exports = {
  MFA_TOTP_WINDOW,
  MfaSecretDecryptionError,
  createEnrollment,
  createEnrollmentPresentation,
  decryptMfaSecret,
  encryptMfaSecret,
  verifyTotpCode,
};