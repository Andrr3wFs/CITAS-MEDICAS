const express = require('express');
const router = express.Router();
const {
  getPublicVapidKey,
  removePushSubscriptionByEndpoint,
  upsertPushSubscription,
} = require('./pushNotifications');

router.get('/push/vapid-public-key', (req, res) => {
  res.json({ success: true, publicKey: getPublicVapidKey() });
});

router.post('/push/subscriptions', (req, res) => {
  const { subscription, username, role, displayName } = req.body || {};

  if (!subscription?.endpoint) {
    return res.status(400).json({ success: false, message: 'La suscripción push es obligatoria' });
  }

  try {
    const storedSubscription = upsertPushSubscription({ subscription, username, role, displayName });
    return res.json({ success: true, subscription: storedSubscription });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message || 'No se pudo guardar la suscripción push' });
  }
});

router.delete('/push/subscriptions', (req, res) => {
  const endpoint = String(req.body?.endpoint || '').trim();

  if (!endpoint) {
    return res.status(400).json({ success: false, message: 'El endpoint de la suscripción es obligatorio' });
  }

  const deleted = removePushSubscriptionByEndpoint(endpoint);
  return res.json({ success: deleted });
});

module.exports = router;