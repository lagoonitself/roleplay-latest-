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
          className="apple-button rounded-full p-2 text-zinc-400 hover:bg-white/[0.06] hover:text-white"
          aria-label="Back to profile"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-base font-bold tracking-tight">
            <FlaskConical className="h-4 w-4 text-amber-300" />
            Model logs
            <span className="rounded-full border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
              Dev
            </span>
          </h1>
          <p className="mt-0.5 text-[11px] text-zinc-400">
            Complete prompt per turn — every injected block, params, and raw output. Logged from now
            on{serverAvailable ? ' (device + account)' : ' (this device)'}.
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            onClick={load}
            className="apple-button rounded-full border border-white/10 p-2 text-zinc-400 hover:text-white"
            title="Refresh logs"
            aria-label="Refresh logs"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleClearDevice}
            className="apple-button rounded-full border border-white/10 p-2 text-zinc-400 hover:text-red-400"
            title="Clear device logs"
            aria-label="Clear device logs"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <label className="flex flex-1 items-center gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3 py-2">
          <Search className="h-4 w-4 shrink-0 text-zinc-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search prompts, outputs, characters…"
            className="w-full bg-transparent text-sm text-zinc-100 placeholder:text-zinc-500 focus:outline-none"
          />
        </label>
        <select
          value={chatFilter}
          onChange={(e) => setChatFilter(e.target.value)}
          className="rounded-2xl border border-white/[0.08] bg-[#151518] px-3 py-2 text-sm text-zinc-200 focus:outline-none"
          aria-label="Filter by chat"
        >
          <option value="">All chats ({merged.length})</option>
          {chatOptions.map(([id, label]) => (
            <option key={id} value={id}>
              {label} · {id.slice(0, 8)}
            </option>
          ))}
        </select>
      </div>

      {/* Log list */}
      <div className="mt-4 space-y-2.5">
        {loading && <p className="px-1 text-xs text-zinc-500">Loading logs…</p>}
        {!loading && filtered.length === 0 && (
          <div className="rounded-3xl border border-white/[0.06] bg-white/[0.02] p-8 text-center">
            <p className="text-sm font-semibold text-zinc-300">No logs yet</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
              Send a chat message and the complete model input (system prompt, history,
              turn_context with memories / lore / scene state) plus the raw output will appear here.
            </p>
          </div>
        )}
        {filtered.map((log) => {
          const open = expandedId === log.id;
          return (
            <article
              key={log.id}
              className="overflow-hidden rounded-2xl border border-white/[0.07] bg-[#151518]/90"
            >
              <button
                onClick={() => {
                  setExpandedId(open ? null : log.id);
                  setExpandedMsgIdx(null);
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-[13px] font-bold text-white">
                      {log.characterName || 'Unknown character'}
                    </span>
                    <span
                      className={`rounded-full border px-1.5 py-px text-[10px] font-bold ${
                        log.kind === 'swipe'
                          ? 'border-sky-400/25 bg-sky-500/10 text-sky-300'
                          : 'border-white/10 bg-white/[0.05] text-zinc-300'
                      }`}
                    >
                      {log.kind}
                    </span>
                    {log.serverId != null && (
                      <span className="rounded-full border border-emerald-400/25 bg-emerald-500/10 px-1.5 py-px text-[10px] font-bold text-emerald-300">
                        saved
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-xs text-zinc-400">
                    {log.userMessage || '(empty user message)'}
                  </p>
                  <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] tabular-nums text-zinc-500">
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
                  className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </button>

              {open && (
                <div className="space-y-3 border-t border-white/[0.06] px-4 py-4">
                  {/* Params */}
                  <section>
                    <div className="mb-1.5 flex items-center justify-between">
                      <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                        Request params
                      </h4>
                      <button
                        onClick={() => copyText(JSON.stringify(log.params, null, 2), 'Params')}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-400 hover:text-white"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    </div>
                    <pre className="overflow-x-auto rounded-xl border border-white/[0.06] bg-black/40 p-3 text-[11px] leading-relaxed text-zinc-300">
                      {JSON.stringify(log.params, null, 2)}
                    </pre>
                  </section>

                  {/* Request messages — the complete prompt */}
                  <section>
                    <div className="mb-1.5 flex items-center justify-between">
                      <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                        Complete prompt · {log.requestMessages.length} messages
                      </h4>
                      <button
                        onClick={() =>
                          copyText(JSON.stringify(log.requestMessages, null, 2), 'Prompt')
                        }
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-400 hover:text-white"
                      >
                        <Copy className="h-3 w-3" /> Copy all
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {log.requestMessages.map((m, i) => {
                        const msgOpen = expandedMsgIdx === i;
                        return (
                          <div
                            key={i}
                            className="overflow-hidden rounded-xl border border-white/[0.06] bg-black/30"
                          >
                            <button
                              onClick={() => setExpandedMsgIdx(msgOpen ? null : i)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left"
                            >
                              <span
                                className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                                  m.role === 'system'
                                    ? 'bg-purple-500/15 text-purple-300'
                                    : m.role === 'assistant'
                                      ? 'bg-emerald-500/15 text-emerald-300'
                                      : 'bg-sky-500/15 text-sky-300'
                                }`}
                              >
                                {m.role}
                              </span>
                              <span className="truncate text-[11px] text-zinc-400">
                                {m.content.slice(0, 120).replace(/\n/g, ' ')}
                              </span>
                              <span className="ml-auto shrink-0 text-[10px] tabular-nums text-zinc-500">
                                {m.content.length.toLocaleString()} chars
                              </span>
                            </button>
                            {msgOpen && (
                              <div className="border-t border-white/[0.06] p-3">
                                <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-zinc-200">
                                  {m.content}
                                </pre>
                                <button
                                  onClick={() => copyText(m.content, `${m.role} message`)}
                                  className="mt-2 inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-400 hover:text-white"
                                >
                                  <Copy className="h-3 w-3" /> Copy message
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
                      <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                        Model output
                      </h4>
                      <button
                        onClick={() => copyText(log.output, 'Output')}
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-zinc-400 hover:text-white"
                      >
                        <Copy className="h-3 w-3" /> Copy
                      </button>
                    </div>
                    <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-black/40 p-3 text-[11px] leading-relaxed text-zinc-200">
                      {log.output || '(empty)'}
                    </pre>
                  </section>

                  {log.reasoning && (
                    <section>
                      <h4 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                        Reasoning (thinking)
                      </h4>
                      <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-white/[0.06] bg-black/40 p-3 text-[11px] leading-relaxed text-amber-100/80">
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
