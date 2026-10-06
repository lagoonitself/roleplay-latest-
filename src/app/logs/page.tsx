'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Copy, RefreshCw, Search, Trash2, ChevronDown, FlaskConical } from 'lucide-react';
import {
  getLocalLogs,
  clearLocalLogs,
  LLM_LOG_EVENT,
  type LlmLogEntry,
} from '@/lib/logs/llm-log-store';
import { toast } from 'sonner';

interface ServerRow {
  id: number;
  created_at: string;
  chat_id: string | null;
  character_id: string | null;
  kind: string;
  model: string;
  params: any;
  request_messages: any;
  user_message: string;
  output: string;
  reasoning: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  cached_tokens: number;
  latency_ms: number;
}

function serverRowToEntry(r: ServerRow): LlmLogEntry {
  return {
    id: `srv-${r.id}`,
    createdAt: r.created_at,
    chatId: r.chat_id || '',
    characterId: r.character_id || '',
    characterName: '',
    kind: r.kind === 'swipe' ? 'swipe' : 'chat',
    model: r.model || '',
    params: r.params || {},
    requestMessages: Array.isArray(r.request_messages) ? r.request_messages : [],
    userMessage: r.user_message || '',
    output: r.output || '',
    reasoning: r.reasoning ?? null,
    usage: {
      input: r.prompt_tokens || 0,
      output: r.completion_tokens || 0,
      total: (r.prompt_tokens || 0) + (r.completion_tokens || 0),
      cached: r.cached_tokens || 0,
    },
    latencyMs: r.latency_ms || 0,
    serverId: r.id,
  };
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function copyText(text: string, label: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} copied`),
    () => toast.error('Copy failed')
  );
}

export default function ModelLogsPage() {
  const [localLogs, setLocalLogs] = useState<LlmLogEntry[]>([]);
  const [serverLogs, setServerLogs] = useState<LlmLogEntry[]>([]);
  const [serverAvailable, setServerAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [chatFilter, setChatFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedMsgIdx, setExpandedMsgIdx] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLocalLogs(getLocalLogs());
    try {
      const res = await fetch('/api/logs?limit=200');
      if (res.ok) {
        const data = await res.json();
        setServerAvailable(!!data?.authenticated);
        const rows: ServerRow[] = Array.isArray(data?.logs) ? data.logs : [];
        setServerLogs(rows.map((r) => serverRowToEntry(r)));
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const onLog = () => setLocalLogs(getLocalLogs());
    window.addEventListener(LLM_LOG_EVENT, onLog);
    return () => window.removeEventListener(LLM_LOG_EVENT, onLog);
  }, [load]);

  // Dedupe: a turn saved locally AND on the server appears once (prefer local — same prompt).
  const merged = useMemo(() => {
    const serverIds = new Set<string | number>(
      localLogs
        .map((l) => l.serverId)
        .filter((v): v is string | number => v !== null && v !== undefined)
    );
    const prunedServer = serverLogs.filter(
      (s) => s.serverId == null || !serverIds.has(s.serverId)
    );
    return [...localLogs, ...prunedServer].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [localLogs, serverLogs]);

  const chatOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of merged) {
      if (!l.chatId) continue;
      if (!map.has(l.chatId)) map.set(l.chatId, l.characterName || l.chatId.slice(0, 8));
    }
    return [...map.entries()];
  }, [merged]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return merged.filter((l) => {
      if (chatFilter && l.chatId !== chatFilter) return false;
      if (!q) return true;
      const hay = [
        l.characterName,
        l.userMessage,
        l.output,
        l.model,
        ...l.requestMessages.map((m) => m.content),
      ]
        .join('\n')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [merged, query, chatFilter]);

  const handleClearDevice = () => {
    if (!confirm('Delete all model logs stored on this device? Server rows are kept.')) return;
    clearLocalLogs();
    setLocalLogs([]);
    toast.info('Device logs cleared');
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 pb-28 pt-4 sm:px-6 sm:pt-6">
      <div className="flex items-center gap-2">
        <Link
          href="/profile"
          className="icon-btn"
          aria-label="Back to profile"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </Link>
        <div className="min-w-0">
          <h1 className="type-page flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-ink-3" aria-hidden />
            Model logs
            <span className="chip chip-warn">
              Dev
            </span>
          </h1>
          <p className="type-meta mt-0.5">
            Complete prompt per turn, every injected block, params, and raw output. Logged from now
            on{serverAvailable ? ' (device and account)' : ' (this device)'}.
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={load}
            className="icon-btn border border-line"
            title="Refresh logs"
            aria-label="Refresh logs"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          </button>
          <button
            type="button"
            onClick={handleClearDevice}
            className="icon-btn border border-line"
            title="Clear device logs"
            aria-label="Clear device logs"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label className="flex flex-1 items-center gap-2 field !py-2">
          <Search className="h-4 w-4 shrink-0 text-ink-3" aria-hidden />
          <span className="sr-only">Search logs</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search prompts, outputs, characters…"
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink-3 focus:outline-none"
          />
        </label>
        <label className="sr-only" htmlFor="logs-chat-filter">
          Filter by chat
        </label>
        <select
          id="logs-chat-filter"
          value={chatFilter}
          onChange={(e) => setChatFilter(e.target.value)}
          className="field bg-sunken text-ink sm:w-auto"
          aria-label="Filter by chat"
        >
          <option value="">All chats ({merged.length})</option>
          {chatOptions.map(([id, label]) => (
            <option key={id} value={id}>
              {label} ({id.slice(0, 8)})
            </option>
          ))}
        </select>
      </div>

      {/* Log list */}
      <div className="mt-4 space-y-2.5">
        {loading && <p className="type-meta px-1">Loading logs…</p>}
        {!loading && filtered.length === 0 && (
          <div className="surface rounded-xl p-8 text-center">
            <p className="type-page !text-lg">No logs yet</p>
            <p className="type-meta mx-auto mt-1 max-w-sm">
              Send a chat message and the complete model input (system prompt, history,
              turn context with memories, lore, and scene state) plus the raw output will appear here.
            </p>
          </div>
        )}
        {filtered.map((log) => {
          const open = expandedId === log.id;
          return (
            <article
              key={log.id}
              className="surface rounded-lg overflow-hidden"
            >
              <button
                type="button"
                onClick={() => {
                  setExpandedId(open ? null : log.id);
                  setExpandedMsgIdx(null);
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
                aria-expanded={open}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-[13px] font-semibold text-ink">
                      {log.characterName || 'Unknown character'}
                    </span>
                    <span className="chip type-code">
                      {log.kind}
                    </span>
                    {log.serverId != null && (
                      <span className="chip chip-ok">
                        saved
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-xs text-ink-2">
                    {log.userMessage || '(empty user message)'}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-ink-3">
                    <span>{formatTime(log.createdAt)}</span>
                    <span>
                      {log.usage.input.toLocaleString()} in / {log.usage.output.toLocaleString()}{' '}
                      out
                    </span>
                    <span>{log.latencyMs} ms</span>
                    <span className="truncate">{log.model}</span>
                  </p>
                </div>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
                  aria-hidden
                />
              </button>

              {open && (
                <div className="space-y-3 border-t border-line px-4 py-4">
                  {/* Params */}
                  <section>
                    <div className="mb-1.5 flex items-center justify-between">
                      <h4 className="type-sec">
                        Request params
                      </h4>
                      <button
                        type="button"
                        onClick={() => copyText(JSON.stringify(log.params, null, 2), 'Params')}
                        className="btn btn-quiet inline-flex items-center gap-1 !text-[11px]"
                      >
                        <Copy className="h-3 w-3" aria-hidden /> Copy
                      </button>
                    </div>
                    <pre className="well type-code overflow-x-auto p-3 leading-relaxed text-ink-2">
                      {JSON.stringify(log.params, null, 2)}
                    </pre>
                  </section>

                  {/* Request messages — the complete prompt */}
                  <section>
                    <div className="mb-1.5 flex items-center justify-between">
                      <h4 className="type-sec">
                        Complete prompt ({log.requestMessages.length} messages)
                      </h4>
                      <button
                        type="button"
                        onClick={() =>
                          copyText(JSON.stringify(log.requestMessages, null, 2), 'Prompt')
                        }
                        className="btn btn-quiet inline-flex items-center gap-1 !text-[11px]"
                      >
                        <Copy className="h-3 w-3" aria-hidden /> Copy all
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {log.requestMessages.map((m, i) => {
                        const msgOpen = expandedMsgIdx === i;
                        return (
                          <div
                            key={i}
                            className="surface rounded-lg overflow-hidden"
                          >
                            <button
                              type="button"
                              onClick={() => setExpandedMsgIdx(msgOpen ? null : i)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left"
                              aria-expanded={msgOpen}
                            >
                              <span
                                className={m.role === 'system' ? 'chip chip-accent type-code' : 'chip type-code'}
                              >
                                {m.role}
                              </span>
                              <span className="truncate text-[11px] text-ink-2">
                                {m.content.slice(0, 120).replace(/\n/g, ' ')}
                              </span>
                              <span className="ml-auto shrink-0 text-[10px] tabular-nums text-ink-3">
                                {m.content.length.toLocaleString()} chars
                              </span>
                            </button>
                            {msgOpen && (
                              <div className="border-t border-line p-3">
                                <pre className="well type-code max-h-96 overflow-y-auto whitespace-pre-wrap break-words !text-[11px] !leading-relaxed text-ink-2 p-3">
                                  {m.content}
                                </pre>
                                <button
                                  type="button"
                                  onClick={() => copyText(m.content, `${m.role} message`)}
                                  className="btn btn-quiet mt-2 inline-flex items-center gap-1 !text-[11px]"
                                >
                                  <Copy className="h-3 w-3" aria-hidden /> Copy message
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Output */}
                  <section>
                    <div className="mb-1.5 flex items-center justify-between">
                      <h4 className="type-sec">
                        Model output
                      </h4>
                      <button
                        type="button"
                        onClick={() => copyText(log.output, 'Output')}
                        className="btn btn-quiet inline-flex items-center gap-1 !text-[11px]"
                      >
                        <Copy className="h-3 w-3" aria-hidden /> Copy
                      </button>
                    </div>
                    <pre className="well type-code max-h-96 overflow-y-auto whitespace-pre-wrap break-words !text-[11px] !leading-relaxed text-ink-2 p-3">
                      {log.output || '(empty)'}
                    </pre>
                  </section>

                  {log.reasoning && (
                    <section>
                      <h4 className="type-sec mb-1.5">
                        Reasoning
                      </h4>
                      <pre className="well type-code max-h-64 overflow-y-auto whitespace-pre-wrap break-words !text-[11px] !leading-relaxed text-ink-2 p-3">
                        {log.reasoning}
                      </pre>
                    </section>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
