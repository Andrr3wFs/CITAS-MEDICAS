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

const loginRoutes = require('./login');
const registroRoutes = require('./registro');
const appointmentsRoutes = require('./appointments');
const pushRoutes = require('./push');
const accessRequestsRoutes = require('./accessRequests');
const admissionsRoutes = require('./admissions');
const integrationRoutes = require('./integration');
const metricsRoutes = require('./metrics');
const adminRoutes = require('./admin');
const doctorRoutes = require('./doctor');
const patientRoutes = require('./patient');
const diagnosesRoutes = require('./diagnoses');
const { router: verificationRoutes } = require('./verification');


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


process.on('uncaughtException', (err) => {
  console.error('ERROR NO CAPTURADO:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('PROMESA RECHAZADA NO CAPTURADA:', reason);
});