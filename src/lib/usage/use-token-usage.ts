'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  TOKEN_USAGE_EVENT,
  getLocalUsage,
  reconcileLocalUsage,
  syncUsageOwner,
  type TokenUsage,
} from './tokens';

interface UseTokenUsageResult extends TokenUsage {
  loading: boolean;
  syncedWithAccount: boolean;
  refresh: () => Promise<void>;
}

/**
 * Single source of truth for the Profile Token HUD.
 * - Guests: localStorage only.
 * - Signed-in: server aggregate (usage_events SUM) is authoritative;
 *   local cache is reconciled upward so the HUD never goes backwards.
 */
export function useTokenUsage(): UseTokenUsageResult {
  const [usage, setUsage] = useState<TokenUsage>(() => getLocalUsage());
  const [loading, setLoading] = useState(true);
  const [syncedWithAccount, setSyncedWithAccount] = useState(false);

  const refresh = useCallback(async () => {
    // Drop the local cache when it belongs to a different signed-in account
    // before reading it — guests and accounts must never share totals.
    let userId: string | null = null;
    try {
      const { data } = await createClient().auth.getSession();
      userId = data.session?.user?.id ?? null;
    } catch {}
    syncUsageOwner(userId);
    const local = getLocalUsage();
    try {
      const res = await fetch('/api/usage', { method: 'GET' });
      if (!res.ok) {
        setUsage(local);
        setSyncedWithAccount(false);
        setLoading(false);
        return;
      }
      const data = await res.json();
      const server: TokenUsage = {
        input: Math.max(0, Math.floor(Number(data?.input) || 0)),
        output: Math.max(0, Math.floor(Number(data?.output) || 0)),
        total: Math.max(0, Math.floor(Number(data?.total) || 0)),
      };
      if (!Number.isFinite(server.total) || (server.input === 0 && server.output === 0 && server.total === 0)) {
        // Server has nothing yet — keep local (covers pre-first-sync accounts).
        const merged = reconcileLocalUsage({
          input: Math.max(local.input, 0),
          output: Math.max(local.output, 0),
          total: local.input + local.output,
        });
        setUsage(merged.total > 0 ? merged : local);
      } else {
        const fixed: TokenUsage = {
          input: server.input,
          output: server.output,
          total: server.input + server.output,
        };
        reconcileLocalUsage(fixed);
        setUsage(fixed);
      }
      setSyncedWithAccount(true);
    } catch {
      setUsage(local);
      setSyncedWithAccount(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      refresh();
    }, 0);
    const onLocal = () => {
      // Optimistic instant update; server re-sync follows.
      setUsage(getLocalUsage());
      refresh();
    };
    const onFocus = () => refresh();
    window.addEventListener(TOKEN_USAGE_EVENT, onLocal);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearTimeout(t);
      window.removeEventListener(TOKEN_USAGE_EVENT, onLocal);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [refresh]);

  return { ...usage, loading, syncedWithAccount, refresh };
}
