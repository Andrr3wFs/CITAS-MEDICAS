const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const PRODUCTION_DATA_FILE = path.join(ROOT_DIR, 'Backend', 'src', 'data.json');
const DEMO_PASSWORD = 'Synthetic#2026Pass';

const getOption = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const createUser = (usuario, role, nombre, extra = {}) => ({
  usuario,
  password: bcrypt.hashSync(DEMO_PASSWORD, 10),
  role,
  nombre,
  passwordPolicyVersion: 1,
  passwordChangeRequired: false,
  sessionVersion: 1,
  mfaEnabled: false,
  ...extra,
});

const createSyntheticData = () => ({
  appointments: [
    {
      id: 1,
      nombre: 'Paciente Sintetico Uno',
      patientId: 'paciente.demo',
      doctor: 'Dra. Ejemplo',
      doctorUsername: 'doctora.demo',
      fecha: '2026-09-15',
      hora: '10:00',
      especialidad: 'Medicina General',
      estado: 'atendida',
      sintoma: 'Descripcion clinica sintetica para pruebas de interfaz.',
      diagnostico: 'Diagnostico sintetico de demostracion.',
      clinicalHistory: {
        medicalHistory: 'Antecedentes sinteticos de demostracion.',
        diagnosis: 'Diagnostico sintetico de demostracion.',
        observations: 'Observacion sintetica.',
        treatment: 'Tratamiento sintetico.',
        indications: 'Indicaciones sinteticas.',
        followUp: 'Seguimiento sintetico.',
      },
      preConsult: { answered: false, answers: null },
    },
  ],
  users: [
    createUser('admin.demo', 'admin', 'Administracion Sintetica'),
    createUser('doctora.demo', 'doctor', 'Dra. Ejemplo'),
    createUser('paciente.demo', 'paciente', 'Paciente Sintetico Uno', { estadoAprobacion: 'aprobado' }),
  ],
  pushSubscriptions: [],
  notificationConfig: {},
  accessRequests: [],
  admissions: [],
  beds: [],
  auditLogs: [],
  sessions: [],
  authChallenges: [],
  integrationConfig: {},
});

const main = () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('La generación de datos sintéticos no se permite en producción.');
  }

  const outputOption = getOption('--output');
  if (!outputOption) {
    throw new Error('Indica una ruta de salida con --output <archivo>.');
  }

  const outputPath = path.resolve(process.cwd(), outputOption);
  const configuredDataFile = process.env.HOSPITAL_DATA_FILE
    ? path.resolve(process.env.HOSPITAL_DATA_FILE)
    : null;

  if (outputPath === PRODUCTION_DATA_FILE || outputPath === configuredDataFile) {
    throw new Error('La salida no puede ser el archivo de datos activo ni Backend/src/data.json.');
  }

  if (fs.existsSync(outputPath) && !process.argv.includes('--force')) {
    throw new Error('El archivo de salida ya existe. Usa --force para reemplazarlo.');
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(createSyntheticData(), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });

  console.log(`Datos sintéticos creados en ${outputPath}`);
  console.log(`Cuentas de demostración: admin.demo, doctora.demo y paciente.demo. Contraseña: ${DEMO_PASSWORD}`);
};

try {
  main();
} catch (error) {
  console.error(`No se pudieron crear datos sintéticos: ${error.message}`);
  process.exitCode = 1;
}