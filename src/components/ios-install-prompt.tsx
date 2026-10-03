'use client';

import React, { useState, useEffect } from 'react';
import { Share, PlusSquare, X, Smartphone, Sparkles } from 'lucide-react';

interface IOSInstallPromptProps {
  forceOpen?: boolean;
  onClose?: () => void;
}

export function IOSInstallPrompt({ forceOpen = false, onClose }: IOSInstallPromptProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if device is iOS (iPhone/iPad/iPod)
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standaloneMode = (window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches;

    setIsIOS(isIOSDevice);
    setIsStandalone(standaloneMode);

    if (forceOpen) {
      setIsOpen(true);
      return;
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

  const handleDismiss = () => {
    setIsOpen(false);
    localStorage.setItem('cadenza_ios_pwa_dismissed', 'true');
    onClose?.();
  };

  if (!isOpen && !forceOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="absolute inset-0" onClick={handleDismiss} />

      <div
        className="relative z-10 w-full max-w-md bg-[#1c1c1f] dark:bg-[#121214] text-white rounded-t-[2.25rem] border-t border-white/[0.12] shadow-2xl p-6 space-y-5 animate-in slide-in-from-bottom duration-300 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-12 h-1.5 rounded-full bg-zinc-600/60 mx-auto -mt-2" />

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-500/20 text-purple-400 flex items-center justify-center border border-purple-500/30">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base tracking-tight">Add Cadenza to Home Screen</h3>
              <p className="text-xs text-zinc-400">Install as a native iPhone PWA app</p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Steps */}
        <div className="space-y-3 bg-zinc-800/40 p-4 rounded-2xl border border-white/[0.06] text-xs">
          <div className="flex items-center gap-3 text-zinc-200">
            <div className="w-7 h-7 rounded-xl bg-purple-600/30 text-purple-300 flex items-center justify-center shrink-0 font-bold">
              1
            </div>
            <div className="flex-1">
              Tap the Safari <span className="font-semibold text-white">Share</span> button <Share className="inline w-3.5 h-3.5 mx-1 text-purple-400" /> in the bottom navigation bar.
            </div>
          </div>

          <div className="flex items-center gap-3 text-zinc-200">
            <div className="w-7 h-7 rounded-xl bg-purple-600/30 text-purple-300 flex items-center justify-center shrink-0 font-bold">
              2
            </div>
            <div className="flex-1">
              Scroll down the menu and select <span className="font-semibold text-white">Add to Home Screen</span> <PlusSquare className="inline w-3.5 h-3.5 mx-1 text-purple-400" />.
            </div>
          </div>

          <div className="flex items-center gap-3 text-zinc-200">
            <div className="w-7 h-7 rounded-xl bg-purple-600/30 text-purple-300 flex items-center justify-center shrink-0 font-bold">
              3
            </div>
            <div className="flex-1">
              Tap <span className="font-semibold text-white">Add</span> in the top-right corner to launch Cadenza in fullscreen!
            </div>
          </div>
        </div>

        <button
          onClick={handleDismiss}
          className="w-full py-3 rounded-2xl bg-purple-600 hover:bg-purple-500 active:scale-95 text-white font-semibold text-xs transition-all apple-button shadow-md shadow-purple-600/25"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
