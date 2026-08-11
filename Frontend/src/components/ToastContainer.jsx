import { useCallback, useEffect, useRef, useState } from "react";

const TOAST_DEFAULT_DURATION_MS = 5000;
const TOAST_EXIT_ANIMATION_MS = 400;

let toastIdCounter = 0;

const toastIcons = {
  success: "✓",
  error: "✕",
  info: "ℹ",
  warning: "⚠",
  reminder: "🔔",
};

const getAudioSupportState = () => {
  if (typeof window === "undefined") {
    return { supported: false, enabled: false, status: "unsupported" };
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return { supported: false, enabled: false, status: "unsupported" };
  }

  return { supported: true, enabled: false, status: "locked" };
};

const playNotificationTone = (audioContextRef) => {
  if (typeof window === "undefined") {
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }

  try {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextClass();
    }

    const context = audioContextRef.current;
    if (context.state === "suspended") {
      return;
    }

    const startAt = context.currentTime;
    const gainNode = context.createGain();
    gainNode.connect(context.destination);
    gainNode.gain.setValueAtTime(0.0001, startAt);

    const firstTone = context.createOscillator();
    firstTone.type = "sine";
    firstTone.frequency.setValueAtTime(880, startAt);
    firstTone.connect(gainNode);
    gainNode.gain.exponentialRampToValueAtTime(0.08, startAt + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22);
    firstTone.start(startAt);
    firstTone.stop(startAt + 0.22);

    const secondTone = context.createOscillator();
    secondTone.type = "sine";
    secondTone.frequency.setValueAtTime(1174.66, startAt + 0.16);
    secondTone.connect(gainNode);
    gainNode.gain.setValueAtTime(0.0001, startAt + 0.16);
    gainNode.gain.exponentialRampToValueAtTime(0.065, startAt + 0.18);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.42);
    secondTone.start(startAt + 0.16);
    secondTone.stop(startAt + 0.42);
  } catch (error) {
    // Ignore audio failures so notifications still render normally.
  }
};

export function useToast() {
  const [toasts, setToasts] = useState([]);
  const audioContextRef = useRef(null);
  const [audioState, setAudioState] = useState(getAudioSupportState);

  const syncAudioState = useCallback(() => {
    const baseState = getAudioSupportState();

    if (!baseState.supported) {
      setAudioState(baseState);
      return baseState;
    }

    const nextStatus = audioContextRef.current?.state === "running" ? "enabled" : "locked";
    const nextState = {
      supported: true,
      enabled: nextStatus === "enabled",
      status: nextStatus,
    };

    setAudioState(nextState);
    return nextState;
  }, []);

  const unlockAudio = useCallback(async () => {
    if (typeof window === "undefined") {
      return { supported: false, enabled: false, status: "unsupported" };
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;

    if (!AudioContextClass) {
      const nextState = { supported: false, enabled: false, status: "unsupported" };
      setAudioState(nextState);
      return nextState;
    }

    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass();
      }

      if (audioContextRef.current.state !== "running") {
        await audioContextRef.current.resume();
      }
    } catch (error) {
      // Mobile browsers can reject resume attempts until a valid gesture occurs.
    }

    return syncAudioState();
  }, [syncAudioState]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      setAudioState({ supported: false, enabled: false, status: "unsupported" });
      return undefined;
    }

    const ensureAudioUnlocked = async () => {
      await unlockAudio();
    };

    const interactionEvents = ["pointerdown", "touchstart", "click", "keydown"];
    interactionEvents.forEach((eventName) => {
      window.addEventListener(eventName, ensureAudioUnlocked, { passive: true });
    });

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        ensureAudioUnlocked();
      }
    };

    syncAudioState();

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      interactionEvents.forEach((eventName) => {
        window.removeEventListener(eventName, ensureAudioUnlocked);
      });
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [syncAudioState, unlockAudio]);

  const addToast = useCallback(({
    type = "info",
    title,
    message,
    duration = TOAST_DEFAULT_DURATION_MS,
    playSound = false,
  }) => {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, type, title, message, duration, exiting: false }]);

    if (playSound) {
      if (audioContextRef.current?.state === "suspended") {
        audioContextRef.current.resume().catch(() => {
          // Ignore blocked resume attempts; toast still shows visually.
        });
      }
      playNotificationTone(audioContextRef);
      syncAudioState();
    }

    return id;
  }, [syncAudioState]);

  const dismissToast = useCallback((id) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, exiting: true } : t))
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_EXIT_ANIMATION_MS);
  }, []);

  return {
    toasts,
    addToast,
    dismissToast,
    audioSupported: audioState.supported,
    soundEnabled: audioState.enabled,
    audioStatus: audioState.status,
    unlockAudio,
  };
}

export default function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="toast-container" aria-live="polite" aria-label="Notificaciones">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }) {
  const timerRef = useRef(null);
  const progressRef = useRef(null);

  useEffect(() => {
    if (toast.duration > 0 && !toast.exiting) {
      if (progressRef.current) {
        progressRef.current.style.animationDuration = `${toast.duration}ms`;
      }
      timerRef.current = setTimeout(() => {
        onDismiss(toast.id);
      }, toast.duration);
    }

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [toast.id, toast.duration, toast.exiting, onDismiss]);

  const icon = toastIcons[toast.type] || toastIcons.info;

  return (
    <div
      className={`toast toast-${toast.type} ${toast.exiting ? "toast-exit" : "toast-enter"}`}
      role="alert"
    >
      <div className="toast-icon" aria-hidden="true">{icon}</div>
      <div className="toast-body">
        {toast.title && <strong className="toast-title">{toast.title}</strong>}
        <p className="toast-message">{toast.message}</p>
      </div>
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(toast.id)}
        aria-label="Cerrar notificación"
      >
        ×
      </button>
      {toast.duration > 0 && (
        <div className="toast-progress" ref={progressRef} />
      )}
    </div>
  );
}
