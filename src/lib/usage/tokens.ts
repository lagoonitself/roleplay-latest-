'use client';

export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

export const TOKEN_USAGE_STORAGE_KEY = 'cadenza_token_usage';
export const TOKEN_USAGE_EVENT = 'cadenza-usage-changed';

const EMPTY: TokenUsage = { input: 0, output: 0, total: 0 };

function sanitize(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v) || v < 0) return 0;
  return Math.floor(v);
}

export function getLocalUsage(): TokenUsage {
  if (typeof window === 'undefined') return { ...EMPTY };
  try {
    const raw = localStorage.getItem(TOKEN_USAGE_STORAGE_KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw);
    const input = sanitize(parsed.input);
    const output = sanitize(parsed.output);
    return { input, output, total: input + output };
  } catch {
    return { ...EMPTY };
  }
}

/** Accumulate a single turn. Output already includes thinking/reasoning tokens server-side. */
export function recordLocalUsage(input: number, output: number): TokenUsage {
  const inT = sanitize(input);
  const outT = sanitize(output);
  if (inT === 0 && outT === 0) return getLocalUsage();
  const prev = getLocalUsage();
  const next: TokenUsage = {
    input: prev.input + inT,
    output: prev.output + outT,
    total: prev.input + inT + prev.output + outT,
  };
  try {
    localStorage.setItem(
      TOKEN_USAGE_STORAGE_KEY,
      JSON.stringify({ ...next, updatedAt: new Date().toISOString() })
    );
    window.dispatchEvent(new CustomEvent(TOKEN_USAGE_EVENT, { detail: next }));
  } catch {}
  return next;
}

/** Reconcile local cache upward when the server reports higher authoritative totals. */
export function reconcileLocalUsage(server: TokenUsage): TokenUsage {
  const s: TokenUsage = {
    input: sanitize(server.input),
    output: sanitize(server.output),
    total: 0,
  };
  s.total = s.input + s.output;
  try {
    const local = getLocalUsage();
    const merged: TokenUsage = {
      input: Math.max(local.input, s.input),
      output: Math.max(local.output, s.output),
      total: 0,
    };
    merged.total = merged.input + merged.output;
    localStorage.setItem(
      TOKEN_USAGE_STORAGE_KEY,
      JSON.stringify({ ...merged, updatedAt: new Date().toISOString() })
    );
    return merged;
  } catch {
    return s;
  }
}

export function formatTokenCount(n: number): string {
  const v = sanitize(n);
  return v.toLocaleString('en-US');
}

export function formatCompactTokenCount(n: number): string {
  const v = sanitize(n);
  if (v < 1000) return `${v}`;
  if (v < 1_000_000) {
    const k = v / 1000;
    return `${k >= 100 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}K`;
  }
  const m = v / 1_000_000;
  return `${m >= 100 ? Math.round(m) : m.toFixed(1).replace(/\.0$/, '')}M`;
}
