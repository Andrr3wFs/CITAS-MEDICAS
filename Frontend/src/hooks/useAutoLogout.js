import { useEffect, useRef } from 'react';

const DEFAULT_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];

export function useAutoLogout({ timeoutMs = 15 * 60 * 1000, onIdle, enabled = true }) {
  const timeoutRef = useRef(null);
  const onIdleRef = useRef(onIdle);

  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled) return undefined;

    const resetTimer = () => {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => onIdleRef.current?.(), timeoutMs);
    };

    DEFAULT_EVENTS.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }));
    resetTimer();

    return () => {
      window.clearTimeout(timeoutRef.current);
      DEFAULT_EVENTS.forEach((eventName) => window.removeEventListener(eventName, resetTimer));
    };
  }, [enabled, timeoutMs]);
}