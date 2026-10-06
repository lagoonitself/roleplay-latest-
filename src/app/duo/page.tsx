'use client';

import React, { useEffect, useState } from 'react';
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
