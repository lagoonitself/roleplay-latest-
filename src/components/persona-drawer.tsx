'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Plus,
  Check,
  Trash2,
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
import { Sheet } from '@/components/ui/sheet';
import { toast } from 'sonner';
import type { Persona } from '@/lib/supabase/types';

interface PersonaDrawerProps {
  open: boolean;
  onClose: () => void;
  onOpenSettingsDialog: () => void;
}

export function PersonaDrawer({ open, onClose, onOpenSettingsDialog }: PersonaDrawerProps) {
  const [settings, updateSettings] = useSettings();
  const { resolvedTheme, setTheme } = useTheme();
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
      <Sheet
        open={open}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        title="Your personas"
        description="Choose who you play in your stories"
        bodyClassName="px-5 pb-5 space-y-5"
      >
        {/* Active Persona Spotlight Card */}
        {activePersona && (
          <div className="rounded-lg border border-accent-line bg-accent-wash p-4 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="type-sec flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-ink-3" aria-hidden="true" />
                Currently roleplaying as
              </span>
              <span className="chip-accent chip">
                <Check className="w-3 h-3" aria-hidden="true" />
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
                <p className="type-meta line-clamp-2">{activePersona.description}</p>
              </div>
            </div>
          </div>
        )}

        {/* All Personas List */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="type-sec">All personas ({personas.length})</span>
            <button
              type="button"
              onClick={() => setCreateModalOpen(true)}
              className="btn btn-quiet min-h-11 px-3"
            >
              <Plus className="w-3.5 h-3.5 text-accent-text" aria-hidden="true" />
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
                    className="row-press flex min-w-0 min-h-11 flex-1 cursor-pointer items-center gap-3 pr-2 text-left"
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
                        {isActive && <Check className="w-3.5 h-3.5 text-accent-text shrink-0" aria-hidden="true" />}
                      </div>
                      <p className="type-meta line-clamp-2 mt-0.5">{persona.description}</p>
                    </div>
                  </button>

                  <div className="flex items-center gap-1 shrink-0">
                    {personas.length > 1 && (
                      <button
                        type="button"
                        onClick={(e) => handleDelete(e, persona.id, persona.name)}
                        className="icon-btn min-h-11 min-w-11"
                        aria-label={`Delete ${persona.name}`}
                      >
                        <Trash2 className="w-4 h-4 text-ink-3 hover:text-danger" aria-hidden="true" />
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
              type="button"
              onClick={() => {
                onClose();
                onOpenSettingsDialog();
              }}
              className="surface row-press min-h-11 rounded-lg flex items-center gap-2.5 p-3 text-xs font-medium text-ink-2 text-left"
            >
              <Settings className="w-4 h-4 text-ink-3 shrink-0" aria-hidden="true" />
              <span>Engine and keys</span>
            </button>

            <button
              type="button"
              onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
              className="surface row-press min-h-11 rounded-lg flex items-center gap-2.5 p-3 text-xs font-medium text-ink-2 text-left"
              aria-label={resolvedTheme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {resolvedTheme === 'dark' ? (
                <>
                  <Sun className="w-4 h-4 text-ink-2 shrink-0" aria-hidden="true" />
                  <span>Light theme</span>
                </>
              ) : (
                <>
                  <Moon className="w-4 h-4 text-ink-2 shrink-0" aria-hidden="true" />
                  <span>Dark theme</span>
                </>
              )}
            </button>
          </div>

          <Link
            href="/lorebooks"
            onClick={onClose}
            className="surface row-press min-h-11 rounded-lg w-full flex items-center justify-between p-3 text-xs text-ink-2"
          >
            <div className="flex items-center gap-2.5">
              <BookOpen className="w-4 h-4 text-ink-3" aria-hidden="true" />
              <span>World lorebooks</span>
            </div>
            <ExternalLink className="w-3.5 h-3.5 text-ink-3" aria-hidden="true" />
          </Link>
        </div>
      </Sheet>

      {/* Modal to create or AI-generate new persona */}
      <div className="relative z-[60]">
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
    </>
  );
}
