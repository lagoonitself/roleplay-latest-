'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeft, Plus, Check, Trash2, Edit2, User, Sparkles } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { toast } from 'sonner';
import type { Persona } from '@/lib/supabase/types';

export default function PersonasPage() {
  const [settings, updateSettings] = useSettings();
  const supabase = createClient();

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    async function loadPersonas() {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData.user) {
        // Fallback default local persona
        setPersonas([
          {
            id: 'persona-default',
            user_id: 'local',
            name: 'User',
            avatar_url: null,
            description: 'A curious and adaptable traveler exploring new stories.',
            is_default: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]);
        return;
      }

      const { data } = await supabase
        .from('personas')
        .select('*')
        .order('created_at', { ascending: false });

      if (data && data.length > 0) {
        setPersonas(data as Persona[]);
      } else {
        // Create an initial persona
        const initPersona = {
          user_id: authData.user.id,
          name: authData.user.user_metadata?.full_name || 'User',
          avatar_url: authData.user.user_metadata?.avatar_url || null,
          description: 'A thoughtful adventurer.',
          is_default: true,
        };
        const { data: created } = await supabase
          .from('personas')
          .insert(initPersona)
          .select()
          .single();
        if (created) setPersonas([created as Persona]);
      }
    }

    loadPersonas();
  }, [supabase]);

  const handleCreatePersona = async () => {
    if (!name.trim()) {
      toast.error('Persona name is required');
      return;
    }

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;

    const newObj: Persona = {
      id: 'p-' + Date.now(),
      user_id: userId || 'local',
      name: name.trim(),
      description: description.trim(),
      avatar_url: avatarUrl.trim() || null,
      is_default: personas.length === 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (userId) {
      const { data, error } = await supabase
        .from('personas')
        .insert({
          user_id: userId,
          name: newObj.name,
          description: newObj.description,
          avatar_url: newObj.avatar_url,
          is_default: newObj.is_default,
        })
        .select()
        .single();

      if (!error && data) {
        setPersonas([data as Persona, ...personas]);
      }
    } else {
      setPersonas([newObj, ...personas]);
    }

    setName('');
    setDescription('');
    setAvatarUrl('');
    setModalOpen(false);
    toast.success(`Persona "${newObj.name}" created!`);
  };

  const handleSetActive = (persona: Persona) => {
    updateSettings({ activePersonaId: persona.id });
    toast.success(`Active persona set to "${persona.name}"`);
  };

  const handleDelete = async (id: string) => {
    setPersonas(personas.filter((p) => p.id !== id));
    await supabase.from('personas').delete().eq('id', id);
    toast.info('Persona removed');
  };

  return (
    <div className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-black/[0.06] dark:border-white/[0.08]">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="p-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
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
          className="px-4 py-2 rounded-full bg-accent text-white hover:bg-accent-hover text-xs font-semibold apple-button flex items-center gap-1.5 shadow-sm"
        >
          <Plus className="w-3.5 h-3.5" />
          New Persona
        </button>
      </div>

      {/* Personas List */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {personas.map((persona) => {
          const isActive = settings.activePersonaId === persona.id || (!settings.activePersonaId && persona.is_default);

          return (
            <div
              key={persona.id}
              className={`p-5 rounded-3xl glass-card border transition-all ${
                isActive
                  ? 'border-accent/40 bg-accent/[0.02]'
                  : 'border-black/[0.06] dark:border-white/[0.08]'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-black/10 overflow-hidden flex items-center justify-center shrink-0 border border-white/10">
                    {persona.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={persona.avatar_url}
                        alt={persona.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="w-6 h-6 text-muted-foreground" />
                    )}
                  </div>

                  <div>
                    <h3 className="font-semibold text-sm tracking-tight flex items-center gap-1.5">
                      {persona.name}
                      {isActive && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent text-white font-bold">
                          Active
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {persona.description || 'No background description provided.'}
                    </p>
                  </div>
                </div>

                <button
                  onClick={() => handleDelete(persona.id)}
                  className="p-1.5 text-muted-foreground hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="pt-4 flex items-center justify-end gap-2 border-t border-black/[0.04] dark:border-white/[0.06] mt-4">
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

      {/* Create Persona Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md glass-panel rounded-3xl p-6 space-y-4 shadow-2xl border border-white/10">
            <h2 className="text-lg font-bold tracking-tight">Create User Persona</h2>

            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Persona Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Detective Miller"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Description & Traits
                </label>
                <textarea
                  rows={3}
                  placeholder="Physical appearance, occupation, background, relationship to world..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full p-3 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Avatar Image URL
                </label>
                <input
                  type="url"
                  placeholder="https://..."
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-xs font-medium rounded-full hover:bg-black/5 dark:hover:bg-white/10 apple-button"
              >
                Cancel
              </button>
              <button
                onClick={handleCreatePersona}
                className="px-5 py-2 text-xs font-semibold rounded-full bg-accent text-white apple-button shadow-sm"
              >
                Create Persona
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
