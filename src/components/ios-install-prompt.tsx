'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Share, PlusSquare } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';

interface IOSInstallPromptProps {
  forceOpen?: boolean;
  onClose?: () => void;
}

const DISMISS_KEY = 'cadenza_ios_pwa_dismissed';
// Re-offer the sheet ~30 days after the last dismissal.
const DISMISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function IOSInstallPrompt({ forceOpen = false, onClose }: IOSInstallPromptProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isEligible, setIsEligible] = useState(false);

  useEffect(() => {
    // iOS devices: iPhone/iPad/iPod UAs, plus iPadOS 13+ which reports a
    // Macintosh UA with touch. No navigator.platform (deprecated).
    const userAgent = window.navigator.userAgent;
    const isIOSDevice =
      /iphone|ipad|ipod/i.test(userAgent) ||
      (/macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
    const standaloneMode =
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;

    if (forceOpen) {
      const t = setTimeout(() => {
        setIsEligible(true);
        setIsOpen(true);
      }, 0);
      return () => clearTimeout(t);
    }

    // Auto show for iOS users not in standalone mode, unless dismissed recently
    if (isIOSDevice && !standaloneMode) {
      let dismissedAt = 0;
      try {
        dismissedAt = Number(localStorage.getItem(DISMISS_KEY));
      } catch {
        // iOS "Block All Cookies" / Safari private mode throws SecurityError.
      }
      const dismissalExpired =
        !Number.isFinite(dismissedAt) || Date.now() - dismissedAt > DISMISS_TTL_MS;
      if (dismissalExpired) {
        // Show after 3 seconds for a smooth intro
        const timer = setTimeout(() => {
          setIsEligible(true);
          setIsOpen(true);
        }, 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [forceOpen]);

  const handleDismiss = useCallback(() => {
    setIsOpen(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      // Private mode / locked storage: dismissal just won't persist.
    }
    onClose?.();
  }, [onClose]);

  // Escape closes the sheet without recording a dismissal beyond handleDismiss.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleDismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, handleDismiss]);

  // Keep early return null ONLY for the "not on iOS / already installed" case
  if (!isEligible) return null;

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
    <Sheet
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) handleDismiss();
      }}
      title="Add Cadenza to your home screen"
      description="It opens in its own window, next to your other apps"
      footer={
        <button
          type="button"
          onClick={handleDismiss}
          className="btn btn-primary min-h-11 w-full text-xs"
        >
          Done
        </button>
      }
    >
      <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line">
        {steps.map((step, i) => (
          <li key={i} className="flex min-h-[56px] items-center gap-3 p-4">
            <span className="type-code w-5 shrink-0 text-ink" aria-hidden="true">
              {i + 1}
            </span>
            <p className="type-meta flex-1 leading-relaxed">{step.body}</p>
          </li>
        ))}
      </ol>
    </Sheet>
  );
}
