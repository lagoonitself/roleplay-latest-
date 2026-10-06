'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Share, PlusSquare, X, Smartphone } from 'lucide-react';

interface IOSInstallPromptProps {
  forceOpen?: boolean;
  onClose?: () => void;
}

export function IOSInstallPrompt({ forceOpen = false, onClose }: IOSInstallPromptProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Check if device is iOS (iPhone/iPad/iPod)
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standaloneMode = (window.navigator as Navigator & { standalone?: boolean }).standalone === true || window.matchMedia('(display-mode: standalone)').matches;

    if (forceOpen) {
      const t = setTimeout(() => setIsOpen(true), 0);
      return () => clearTimeout(t);
    }

    // Auto show once for iOS users not in standalone mode
    if (isIOSDevice && !standaloneMode) {
      const dismissed = localStorage.getItem('cadenza_ios_pwa_dismissed');
      if (!dismissed) {
        // Show after 3 seconds for a smooth intro
        const timer = setTimeout(() => setIsOpen(true), 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [forceOpen]);

  const handleDismiss = useCallback(() => {
    setIsOpen(false);
    localStorage.setItem('cadenza_ios_pwa_dismissed', 'true');
    onClose?.();
  }, [onClose]);

  // Escape closes the sheet without recording a dismissal beyond handleDismiss.
  useEffect(() => {
    if (!isOpen && !forceOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, forceOpen, handleDismiss]);

  if (!isOpen && !forceOpen) return null;

  const steps = [
    {
      body: (
        <>
          Tap the <span className="font-medium text-ink">Share</span> button{' '}
          <Share className="mx-1 inline h-3.5 w-3.5 text-ink-3" aria-hidden="true" /> in the
          Safari toolbar…
        </>
      ),
    },
    {
      body: (
        <>
          Scroll down and tap <span className="font-medium text-ink">“Add to Home Screen”</span>{' '}
          <PlusSquare className="mx-1 inline h-3.5 w-3.5 text-ink-3" aria-hidden="true" />…
        </>
      ),
    },
    {
      body: (
        <>
          Tap <span className="font-medium text-ink">“Add”</span> in the top-right corner to
          finish.
        </>
      ),
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={handleDismiss} />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add to home screen instructions"
        className="panel bg-raised relative z-10 w-full max-w-md space-y-5 rounded-t-3xl rounded-b-none border-x-0 border-b-0 border-t border-line p-6 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] animate-in slide-in-from-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="bg-line-strong mx-auto -mt-2 h-1.5 w-12 rounded-full" />

        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Smartphone className="h-5 w-5 shrink-0 text-ink-3" aria-hidden="true" />
            <div>
              <h3 className="type-sec text-base">Add Cadenza to your home screen</h3>
              <p className="type-meta mt-0.5">It opens in its own window, next to your other apps</p>
            </div>
          </div>
          <button onClick={handleDismiss} aria-label="Close" className="icon-btn shrink-0">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Steps */}
        <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {steps.map((step, i) => (
            <li key={i} className="flex items-center gap-3 p-4">
              <span className="type-code w-5 shrink-0 text-ink" aria-hidden="true">
                {i + 1}
              </span>
              <p className="type-meta flex-1 leading-relaxed">{step.body}</p>
            </li>
          ))}
        </ol>

        <button onClick={handleDismiss} className="btn btn-primary w-full text-xs">
          Done
        </button>
      </div>
    </div>
  );
}
