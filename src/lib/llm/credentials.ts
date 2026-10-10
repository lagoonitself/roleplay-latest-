'use client';

import { getSavedSettings, saveSettings, type ChatgptAuth, type UserAppSettings } from '@/lib/store/settings';
import { encodeChatgptKey } from './chatgpt';

/** Refresh this long before expiry so a token never lapses mid-reply. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let refreshing: Promise<ChatgptAuth> | null = null;

/** True when the chosen provider has what it needs (or the server has its own key). */
export function hasLlmCredentials(settings: UserAppSettings): boolean {
  if (settings.llmProvider === 'chatgpt') return !!settings.chatgptAuth;
  return !!settings.opencodeApiKey || !!process.env.NEXT_PUBLIC_HAS_SERVER_KEY;
}

export function missingCredentialsMessage(settings: UserAppSettings): string {
  return settings.llmProvider === 'chatgpt'
    ? 'Sign in with ChatGPT in Settings first.'
    : 'Please configure your OpenCode Go API key in Settings first.';
}

async function refreshChatgpt(auth: ChatgptAuth): Promise<ChatgptAuth> {
  const res = await fetch('/api/auth/chatgpt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'refresh', refreshToken: auth.refreshToken }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (data?.expired) saveSettings({ chatgptAuth: null });
    throw new Error(data?.error || 'Couldn’t refresh your ChatGPT sign-in.');
  }
  const next: ChatgptAuth = { ...auth, ...data };
  saveSettings({ chatgptAuth: next });
  return next;
}

/**
 * The credential string sent to the server as `apiKey`: the OpenCode Go key, or the
 * ChatGPT session (refreshed first when close to expiry). Empty when none is set.
 */
export async function resolveLlmKey(settings: UserAppSettings = getSavedSettings()): Promise<string> {
  if (settings.llmProvider !== 'chatgpt') return settings.opencodeApiKey;

  // Re-read storage: another tab or an earlier refresh may hold a newer token.
  let auth = getSavedSettings().chatgptAuth ?? settings.chatgptAuth;
  if (!auth) return '';
  if (auth.expiresAt - Date.now() < REFRESH_MARGIN_MS) {
    // Refresh tokens are single-use, so concurrent callers share one refresh.
    refreshing ??= refreshChatgpt(auth).finally(() => {
      refreshing = null;
    });
    auth = await refreshing;
  }
  return encodeChatgptKey({ t: auth.accessToken, a: auth.accountId, m: settings.chatgptModel });
}
