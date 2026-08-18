import { useCallback, useEffect, useMemo, useState } from "react";
import api from "./api";

const PUSH_SW_PATH = "/push-sw.js";

const urlBase64ToUint8Array = (base64String) => {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
};

const getPushSupport = () => {
  if (typeof window === "undefined") {
    return false;
  }

  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
};

export function usePushNotifications({ user, addToast }) {
  const [serviceWorkerRegistration, setServiceWorkerRegistration] = useState(null);
  const [pushPermission, setPushPermission] = useState(() => (
    typeof window === "undefined" || typeof Notification === "undefined"
      ? "unsupported"
      : Notification.permission
  ));
  const [pushEnabled, setPushEnabled] = useState(false);
  const [isActivatingPush, setIsActivatingPush] = useState(false);

  const pushSupported = useMemo(() => getPushSupport(), []);

  const syncSubscriptionState = useCallback(async (registration = serviceWorkerRegistration) => {
    if (!pushSupported || !registration) {
      setPushEnabled(false);
      return false;
    }

    const subscription = await registration.pushManager.getSubscription();
    const isEnabled = Boolean(subscription) && Notification.permission === "granted";
    setPushEnabled(isEnabled);
    setPushPermission(Notification.permission);
    return isEnabled;
  }, [pushSupported, serviceWorkerRegistration]);

  const subscribeCurrentUser = useCallback(async (registration = serviceWorkerRegistration) => {
    if (!pushSupported || !registration || !user?.username) {
      return false;
    }

    const permission = Notification.permission;
    setPushPermission(permission);

    if (permission !== "granted") {
      setPushEnabled(false);
      return false;
    }

    const vapidResponse = await api.get("/push/vapid-public-key");
    const applicationServerKey = urlBase64ToUint8Array(vapidResponse.data.publicKey);

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    await api.post("/push/subscriptions", {
      subscription,
    });

    setPushEnabled(true);
    return true;
  }, [pushSupported, serviceWorkerRegistration, user]);

  const activatePush = useCallback(async () => {
    if (!pushSupported) {
      addToast({
        type: "warning",
        title: "Sin soporte",
        message: "Este navegador no admite notificaciones push.",
      });
      return false;
    }

    setIsActivatingPush(true);

    try {
      const registration = serviceWorkerRegistration || await navigator.serviceWorker.register(PUSH_SW_PATH);
      setServiceWorkerRegistration(registration);

      const permission = await Notification.requestPermission();
      setPushPermission(permission);

      if (permission !== "granted") {
        setPushEnabled(false);
        addToast({
          type: "warning",
          title: "Push bloqueado",
          message: "Permite las notificaciones del navegador para recibir avisos con la app cerrada.",
        });
        return false;
      }

      await subscribeCurrentUser(registration);
      addToast({
        type: "success",
        title: "Push activado",
        message: "Recibirás notificaciones incluso si la aplicación está cerrada.",
      });
      return true;
    } catch (error) {
      setPushEnabled(false);
      addToast({
        type: "error",
        title: "Push no disponible",
        message: error.response?.data?.message || error.message || "No se pudo activar la notificación push.",
      });
      return false;
    } finally {
      setIsActivatingPush(false);
    }
  }, [addToast, pushSupported, serviceWorkerRegistration, subscribeCurrentUser]);

  useEffect(() => {
    if (!pushSupported) {
      setPushPermission("unsupported");
      setPushEnabled(false);
      return undefined;
    }

    let isMounted = true;

    const registerServiceWorker = async () => {
      try {
        const registration = await navigator.serviceWorker.register(PUSH_SW_PATH);

        if (!isMounted) {
          return;
        }

        setServiceWorkerRegistration(registration);
        await syncSubscriptionState(registration);
      } catch {
        if (isMounted) {
          setPushEnabled(false);
        }
      }
    };

    registerServiceWorker();

    return () => {
      isMounted = false;
    };
  }, [pushSupported, syncSubscriptionState]);

  useEffect(() => {
    if (!serviceWorkerRegistration || !user?.username || Notification.permission !== "granted") {
      return;
    }

    subscribeCurrentUser(serviceWorkerRegistration).catch(() => {
      setPushEnabled(false);
    });
  }, [serviceWorkerRegistration, subscribeCurrentUser, user]);

  const pushStatusLabel = useMemo(() => {
    if (!pushSupported) {
      return "Push no compatible";
    }

    if (pushEnabled) {
      return "Push activado";
    }

    if (pushPermission === "denied") {
      return "Push bloqueado";
    }

    if (isActivatingPush) {
      return "Activando push";
    }

    return "Activar push";
  }, [isActivatingPush, pushEnabled, pushPermission, pushSupported]);

  return {
    pushSupported,
    pushPermission,
    pushEnabled,
    pushStatusLabel,
    isActivatingPush,
    activatePush,
  };
}