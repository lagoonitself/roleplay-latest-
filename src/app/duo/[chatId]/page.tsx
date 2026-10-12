'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Pause, Play, Square, Plus, Loader2, AlertTriangle, Megaphone, ChevronDown } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { useRegexScripts } from '@/lib/store/regex-store';
import { useVisualViewportVars } from '@/lib/hooks';
import { CharacterAvatar } from '@/components/character-avatar';
import { RoleplayMessageContent } from '@/components/chat/roleplay-message-content';
import { DUO_CONTINUE_TURNS, DUO_MAX_TURNS_CAP, parseDuo, type DuoSession } from '@/lib/duo/types';
import { formatTokenCount } from '@/lib/usage/tokens';
import { toast } from 'sonner';
import type { Chat, Message } from '@/lib/supabase/types';
import { resolveLlmKey } from '@/lib/llm/credentials';

async function getAuthHeaders(supabase: ReturnType<typeof createClient>): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch {}
  return headers;
}

export default function DuoWatchPage() {
  const params = useParams();
  const chatId = params?.chatId as string;
  const supabase = createClient();
  const [settings] = useSettings();
  const { scripts: regexScripts } = useRegexScripts();

  const [chat, setChat] = useState<Chat | null>(null);
  const [duo, setDuo] = useState<DuoSession | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [directorOpen, setDirectorOpen] = useState(false);
  const [draftScene, setDraftScene] = useState('');
  const [draftSecretA, setDraftSecretA] = useState('');
  const [draftSecretB, setDraftSecretB] = useState('');
  const [directSaving, setDirectSaving] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const lastActivityRef = useRef<number>(0);
  const lastStepRef = useRef<number>(0);
  const duoRef = useRef<DuoSession | null>(null);
  const settingsRef = useRef(settings);
  const loadPromiseRef = useRef<Promise<void> | null>(null);

  // Keep the shell sized to the *visible* viewport so the director fields stay
  // above the iOS keyboard instead of behind it.
  useVisualViewportVars();

  useEffect(() => {
    duoRef.current = duo;
  }, [duo]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const scrollToBottom = useCallback((smooth = true) => {
    if (!isAtBottom) return;
    // Smooth scrolling is motion too — honour prefers-reduced-motion.
    const reduce =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    endRef.current?.scrollIntoView({ behavior: smooth && !reduce ? 'smooth' : 'auto', block: 'end' });
  }, [isAtBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Coalesced: concurrent callers share one in-flight fetch, so background
  // ticks can never stack full chat + transcript refetches before one lands.
  const load = useCallback(() => {
    if (!loadPromiseRef.current) {
      const run = (async () => {
        const { data: chatRow } = await supabase.from('chats').select('*').eq('id', chatId).maybeSingle();
        if (chatRow) {
          setChat(chatRow as Chat);
          setDuo(parseDuo((chatRow as Chat).settings));
        }
        const { data: rows } = await supabase
          .from('messages')
          .select('*')
          .eq('chat_id', chatId)
          .order('created_at', { ascending: true })
          .limit(400);
        if (rows) {
          setMessages(rows as Message[]);
          lastActivityRef.current = Date.now();
        }
      })();
      loadPromiseRef.current = run.finally(() => {
        loadPromiseRef.current = null;
      });
    }
    return loadPromiseRef.current;
  }, [chatId, supabase]);

  useEffect(() => {
    lastActivityRef.current = Date.now();
    // Data fetch on mount — the standard pattern used across this app.
    void load().catch(() => {});
  }, [load]);

  // Live: message inserts/updates + duo state changes.
  useEffect(() => {
    const msgChannel = supabase
      .channel(`duo-messages-${chatId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'messages', filter: `chat_id=eq.${chatId}` },
        (payload) => {
          lastActivityRef.current = Date.now();
          if (payload.eventType === 'INSERT') {
            const m = payload.new as Message;
            setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          } else if (payload.eventType === 'UPDATE') {
            const m = payload.new as Message;
            setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...m } : x)));
          } else if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as Message)?.id;
            if (oldId) setMessages((prev) => prev.filter((x) => x.id !== oldId));
          }
        }
      )
      .subscribe();
    const chatChannel = supabase
      .channel(`duo-chat-${chatId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'chats', filter: `id=eq.${chatId}` },
        (payload) => {
          const row = payload.new as Chat;
          setChat(row);
          setDuo(parseDuo(row.settings));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(msgChannel);
      supabase.removeChannel(chatChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  // Gentle state refresh + watchdog: revive a stalled chain. Ticks are cheap
  // and pause while the tab is hidden: no settings poll unless a run is live,
  // and none within a few seconds of a step request — the step response and
  // the realtime channels already carry the fresh state.
  useEffect(() => {
    let tickInFlight = false;
    const tick = async () => {
      if (tickInFlight || document.hidden) return;
      tickInFlight = true;
      try {
        const current = duoRef.current;
        if (!current) {
          // Nothing loaded yet — full reload, coalesced by load().
          await load();
          return;
        }
        if (current.status !== 'running') return;
        const now = Date.now();
        if (now - lastActivityRef.current > 45000) {
          // Stalled — ask the server for the next line to revive the chain.
          try {
            const headers = await getAuthHeaders(supabase);
            if (settingsRef.current.opencodeApiKey) headers['x-llm-key'] = settingsRef.current.opencodeApiKey;
            const res = await fetch('/api/duo', {
              method: 'POST',
              headers,
              body: JSON.stringify({ action: 'step', chatId, runId: current.runId }),
            });
            lastActivityRef.current = now;
            lastStepRef.current = now;
            const json = await res.json().catch(() => null);
            if (json?.duo) setDuo(json.duo as DuoSession);
          } catch {}
        } else if (now - lastStepRef.current > 5000) {
          // Keep the header counters fresh without a full reload.
          const { data } = await supabase.from('chats').select('settings').eq('id', chatId).maybeSingle();
          if (data) setDuo(parseDuo((data as { settings: unknown }).settings));
        }
      } catch {
        // A failed background tick must never become an unhandled rejection.
      } finally {
        tickInFlight = false;
      }
    };
    const timer = setInterval(() => {
      void tick().catch(() => {});
    }, 8000);
    // Pause while the tab is hidden; resume with a tick as soon as it shows.
    const onVisibilityChange = () => {
      if (!document.hidden) void tick().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const control = async (action: 'pause' | 'resume' | 'stop' | 'continue') => {
    setBusy(true);
    try {
      const headers = await getAuthHeaders(supabase);
      const llmKey = await resolveLlmKey(settings);
      if (llmKey) headers['x-llm-key'] = llmKey;
      const res = await fetch('/api/duo', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'control', control: action, chatId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Control failed.');
      if (json.duo) setDuo(json.duo as DuoSession);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Control failed.');
    } finally {
      setBusy(false);
    }
  };

  const openDirector = () => {
    if (duo) {
      setDraftScene(duo.seed || '');
      setDraftSecretA(duo.secrets.a || '');
      setDraftSecretB(duo.secrets.b || '');
    }
    setDirectorOpen(true);
  };

  const saveDirection = async () => {
    setDirectSaving(true);
    try {
      const headers = await getAuthHeaders(supabase);
      const llmKey = await resolveLlmKey(settings);
      if (llmKey) headers['x-llm-key'] = llmKey;
      const res = await fetch('/api/duo', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'direct',
          chatId,
          seed: draftScene,
          secrets: { a: draftSecretA, b: draftSecretB },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Direction failed.');
      if (json.duo) setDuo(json.duo as DuoSession);
      toast.success('Direction set — applies from the next line.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Direction failed.');
    } finally {
      setDirectSaving(false);
    }
  };

  const tokens = useMemo(() => {
    let total = 0;
    for (const m of messages) total += (m.meta?.tokens_in || 0) + (m.meta?.tokens_out || 0);
    return total;
  }, [messages]);

  const face = (side: 'a' | 'b') => duo?.faces?.[side];
  const status = duo?.status || 'running';

  return (
    <div className="flex-1 flex flex-col w-full max-w-4xl mx-auto min-h-0 max-h-[calc(var(--app-height,100dvh)+var(--app-offset-top,0px)-env(safe-area-inset-top,0px)-3.5rem)] pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]">
      {/* Header */}
      {/* Sticky under the navbar, which is safe-top + 3.5rem tall on notched phones. */}
      <div className="sticky top-[calc(env(safe-area-inset-top,0px)+3.5rem)] z-30 bg-background border-b border-line">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link href="/duo" className="icon-btn shrink-0" aria-label="All scenes">
            <ArrowLeft className="w-5 h-5" aria-hidden />
          </Link>
          {duo && (
            <div className="flex -space-x-2 shrink-0" aria-hidden>
              {(['a', 'b'] as const).map((s) => (
                <div key={s} className="w-9 h-9 rounded-md overflow-hidden border border-line bg-background ring-2 ring-background">
                  <CharacterAvatar name={face(s)?.name || '?'} avatarUrl={face(s)?.avatar_url || null} />
                </div>
              ))}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-serif text-[0.95rem] font-medium text-ink truncate">
              {chat?.title || 'Scene'}
            </div>
            <div className="type-meta truncate">
              {duo ? (
                <>
                  {duo.faces.a.name} and {duo.faces.b.name}, turn{' '}
                  {Math.min(duo.turn + (status === 'running' ? 1 : 0), duo.maxTurns)}/{duo.maxTurns}
                  {tokens > 0 && <>, {formatTokenCount(tokens)} tokens</>}
                </>
              ) : (
                'Loading…'
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {status === 'running' ? (
              <button
                onClick={() => control('pause')}
                disabled={busy}
                className="icon-btn text-warn disabled:opacity-50"
                title="Pause"
                aria-label="Pause scene"
              >
                <Pause className="w-4 h-4" aria-hidden />
              </button>
            ) : status === 'paused' || status === 'error' ? (
              <button
                onClick={() => control('resume')}
                disabled={busy}
                className="icon-btn text-ok disabled:opacity-50"
                title="Resume"
                aria-label="Resume scene"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Play className="w-4 h-4" aria-hidden />}
              </button>
            ) : null}
            {(status === 'paused' || status === 'running') && (
              <button
                onClick={() => control('stop')}
                disabled={busy}
                className="icon-btn text-danger disabled:opacity-50"
                title="Stop"
                aria-label="Stop scene"
              >
                <Square className="w-4 h-4" aria-hidden />
              </button>
            )}
            {status === 'done' && duo && duo.turn < DUO_MAX_TURNS_CAP && (
              <button
                onClick={() => control('continue')}
                disabled={busy}
                className="btn btn-ghost disabled:opacity-50"
                title={`Add ${DUO_CONTINUE_TURNS} more lines`}
              >
                <Plus className="w-3.5 h-3.5 text-accent-text" aria-hidden />
                More
              </button>
            )}
          </div>
        </div>
        {duo?.status === 'error' && duo.lastError && (
          <div className="mx-4 sm:mx-6 mb-3 px-3 py-2 rounded-lg border border-danger-line bg-danger-wash flex items-center gap-2 text-xs text-danger">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
            <span className="truncate">{duo.lastError}</span>
          </div>
        )}
      </div>

      {/* Director */}
      {duo && (
        <div className="px-4 sm:px-6 pt-3">
          <div className="surface rounded-xl overflow-hidden">
            <button
              onClick={() => (directorOpen ? setDirectorOpen(false) : openDirector())}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left"
              aria-expanded={directorOpen}
            >
              <Megaphone className="w-4 h-4 text-ink-3 shrink-0" aria-hidden />
              <span className="type-sec flex-1">Direct this scene</span>
              <span className="flex items-center gap-1">
                {duo.seed.trim() && <span className="chip">Both hear this</span>}
                {duo.secrets.a.trim() && (
                  <span className="chip-accent chip" title={`${duo.faces.a.name} has a secret direction`}>
                    {duo.faces.a.name.split(' ')[0]} secret
                  </span>
                )}
                {duo.secrets.b.trim() && (
                  <span className="chip-accent chip" title={`${duo.faces.b.name} has a secret direction`}>
                    {duo.faces.b.name.split(' ')[0]} secret
                  </span>
                )}
              </span>
              <ChevronDown
                className={`w-4 h-4 text-ink-3 transition-transform duration-150 ${directorOpen ? 'rotate-180' : ''}`}
                aria-hidden
              />
            </button>
            {directorOpen && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t border-line">
                <div className="block pt-2">
                  <label htmlFor="duo-direct-scene" className="type-label">
                    Steer the story <span className="text-ink-3 font-normal">(both hear this)</span>
                  </label>
                  <textarea
                    id="duo-direct-scene"
                    value={draftScene}
                    onChange={(e) => setDraftScene(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    placeholder="A storm knocks out the lights. They have to trust each other…"
                    className="field mt-1 resize-none text-xs"
                  />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="block">
                    <label htmlFor="duo-secret-a" className="type-label">
                      Secret for {duo.faces.a.name}{' '}
                      <span className="text-ink-3 font-normal">({duo.faces.b.name.split(' ')[0]} never hears this)</span>
                    </label>
                    <textarea
                      id="duo-secret-a"
                      value={draftSecretA}
                      onChange={(e) => setDraftSecretA(e.target.value)}
                      rows={2}
                      maxLength={2000}
                      placeholder="You are hiding something. Deflect gently…"
                      className="field mt-1 resize-none text-xs border-accent-line"
                    />
                  </div>
                  <div className="block">
                    <label htmlFor="duo-secret-b" className="type-label">
                      Secret for {duo.faces.b.name}{' '}
                      <span className="text-ink-3 font-normal">({duo.faces.a.name.split(' ')[0]} never hears this)</span>
                    </label>
                    <textarea
                      id="duo-secret-b"
                      value={draftSecretB}
                      onChange={(e) => setDraftSecretB(e.target.value)}
                      rows={2}
                      maxLength={2000}
                      placeholder="You suspect them. Probe without accusing…"
                      className="field mt-1 resize-none text-xs border-accent-line"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={saveDirection}
                    disabled={directSaving}
                    className="btn btn-primary flex-1 disabled:opacity-50"
                  >
                    {directSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />}
                    {directSaving ? 'Setting direction…' : 'Set direction'}
                  </button>
                  <button onClick={() => setDirectorOpen(false)} className="btn btn-quiet">
                    Done
                  </button>
                </div>
                <p className="type-meta leading-relaxed">
                  Applies from the next line, no restart needed. Each side only hears its own secret.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Transcript */}
      <div
        ref={containerRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 120);
        }}
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-6 max-w-3xl w-full mx-auto"
      >
        {duo?.seed && (
          <div className="surface rounded-xl mx-auto max-w-xl px-4 py-3 text-center">
            <p className="type-meta leading-relaxed">{duo.seed}</p>
          </div>
        )}
        {messages.map((m) => {
          const side = m.meta?.duo?.side || 'a';
          const name = m.meta?.duo?.name || face(side)?.name || (side === 'a' ? 'A' : 'B');
          const avatar = face(side)?.avatar_url || null;
          const isA = side === 'a';
          const streaming = m.status === 'streaming';
          if (isA) {
            return (
              <div key={m.id} className="flex gap-2.5">
                <div className="w-8 h-8 rounded-md overflow-hidden shrink-0 mt-0.5 border border-line">
                  <CharacterAvatar name={name} avatarUrl={avatar} />
                </div>
                <div className="min-w-0 max-w-[82%] sm:max-w-[75%]">
                  <div className="type-meta mb-1">
                    {name}
                    {streaming && (
                      <span
                        className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-accent pulse-soft align-middle"
                        aria-label="Writing"
                      />
                    )}
                  </div>
                  <div className="prose-rp">
                    {m.content ? (
                      <RoleplayMessageContent content={m.content} role="assistant" characterName={name} scripts={regexScripts} />
                    ) : (
                      <span className="pulse-soft text-accent-text" aria-label="Writing">
                        ●
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          }
          return (
            <div key={m.id} className="flex gap-2.5 flex-row-reverse">
              <div className="w-8 h-8 rounded-md overflow-hidden shrink-0 mt-0.5 border border-line">
                <CharacterAvatar name={name} avatarUrl={avatar} />
              </div>
              <div className="min-w-0 max-w-[82%] sm:max-w-[75%] flex flex-col items-end">
                <div className="type-meta mb-1">
                  {name}
                  {streaming && (
                    <span
                      className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-accent pulse-soft align-middle"
                      aria-label="Writing"
                    />
                  )}
                </div>
                <div className="rp-user-bubble rounded-xl rounded-tr-md px-3.5 py-2.5 w-full">
                  <div className="prose-rp text-[0.95rem]">
                    {m.content ? (
                      <RoleplayMessageContent content={m.content} role="assistant" characterName={name} scripts={regexScripts} />
                    ) : (
                      <span className="pulse-soft text-accent-text" aria-label="Writing">
                        ●
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {status === 'done' && (
          <div className="text-center type-meta pt-2">Scene complete, {messages.length} lines.</div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
