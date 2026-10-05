'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Pause, Play, Square, Plus, Loader2, AlertTriangle, Megaphone, ChevronDown } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { CharacterAvatar } from '@/components/character-avatar';
import { RoleplayMessageContent } from '@/components/chat/roleplay-message-content';
import { DUO_CONTINUE_TURNS, DUO_MAX_TURNS_CAP, parseDuo, type DuoSession } from '@/lib/duo/types';
import { formatTokenCount } from '@/lib/usage/tokens';
import { toast } from 'sonner';
import type { Chat, Message } from '@/lib/supabase/types';

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
  const duoRef = useRef<DuoSession | null>(null);

  useEffect(() => {
    duoRef.current = duo;
  }, [duo]);

  const scrollToBottom = useCallback((smooth = true) => {
    if (!isAtBottom) return;
    endRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
  }, [isAtBottom]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const load = useCallback(async () => {
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
  }, [chatId, supabase]);

  useEffect(() => {
    lastActivityRef.current = Date.now();
    // Data fetch on mount — the standard pattern used across this app.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
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

  // Gentle state refresh + watchdog: revive a stalled chain.
  useEffect(() => {
    const timer = setInterval(async () => {
      const current = duoRef.current;
      if (!current) {
        load();
        return;
      }
      if (current.status === 'running' && Date.now() - lastActivityRef.current > 45000) {
        try {
          const headers = await getAuthHeaders(supabase);
          if (settings.opencodeApiKey) headers['x-llm-key'] = settings.opencodeApiKey;
          await fetch('/api/duo', {
            method: 'POST',
            headers,
            body: JSON.stringify({ action: 'step', chatId, runId: current.runId }),
          });
          lastActivityRef.current = Date.now();
        } catch {}
      } else if (current.status === 'running') {
        // Keep the header counters fresh without a full reload.
        const { data } = await supabase.from('chats').select('settings').eq('id', chatId).maybeSingle();
        if (data) setDuo(parseDuo((data as { settings: unknown }).settings));
      }
    }, 8000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);

  const control = async (action: 'pause' | 'resume' | 'stop' | 'continue') => {
    setBusy(true);
    try {
      const headers = await getAuthHeaders(supabase);
      if (settings.opencodeApiKey) headers['x-llm-key'] = settings.opencodeApiKey;
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
      if (settings.opencodeApiKey) headers['x-llm-key'] = settings.opencodeApiKey;
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
    <div className="flex-1 flex flex-col w-full max-w-4xl mx-auto min-h-0 pb-6">
      {/* Header */}
      <div className="sticky top-14 z-30 glass-panel border-b border-black/[0.06] dark:border-white/[0.08]">
        <div className="px-4 sm:px-6 py-3 flex items-center gap-3">
          <Link
            href="/duo"
            className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            aria-label="All scenes"
          >
            <ArrowLeft className="w-4.5 h-4.5 w-5 h-5" />
          </Link>
          {duo && (
            <div className="flex -space-x-2 shrink-0">
              {(['a', 'b'] as const).map((s) => (
                <div key={s} className="w-9 h-9 rounded-xl overflow-hidden ring-2 ring-[var(--background)]">
                  <CharacterAvatar name={face(s)?.name || '?'} avatarUrl={face(s)?.avatar_url || null} />
                </div>
              ))}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm truncate">{chat?.title || 'Scene'}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {duo ? (
                <>
                  {duo.faces.a.name} · {duo.faces.b.name} — turn {Math.min(duo.turn + (status === 'running' ? 1 : 0), duo.maxTurns)}/{duo.maxTurns}
                  {tokens > 0 && <> · {formatTokenCount(tokens)} tokens</>}
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
                className="p-2.5 rounded-full bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 apple-button disabled:opacity-50"
                title="Pause"
                aria-label="Pause scene"
              >
                <Pause className="w-4 h-4" />
              </button>
            ) : status === 'paused' || status === 'error' ? (
              <button
                onClick={() => control('resume')}
                disabled={busy}
                className="p-2.5 rounded-full bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 apple-button disabled:opacity-50"
                title="Resume"
                aria-label="Resume scene"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              </button>
            ) : null}
            {(status === 'paused' || status === 'running') && (
              <button
                onClick={() => control('stop')}
                disabled={busy}
                className="p-2.5 rounded-full bg-red-500/15 hover:bg-red-500/25 text-red-300 apple-button disabled:opacity-50"
                title="Stop"
                aria-label="Stop scene"
              >
                <Square className="w-4 h-4" />
              </button>
            )}
            {status === 'done' && duo && duo.turn < DUO_MAX_TURNS_CAP && (
              <button
                onClick={() => control('continue')}
                disabled={busy}
                className="px-3.5 py-2 rounded-full bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold apple-button flex items-center gap-1.5 disabled:opacity-50"
                title={`Add ${DUO_CONTINUE_TURNS} more lines`}
              >
                <Plus className="w-3.5 h-3.5" />
                More
              </button>
            )}
          </div>
        </div>
        {duo?.status === 'error' && duo.lastError && (
          <div className="px-4 sm:px-6 pb-3 flex items-center gap-2 text-[11px] text-red-300">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{duo.lastError}</span>
          </div>
        )}
      </div>

      {/* Director */}
      {duo && (
        <div className="px-4 sm:px-6 pt-3">
          <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 overflow-hidden">
            <button
              onClick={() => (directorOpen ? setDirectorOpen(false) : openDirector())}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left apple-button"
              aria-expanded={directorOpen}
            >
              <Megaphone className="w-4 h-4 text-amber-300 shrink-0" />
              <span className="text-xs font-semibold flex-1">Direct this scene</span>
              <span className="flex items-center gap-1">
                {duo.seed.trim() && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/[0.07] text-zinc-300 font-bold" title="Scene direction both hear">
                    Both
                  </span>
                )}
                {duo.secrets.a.trim() && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-bold" title={`${duo.faces.a.name} has a secret direction`}>
                    {duo.faces.a.name.split(' ')[0]} ✦
                  </span>
                )}
                {duo.secrets.b.trim() && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 font-bold" title={`${duo.faces.b.name} has a secret direction`}>
                    {duo.faces.b.name.split(' ')[0]} ✦
                  </span>
                )}
              </span>
              <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${directorOpen ? 'rotate-180' : ''}`} />
            </button>
            {directorOpen && (
              <div className="px-4 pb-4 pt-1 space-y-3 border-t border-white/[0.05]">
                <label className="block pt-2">
                  <span className="text-[11px] font-semibold text-zinc-300">
                    Steer the story <span className="text-muted-foreground font-normal">— both hear this</span>
                  </span>
                  <textarea
                    value={draftScene}
                    onChange={(e) => setDraftScene(e.target.value)}
                    rows={2}
                    maxLength={2000}
                    placeholder="A storm knocks out the lights. They have to trust each other…"
                    className="mt-1 w-full rounded-xl bg-black/30 border border-white/[0.08] px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/40 resize-none"
                  />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="text-[11px] font-semibold text-purple-300">
                      Secret for {duo.faces.a.name} <span className="text-muted-foreground font-normal">— {duo.faces.b.name.split(' ')[0]} never hears this</span>
                    </span>
                    <textarea
                      value={draftSecretA}
                      onChange={(e) => setDraftSecretA(e.target.value)}
                      rows={2}
                      maxLength={2000}
                      placeholder="You are hiding something. Deflect gently…"
                      className="mt-1 w-full rounded-xl bg-black/30 border border-purple-500/25 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/40 resize-none"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] font-semibold text-sky-300">
                      Secret for {duo.faces.b.name} <span className="text-muted-foreground font-normal">— {duo.faces.a.name.split(' ')[0]} never hears this</span>
                    </span>
                    <textarea
                      value={draftSecretB}
                      onChange={(e) => setDraftSecretB(e.target.value)}
                      rows={2}
                      maxLength={2000}
                      placeholder="You suspect them. Probe without accusing…"
                      className="mt-1 w-full rounded-xl bg-black/30 border border-sky-500/25 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-sky-500/40 resize-none"
                    />
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={saveDirection}
                    disabled={directSaving}
                    className="flex-1 py-2 rounded-full bg-amber-500/90 hover:bg-amber-500 text-black text-xs font-bold apple-button flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    {directSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {directSaving ? 'Directing…' : 'Set direction'}
                  </button>
                  <button
                    onClick={() => setDirectorOpen(false)}
                    className="px-4 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.1] text-xs font-semibold apple-button"
                  >
                    Done
                  </button>
                </div>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  Applies from the next line — no restart needed. Secrets go only to that side&apos;s model;
                  each side never sees the other&apos;s direction.
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
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4"
      >
        {duo?.seed && (
          <div className="mx-auto max-w-xl rounded-2xl border border-purple-500/20 bg-purple-500/[0.07] px-4 py-3 text-xs leading-relaxed text-zinc-300 text-center">
            {duo.seed}
          </div>
        )}
        {messages.map((m) => {
          const side = m.meta?.duo?.side || 'a';
          const name = m.meta?.duo?.name || face(side)?.name || (side === 'a' ? 'A' : 'B');
          const avatar = face(side)?.avatar_url || null;
          const isA = side === 'a';
          const streaming = m.status === 'streaming';
          return (
            <div key={m.id} className={`flex gap-2.5 ${isA ? '' : 'flex-row-reverse'}`}>
              <div className="w-8 h-8 rounded-xl overflow-hidden shrink-0 mt-0.5">
                <CharacterAvatar name={name} avatarUrl={avatar} />
              </div>
              <div className={`max-w-[82%] sm:max-w-[75%] min-w-0 ${isA ? '' : 'flex flex-col items-end'}`}>
                <div className={`text-[11px] font-semibold mb-1 ${isA ? 'text-purple-300' : 'text-sky-300'}`}>
                  {name}
                  {streaming && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse align-middle" />}
                </div>
                <div
                  className={`rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                    isA
                      ? 'rounded-tl-md bg-[var(--chat-char-bg)] text-[var(--chat-char-text)] border border-[var(--chat-char-border)]'
                      : 'rounded-tr-md bg-purple-600/20 border border-purple-500/25 text-foreground'
                  }`}
                >
                  {m.content ? (
                    <RoleplayMessageContent content={m.content} role="assistant" characterName={name} />
                  ) : (
                    <span className="flex gap-1 py-1" aria-label="Writing">
                      {[0, 1, 2].map((i) => (
                        <span
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-current opacity-40 animate-bounce"
                          style={{ animationDelay: `${i * 180}ms` }}
                        />
                      ))}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {status === 'done' && (
          <div className="text-center text-[11px] text-muted-foreground pt-2">Scene complete — {messages.length} lines.</div>
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
}
