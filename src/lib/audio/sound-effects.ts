/**
 * Ultra-lightweight Web Audio Soundscape for Roleplay Interactions.
 *
 * 100% native Web Audio API (AudioContext)
 * Zero external audio files, zero network requests, zero memory leaks.
 */

import { useState, useEffect } from 'react';

const SOUND_PREF_KEY = 'cadenza_sound_effects_enabled';

export function isSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const val = localStorage.getItem(SOUND_PREF_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SOUND_PREF_KEY, String(enabled));
    window.dispatchEvent(new Event('cadenza-sound-pref-changed'));
  } catch {}
}

export function useSoundEffects(): [boolean, (val?: boolean) => void] {
  const [enabled, setEnabled] = useState<boolean>(() => isSoundEnabled());

  useEffect(() => {
    const handler = () => {
      setEnabled(isSoundEnabled());
    };
    window.addEventListener('cadenza-sound-pref-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('cadenza-sound-pref-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const toggle = (val?: boolean) => {
    const next = typeof val === 'boolean' ? val : !enabled;
    setSoundEnabled(next);
    setEnabled(next);
  };

  return [enabled, toggle];
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;
    return new AudioContextClass();
  } catch {
    return null;
  }
}

/**
 * Tactile multi-die wooden/plastic tabletop rattle.
 */
export function playDiceSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const bounces = [0, 0.045 + Math.random() * 0.02, 0.095 + Math.random() * 0.03];
    bounces.forEach((delay, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1600 + Math.random() * 800, ctx.currentTime + delay);
      filter.Q.setValueAtTime(3.5, ctx.currentTime + delay);

      osc.type = 'triangle';
      const baseFreq = 340 + Math.random() * 100 - idx * 40;
      osc.frequency.setValueAtTime(baseFreq, ctx.currentTime + delay);
      osc.frequency.exponentialRampToValueAtTime(90, ctx.currentTime + delay + 0.035);

      const vol = 0.18 / (idx + 1);
      gain.gain.setValueAtTime(vol, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.04);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.045);
    });

    setTimeout(() => {
      try {
        ctx.close();
      } catch {}
    }, 350);
  } catch {}
}

/**
 * Gentle message send bubble pop.
 */
export function playSendSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(320, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(580, ctx.currentTime + 0.04);

    gain.gain.setValueAtTime(0.09, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.055);

    setTimeout(() => {
      try {
        ctx.close();
      } catch {}
    }, 200);
  } catch {}
}

/**
 * Warm, delicate chime signaling that the character has finished writing their turn.
 */
export function playReceiveSound(): void {
  if (!isSoundEnabled()) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    // Two gentle harmonic chimes (C6 and E6) with smooth decay
    const notes = [
      { freq: 1046.5, delay: 0 },
      { freq: 1318.5, delay: 0.06 },
    ];

    notes.forEach(({ freq, delay }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);

      gain.gain.setValueAtTime(0.06, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.25);
    });

    setTimeout(() => {
      try {
        ctx.close();
      } catch {}
    }, 450);
  } catch {}
}
