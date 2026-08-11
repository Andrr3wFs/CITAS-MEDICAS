function inspectRouter(name, router) {
  console.log('\nRouter:', name);
  if (!router || !router.stack) return console.log('  (no stack)');
  router.stack.forEach((layer) => {
    if (layer.route && layer.route.path) {
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      console.log(`  ${methods} ${layer.route.path}`);
    } else if (layer.name === 'router') {
      console.log('  nested router layer');
    }
  });
}

const loginRoutes = require('../src/routes/login');
const registroRoutes = require('../src/routes/registro');
const appointmentsRoutes = require('../src/routes/appointments');
const pushRoutes = require('../src/routes/push');
const accessRequestsRoutes = require('../src/routes/accessRequests');
const admissionsRoutes = require('../src/routes/admissions');
const integrationRoutes = require('../src/routes/integration');

inspectRouter('login', loginRoutes);
inspectRouter('registro', registroRoutes);
inspectRouter('appointments', appointmentsRoutes);
inspectRouter('push', pushRoutes);
inspectRouter('accessRequests', accessRequestsRoutes);
inspectRouter('admissions', admissionsRoutes);
inspectRouter('integration', integrationRoutes);

