'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Plus,
  Sparkles,
  Check,
  ArrowRight,
  Trash2,
  Pencil,
  Image as ImageIcon,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { CharacterAvatar } from '@/components/character-avatar';
import { toast } from 'sonner';
import type { Character, Persona } from '@/lib/supabase/types';
import { resolveLlmKey } from '@/lib/llm/credentials';

export interface PersonaModalProps {
  open: boolean;
  onClose: () => void;
  character?: Character | null;
  onSelectPersona: (persona: Persona) => void;
  currentPersonaId?: string | null;
  editingPersona?: Persona | null;
  initialMode?: 'list' | 'create';
}

const DEFAULT_PERSONAS: Persona[] = [
  {
    id: 'p-default-alexander',
    user_id: 'guest',
    name: 'Alexander Vance',
    avatar_url: null,
    description: 'A sharp, composed, yet deeply observant companion with an enigmatic past.',
    is_default: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export function PersonaModal({
  open,
  onClose,
  character,
  onSelectPersona,
  currentPersonaId,
  editingPersona,
  initialMode,
}: PersonaModalProps) {
  const [settings, updateSettings] = useSettings();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>(
    currentPersonaId || settings.activePersonaId || ''
  );
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [editingPersonaState, setEditingPersonaState] = useState<Persona | null>(null);

  // Persona Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load Personas (from DB + localStorage)
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
        const first = combined[0];
        if (first) {
          setSelectedPersonaId((prev) => prev || first.id);
        }
        return;
      }
    }

    // Guest fallback
    if (localList.length === 0) {
      localList = DEFAULT_PERSONAS;
      try {
        localStorage.setItem('cadenza_local_personas', JSON.stringify(DEFAULT_PERSONAS));
      } catch {}
    }
    setPersonas(localList);
    const firstLocal = localList[0];
    if (firstLocal) {
      setSelectedPersonaId((prev) => prev || firstLocal.id);
    }
  }, [supabase]);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      void loadPersonas();
      if (currentPersonaId) {
        setSelectedPersonaId(currentPersonaId);
      }
      if (editingPersona) {
        setEditingPersonaState(editingPersona);
        setName(editingPersona.name || '');
        setDescription(editingPersona.description || '');
        setAvatarUrl(editingPersona.avatar_url || '');
        setMode('create');
      } else if (initialMode) {
        setEditingPersonaState(null);
        setName('');
        setDescription('');
        setAvatarUrl('');
        setMode(initialMode);
      } else {
        setEditingPersonaState(null);
        setName('');
        setDescription('');
        setAvatarUrl('');
        setMode('list');
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [open, loadPersonas, currentPersonaId, editingPersona, initialMode]);

  // AI Persona Generation
  const handleGenerateAI = async () => {
    setAiLoading(true);
    try {
      const res = await fetch('/api/persona/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: aiPrompt.trim(),
          character: character
            ? {
                name: character.name,
                tagline: character.tagline,
                description: character.description,
                scenario: character.scenario,
                personality: character.personality,
                first_message: character.first_message,
                speech_style: character.speech_style,
                tags: character.tags,
                content_rating: character.content_rating,
              }
            : null,
          apiKey: await resolveLlmKey(settings),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to generate persona');
      }

      const generated = await res.json();
      if (generated.name) setName(generated.name);
      if (generated.description) setDescription(generated.description);
      if (generated.accent_color) setAccentColor(generated.accent_color);

      toast.success(`Generated persona "${generated.name}"!`);
    } catch (err) {
      toast.error((err instanceof Error ? err.message : '') || 'Generation error');
    } finally {
      setAiLoading(false);
    }
  };

  // Image Upload for Persona
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setAvatarUrl(event.target?.result as string);
      toast.success('Avatar loaded!');
    };
    reader.onerror = () => {
      toast.error('Could not read that image — please try another file');
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const handleStartEdit = (persona: Persona) => {
    setEditingPersonaState(persona);
    setName(persona.name || '');
    setDescription(persona.description || '');
    setAvatarUrl(persona.avatar_url || '');
    setMode('create');
  };

  // Save Persona
  const handleSavePersona = async () => {
    if (!name.trim()) {
      toast.error('Persona name is required');
      return;
    }

    setSaving(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;

      if (editingPersonaState) {
        const updatedPersona: Persona = {
          ...editingPersonaState,
          name: name.trim(),
          avatar_url: avatarUrl.trim() || null,
          description: description.trim(),
          updated_at: new Date().toISOString(),
        };

        // Local-only personas (guest, or created before sign-in) have ids like
        // `persona-…` and never reached the database.
        if (userId && !editingPersonaState.id.startsWith('persona-')) {
          const { error } = await supabase
            .from('personas')
            .update({
              name: updatedPersona.name,
              avatar_url: updatedPersona.avatar_url,
              description: updatedPersona.description,
              updated_at: updatedPersona.updated_at,
            })
            .eq('id', editingPersonaState.id);
          if (error) {
            toast.error('Couldn’t save your changes. Try again.');
            return;
          }
        }

        const updated = personas.map((p) => (p.id === editingPersonaState.id ? updatedPersona : p));
        try {
          localStorage.setItem('cadenza_local_personas', JSON.stringify(updated));
        } catch {}
        setPersonas(updated);
        // Editing is not choosing: only refresh the active persona if this was it.
        if (selectedPersonaId === updatedPersona.id) {
          onSelectPersona(updatedPersona);
        }

        setName('');
        setDescription('');
        setAvatarUrl('');
        setAiPrompt('');
        setEditingPersonaState(null);

        if (!initialMode || initialMode === 'list') {
          setMode('list');
        } else {
          onClose();
        }
        toast.success(`Persona "${updatedPersona.name}" updated!`);
        return;
      }

      const newPersona: Persona = {
        id: `persona-${Date.now()}`,
        user_id: userId || 'guest',
        name: name.trim(),
        avatar_url: avatarUrl.trim() || null,
        description: description.trim(),
        is_default: personas.length === 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (userId) {
        try {
          const { data, error } = await supabase
            .from('personas')
            .insert({
              user_id: userId,
              name: newPersona.name,
              avatar_url: newPersona.avatar_url,
              description: newPersona.description,
              is_default: newPersona.is_default,
            })
            .select()
            .single();

          if (!error && data) {
            newPersona.id = data.id;
          }
        } catch {}
      }

      const updated = [newPersona, ...personas.filter((p) => p.id !== newPersona.id)];
      try {
        localStorage.setItem('cadenza_local_personas', JSON.stringify(updated));
      } catch {}
      setPersonas(updated);

      setSelectedPersonaId(newPersona.id);
      updateSettings({ activePersonaId: newPersona.id });
      onSelectPersona(newPersona);

      setName('');
      setDescription('');
      setAvatarUrl('');
      setAiPrompt('');
      if (!initialMode || initialMode === 'list') {
        setMode('list');
      } else {
        onClose();
      }

      toast.success(`Persona "${newPersona.name}" created!`);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    if (mode === 'create' && (!initialMode || initialMode === 'list')) {
      setMode('list');
      setEditingPersonaState(null);
    } else {
      onClose();
    }
  };

  // Confirm selection and start chat
  const handleConfirmSelection = () => {
    const chosen = personas.find((p) => p.id === selectedPersonaId) || personas[0];
    if (!chosen) {
      toast.error('Please create or select a persona first');
      return;
    }

    updateSettings({ activePersonaId: chosen.id });
    onSelectPersona(chosen);
    onClose();
  };

  const handleDeletePersona = async (id: string, e: React.MouseEvent) => {
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
    if (selectedPersonaId === id && updated[0]) {
      setSelectedPersonaId(updated[0].id);
    }
    try {
      const { error } = await supabase.from('personas').delete().eq('id', id);
      if (error) {
        toast.warning('Persona removed locally, but the cloud copy could not be deleted');
      } else {
        toast.info('Persona deleted');
      }
    } catch {
      toast.warning('Persona removed locally, but the cloud copy could not be deleted');
    }
  };

  const isEditing = Boolean(editingPersonaState);
  const sheetTitle = mode === 'list' ? 'Choose your persona' : (isEditing ? 'Edit persona' : 'New persona');

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        title={sheetTitle}
        description={
          mode === 'list'
            ? (character ? `Roleplaying with ${character.name}` : 'Define who you play in this story')
            : undefined
        }
        size="tall"
        bodyClassName="px-4 sm:px-5 pb-5 space-y-4"
        footer={
          mode === 'list' ? (
            <div className="flex gap-2 w-full">
              <button
                type="button"
                onClick={onClose}
                className="btn btn-quiet flex-1 min-h-11"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmSelection}
                className="btn btn-primary flex-1 min-h-11"
              >
                <span>{character ? 'Start roleplay' : 'Use persona'}</span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <div className="flex gap-2 w-full">
              <button
                type="button"
                onClick={handleCancel}
                className="btn btn-quiet flex-1 min-h-11"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleGenerateAI}
                disabled={aiLoading}
                className="btn btn-ghost flex-1 min-h-11"
              >
                <Sparkles
                  className={`w-4 h-4 text-accent-text ${aiLoading ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                <span>{aiLoading ? 'Generating…' : 'Generate'}</span>
              </button>
              <button
                type="button"
                onClick={handleSavePersona}
                disabled={saving}
                className="btn btn-primary flex-1 min-h-11"
              >
                <Check className="w-4 h-4" aria-hidden="true" />
                <span>{saving ? 'Saving…' : (isEditing ? 'Save' : 'Save & select')}</span>
              </button>
            </div>
          )
        }
      >
        {mode === 'list' ? (
          /* LIST MODE */
          <div className="space-y-3">
            <div className="flex items-center justify-between pb-1">
              <span className="type-sec">Your personas ({personas.length})</span>
              <button
                type="button"
                onClick={() => {
                  setEditingPersonaState(null);
                  setName('');
                  setDescription('');
                  setAvatarUrl('');
                  setMode('create');
                }}
                className="btn btn-ghost min-h-11"
              >
                <Plus className="w-4 h-4 text-accent-text" aria-hidden="true" />
                <span>New persona</span>
              </button>
            </div>

            <div className="space-y-2">
              {personas.map((persona) => {
                const isSelected = selectedPersonaId === persona.id;

                return (
                  <div
                    key={persona.id}
                    className={`p-3.5 sm:p-4 rounded-xl border flex items-center justify-between gap-3 min-h-[64px] row-press transition-[border-color,background-color] duration-150 ${
                      isSelected ? 'border-accent-line bg-accent-wash' : 'border-line bg-surface'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedPersonaId(persona.id)}
                      aria-pressed={isSelected}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left py-1"
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
                          <span className="font-serif text-[0.95rem] font-medium text-ink truncate">
                            {persona.name}
                          </span>
                          {isSelected && <span className="chip chip-accent shrink-0">Selected</span>}
                        </div>
                        <p className="type-meta line-clamp-1 mt-0.5">
                          {persona.description || 'No background yet.'}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartEdit(persona);
                        }}
                        className="icon-btn min-h-11 min-w-11"
                        aria-label={`Edit ${persona.name}`}
                      >
                        <Pencil className="w-4 h-4" aria-hidden="true" />
                      </button>
                      {personas.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => handleDeletePersona(persona.id, e)}
                          className="icon-btn min-h-11 min-w-11 text-ink-3 hover:text-danger"
                          aria-label={`Delete ${persona.name}`}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      )}
                      <div
                        aria-hidden="true"
                        className={`w-6 h-6 rounded-full border flex items-center justify-center shrink-0 ${
                          isSelected ? 'border-accent-line bg-accent-wash' : 'border-line-strong'
                        }`}
                      >
                        {isSelected && <Check className="w-3.5 h-3.5 text-accent-text" aria-hidden="true" />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* CREATE / EDIT MODE */
          <div className="space-y-4">
            {/* AI Generator Box */}
            <div className="surface rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="type-sec flex items-center gap-1.5 text-sm sm:text-base">
                  <Sparkles className="w-4 h-4 text-accent-text" aria-hidden="true" />
                  Persona generator
                </span>
                {character && (
                  <span className="type-meta truncate">Matched to {character.name}</span>
                )}
              </div>

              <p className="type-meta leading-relaxed">
                Describe who you want to play — anything you specify is used exactly, and the
                rest is filled in to fit {character ? character.name : 'your story'}. Or leave it
                blank and let the generator draft a counterpart for this story.
              </p>

              <div className="space-y-2">
                <label htmlFor="persona-ai-idea" className="type-label block">
                  Your idea
                </label>
                <textarea
                  id="persona-ai-idea"
                  rows={4}
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="Describe your idea, e.g. a cynical detective with an old silver lighter…"
                  className="field w-full resize-y min-h-[96px] leading-relaxed"
                />
                <div className="flex items-center justify-between gap-2 pt-1">
                  <span className="type-meta">
                    {aiPrompt.length > 0 ? `${aiPrompt.length} characters` : 'Optional'}
                  </span>
                  <button
                    type="button"
                    onClick={handleGenerateAI}
                    disabled={aiLoading}
                    className="btn btn-ghost min-h-11 disabled:opacity-50"
                  >
                    <Sparkles
                      className={`w-4 h-4 text-accent-text ${aiLoading ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>{aiLoading ? 'Generating…' : 'Generate'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Persona Fields */}
            <div className="space-y-4 pt-1">
              {/* Avatar Preview & Actions */}
              <div className="space-y-1.5">
                <span className="type-label block">Avatar photo</span>
                <div className="flex flex-wrap items-center gap-4">
                  <div className="w-16 h-16 rounded-md overflow-hidden shrink-0 border border-line relative">
                    <CharacterAvatar
                      name={name || 'Persona'}
                      avatarUrl={avatarUrl}
                      accentColor={accentColor}
                      className="w-full h-full"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="btn btn-quiet min-h-11"
                    >
                      <ImageIcon className="w-4 h-4" aria-hidden="true" />
                      <span>Upload photo</span>
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      className="hidden"
                      aria-label="Upload persona photo"
                    />
                    {avatarUrl && (
                      <button
                        type="button"
                        onClick={() => setAvatarUrl('')}
                        className="btn btn-quiet text-danger min-h-11"
                      >
                        <span>Clear photo</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Persona Name */}
              <div className="space-y-1.5">
                <label htmlFor="persona-name" className="type-label block">
                  Persona name
                </label>
                <input
                  id="persona-name"
                  type="text"
                  placeholder="e.g. Alexander Vance"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="field w-full font-medium"
                  autoComplete="name"
                />
              </div>

              {/* Description / Backstory */}
              <div className="space-y-1.5">
                <label htmlFor="persona-backstory" className="type-label block">
                  Backstory and appearance
                </label>
                <textarea
                  id="persona-backstory"
                  rows={4}
                  placeholder="How they look, what they do, how they know this story…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="field w-full resize-y min-h-[96px] leading-relaxed"
                />
              </div>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
