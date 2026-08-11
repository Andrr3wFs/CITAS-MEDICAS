self.addEventListener("push", (event) => {
  const payload = event.data ? event.data.json() : {};
  const title = payload.title || "SaludVida";
  const options = {
    body: payload.message || "Tienes una nueva actualización del hospital.",
    icon: "/saludvida-mark.svg",
    badge: "/saludvida-mark.svg",
    tag: payload.tag || `saludvida-${Date.now()}`,
    data: {
      url: payload.url || "/dashboard",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const nextUrl = event.notification.data?.url || "/dashboard";

  event.waitUntil((async () => {
    const windowClients = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const matchingClient = windowClients.find((client) => client.url.includes(nextUrl));

    if (matchingClient) {
      await matchingClient.focus();
      return;
    }

    await clients.openWindow(nextUrl);
  })());
});