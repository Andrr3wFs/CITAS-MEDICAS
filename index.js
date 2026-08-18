const originalRequire = module.constructor.prototype.require;
module.constructor.prototype.require = function(path) {
  try {
    return originalRequire.apply(this, arguments);
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.error("\n========================================");
      console.error(`¡FALTA ESTE ARCHIVO: "${path}"!`);
      console.error("========================================\n");
    }
    throw err;
  }
};

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT) || 5000;

// Las decisiones de autorización se derivan exclusivamente de la sesión verificada.
app.use(cors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));

app.use(express.json());

// 1. ARCHIVOS ESTÁTICOS PRIMERO (Para que el favicon y assets carguen libremente sin auth)
app.use(express.static(path.join(__dirname, 'Frontend/dist')));

// 2. IMPORTACIÓN DE RUTAS DE LA API
const loginRoutes = require('./Backend/src/ruta/login');
const registroRoutes = require('./Backend/src/ruta/registro');
const appointmentsRoutes = require('./Backend/src/ruta/appointments');
const pushRoutes = require('./Backend/src/ruta/push');
const accessRequestsRoutes = require('./Backend/src/ruta/accessRequests');
const admissionsRoutes = require('./Backend/src/ruta/admissions');
const integrationRoutes = require('./Backend/src/ruta/integration');
const metricsRoutes = require('./Backend/src/ruta/metrics');
const adminRoutes = require('./Backend/src/ruta/admin');
const doctorRoutes = require('./Backend/src/ruta/doctor');
const patientRoutes = require('./Backend/src/ruta/patient');
const diagnosesRoutes = require('./Backend/src/ruta/diagnoses');
const { router: verificationRoutes } = require('./Backend/src/ruta/verification');

// 3. MONTAJE DE RUTAS BAJO EL PREFIJO /api (Coincidente con el Frontend)
app.use('/api', loginRoutes);
app.use('/api', registroRoutes);
app.use('/api', verificationRoutes);
app.use('/api', diagnosesRoutes);
app.use('/api/paciente', patientRoutes);
app.use('/api', appointmentsRoutes);
app.use('/api', pushRoutes);
app.use('/api/access-requests', accessRequestsRoutes);
app.use('/api', admissionsRoutes);
app.use('/api', integrationRoutes);
app.use('/api', metricsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/doctor', doctorRoutes);

// 4. COMODÍN DEL FRONTEND AL FINAL ABSOLUTO
app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'Frontend/dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});

process.on('uncaughtException', (err) => {
  console.error('ERROR NO CAPTURADO:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('PROMESA RECHAZADA NO CAPTURADA:', reason);
});