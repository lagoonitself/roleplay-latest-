'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  X,
  Plus,
  Check,
  Trash2,
  User,
  Sparkles,
  Settings,
  Sun,
  Moon,
  ExternalLink,
  BookOpen,
} from 'lucide-react';
import { useSettings } from '@/lib/store/settings';
import { useTheme } from 'next-themes';
import { createClient } from '@/lib/supabase/client';
import { CharacterAvatar } from '@/components/character-avatar';
import { PersonaModal } from '@/components/persona-modal';
import { toast } from 'sonner';
import type { Persona } from '@/lib/supabase/types';

interface PersonaDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenSettingsDialog: () => void;
}

export function PersonaDrawer({ open, onClose, onOpenSettingsDialog }: PersonaDrawerProps) {
  const [settings, updateSettings] = useSettings();
  const { theme, setTheme } = useTheme();
  const supabase = createClient();

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const loadPersonas = useCallback(async () => {
    let localList: Persona[] = [];
    try {
      localList = JSON.parse(localStorage.getItem('cadenza_local_personas') || '[]');
    } catch {}

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;

    if (userId) {
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
  }, [supabase]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      void loadPersonas();
    }, 0);
    return () => clearTimeout(timer);
  }, [open, loadPersonas]);

  if (!open) return null;

  const handleSetActive = (persona: Persona) => {
    updateSettings({ activePersonaId: persona.id });
    toast.success(`Active persona set to "${persona.name}"`);
  };

  const handleDelete = async (e: React.MouseEvent, id: string, name: string) => {
    e.stopPropagation();
    if (personas.length <= 1) {
      toast.error('You need at least one persona.');
      return;
    }
    const updated = personas.filter((p) => p.id !== id);
    setPersonas(updated);
    try {
      localStorage.setItem('cadenza_local_personas', JSON.stringify(updated));
    } catch {}
    await supabase.from('personas').delete().eq('id', id);
    if (settings.activePersonaId === id) {
      updateSettings({ activePersonaId: updated[0].id });
    }
    toast.info(`Removed "${name}"`);
  };

  const activePersona =
    personas.find((p) => p.id === settings.activePersonaId) ||
    personas.find((p) => p.is_default) ||
    personas[0];

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
      >
        <div className="absolute inset-0" onClick={onClose} />

        <div
          role="dialog"
          aria-modal="true"
          aria-label="Your personas"
          onClick={(e) => e.stopPropagation()}
          className="panel relative z-10 w-full max-w-lg rounded-t-3xl sm:rounded-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in slide-in-from-bottom duration-200 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]"
        >
          {/* Handle */}
          <div className="w-8 h-1 rounded-full bg-line-strong mx-auto mt-3 mb-2" aria-hidden />

          {/* Header */}
          <div className="px-5 py-3 flex items-center justify-between border-b border-line">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-md bg-sunken border border-line flex items-center justify-center shrink-0">
                <User className="w-4 h-4 text-ink-3" aria-hidden />
              </div>
              <div className="min-w-0">
                <h3 className="type-page text-base">Your personas</h3>
                <p className="type-meta truncate">Choose who you play in your stories</p>
              </div>
            </div>
            <button onClick={onClose} className="icon-btn shrink-0" aria-label="Close personas">
              <X className="w-5 h-5" aria-hidden />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Active Persona Spotlight Card */}
            {activePersona && (
              <div className="rounded-lg border border-accent-line bg-accent-wash p-4 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="type-sec flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-ink-3" aria-hidden />
                    Currently roleplaying as
                  </span>
                  <span className="chip-accent chip">
                    <Check className="w-3 h-3" aria-hidden />
                    Active
                  </span>
                </div>
                <div className="flex items-center gap-3 pt-1 min-w-0">
                  <div className="w-11 h-11 rounded-md overflow-hidden bg-sunken shrink-0 border border-line relative">
                    <CharacterAvatar
                      name={activePersona.name}
                      avatarUrl={activePersona.avatar_url}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-serif text-[0.95rem] font-medium text-ink truncate">
                      {activePersona.name}
                    </h4>
                    <p className="type-meta line-clamp-1">{activePersona.description}</p>
                  </div>
                </div>
              </div>
            )}

            {/* All Personas List */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="type-sec">All personas ({personas.length})</span>
                <button onClick={() => setCreateModalOpen(true)} className="btn btn-quiet">
                  <Plus className="w-3.5 h-3.5 text-accent-text" aria-hidden />
                  Add persona
                </button>
              </div>

              <div className="surface rounded-lg divide-y divide-line overflow-hidden">
                {personas.map((persona) => {
                  const isActive = persona.id === activePersona?.id;

                  return (
                    <div
                      key={persona.id}
                      className={`group flex items-center justify-between gap-2 p-3 transition-[background-color] duration-150 ${
                        isActive ? 'bg-accent-wash' : ''
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleSetActive(persona)}
                        aria-pressed={isActive}
                        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 pr-2 text-left"
                      >
                        <div className="w-10 h-10 rounded-md overflow-hidden bg-sunken shrink-0 border border-line relative">
                          <CharacterAvatar
                            name={persona.name}
                            avatarUrl={persona.avatar_url}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="font-serif text-[0.9rem] font-medium text-ink truncate flex items-center gap-1.5">
                            {persona.name}
                            {isActive && <Check className="w-3.5 h-3.5 text-accent-text shrink-0" aria-hidden />}
                          </div>
                          <p className="type-meta truncate mt-0.5">{persona.description}</p>
                        </div>
                      </button>

                      <div className="flex items-center gap-1 shrink-0">
                        {personas.length > 1 && (
                          <button
                            onClick={(e) => handleDelete(e, persona.id, persona.name)}
                            className="icon-btn"
                            aria-label={`Delete ${persona.name}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick App Settings Section */}
            <div className="space-y-2 pt-3 border-t border-line">
              <span className="type-sec block">Preferences</span>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    onClose();
                    onOpenSettingsDialog();
                  }}
                  className="surface rounded-lg flex items-center gap-2.5 p-3 text-xs font-medium text-ink-2 text-left"
                >
                  <Settings className="w-4 h-4 text-ink-3 shrink-0" aria-hidden />
                  <span>Engine and keys</span>
                </button>

                <button
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="surface rounded-lg flex items-center gap-2.5 p-3 text-xs font-medium text-ink-2 text-left"
                  aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                >
                  {theme === 'dark' ? (
                    <>
                      <Sun className="w-4 h-4 text-ink-2 shrink-0" aria-hidden />
                      <span>Light theme</span>
                    </>
                  ) : (
                    <>
                      <Moon className="w-4 h-4 text-ink-2 shrink-0" aria-hidden />
                      <span>Dark theme</span>
                    </>
                  )}
                </button>
              </div>

              <Link
                href="/lorebooks"
                onClick={onClose}
                className="surface rounded-lg w-full flex items-center justify-between p-3 text-xs text-ink-2"
              >
                <div className="flex items-center gap-2.5">
                  <BookOpen className="w-4 h-4 text-ink-3" aria-hidden />
                  <span>World lorebooks</span>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-ink-3" aria-hidden />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Modal to create or AI-generate new persona */}
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
    </>
  );
}
