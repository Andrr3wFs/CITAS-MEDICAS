require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.use(cors());
app.use(express.json());

// Ruta de prueba
app.get('/', (req, res) => {
  res.send('Backend funcionando 🚀');
});

// Importar y usar rutas
const loginRoutes = require('./src/routes/login');
const registroRoutes = require('./src/routes/registro');
const appointmentsRoutes = require('./src/routes/appointments');
const pushRoutes = require('./src/routes/push');
const accessRequestsRoutes = require('./src/routes/accessRequests');
const admissionsRoutes = require('./src/routes/admissions');
const integrationRoutes = require('./src/routes/integration');
const metricsRoutes = require('./src/routes/metrics');
const adminRoutes = require('./src/routes/admin');
const doctorRoutes = require('./src/routes/doctor');
const patientRoutes = require('./src/routes/patient');
const diagnosesRoutes = require('./src/routes/diagnoses');
const { router: verificationRoutes } = require('./src/routes/verification');

app.use(loginRoutes);
app.use(registroRoutes);
app.use(verificationRoutes);
app.use(diagnosesRoutes);
app.use('/api', diagnosesRoutes);
app.use(appointmentsRoutes);
app.use(pushRoutes);
app.use('/access-requests', accessRequestsRoutes);
app.use(admissionsRoutes);
app.use(integrationRoutes);
app.use(metricsRoutes);
app.use('/admin', adminRoutes);
app.use('/doctor', doctorRoutes);
app.use('/paciente', patientRoutes);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});