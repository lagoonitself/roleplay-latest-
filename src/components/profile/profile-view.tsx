'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  User,
  Plus,
  Check,
  Trash2,
  Settings,
  Sun,
  Moon,
  BookOpen,
  ExternalLink,
  LogOut,
  RefreshCw,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { CharacterAvatar } from '@/components/character-avatar';
import { PersonaModal } from '@/components/persona-modal';
import { TokenHud } from './token-hud';
import { useTokenUsage } from '@/lib/usage/use-token-usage';
import { toast } from 'sonner';
import type { Persona } from '@/lib/supabase/types';

interface ProfileViewProps {
  onOpenSettingsDialog: () => void;
}

/**
 * Feature 2 — dedicated full Profile section (not a popup).
 * Account details + persona roster + Token Usage HUD (raw counts only).
 */
export function ProfileView({ onOpenSettingsDialog }: ProfileViewProps) {
  const supabase = createClient();
  const [settings, updateSettings] = useSettings();
  const { theme, setTheme } = useTheme();
  const usage = useTokenUsage();

  const [user, setUser] = useState<{ email?: string; name?: string; avatar?: string } | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      if (!u) {
        setUser(null);
        return;
      }
      setUser({
        email: u.email || undefined,
        name:
          (u.user_metadata?.full_name as string) ||
          (u.user_metadata?.name as string) ||
          (u.email ? u.email.split('@')[0] : 'Roleplayer'),
        avatar: (u.user_metadata?.avatar_url as string) || undefined,
      });
    });
  }, [supabase]);

  const loadPersonas = async () => {
    let localList: Persona[] = [];
    try {
      localList = JSON.parse(localStorage.getItem('cadenza_local_personas') || '[]');
    } catch {}

    const { data: authData } = await supabase.auth.getUser();
    if (authData.user?.id) {
      const { data: dbPersonas } = await supabase
        .from('personas')
        .select('*')
        .order('created_at', { ascending: false });
      if (dbPersonas && dbPersonas.length > 0) {
        const combined = [...(dbPersonas as Persona[])];
        const dbIds = new Set(combined.map((p) => p.id));
        for (const lp of localList) {
          if (!dbIds.has(lp.id)) combined.push(lp);
        }
        setPersonas(combined);
        return;
      }
    }

    if (localList.length === 0) {
      localList = [
        {
          id: 'persona-default-alexander',
          user_id: 'guest',
          name: 'Alexander Vance',
          avatar_url: null,
          description: 'A sharp, composed, yet deeply observant companion navigating the unfolding story.',
          is_default: true,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      try {
        localStorage.setItem('cadenza_local_personas', JSON.stringify(localList));
      } catch {}
    }
    setPersonas(localList);
  };

  useEffect(() => {
    loadPersonas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist a snapshot of totals onto the user's profile row so counts
  // survive in the database profile (authoritative ledger stays in usage_events).
  useEffect(() => {
    if (usage.loading || (usage.input === 0 && usage.output === 0)) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: authData } = await supabase.auth.getUser();
        const uid = authData.user?.id;
        if (!uid || cancelled) return;
        const { data: existing } = await supabase
          .from('profiles')
          .select('settings')
          .eq('id', uid)
          .maybeSingle();
        const prevSettings =
          existing && typeof existing.settings === 'object' && existing.settings !== null
            ? (existing.settings as Record<string, unknown>)
            : {};
        await supabase.from('profiles').upsert(
          {
            id: uid,
            settings: {
              ...prevSettings,
              token_usage: {
                input: usage.input,
                output: usage.output,
                total: usage.total,
                updatedAt: new Date().toISOString(),
              },
            },
          },
          { onConflict: 'id' }
        );
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usage.input, usage.output, usage.loading]);

  const activePersona =
    personas.find((p) => p.id === settings.activePersonaId) ||
    personas.find((p) => p.is_default) ||
    personas[0];

  const handleSetActive = (persona: Persona) => {
    updateSettings({ activePersonaId: persona.id });
    toast.success(`Roleplaying as "${persona.name}"`);
  };

  const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (personas.length <= 1) {
      toast.error('Keep at least one persona.');
      return;
    }
    const updated = personas.filter((p) => p.id !== id);
    setPersonas(updated);
    try {
      localStorage.setItem('cadenza_local_personas', JSON.stringify(updated));
    } catch {}
    await supabase.from('personas').delete().eq('id', id);
    if (settings.activePersonaId === id && updated[0]) {
      updateSettings({ activePersonaId: updated[0].id });
    }
    toast.info(`Removed "${name}"`);
  };

  const handleSignIn = async () => {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) toast.error('Sign-in failed: ' + error.message);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    toast.info('Signed out — usage stays on this device');
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await usage.refresh();
    await loadPersonas();
    setRefreshing(false);
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 pb-28 pt-4 sm:px-6 sm:pt-6">
      {/* Account header */}
      <section className="overflow-hidden rounded-3xl border border-white/[0.08] bg-[#151518]/90 p-5 shadow-xl shadow-black/30">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-zinc-800 text-lg font-bold text-white">
              {user?.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatar} alt="" className="h-full w-full object-cover" />
              ) : (
                <span>{(user?.name || 'G').slice(0, 1).toUpperCase()}</span>
              )}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-base font-bold tracking-tight text-white">
                {user?.name || 'Guest explorer'}
              </h2>
              <p className="truncate text-xs text-zinc-400">
                {user?.email || 'Chats and usage saved on this device'}
              </p>
              <p className="mt-1 text-[11px] text-zinc-500">
                {personas.length} {personas.length === 1 ? 'persona' : 'personas'} in your roster
              </p>
            </div>
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="apple-button rounded-full border border-white/10 p-2 text-zinc-400 hover:text-white disabled:opacity-50"
            title="Refresh profile and usage"
            aria-label="Refresh profile and usage"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {user ? (
            <button
              onClick={handleSignOut}
              className="apple-button inline-flex items-center gap-1.5 rounded-full bg-red-500/10 px-3.5 py-1.5 text-xs font-medium text-red-400 hover:bg-red-500/20"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign out
            </button>
          ) : (
            <button
              onClick={handleSignIn}
              className="apple-button rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:opacity-90"
            >
              Sign in with Google
            </button>
          )}
          <button
            onClick={onOpenSettingsDialog}
            className="apple-button inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-xs font-medium text-zinc-200 hover:bg-white/[0.08]"
          >
            <Settings className="h-3.5 w-3.5 text-purple-400" />
            AI engine & keys
          </button>
        </div>
      </section>

      {/* Token Usage HUD — raw counts only */}
      <TokenHud
        input={usage.input}
        output={usage.output}
        total={usage.total}
        loading={usage.loading}
        syncedWithAccount={usage.syncedWithAccount}
      />

      {/* Active persona spotlight */}
      {activePersona && (
        <section className="rounded-3xl border border-purple-500/30 bg-purple-950/20 p-4">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-purple-300">
              Currently roleplaying as
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-bold text-white">
              <Check className="h-3 w-3" />
              Active
            </span>
          </div>
          <div className="flex items-center gap-3 pt-2.5">
            <div className="h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-zinc-800">
              <CharacterAvatar
                name={activePersona.name}
                avatarUrl={activePersona.avatar_url}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-white">{activePersona.name}</h3>
              <p className="line-clamp-1 text-xs text-zinc-300">{activePersona.description}</p>
            </div>
          </div>
        </section>
      )}

      {/* Persona roster */}
      <section className="space-y-2.5">
        <div className="flex items-center justify-between px-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
            Persona roster ({personas.length})
          </h3>
          <button
            onClick={() => setCreateModalOpen(true)}
            className="apple-button inline-flex items-center gap-1 text-xs font-semibold text-purple-400 hover:text-purple-300"
          >
            <Plus className="h-3.5 w-3.5" />
            Add persona
          </button>
        </div>

        <div className="space-y-2">
          {personas.map((persona) => {
            const isActive = persona.id === activePersona?.id;
            return (
              <div
                key={persona.id}
                onClick={() => handleSetActive(persona)}
                className={`group flex cursor-pointer items-center justify-between rounded-2xl border p-3 transition-all apple-button ${
                  isActive
                    ? 'border-purple-500/40 bg-purple-900/15 text-white'
                    : 'border-white/[0.06] bg-zinc-800/40 text-zinc-300 hover:bg-zinc-800/70'
                }`}
              >
                <div className="flex min-w-0 items-center gap-3 pr-2">
                  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-zinc-800">
                    <CharacterAvatar
                      name={persona.name}
                      avatarUrl={persona.avatar_url}
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="truncate">
                    <div className="flex items-center gap-1.5 truncate text-xs font-semibold text-white sm:text-sm">
                      <span className="truncate">{persona.name}</span>
                      {isActive && <Check className="h-3.5 w-3.5 shrink-0 text-purple-400" />}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-zinc-400">{persona.description}</p>
                  </div>
                </div>
                {personas.length > 1 && (
                  <button
                    onClick={(e) => handleDelete(e, persona.id, persona.name)}
                    className="shrink-0 rounded-lg p-1.5 text-zinc-500 transition-colors hover:bg-red-500/10 hover:text-red-400"
                    title={`Delete ${persona.name}`}
                    aria-label={`Delete ${persona.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Preferences */}
      <section className="space-y-2 border-t border-white/[0.06] pt-4">
        <h3 className="px-1 text-xs font-bold uppercase tracking-wider text-zinc-400">Preferences</h3>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onOpenSettingsDialog}
            className="flex items-center gap-2.5 rounded-2xl border border-white/[0.06] bg-zinc-800/50 p-3 text-left text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 apple-button"
          >
            <User className="h-4 w-4 shrink-0 text-purple-400" />
            <span>AI engine & API keys</span>
          </button>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="flex items-center gap-2.5 rounded-2xl border border-white/[0.06] bg-zinc-800/50 p-3 text-left text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 apple-button"
          >
            {theme === 'dark' ? (
              <>
                <Sun className="h-4 w-4 shrink-0 text-amber-400" />
                <span>Light theme</span>
              </>
            ) : (
              <>
                <Moon className="h-4 w-4 shrink-0 text-purple-400" />
                <span>Dark theme</span>
              </>
            )}
          </button>
        </div>
        <Link
          href="/lorebooks"
          className="flex w-full items-center justify-between rounded-2xl border border-white/[0.04] bg-zinc-800/30 p-3 text-xs text-zinc-300 transition-colors hover:bg-zinc-800/60"
        >
          <div className="flex items-center gap-2.5">
            <BookOpen className="h-4 w-4 text-blue-400" />
            <span>World lorebooks & knowledge</span>
          </div>
          <ExternalLink className="h-3.5 w-3.5 text-zinc-500" />
        </Link>
      </section>

      <PersonaModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        onSelectPersona={(newP) => {
          loadPersonas();
          updateSettings({ activePersonaId: newP.id });
          setCreateModalOpen(false);
          toast.success(`Created persona "${newP.name}"`);
        }}
      />
    </div>
  );
}
