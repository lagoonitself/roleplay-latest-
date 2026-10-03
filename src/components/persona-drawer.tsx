'use client';

import React, { useState, useEffect } from 'react';
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

  const loadPersonas = async () => {
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
  };

  useEffect(() => {
    if (open) {
      loadPersonas();
    }
  }, [open, supabase]);

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
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="absolute inset-0" onClick={onClose} />

        <div
          className="relative z-10 w-full max-w-lg bg-[#18181b] dark:bg-[#121214] text-zinc-100 rounded-t-[2.25rem] border-t border-white/[0.09] shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in slide-in-from-bottom duration-300 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Handle */}
          <div className="w-12 h-1.5 rounded-full bg-zinc-600/60 mx-auto mt-3 mb-2" />

          {/* Header */}
          <div className="px-5 py-3 flex items-center justify-between border-b border-white/[0.06]">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-purple-600/20 text-purple-400 flex items-center justify-center border border-purple-500/20">
                <User className="w-4 h-4" />
              </div>
              <div>
                <h3 className="font-bold text-base text-white tracking-tight">Your Personas & Profile</h3>
                <p className="text-xs text-zinc-400">Choose who you roleplay as in stories</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-full text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Active Persona Spotlight Card */}
            {activePersona && (
              <div className="p-4 rounded-2xl bg-purple-950/20 border border-purple-500/30 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold tracking-wider text-purple-400 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3" />
                    Currently Roleplaying As
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-purple-600 text-white font-bold text-[10px] flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Active
                  </span>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <div className="w-11 h-11 rounded-xl overflow-hidden bg-zinc-800 shrink-0 border border-white/10 relative">
                    <CharacterAvatar
                      name={activePersona.name}
                      avatarUrl={activePersona.avatar_url}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-sm text-white truncate">{activePersona.name}</h4>
                    <p className="text-xs text-zinc-300 line-clamp-1">{activePersona.description}</p>
                  </div>
                </div>
              </div>
            )}

            {/* All Personas List */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                  Available Personas ({personas.length})
                </span>
                <button
                  onClick={() => setCreateModalOpen(true)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-purple-400 hover:text-purple-300 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Persona
                </button>
              </div>

              <div className="space-y-2">
                {personas.map((persona) => {
                  const isActive = persona.id === activePersona?.id;

                  return (
                    <div
                      key={persona.id}
                      onClick={() => handleSetActive(persona)}
                      className={`group flex items-center justify-between p-3 rounded-2xl border cursor-pointer transition-all ${
                        isActive
                          ? 'bg-purple-900/15 border-purple-500/40 text-white shadow-xs'
                          : 'bg-zinc-800/40 hover:bg-zinc-800/70 border-white/[0.06] text-zinc-300'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0 pr-2">
                        <div className="w-10 h-10 rounded-xl overflow-hidden bg-zinc-800 shrink-0 border border-white/10 relative">
                          <CharacterAvatar
                            name={persona.name}
                            avatarUrl={persona.avatar_url}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="truncate">
                          <div className="font-semibold text-xs sm:text-sm text-white truncate flex items-center gap-1.5">
                            {persona.name}
                            {isActive && <Check className="w-3.5 h-3.5 text-purple-400 shrink-0" />}
                          </div>
                          <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                            {persona.description}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {personas.length > 1 && (
                          <button
                            onClick={(e) => handleDelete(e, persona.id, persona.name)}
                            className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Delete persona"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Quick App Settings Section */}
            <div className="space-y-2 pt-2 border-t border-white/[0.06]">
              <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider block">
                Preferences & Engine
              </span>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => {
                    onClose();
                    onOpenSettingsDialog();
                  }}
                  className="flex items-center gap-2.5 p-3 rounded-2xl bg-zinc-800/50 hover:bg-zinc-800 border border-white/[0.06] text-xs font-medium text-zinc-200 transition-colors text-left"
                >
                  <Settings className="w-4 h-4 text-purple-400 shrink-0" />
                  <span>AI Engine & API Keys</span>
                </button>

                <button
                  onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                  className="flex items-center gap-2.5 p-3 rounded-2xl bg-zinc-800/50 hover:bg-zinc-800 border border-white/[0.06] text-xs font-medium text-zinc-200 transition-colors text-left"
                >
                  {theme === 'dark' ? (
                    <>
                      <Sun className="w-4 h-4 text-amber-400 shrink-0" />
                      <span>Light Theme</span>
                    </>
                  ) : (
                    <>
                      <Moon className="w-4 h-4 text-purple-400 shrink-0" />
                      <span>Dark Theme</span>
                    </>
                  )}
                </button>
              </div>

              <Link
                href="/lorebooks"
                onClick={onClose}
                className="w-full flex items-center justify-between p-3 rounded-2xl bg-zinc-800/30 hover:bg-zinc-800/60 border border-white/[0.04] text-xs text-zinc-300 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <BookOpen className="w-4 h-4 text-blue-400" />
                  <span>World Lorebooks & Knowledge</span>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-zinc-500" />
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
