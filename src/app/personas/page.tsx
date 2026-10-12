'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Trash2, Pencil } from 'lucide-react';
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
  const [editingPersona, setEditingPersona] = useState<Persona | null>(null);

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
    try {
      const { error } = await supabase.from('personas').delete().eq('id', id);
      if (error) {
        toast.warning('Persona removed locally, but the cloud copy could not be deleted');
        return;
      }
    } catch {
      toast.warning('Persona removed locally, but the cloud copy could not be deleted');
      return;
    }
    toast.info('Persona removed');
  };

  const handleOpenCreate = () => {
    setEditingPersona(null);
    setModalOpen(true);
  };

  const handleOpenEdit = (persona: Persona) => {
    setEditingPersona(persona);
    setModalOpen(true);
  };

  return (
    <div className="flex-1 max-w-2xl w-full mx-auto px-4 sm:px-6 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+2rem)] space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-line">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="icon-btn min-h-11 min-w-11 shrink-0"
            aria-label="Back to explore"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden="true" />
          </Link>
          <div className="min-w-0">
            <h1 className="type-page">Your personas</h1>
            <p className="type-meta mt-0.5 truncate">
              Define who you play across different scenarios and worlds
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleOpenCreate}
          className="btn btn-primary w-full sm:w-auto min-h-11 flex items-center justify-center gap-1.5 shrink-0"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          <span>New persona</span>
        </button>
      </div>

      {/* Personas list: iOS list style */}
      {personas.length === 0 ? (
        <div className="surface rounded-xl p-8 text-center space-y-3">
          <p className="type-sec">No personas yet</p>
          <p className="type-meta">Create your first persona to start roleplaying.</p>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="btn btn-primary min-h-11"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>New persona</span>
          </button>
        </div>
      ) : (
        <div className="surface rounded-xl divide-y divide-line overflow-hidden">
          {personas.map((persona) => {
            const isActive =
              settings.activePersonaId === persona.id ||
              (!settings.activePersonaId && persona.is_default);

            return (
              <div
                key={persona.id}
                className={`flex items-center justify-between gap-3 p-3.5 sm:p-4 min-h-[64px] row-press transition-[background-color] duration-150 ${
                  isActive ? 'bg-accent-wash/30' : ''
                }`}
              >
                {/* Tappable row body to set active */}
                <button
                  type="button"
                  onClick={() => handleSetActive(persona)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer"
                  aria-label={isActive ? `${persona.name} (active persona)` : `Set ${persona.name} as active persona`}
                  aria-pressed={isActive}
                >
                  <div className="w-11 h-11 rounded-lg overflow-hidden shrink-0 border border-line">
                    <CharacterAvatar
                      name={persona.name}
                      avatarUrl={persona.avatar_url}
                      className="w-full h-full"
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <h2 className="font-serif text-base font-medium text-ink truncate">
                        {persona.name}
                      </h2>
                      {isActive ? (
                        <span className="chip chip-accent shrink-0">
                          Active
                        </span>
                      ) : persona.is_default ? (
                        <span className="chip shrink-0">
                          Default
                        </span>
                      ) : null}
                    </div>
                    <p className="type-meta line-clamp-2 mt-0.5">
                      {persona.description || 'No background description yet.'}
                    </p>
                  </div>
                </button>

                {/* Edit and Delete actions: always visible, >=44px touch targets */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleOpenEdit(persona)}
                    className="icon-btn min-h-11 min-w-11"
                    aria-label={`Edit ${persona.name}`}
                  >
                    <Pencil className="w-4 h-4" aria-hidden="true" />
                  </button>

                  {personas.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDelete(persona.id)}
                      className="icon-btn min-h-11 min-w-11 text-ink-3 hover:text-danger"
                      aria-label={`Delete ${persona.name}`}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Persona Sheet */}
      <PersonaModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingPersona(null);
        }}
        editingPersona={editingPersona}
        initialMode="create"
        onSelectPersona={(p) => {
          handleSetActive(p);
          void loadPersonas();
        }}
      />
    </div>
  );
}
