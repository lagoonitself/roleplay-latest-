'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Search, Check, Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { CharacterAvatar } from '@/components/character-avatar';
import { DUO_DEFAULT_DELAY_MS, DUO_DEFAULT_MAX_TURNS, DUO_MAX_TURNS_CAP, type AgentKind, type DuoSide } from '@/lib/duo/types';
import { toast } from 'sonner';
import type { Character, Persona } from '@/lib/supabase/types';

interface Pick {
  kind: AgentKind;
  id: string;
  name: string;
  avatar_url: string | null;
  sub: string;
}

async function getAuthHeaders(supabase: ReturnType<typeof createClient>): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers['Authorization'] = `Bearer ${token}`;
  } catch {}
  return headers;
}

export default function DuoNewPage() {
  const router = useRouter();
  const supabase = createClient();
  const [settings] = useSettings();
  const [characters, setCharacters] = useState<Character[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'all' | 'characters' | 'personas'>('all');
  const [slot, setSlot] = useState<DuoSide>('a');
  const [pickA, setPickA] = useState<Pick | null>(null);
  const [pickB, setPickB] = useState<Pick | null>(null);
  const [seed, setSeed] = useState('');
  const [firstSpeaker, setFirstSpeaker] = useState<DuoSide>('a');
  const [maxTurns, setMaxTurns] = useState(DUO_DEFAULT_MAX_TURNS);
  const [delayMs, setDelayMs] = useState(DUO_DEFAULT_DELAY_MS);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth.user?.id;
      let chars: Character[] = [];
      let pers: Persona[] = [];
      try {
        chars = JSON.parse(localStorage.getItem('cadenza_local_characters') || '[]');
      } catch {}
      try {
        const localPers: Persona[] = JSON.parse(localStorage.getItem('cadenza_local_personas') || '[]');
        pers = localPers;
      } catch {}
      if (userId) {
        const [{ data: dbChars }, { data: dbPers }] = await Promise.all([
          supabase.from('characters').select('*').order('updated_at', { ascending: false }).limit(200),
          supabase.from('personas').select('*').order('created_at', { ascending: false }).limit(100),
        ]);
        if (dbChars) {
          const seen = new Set(chars.map((c) => c.id));
          for (const c of dbChars as Character[]) {
            if (!seen.has(c.id)) chars.push(c);
          }
        }
        if (dbPers) {
          const seen = new Set(pers.map((p) => p.id));
          for (const p of dbPers as Persona[]) {
            if (!seen.has(p.id)) pers.push(p);
          }
        }
      }
      setCharacters(chars);
      setPersonas(pers);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options: Pick[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: Pick[] = [];
    if (tab !== 'personas') {
      for (const c of characters) {
        if (q && !`${c.name} ${c.tagline} ${c.description}`.toLowerCase().includes(q)) continue;
        out.push({ kind: 'character', id: c.id, name: c.name, avatar_url: c.avatar_url, sub: c.tagline || 'Character' });
      }
    }
    if (tab !== 'characters') {
      for (const p of personas) {
        if (q && !`${p.name} ${p.description}`.toLowerCase().includes(q)) continue;
        out.push({ kind: 'persona', id: p.id, name: p.name, avatar_url: p.avatar_url, sub: 'Persona' });
      }
    }
    return out.slice(0, 120);
  }, [characters, personas, query, tab]);

  const choose = (opt: Pick) => {
    if (slot === 'a') {
      if (pickB && pickB.kind === opt.kind && pickB.id === opt.id) {
        toast.error('Pick two different people.');
        return;
      }
      setPickA(opt);
      setSlot('b');
    } else {
      if (pickA && pickA.kind === opt.kind && pickA.id === opt.id) {
        toast.error('Pick two different people.');
        return;
      }
      setPickB(opt);
    }
  };

  const canStart = pickA && pickB && !starting;

  const start = async () => {
    if (!pickA || !pickB) {
      toast.error('Pick both people first.');
      return;
    }
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      toast.error('Sign in to run a scene — it lives on the server.');
      return;
    }
    setStarting(true);
    try {
      const headers = await getAuthHeaders(supabase);
      if (settings.opencodeApiKey) headers['x-llm-key'] = settings.opencodeApiKey;
      const res = await fetch('/api/duo', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'start',
          agents: {
            a: { kind: pickA.kind, id: pickA.id },
            b: { kind: pickB.kind, id: pickB.id },
          },
          seed,
          firstSpeaker,
          maxTurns: Math.min(DUO_MAX_TURNS_CAP, Math.max(2, maxTurns)),
          turnDelayMs: Math.min(6000, Math.max(0, delayMs)),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || 'Could not start.');
      router.push(`/duo/${json.chatId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start.');
      setStarting(false);
    }
  };

  const slotCard = (side: DuoSide, pick: Pick | null) => (
    <button
      onClick={() => setSlot(side)}
      className={`flex-1 rounded-2xl border p-3 text-left transition-all apple-button ${
        slot === side
          ? 'border-purple-500/50 bg-purple-500/[0.08]'
          : 'border-white/[0.08] bg-zinc-900/50 hover:border-white/[0.16]'
      }`}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">
        {side === 'a' ? 'First voice' : 'Second voice'}
      </div>
      {pick ? (
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0">
            <CharacterAvatar name={pick.name} avatarUrl={pick.avatar_url} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{pick.name}</div>
            <div className="text-[11px] text-muted-foreground truncate capitalize">{pick.kind}</div>
          </div>
          <Check className="w-4 h-4 text-emerald-400 ml-auto shrink-0" />
        </div>
      ) : (
        <div className="text-xs text-muted-foreground py-2">
          {slot === side ? 'Tap someone below…' : 'Not picked yet'}
        </div>
      )}
    </button>
  );

  return (
    <div className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-5 pb-24">
      <div className="flex items-center gap-3">
        <Link
          href="/duo"
          className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Back to scenes"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight">New scene</h1>
          <p className="text-xs text-muted-foreground">Two people. One situation. No script.</p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        {slotCard('a', pickA)}
        <div className="hidden sm:flex items-center text-[11px] font-bold text-muted-foreground px-1">×</div>
        {slotCard('b', pickB)}
      </div>

      <div className="rounded-3xl border border-white/[0.06] bg-zinc-900/40 p-4 space-y-3">
        <label className="block">
          <span className="text-xs font-semibold">Situation <span className="text-muted-foreground font-normal">(optional — sets the scene)</span></span>
          <textarea
            value={seed}
            onChange={(e) => setSeed(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="A rooftop at midnight, rain just stopped. They haven't seen each other in years…"
            className="mt-1.5 w-full rounded-2xl bg-black/30 border border-white/[0.08] px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 resize-none"
          />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs font-semibold">Who speaks first</span>
            <div className="mt-1.5 flex rounded-full bg-black/30 border border-white/[0.08] p-1 text-xs font-semibold">
              {(['a', 'b'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFirstSpeaker(s)}
                  className={`flex-1 px-3 py-1.5 rounded-full transition-colors apple-button truncate ${
                    firstSpeaker === s ? 'bg-purple-600 text-white' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {(s === 'a' ? pickA?.name : pickB?.name) || (s === 'a' ? 'First' : 'Second')}
                </button>
              ))}
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-semibold">Length · {maxTurns} lines</span>
            <input
              type="range"
              min={4}
              max={DUO_MAX_TURNS_CAP}
              value={maxTurns}
              onChange={(e) => setMaxTurns(Number(e.target.value))}
              className="mt-3 w-full accent-purple-500"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold">Pace · {(delayMs / 1000).toFixed(1)}s</span>
            <input
              type="range"
              min={0}
              max={6000}
              step={400}
              value={delayMs}
              onChange={(e) => setDelayMs(Number(e.target.value))}
              className="mt-3 w-full accent-purple-500"
            />
          </label>
        </div>
        <button
          onClick={start}
          disabled={!canStart}
          className="w-full py-2.5 rounded-full bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold apple-button flex items-center justify-center gap-2 shadow-md shadow-purple-600/20"
        >
          {starting && <Loader2 className="w-4 h-4 animate-spin" />}
          {starting ? 'Opening the scene…' : 'Start the scene'}
        </button>
      </div>

      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your roster…"
              className="w-full pl-9 pr-4 py-2.5 rounded-2xl bg-zinc-800/40 border border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40"
            />
          </div>
          <div className="flex rounded-full bg-zinc-800/50 border border-white/[0.08] p-1 text-xs font-semibold">
            {(['all', 'characters', 'personas'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3.5 py-1.5 rounded-full capitalize transition-colors apple-button ${
                  tab === t ? 'bg-purple-600 text-white' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {options.map((opt) => {
            const active =
              (slot === 'a' ? pickA : pickB)?.id === opt.id &&
              (slot === 'a' ? pickA : pickB)?.kind === opt.kind;
            const taken =
              (slot === 'a' ? pickB : pickA)?.id === opt.id &&
              (slot === 'a' ? pickB : pickA)?.kind === opt.kind;
            return (
              <button
                key={`${opt.kind}-${opt.id}`}
                onClick={() => choose(opt)}
                disabled={taken}
                className={`flex items-center gap-2.5 p-2.5 rounded-2xl border text-left transition-all apple-button ${
                  active
                    ? 'border-purple-500/60 bg-purple-500/[0.1]'
                    : taken
                      ? 'border-white/[0.04] bg-zinc-900/30 opacity-40'
                      : 'border-white/[0.06] bg-zinc-900/40 hover:border-purple-500/30'
                }`}
              >
                <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0">
                  <CharacterAvatar name={opt.name} avatarUrl={opt.avatar_url} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate">{opt.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate capitalize">
                    {opt.kind} · {opt.sub}
                  </div>
                </div>
                {active && <Check className="w-4 h-4 text-emerald-400 shrink-0" />}
              </button>
            );
          })}
        </div>
        {options.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-8">
            Nothing matches. Create characters or personas first, then come back.
          </p>
        )}
      </div>
    </div>
  );
}
