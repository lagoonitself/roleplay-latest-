'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
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
    const timer = setTimeout(() => {
      void loadPersonas();
    }, 0);
    return () => clearTimeout(timer);
  }, [loadPersonas]);

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
    <div className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="icon-btn"
            aria-label="Back to explore"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden />
          </Link>
          <div>
            <h1 className="type-page">Your personas</h1>
            <p className="type-meta mt-0.5">
              Define who you play across different scenarios and worlds
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="btn btn-primary flex items-center justify-center gap-1.5 self-start sm:self-auto"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden />
          <span>New persona</span>
        </button>
      </div>

      {/* Personas list */}
      <div className="surface rounded-xl divide-y divide-line overflow-hidden">
        {personas.map((persona) => {
          const isActive =
            settings.activePersonaId === persona.id ||
            (!settings.activePersonaId && persona.is_default);

          return (
            <div
              key={persona.id}
              className={isActive ? 'border-l-2 border-accent-line p-4 sm:p-5' : 'p-4 sm:p-5'}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0 border border-line" style={{ width: 48, height: 48 }}>
                    <CharacterAvatar
                      name={persona.name}
                      avatarUrl={persona.avatar_url}
                      className="w-full h-full"
                    />
                  </div>

                  <div className="min-w-0">
                    <h3 className="font-serif text-base font-medium text-ink flex items-center gap-1.5 truncate">
                      <span className="truncate">{persona.name}</span>
                      {isActive && (
                        <span className="chip chip-accent shrink-0">
                          Active
                        </span>
                      )}
                    </h3>
                    <p className="type-meta line-clamp-2 mt-0.5">
                      {persona.description || 'No background description yet.'}
                    </p>
                  </div>
                </div>

                {personas.length > 1 && (
                  <button
                    type="button"
                    onClick={() => handleDelete(persona.id)}
                    className="icon-btn shrink-0"
                    aria-label={`Delete ${persona.name}`}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden />
                  </button>
                )}
              </div>

              <div className="pt-3 flex items-center justify-between gap-3">
                <span className="type-meta">
                  {isActive ? 'Current active persona in chats' : 'Ready to use'}
                </span>
                {!isActive && (
                  <button
                    type="button"
                    onClick={() => handleSetActive(persona)}
                    className="btn btn-quiet"
                  >
                    Set as active
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
