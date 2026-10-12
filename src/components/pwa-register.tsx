'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';

const UPDATE_TOAST_ID = 'cadenza-sw-update';

export function PwaRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    // Service workers only run over http(s); skip data/blob/file contexts.
    if (window.location.protocol !== 'http:' && window.location.protocol !== 'https:') return;
    // Never register from a dev session: avoids stale-shell confusion locally.
    if (process.env.NODE_ENV !== 'production') return;

    // Reload exactly once, and only after the user asked for the takeover —
    // the first install (clients.claim) must never yank the page.
    let reloadPending = false;
    let refreshed = false;
    const onControllerChange = () => {
      if (!reloadPending || refreshed) return;
      refreshed = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    // A new worker is installed and waiting: offer the update instead of
    // swapping silently. sonner's <Toaster> is mounted app-wide.
    const promptUpdate = (registration: ServiceWorkerRegistration) => {
      window.dispatchEvent(new CustomEvent('cadenza-update-ready'));
      toast('Update ready — refresh to apply', {
        id: UPDATE_TOAST_ID,
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: 'Refresh',
          onClick: () => {
            reloadPending = true;
            const waiting = registration.waiting;
            if (waiting) {
              waiting.postMessage({ type: 'SKIP_WAITING' });
            } else {
              window.location.reload();
            }
          },
        },
      });
    };

    const register = () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          // Surface already-waiting updates (e.g. installed while page was open).
          if (registration.waiting && navigator.serviceWorker.controller) {
            promptUpdate(registration);
          }
          registration.addEventListener('updatefound', () => {
            const next = registration.installing;
            if (!next) return;
            next.addEventListener('statechange', () => {
              if (next.state === 'installed' && navigator.serviceWorker.controller) {
                promptUpdate(registration);
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
    }

    return () => {
      toast.dismiss(UPDATE_TOAST_ID);
      window.removeEventListener('load', register);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}
