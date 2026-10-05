'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Play, Pause, Check, AlertTriangle, Trash2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { CharacterAvatar } from '@/components/character-avatar';
import { parseDuo } from '@/lib/duo/types';
import { toast } from 'sonner';
import type { Chat } from '@/lib/supabase/types';

function statusLabel(chat: Chat): string {
  const duo = parseDuo(chat.settings);
  if (!duo) return 'Scene';
  if (duo.status === 'running') return `Live · ${duo.turn}/${duo.maxTurns}`;
  if (duo.status === 'paused') return `Paused · ${duo.turn}/${duo.maxTurns}`;
  if (duo.status === 'done') return `Done · ${duo.turn} lines`;
  if (duo.status === 'error') return 'Needs attention';
  return 'Stopped';
}

export default function DuoListPage() {
  const supabase = createClient();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        setChats([]);
        setLoading(false);
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
        const fallback = await supabase
          .from('chats')
          .select('*')
          .order('last_message_at', { ascending: false })
          .limit(120);
        rows = ((fallback.data || []) as Chat[]).filter((c) => parseDuo(c.settings));
      }
      setChats(rows);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Data fetch on mount — the standard pattern used across this app.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const channel = supabase
      .channel('duo-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chats' }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remove = async (id: string) => {
    if (!window.confirm('Delete this scene and its transcript?')) return;
    await supabase.from('chats').delete().eq('id', id);
    toast.success('Scene deleted');
    load();
  };

  return (
    <div className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6 pb-24">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Back home"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Duo scenes</h1>
            <p className="text-xs text-muted-foreground">Two of your people, talking on their own. You watch.</p>
          </div>
        </div>
        <Link
          href="/duo/new"
          className="px-4 py-2 rounded-full bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold apple-button flex items-center gap-1.5 shadow-md shadow-purple-600/20"
        >
          <Plus className="w-3.5 h-3.5" />
          New scene
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-36 rounded-3xl bg-zinc-900/30 border border-white/[0.06] animate-pulse" />
          ))}
        </div>
      ) : chats.length === 0 ? (
        <div className="rounded-3xl border border-white/[0.06] bg-zinc-900/40 p-10 text-center space-y-3">
          <h2 className="font-semibold">No scenes yet</h2>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto">
            Pick any two characters or personas, give them a situation, and they start talking. It keeps
            going even if you close the page — pause or resume whenever you like.
          </p>
          <Link
            href="/duo/new"
            className="inline-flex px-5 py-2 rounded-full bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold apple-button"
          >
            Start your first scene
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {chats.map((chat) => {
            const duo = parseDuo(chat.settings);
            return (
              <div
                key={chat.id}
                className="rounded-3xl overflow-hidden bg-zinc-900/40 border border-white/[0.06] hover:border-purple-500/30 transition-colors"
              >
                <Link href={`/duo/${chat.id}`} className="block p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex -space-x-2">
                      {(['a', 'b'] as const).map((side) => {
                        const face = duo?.faces?.[side];
                        return (
                          <div key={side} className="w-11 h-11 rounded-2xl overflow-hidden ring-2 ring-zinc-900">
                            <CharacterAvatar name={face?.name || '?'} avatarUrl={face?.avatar_url || null} />
                          </div>
                        );
                      })}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">{chat.title || 'Untitled scene'}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {duo ? `${duo.faces.a.name} · ${duo.faces.b.name}` : ''}
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-1 rounded-full bg-white/[0.06] text-zinc-300 whitespace-nowrap flex items-center gap-1">
                      {duo?.status === 'running' && <Play className="w-3 h-3 text-emerald-400" />}
                      {duo?.status === 'paused' && <Pause className="w-3 h-3 text-amber-400" />}
                      {duo?.status === 'done' && <Check className="w-3 h-3 text-zinc-400" />}
                      {duo?.status === 'error' && <AlertTriangle className="w-3 h-3 text-red-400" />}
                      {statusLabel(chat)}
                    </span>
                  </div>
                  {duo?.seed && <p className="mt-3 text-xs text-muted-foreground line-clamp-2">{duo.seed}</p>}
                </Link>
                <div className="px-4 pb-3 flex items-center justify-between text-[11px] text-zinc-500">
                  <span>{new Date(chat.last_message_at).toLocaleString()}</span>
                  <button
                    onClick={() => remove(chat.id)}
                    className="p-1.5 rounded-full hover:bg-red-500/20 hover:text-red-400 transition-colors"
                    aria-label="Delete scene"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
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
