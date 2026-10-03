'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Check, Trash2, User, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { CharacterAvatar } from '@/components/character-avatar';
import { PersonaModal } from '@/components/persona-modal';
import { toast } from 'sonner';
import type { Persona } from '@/lib/supabase/types';

export default function PersonasPage() {
  const [settings, updateSettings] = useSettings();
  const supabase = createClient();

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [modalOpen, setModalOpen] = useState(false);

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
    loadPersonas();
  }, [supabase]);

  const handleSetActive = (persona: Persona) => {
    updateSettings({ activePersonaId: persona.id });
    toast.success(`Active persona set to "${persona.name}"`);
  };

  const handleDelete = async (id: string) => {
    const updated = personas.filter((p) => p.id !== id);
    setPersonas(updated);
    try {
      localStorage.setItem('cadenza_local_personas', JSON.stringify(updated));
    } catch {}
    await supabase.from('personas').delete().eq('id', id);
    toast.info('Persona removed');
  };

  return (
    <div className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-black/[0.06] dark:border-white/[0.08]">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">Your Personas</h1>
            <p className="text-xs text-muted-foreground">
              Define who you play across different scenarios and worlds
            </p>
          </div>
        </div>

        <button
          onClick={() => setModalOpen(true)}
          className="px-4 py-2 rounded-full bg-accent text-white hover:bg-accent-hover text-xs font-semibold apple-button flex items-center justify-center gap-1.5 shadow-sm self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Persona</span>
        </button>
      </div>

      {/* Personas List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {personas.map((persona) => {
          const isActive =
            settings.activePersonaId === persona.id ||
            (!settings.activePersonaId && persona.is_default);

          return (
            <div
              key={persona.id}
              className={`p-5 rounded-3xl glass-card border transition-all space-y-4 ${
                isActive
                  ? 'border-accent/40 bg-accent/[0.02] shadow-sm'
                  : 'border-black/[0.06] dark:border-white/[0.08]'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-2xl overflow-hidden shrink-0 border border-white/10 shadow-xs">
                    <CharacterAvatar
                      name={persona.name}
                      avatarUrl={persona.avatar_url}
                      className="w-full h-full"
                    />
                  </div>

                  <div className="min-w-0">
                    <h3 className="font-semibold text-sm tracking-tight flex items-center gap-1.5 truncate">
                      {persona.name}
                      {isActive && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent text-white font-bold shrink-0">
                          Active
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {persona.description || 'No background description provided.'}
                    </p>
                  </div>
                </div>

                {personas.length > 1 && (
                  <button
                    onClick={() => handleDelete(persona.id)}
                    className="p-1.5 text-muted-foreground hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-colors shrink-0"
                    title="Delete persona"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="pt-3 flex items-center justify-between border-t border-black/[0.04] dark:border-white/[0.06]">
                <span className="text-[11px] text-muted-foreground">
                  {isActive ? 'Current active persona in chats' : 'Ready to use'}
                </span>
                {!isActive && (
                  <button
                    onClick={() => handleSetActive(persona)}
                    className="px-3 py-1 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-xs font-medium apple-button"
                  >
                    Set as Active
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Universal Persona Modal with DeepSeek AI Generator */}
      <PersonaModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSelectPersona={(p) => {
          handleSetActive(p);
          loadPersonas();
        }}
      />
    </div>
  );
}
