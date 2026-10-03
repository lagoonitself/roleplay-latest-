'use client';

import { useEffect } from 'react';

export function PwaRegister() {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => {
          // Successfully registered
        })
        .catch(() => {
          // Silent fallback
        });
    }
  }, []);

  return null;
}
