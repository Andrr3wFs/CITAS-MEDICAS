const webpush = require('web-push');
const { notificationConfig, pushSubscriptions, saveData } = require('./storage');

const normalizeUsername = (username) => String(username || '').trim().toLowerCase();

const hasVapidKeys = () => Boolean(
  notificationConfig?.vapidKeys?.publicKey && notificationConfig?.vapidKeys?.privateKey
);

const ensureVapidConfiguration = () => {
  if (
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY
  ) {
    notificationConfig.vapidKeys.publicKey = process.env.VAPID_PUBLIC_KEY;
    notificationConfig.vapidKeys.privateKey = process.env.VAPID_PRIVATE_KEY;
  }

  if (process.env.VAPID_SUBJECT) {
    notificationConfig.subject = process.env.VAPID_SUBJECT;
  }

  if (!hasVapidKeys()) {
    const generatedKeys = webpush.generateVAPIDKeys();
    notificationConfig.vapidKeys.publicKey = generatedKeys.publicKey;
    notificationConfig.vapidKeys.privateKey = generatedKeys.privateKey;
    saveData();
  }

  webpush.setVapidDetails(
    notificationConfig.subject || 'mailto:admin@saludvida.local',
    notificationConfig.vapidKeys.publicKey,
    notificationConfig.vapidKeys.privateKey
  );
};

const getPublicVapidKey = () => {
  ensureVapidConfiguration();
  return notificationConfig.vapidKeys.publicKey;
};

const upsertPushSubscription = ({ username, role, displayName, subscription }) => {
  if (!subscription?.endpoint) {
    throw new Error('Suscripción push inválida');
  }

  const normalizedUsername = normalizeUsername(username);
  const existingIndex = pushSubscriptions.findIndex(
    (entry) => entry?.subscription?.endpoint === subscription.endpoint
  );

  const nextRecord = {
    username: normalizedUsername,
    role: String(role || 'paciente').trim().toLowerCase(),
    displayName: String(displayName || normalizedUsername || 'Paciente').trim(),
    subscription,
    createdAt: existingIndex >= 0 ? pushSubscriptions[existingIndex].createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (existingIndex >= 0) {
    pushSubscriptions.splice(existingIndex, 1, nextRecord);
  } else {
    pushSubscriptions.push(nextRecord);
  }

  saveData();
  return nextRecord;
};

const removePushSubscriptionByEndpoint = (endpoint, username) => {
  const subscriptionIndex = pushSubscriptions.findIndex(
    (entry) => entry?.subscription?.endpoint === endpoint
  );

  if (
    subscriptionIndex === -1
    || (username && pushSubscriptions[subscriptionIndex].username !== normalizeUsername(username))
  ) {
    return false;
  }

  pushSubscriptions.splice(subscriptionIndex, 1);
  saveData();
  return true;
};

const sendPushNotificationToUsers = async (usernames, payload) => {
  ensureVapidConfiguration();

  const normalizedTargets = [...new Set(usernames.map(normalizeUsername).filter(Boolean))];

  if (normalizedTargets.length === 0) {
    return;
  }

  const subscriptionsToNotify = pushSubscriptions.filter((entry) =>
    normalizedTargets.includes(normalizeUsername(entry.username))
  );

  await Promise.allSettled(
    subscriptionsToNotify.map(async (entry) => {
      try {
        await webpush.sendNotification(entry.subscription, JSON.stringify(payload));
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) {
          removePushSubscriptionByEndpoint(entry.subscription.endpoint);
        }
      }
    })
  );
};

module.exports = {
  getPublicVapidKey,
  upsertPushSubscription,
  removePushSubscriptionByEndpoint,
  sendPushNotificationToUsers,
};