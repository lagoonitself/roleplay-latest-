'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { CharacterAvatar } from '@/components/character-avatar';
import { parseDuo } from '@/lib/duo/types';
import { toast } from 'sonner';
import type { Chat } from '@/lib/supabase/types';

function statusChip(status: string | undefined): string {
  if (status === 'running') return 'chip-ok chip';
  if (status === 'paused') return 'chip-warn chip';
  if (status === 'error') return 'chip-danger chip';
  return 'chip';
}

function statusLabel(chat: Chat): string {
  const duo = parseDuo(chat.settings);
  if (!duo) return 'Scene';
  if (duo.status === 'running') return `Live, ${duo.turn} of ${duo.maxTurns}`;
  if (duo.status === 'paused') return `Paused, ${duo.turn} of ${duo.maxTurns}`;
  if (duo.status === 'done') return `Done, ${duo.turn} lines`;
  if (duo.status === 'error') return 'Needs attention';
  return 'Stopped';
}

export default function DuoListPage() {
  const supabase = createClient();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);

  const loadSeqRef = useRef(0);
  const firstLoadDoneRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshPendingRef = useRef(false);

  // Monotonic sequence: a slow response can never overwrite newer state.
  const load = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    if (!firstLoadDoneRef.current) setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (seq !== loadSeqRef.current) return;
      if (!auth.user) {
        setChats([]);
        return;
      }
      // mode column may not exist on older DBs — fall back to settings scan.
      let rows: Chat[] = [];
      const attempt = await supabase
        .from('chats')
        .select('*')
        .eq('mode', 'duo')
        .order('last_message_at', { ascending: false })
        .limit(60);
      if (!attempt.error && attempt.data) {
        rows = attempt.data as Chat[];
      } else {
        if (seq !== loadSeqRef.current) return;
        const fallback = await supabase
          .from('chats')
          .select('*')
          .order('last_message_at', { ascending: false })
          .limit(120);
        rows = ((fallback.data || []) as Chat[]).filter((c) => parseDuo(c.settings));
      }
      if (seq !== loadSeqRef.current) return;
      setChats(rows);
    } catch (e) {
      console.error(e);
    } finally {
      // Only the freshest load settles the loading state.
      if (seq === loadSeqRef.current) {
        firstLoadDoneRef.current = true;
        setLoading(false);
      }
    }
  }, [supabase]);

  // Duo runs write chats.settings on every step — coalesce realtime bursts
  // into one trailing refresh instead of refetching per event.
  const scheduleLoad = useCallback(() => {
    if (typeof document !== 'undefined' && document.hidden) {
      refreshPendingRef.current = true;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      void load();
    }, 600);
  }, [load]);

  const loadNow = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    void load();
  }, [load]);

  useEffect(() => {
    // Data fetch on mount — the standard pattern used across this app.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNow();
    const channel = supabase
      .channel('duo-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, () => scheduleLoad())
      .subscribe();

    // Refresh skipped while the tab was hidden, now that it is visible again.
    const handleVisibility = () => {
      if (!document.hidden && refreshPendingRef.current) {
        refreshPendingRef.current = false;
        loadNow();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      refreshPendingRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (id: string) => {
    if (!window.confirm('Delete this scene and its transcript?')) return;
    try {
      const { error } = await supabase.from('chats').delete().eq('id', id);
      if (error) {
        toast.error('Could not delete the scene — please try again');
        return;
      }
      toast.success('Scene deleted');
      loadNow();
    } catch {
      toast.error('Could not delete the scene — please try again');
    }
  };

  return (
    <div className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6 pb-[calc(env(safe-area-inset-bottom,0px)+6rem)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link href="/" className="icon-btn shrink-0" aria-label="Back home">
            <ArrowLeft className="w-5 h-5" aria-hidden />
          </Link>
          <div className="min-w-0">
            <h1 className="type-page">Duo scenes</h1>
            <p className="type-meta">Two of your people, talking on their own. You watch.</p>
          </div>
        </div>
        <Link href="/duo/new" className="btn btn-primary shrink-0">
          <Plus className="w-3.5 h-3.5" aria-hidden />
          New scene
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4" aria-label="Loading scenes">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-36 rounded-xl bg-sunken animate-pulse" aria-hidden />
          ))}
        </div>
      ) : chats.length === 0 ? (
        <div className="surface rounded-xl p-10 text-center space-y-3">
          <h2 className="type-page">No scenes yet</h2>
          <p className="type-meta max-w-sm mx-auto">
            Pick any two characters or personas, give them a situation, and they start talking. It
            keeps going even if you close the page. Pause or resume whenever you like.
          </p>
          <Link href="/duo/new" className="btn btn-primary inline-flex">
            Start your first scene
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {chats.map((chat) => {
            const duo = parseDuo(chat.settings);
            return (
              <div key={chat.id} className="surface rounded-xl overflow-hidden">
                <Link href={`/duo/${chat.id}`} className="block p-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex -space-x-2 shrink-0">
                      {(['a', 'b'] as const).map((side) => {
                        const face = duo?.faces?.[side];
                        return (
                          <div
                            key={side}
                            className="w-10 h-10 rounded-md overflow-hidden border border-line bg-background ring-2 ring-background"
                          >
                            <CharacterAvatar name={face?.name || '?'} avatarUrl={face?.avatar_url || null} />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-serif text-[0.95rem] font-medium text-ink truncate">
                        {chat.title || 'Untitled scene'}
                      </div>
                      <div className="type-meta truncate">
                        {duo ? `${duo.faces.a.name} and ${duo.faces.b.name}` : ''}
                      </div>
                    </div>
                    <span className={statusChip(duo?.status)}>{statusLabel(chat)}</span>
                  </div>
                  {duo?.seed && <p className="mt-3 type-meta line-clamp-2">{duo.seed}</p>}
                </Link>
                <div className="px-4 pb-3 flex items-center justify-between gap-2">
                  <span className="type-meta truncate">
                    {chat.last_message_at ? new Date(chat.last_message_at).toLocaleString() : ''}
                  </span>
                  <button
                    onClick={() => remove(chat.id)}
                    className="icon-btn"
                    aria-label={`Delete ${chat.title || 'scene'}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
