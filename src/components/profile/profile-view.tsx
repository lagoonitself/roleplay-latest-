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
  LogOut,
  RefreshCw,
  FlaskConical,
  ChevronRight,
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
  const { resolvedTheme, setTheme } = useTheme();
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
    const t = setTimeout(() => {
      loadPersonas();
    }, 0);
    return () => clearTimeout(t);
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
    <div className="mx-auto w-full max-w-3xl space-y-5 px-4 pt-3 pb-6 sm:px-6 sm:pt-4 sm:pb-8">
      {/* Account section — iOS Settings style */}
      <section className="space-y-2" aria-label="Account">
        <h3 className="type-sec px-1">Account</h3>
        <div className="surface rounded-xl divide-y divide-line overflow-hidden">
          <div className="flex items-center justify-between gap-3 p-4 sm:p-5">
            <div className="flex min-w-0 items-center gap-3.5">
              <div
                className="flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-sunken font-serif text-lg text-ink"
                style={{ width: 52, height: 52 }}
              >
                {user?.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.avatar} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span>{(user?.name || 'G').slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <div className="min-w-0">
                <h2 className="type-page truncate font-serif text-lg sm:text-xl">
                  {user?.name || 'Guest explorer'}
                </h2>
                <p className="type-meta truncate">
                  {user?.email || 'Chats and usage saved on this device'}
                </p>
                <p className="type-meta mt-0.5 truncate">
                  {personas.length} {personas.length === 1 ? 'persona' : 'personas'} in your roster
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={refreshing}
              className="icon-btn min-h-11 min-w-11 shrink-0 border border-line disabled:opacity-50"
              title="Refresh profile and usage"
              aria-label="Refresh profile and usage"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 p-3 sm:p-4">
            {user ? (
              <button
                type="button"
                onClick={handleSignOut}
                className="btn btn-danger min-h-11 w-full sm:w-auto inline-flex items-center justify-center gap-1.5"
              >
                <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                Sign out
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSignIn}
                className="btn btn-ghost min-h-11 w-full sm:w-auto inline-flex items-center justify-center"
              >
                Sign in with Google
              </button>
            )}
            <button
              type="button"
              onClick={onOpenSettingsDialog}
              className="btn btn-ghost min-h-11 w-full sm:w-auto inline-flex items-center justify-center gap-1.5"
            >
              <Settings className="h-3.5 w-3.5 text-ink-3" aria-hidden="true" />
              AI engine and keys
            </button>
          </div>
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
        <section className="space-y-2" aria-label="Active persona">
          <h3 className="type-sec px-1">Active persona</h3>
          <div className="rounded-xl border border-accent-line bg-accent-wash p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="type-label">Roleplaying as</span>
              <span className="chip chip-accent inline-flex items-center gap-1">
                <Check className="h-3 w-3" aria-hidden="true" />
                Active
              </span>
            </div>
            <div className="flex items-center gap-3 pt-2.5">
              <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-line">
                <CharacterAvatar
                  name={activePersona.name}
                  avatarUrl={activePersona.avatar_url}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0">
                <h4 className="truncate font-serif text-base font-medium text-ink">{activePersona.name}</h4>
                <p className="type-meta line-clamp-1 truncate">{activePersona.description}</p>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Persona roster */}
      <section className="space-y-2" aria-label="Persona roster">
        <div className="flex items-center justify-between px-1">
          <h3 className="type-sec">
            Persona roster ({personas.length})
          </h3>
          <button
            type="button"
            onClick={() => setCreateModalOpen(true)}
            className="btn btn-quiet min-h-11 inline-flex items-center gap-1 px-2.5 text-xs text-ink"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Add persona
          </button>
        </div>

        <div className="surface rounded-xl divide-y divide-line overflow-hidden">
          {personas.map((persona) => {
            const isActive = persona.id === activePersona?.id;
            return (
              <div
                key={persona.id}
                className={`flex items-center gap-2 px-3 sm:px-4 py-2 min-h-[52px] ${
                  isActive ? 'border-l-2 border-accent-line bg-accent-wash/30' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleSetActive(persona)}
                  className="row-press flex min-w-0 flex-1 items-center gap-3 py-1 text-left rounded-lg transition-colors"
                  aria-pressed={isActive}
                >
                  <span className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-line">
                    <CharacterAvatar
                      name={persona.name}
                      avatarUrl={persona.avatar_url}
                      className="h-full w-full object-cover"
                    />
                  </span>
                  <span className="truncate min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate font-serif text-sm font-medium text-ink">
                      <span className="truncate">{persona.name}</span>
                      {isActive && (
                        <span className="chip chip-accent shrink-0">Active</span>
                      )}
                    </span>
                    <span className="type-meta mt-0.5 block truncate">{persona.description}</span>
                  </span>
                </button>
                {personas.length > 1 && (
                  <button
                    type="button"
                    onClick={(e) => handleDelete(e, persona.id, persona.name)}
                    className="icon-btn min-h-11 min-w-11 shrink-0 text-ink-3 hover:text-danger"
                    title={`Delete ${persona.name}`}
                    aria-label={`Delete ${persona.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Preferences */}
      <section className="space-y-2" aria-label="Preferences">
        <h3 className="type-sec px-1">Preferences</h3>
        <div className="surface rounded-xl divide-y divide-line overflow-hidden">
          <button
            type="button"
            onClick={onOpenSettingsDialog}
            className="row-press flex min-h-[52px] w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="flex items-center gap-3 min-w-0 truncate">
              <User className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
              <span className="type-sec truncate">AI engine and API keys</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
            className="row-press flex min-h-[52px] w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="flex items-center gap-3 min-w-0 truncate">
              {resolvedTheme === 'dark' ? (
                <Sun className="h-4 w-4 shrink-0 text-ink-2" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4 shrink-0 text-ink-2" aria-hidden="true" />
              )}
              <span className="type-sec truncate">
                {resolvedTheme === 'dark' ? 'Light theme' : 'Dark theme'}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
          </button>
          <Link
            href="/lorebooks"
            className="row-press flex min-h-[52px] w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="flex items-center gap-3 min-w-0 truncate">
              <BookOpen className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
              <span className="type-sec truncate">World lorebooks and knowledge</span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
          </Link>
          <Link
            href="/logs"
            className="row-press flex min-h-[52px] w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="flex items-center gap-3 min-w-0 truncate">
              <FlaskConical className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
              <span className="type-sec truncate">Model logs</span>
              <span className="chip chip-warn shrink-0">
                Dev
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-3" aria-hidden="true" />
          </Link>
        </div>
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
