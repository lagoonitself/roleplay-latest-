'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Plus,
  Sparkles,
  Check,
  ArrowRight,
  Trash2,
  ChevronLeft,
  Image as ImageIcon,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { CharacterAvatar } from '@/components/character-avatar';
import { toast } from 'sonner';
import type { Character, Persona } from '@/lib/supabase/types';
import { resolveLlmKey } from '@/lib/llm/credentials';

interface PersonaModalProps {
  open: boolean;
  onClose: () => void;
  character?: Character | null;
  onSelectPersona: (persona: Persona) => void;
  currentPersonaId?: string | null;
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
}: PersonaModalProps) {
  const [settings, updateSettings] = useSettings();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>(
    currentPersonaId || settings.activePersonaId || ''
  );
  const [mode, setMode] = useState<'list' | 'create'>('list');

  // New Persona Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [accentColor, setAccentColor] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

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
      setMode('list');
    }, 0);
    return () => clearTimeout(timer);
  }, [open, loadPersonas]);

  // Escape closes regardless of where focus is — a dialog's own onKeyDown only
  // fires while focus is inside it.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // AI Persona Generation
  const handleGenerateAI = async () => {
    setAiLoading(true);
    try {
      const res = await fetch('/api/persona/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: aiPrompt.trim(),
          // Full partner context so the persona fits the actual world, tone, and
          // opening scene it will chat in (and never contradicts the character).
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

  // Save Persona
  const handleSavePersona = async () => {
    if (!name.trim()) {
      toast.error('Persona name is required');
      return;
    }

    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;

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

    // Persist to local storage. The state update must not be lost when the
    // write throws (e.g. quota exceeded on a big avatar) — keep the two apart.
    const updated = [newPersona, ...personas.filter((p) => p.id !== newPersona.id)];
    try {
      localStorage.setItem('cadenza_local_personas', JSON.stringify(updated));
    } catch {}
    setPersonas(updated);

    setSelectedPersonaId(newPersona.id);
    updateSettings({ activePersonaId: newPersona.id });

    // Reset form
    setName('');
    setDescription('');
    setAvatarUrl('');
    setAiPrompt('');
    setMode('list');

    toast.success(`Persona "${newPersona.name}" created!`);
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
    // Also drop the cloud row — otherwise the persona resurrects on reload.
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

  if (!open) return null;

  const chosenName = personas.find((p) => p.id === selectedPersonaId)?.name || 'Default';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-background/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      {/* Mobile Bottom Sheet / Desktop Modal Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'list' ? 'Choose your persona' : 'Create a persona'}
        onClick={(e) => e.stopPropagation()}
        className="panel w-full sm:max-w-xl max-h-[92dvh] sm:max-h-[85dvh] flex flex-col rounded-t-3xl sm:rounded-2xl overflow-hidden animate-in slide-in-from-bottom duration-200"
      >
        {/* Mobile Grab Bar */}
        <div className="sm:hidden flex justify-center pt-3 pb-1" aria-hidden>
          <div className="w-8 h-1 rounded-full bg-line-strong" />
        </div>

        {/* Modal Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-line flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {mode === 'create' && (
              <button onClick={() => setMode('list')} className="icon-btn" aria-label="Back to personas">
                <ChevronLeft className="w-5 h-5" aria-hidden />
              </button>
            )}
            <div className="min-w-0">
              <h2 className="type-page text-lg">{mode === 'list' ? 'Choose your persona' : 'Create a persona'}</h2>
              <p className="type-meta truncate">
                {character ? `Roleplaying with ${character.name}` : 'Define who you play in this story'}
              </p>
            </div>
          </div>

          <button onClick={onClose} className="icon-btn shrink-0" aria-label="Close personas">
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {mode === 'list' ? (
            /* LIST MODE */
            <div className="space-y-2">
              <div className="flex items-center justify-between pb-1">
                <span className="type-sec">Your personas ({personas.length})</span>
                <button onClick={() => setMode('create')} className="btn btn-ghost">
                  <Plus className="w-3.5 h-3.5 text-accent-text" aria-hidden />
                  New persona
                </button>
              </div>

              {personas.map((persona) => {
                const isSelected = selectedPersonaId === persona.id;

                return (
                  <div
                    key={persona.id}
                    className={`p-3.5 sm:p-4 rounded-lg border flex items-center justify-between gap-3 transition-[border-color,background-color] duration-150 ${
                      isSelected ? 'border-accent-line bg-accent-wash' : 'border-line'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedPersonaId(persona.id)}
                      aria-pressed={isSelected}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                    >
                      <div className="w-11 h-11 rounded-md overflow-hidden shrink-0 border border-line">
                        <CharacterAvatar
                          name={persona.name}
                          avatarUrl={persona.avatar_url}
                          className="w-full h-full"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-serif text-[0.95rem] font-medium text-ink truncate">
                            {persona.name}
                          </span>
                          {isSelected && <span className="chip-accent chip">Selected</span>}
                        </div>
                        <p className="type-meta line-clamp-1 mt-0.5">
                          {persona.description || 'No background yet.'}
                        </p>
                      </div>
                    </button>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {personas.length > 1 && (
                        <button
                          onClick={(e) => handleDeletePersona(persona.id, e)}
                          className="icon-btn"
                          aria-label={`Delete ${persona.name}`}
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden />
                        </button>
                      )}
                      <div
                        aria-hidden
                        className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                          isSelected ? 'border-accent-line bg-accent-wash' : 'border-line-strong'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-accent-text" aria-hidden />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* CREATE MODE */
            <div className="space-y-4 animate-in fade-in duration-150">
              {/* AI Generator Box */}
              <div className="surface rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="type-sec flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-accent-text" aria-hidden />
                    Persona generator
                  </span>
                  {character && <span className="type-meta">Matched to {character.name}</span>}
                </div>

                <p className="type-meta leading-relaxed">
                  Describe who you want to play — anything you specify is used exactly, and the
                  rest is filled in to fit {character ? character.name : 'your story'}. Or leave it
                  blank and let the generator draft a counterpart for this story.
                </p>

                <div className="space-y-2">
                  <label htmlFor="persona-ai-idea" className="type-label">
                    Your idea
                  </label>
                  <textarea
                    id="persona-ai-idea"
                    rows={3}
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Describe your idea, e.g. a cynical detective with an old silver lighter…"
                    className="field resize-y min-h-[76px] max-h-[180px] text-xs leading-relaxed"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="type-meta">
                      {aiPrompt.length > 0 ? `${aiPrompt.length} characters` : 'Optional'}
                    </span>
                    <button
                      type="button"
                      onClick={handleGenerateAI}
                      disabled={aiLoading}
                      className="btn btn-ghost disabled:opacity-50"
                    >
                      <Sparkles
                        className={`w-3.5 h-3.5 text-accent-text ${aiLoading ? 'animate-spin' : ''}`}
                        aria-hidden
                      />
                      {aiLoading ? 'Generating…' : 'Generate'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Persona Fields */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-4">
                  {/* Avatar Preview */}
                  <div className="w-16 h-16 rounded-md overflow-hidden shrink-0 border border-line relative">
                    <CharacterAvatar
                      name={name || 'Persona'}
                      avatarUrl={avatarUrl}
                      accentColor={accentColor}
                      className="w-full h-full"
                    />
                  </div>

                  <div className="flex-1 space-y-1.5 min-w-0">
                    <label htmlFor="persona-name" className="type-label">
                      Persona name
                    </label>
                    <input
                      id="persona-name"
                      type="text"
                      placeholder="e.g. Alexander Vance"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="field font-medium"
                    />
                  </div>
                </div>

                {/* Avatar actions */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="btn btn-quiet"
                  >
                    <ImageIcon className="w-3.5 h-3.5" aria-hidden />
                    Upload photo
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
                    <button type="button" onClick={() => setAvatarUrl('')} className="btn btn-quiet text-danger">
                      Clear photo
                    </button>
                  )}
                </div>

                {/* Description / Backstory */}
                <div className="space-y-1.5 pt-1">
                  <label htmlFor="persona-backstory" className="type-label">
                    Backstory and appearance
                  </label>
                  <textarea
                    id="persona-backstory"
                    rows={4}
                    placeholder="How they look, what they do, how they know this story…"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="field text-xs leading-relaxed"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-line flex items-center justify-between gap-3">
          {mode === 'list' ? (
            <>
              <p className="type-meta hidden sm:block min-w-0 truncate">
                Selected: <strong className="text-ink-2">{chosenName}</strong>
              </p>
              <button onClick={handleConfirmSelection} className="btn btn-primary w-full sm:w-auto ml-auto">
                <span>Start roleplay</span>
                <ArrowRight className="w-4 h-4" aria-hidden />
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => setMode('list')} className="btn btn-quiet">
                Cancel
              </button>
              <button type="button" onClick={handleSavePersona} className="btn btn-primary">
                <Check className="w-3.5 h-3.5" aria-hidden />
                Save and select
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
