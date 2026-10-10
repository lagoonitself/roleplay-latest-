'use client';

export interface LoggedChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmLogEntry {
  /** Stable client-side id: `llm-<timestamp>-<rand>` or server row id string. */
  id: string;
  createdAt: string;
  chatId: string;
  characterId: string;
  characterName: string;
  kind: 'chat' | 'swipe' | 'regen' | 'continue' | 'impersonate';
  model: string;
  /** Exact generation params sent to the provider. */
  params: {
    temperature: number;
    max_tokens: number;
    thinking: boolean;
    top_p: number;
    presence_penalty?: number;
    frequency_penalty?: number;
    stop?: string[];
  };
  /** The COMPLETE assembled prompt — every injected block included. */
  requestMessages: LoggedChatMessage[];
  /** Raw user text for this turn (before prompt engineering). */
  userMessage: string;
  /** Final assistant output (cleaned prose). */
  output: string;
  reasoning: string | null;
  usage: { input: number; output: number; total: number; cached?: number };
  latencyMs: number;
  /** Server Supabase row id when persisted to `llm_logs`, else null (guest / table missing). */
  serverId: string | number | null;
}

export const LLM_LOG_STORAGE_KEY = 'cadenza_llm_logs_v1';
export const LLM_LOG_EVENT = 'cadenza-llm-log';
const MAX_LOGS = 200;

function sanitizeEntry(e: unknown): LlmLogEntry | null {
  if (!e || typeof e !== 'object') return null;
  if (!Array.isArray((e as { requestMessages?: unknown }).requestMessages)) return null;
  return e as LlmLogEntry;
}

export function getLocalLogs(): LlmLogEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LLM_LOG_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeEntry).filter(Boolean) as LlmLogEntry[];
  } catch {
    return [];
  }
}

export function saveLocalLog(entry: LlmLogEntry): LlmLogEntry[] {
  try {
    const prev = getLocalLogs();
    const next = [entry, ...prev].slice(0, MAX_LOGS);
    localStorage.setItem(LLM_LOG_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(LLM_LOG_EVENT, { detail: entry }));
    return next;
  } catch {
    return getLocalLogs();
  }
}

export function clearLocalLogs(): void {
  try {
    localStorage.removeItem(LLM_LOG_STORAGE_KEY);
    window.dispatchEvent(new CustomEvent(LLM_LOG_EVENT, { detail: null }));
  } catch {}
}

export function makeLogId(): string {
  return `llm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
