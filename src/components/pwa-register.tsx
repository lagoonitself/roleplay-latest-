'use client';

import { useEffect } from 'react';

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    // Service workers only run over http(s); skip data/blob/file contexts.
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return;
    // Never register from a dev session: avoids stale-shell confusion locally.
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          // Surface already-waiting updates (e.g. installed while page was open).
          if (registration.waiting && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('cadenza-update-ready'));
          }
          registration.addEventListener('updatefound', () => {
            const next = registration.installing;
            if (!next) return;
            next.addEventListener('statechange', () => {
              if (next.state === 'installed' && navigator.serviceWorker.controller) {
                window.dispatchEvent(new CustomEvent('cadenza-update-ready'));
              }
            });
          });
        })
        .catch(() => {
          // Silent fallback: the app must never break without a worker.
        });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
