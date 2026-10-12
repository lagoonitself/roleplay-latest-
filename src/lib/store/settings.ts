'use client';

import { useState, useEffect } from 'react';

export type LlmProvider = 'opencode' | 'chatgpt';

/** OAuth session from "Sign in with ChatGPT" (kept in this browser only). */
export interface ChatgptAuth {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
  accountId: string;
  email: string;
  plan: string;
}

export interface UserAppSettings {
  llmProvider: LlmProvider;
  chatgptAuth: ChatgptAuth | null;
  chatgptModel: string;
  opencodeApiKey: string;
  opencodeEndpoint: string;
  opencodeModel: string;
  uncensoredMode: boolean;
  activePersonaId: string | null;
  defaultTemperature: number;
  thinkingEnabled: boolean;
}

export const DEFAULT_SETTINGS: UserAppSettings = {
  llmProvider: 'opencode',
  chatgptAuth: null,
  chatgptModel: 'gpt-5.5',
  opencodeApiKey: '',
  opencodeEndpoint: 'https://opencode.ai/zen/go/v1/chat/completions',
  opencodeModel: 'deepseek-v4.1-flash',
  uncensoredMode: true, // Default to true since user explicitly requested it!
  activePersonaId: null,
  defaultTemperature: 1.15,
  thinkingEnabled: false,
};

const STORAGE_KEY = 'cadenza_user_settings';

/**
 * Validates one persisted settings blob field-by-field. Anything with the wrong
 * type (old schema versions, hand-edited storage, corrupted JSON fragments) is
 * dropped back to its default instead of flowing into the app unchecked.
 */
function normalizeSettings(raw: unknown): UserAppSettings {
  const out: UserAppSettings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const s = raw as Record<string, unknown>;
  if (typeof s.opencodeApiKey === 'string') out.opencodeApiKey = s.opencodeApiKey;
  if (typeof s.opencodeEndpoint === 'string' && s.opencodeEndpoint.trim()) out.opencodeEndpoint = s.opencodeEndpoint;
  if (typeof s.opencodeModel === 'string' && s.opencodeModel.trim()) out.opencodeModel = s.opencodeModel;
  if (typeof s.uncensoredMode === 'boolean') out.uncensoredMode = s.uncensoredMode;
  if (typeof s.activePersonaId === 'string' || s.activePersonaId === null) out.activePersonaId = s.activePersonaId as string | null;
  if (typeof s.defaultTemperature === 'number' && Number.isFinite(s.defaultTemperature)) {
    out.defaultTemperature = Math.min(2, Math.max(0, s.defaultTemperature));
  }
  if (typeof s.thinkingEnabled === 'boolean') out.thinkingEnabled = s.thinkingEnabled;
  return out;
}

export function getSavedSettings(): UserAppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Partial<UserAppSettings>): UserAppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  const current = getSavedSettings();
  const updated = normalizeSettings({ ...current, ...settings });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('cadenza-settings-changed'));
  } catch (err) {
    console.error('Failed to save settings:', err);
    try {
      window.dispatchEvent(
        new CustomEvent('cadenza-storage-error', {
          detail: { scope: 'settings', quota: err instanceof DOMException && err.name === 'QuotaExceededError' },
        })
      );
    } catch {}
  }
  return updated;
}

export function useSettings(): [UserAppSettings, (newSettings: Partial<UserAppSettings>) => void] {
  const [settings, setSettings] = useState<UserAppSettings>(() => getSavedSettings());

  useEffect(() => {
    const handler = () => {
      setSettings(getSavedSettings());
    };

    window.addEventListener('cadenza-settings-changed', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('cadenza-settings-changed', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const update = (newSettings: Partial<UserAppSettings>) => {
    const saved = saveSettings(newSettings);
    setSettings(saved);
  };

  return [settings, update];
}
