(async () => {
  const integration = require('../src/routes/integration');

  // Find the layer for POST /orders/lab
  let handler = null;
  integration.stack.forEach((layer) => {
    if (layer.route && layer.route.path === '/orders/lab') {
      const methodLayer = layer.route.stack.find(s => s.method === 'post');
      if (methodLayer) handler = methodLayer.handle;
    }
  });

  if (!handler) {
    console.error('Handler not found');
    process.exit(1);
  }

  // Mock req/res
  const req = {
    body: { patientId: 'paciente1', patientName: 'Paciente 1', orderCode: '24357-6', orderText: 'Hemograma completo', appointmentId: '6' },
    headers: { 'x-user-username': 'admin', 'x-user-role': 'admin' },
  };

  const res = {
    status(code) { this._status = code; return this; },
    json(obj) { console.log('RES', this._status || 200, JSON.stringify(obj, null, 2)); }
  };

  try {
    await handler(req, res);
  } catch (e) {
    console.error('Handler error', e);
  }
})();
