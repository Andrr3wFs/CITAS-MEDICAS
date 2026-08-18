const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  '123456', '12345678', '123456789', '1234567890', '123456789a', '123456789!',
  '1234567890!', '123456789012', '1234567890123', '123456789012345', '1234',
  'admin', 'admin123', 'admin1234', 'admin123!', 'administrator', 'administrador',
  'changeme', 'contraseña', 'contraseña123', 'hospital', 'hospital123', 'iloveyou',
  'letmein', 'monkey', 'passw0rd', 'password', 'password1', 'password12',
  'password123', 'password123!', 'password1!', 'qwerty', 'qwerty123', 'qwerty123!',
  'secret', 'test', 'test123', 'welcome', 'welcome1', 'welcome123', 'welcome123!',
]);

const canonicalize = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[@]/g, 'a')
  .replace(/[0]/g, 'o')
  .replace(/[1!]/g, 'i')
  .replace(/[3]/g, 'e')
  .replace(/[4]/g, 'a')
  .replace(/[5$]/g, 's')
  .replace(/[7]/g, 't')
  .replace(/[^a-z0-9]/g, '');

const hasCommonPassword = (password) => {
  const normalized = String(password || '').trim().toLowerCase();
  const canonical = canonicalize(password);
  const compact = normalized.replace(/\s+/g, '');

  return COMMON_PASSWORDS.has(normalized)
    || COMMON_PASSWORDS.has(compact)
    || COMMON_PASSWORDS.has(canonical);
};

const getPersonalTokens = ({ username, displayName } = {}) => [username, displayName]
  .flatMap((value) => String(value || '').split(/\s+/).map(canonicalize))
  .filter((value) => value.length >= 3);

const validatePassword = (password, context = {}) => {
  const value = String(password || '');
  const errors = [];

  if (value.length < MIN_PASSWORD_LENGTH) {
    errors.push(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }

  if (value.length > MAX_PASSWORD_LENGTH) {
    errors.push(`La contraseña no puede superar los ${MAX_PASSWORD_LENGTH} caracteres.`);
  }

  if (!/[a-z]/.test(value)) {
    errors.push('La contraseña debe incluir una letra minúscula.');
  }

  if (!/[A-Z]/.test(value)) {
    errors.push('La contraseña debe incluir una letra mayúscula.');
  }

  if (!/\d/.test(value)) {
    errors.push('La contraseña debe incluir un número.');
  }

  if (!/[^\p{L}\p{N}\s]/u.test(value)) {
    errors.push('La contraseña debe incluir un carácter especial.');
  }

  if (hasCommonPassword(value)) {
    errors.push('La contraseña está en la lista de contraseñas comunes y no puede utilizarse.');
  }

  const canonicalPassword = canonicalize(value);
  if (getPersonalTokens(context).some((token) => canonicalPassword.includes(token))) {
    errors.push('La contraseña no puede incluir el usuario ni el nombre de la cuenta.');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
};

module.exports = {
  COMMON_PASSWORDS,
  MIN_PASSWORD_LENGTH,
  validatePassword,
};