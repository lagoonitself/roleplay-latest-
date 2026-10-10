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

export function getSavedSettings(): UserAppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Partial<UserAppSettings>): UserAppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS;
  const current = getSavedSettings();
  const updated = { ...current, ...settings };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new Event('cadenza-settings-changed'));
  } catch (err) {
    console.error('Failed to save settings:', err);
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
