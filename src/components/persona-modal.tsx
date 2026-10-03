'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Plus,
  Sparkles,
  Check,
  User,
  ArrowRight,
  Trash2,
  Edit2,
  ChevronLeft,
  Image as ImageIcon,
  Link2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { CharacterAvatar } from '@/components/character-avatar';
import { toast } from 'sonner';
import type { Character, Persona } from '@/lib/supabase/types';

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
  const [accentColor, setAccentColor] = useState('#3b82f6');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // Load Personas (from DB + localStorage)
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
        if (!selectedPersonaId && combined[0]) {
          setSelectedPersonaId(combined[0].id);
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
    if (!selectedPersonaId && localList[0]) {
      setSelectedPersonaId(localList[0].id);
    }
  };

  useEffect(() => {
    if (open) {
      loadPersonas();
      setMode('list');
    }
  }, [open]);

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
              }
            : null,
          apiKey: settings.opencodeApiKey,
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
    } catch (err: any) {
      toast.error(err.message || 'Generation error');
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
    reader.readAsDataURL(file);
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

    // Persist to local storage
    try {
      const updated = [newPersona, ...personas.filter((p) => p.id !== newPersona.id)];
      localStorage.setItem('cadenza_local_personas', JSON.stringify(updated));
      setPersonas(updated);
    } catch {}

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

  const handleDeletePersona = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = personas.filter((p) => p.id !== id);
    setPersonas(updated);
    try {
      localStorage.setItem('cadenza_local_personas', JSON.stringify(updated));
    } catch {}
    if (selectedPersonaId === id && updated[0]) {
      setSelectedPersonaId(updated[0].id);
    }
    toast.info('Persona deleted');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Mobile Bottom Sheet / Desktop Modal Dialog */}
      <div className="w-full sm:max-w-xl max-h-[92vh] sm:max-h-[85vh] flex flex-col bg-background/95 border border-black/[0.08] dark:border-white/[0.12] rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden animate-in slide-in-from-bottom-6 sm:zoom-in-95 duration-250">
        {/* Mobile Grab Bar */}
        <div className="sm:hidden flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-black/20 dark:bg-white/20" />
        </div>

        {/* Modal Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-2">
            {mode === 'create' && (
              <button
                onClick={() => setMode('list')}
                className="p-1.5 -ml-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <div>
              <h2 className="text-base sm:text-lg font-bold tracking-tight">
                {mode === 'list' ? 'Choose Your Persona' : 'Create New Persona'}
              </h2>
              <p className="text-xs text-muted-foreground line-clamp-1">
                {character
                  ? `Roleplaying with ${character.name}`
                  : 'Define who you are playing in this story'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          {mode === 'list' ? (
            /* LIST MODE */
            <div className="space-y-3">
              <div className="flex items-center justify-between pb-1">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Your Personas ({personas.length})
                </span>
                <button
                  onClick={() => setMode('create')}
                  className="px-3 py-1 rounded-full bg-accent/10 text-accent hover:bg-accent/20 text-xs font-semibold apple-button flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  New Persona
                </button>
              </div>

              {personas.map((persona) => {
                const isSelected = selectedPersonaId === persona.id;

                return (
                  <div
                    key={persona.id}
                    onClick={() => setSelectedPersonaId(persona.id)}
                    className={`p-3.5 sm:p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'border-accent bg-accent/[0.04] shadow-sm'
                        : 'border-black/[0.06] dark:border-white/[0.08] hover:border-black/20 dark:hover:border-white/20'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-2xl overflow-hidden shrink-0 border border-white/10 shadow-xs">
                        <CharacterAvatar
                          name={persona.name}
                          avatarUrl={persona.avatar_url}
                          className="w-full h-full"
                        />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold tracking-tight truncate">
                            {persona.name}
                          </span>
                          {isSelected && (
                            <span className="text-[10px] px-2 py-0.2 rounded-full bg-accent text-white font-bold">
                              Selected
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {persona.description || 'No background description provided.'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {personas.length > 1 && (
                        <button
                          onClick={(e) => handleDeletePersona(persona.id, e)}
                          className="p-2 text-muted-foreground hover:text-red-500 rounded-xl hover:bg-red-500/10 transition-colors"
                          title="Delete persona"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center transition-colors ${
                          isSelected
                            ? 'bg-accent border-accent text-white'
                            : 'border-muted-foreground/30'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
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
              <div className="p-4 rounded-2xl bg-purple-500/[0.06] border border-purple-500/20 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    AI Persona Generator
                  </span>
                  {character && (
                    <span className="text-[10px] text-muted-foreground font-mono">
                      Matched to {character.name}
                    </span>
                  )}
                </div>

                <p className="text-xs text-muted-foreground leading-relaxed">
                  Describe what kind of character you want to play, or leave blank to automatically design a counterpart with rich backstory!
                </p>

                <div className="space-y-2.5">
                  <textarea
                    rows={3}
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Describe your character concept (e.g. Her estranged ex-husband, a cynical detective who still carries an old silver lighter she gave him)..."
                    className="w-full px-3.5 py-2.5 rounded-xl bg-background border border-black/[0.08] dark:border-white/[0.1] text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-purple-500/40 resize-y min-h-[76px] max-h-[180px] overflow-y-auto"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      {aiPrompt.length > 0 ? `${aiPrompt.length} characters` : 'Optional • Leave blank for auto-generation'}
                    </span>
                    <button
                      type="button"
                      onClick={handleGenerateAI}
                      disabled={aiLoading}
                      className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold apple-button flex items-center gap-1.5 shrink-0 shadow-sm disabled:opacity-50 transition-all cursor-pointer"
                    >
                      {aiLoading ? (
                        <>
                          <Sparkles className="w-3.5 h-3.5 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-3.5 h-3.5" />
                          Generate
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Persona Fields */}
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-4">
                  {/* Avatar Preview */}
                  <div className="w-16 h-16 rounded-2xl overflow-hidden shrink-0 border border-black/10 dark:border-white/10 shadow-xs relative group">
                    <CharacterAvatar
                      name={name || 'Persona'}
                      avatarUrl={avatarUrl}
                      accentColor={accentColor}
                      className="w-full h-full"
                    />
                  </div>

                  <div className="flex-1 space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Persona Name <span className="text-accent">*</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Alexander Vance"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3.5 py-2 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 font-medium"
                    />
                  </div>
                </div>

                {/* Avatar actions */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3 py-1.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] hover:bg-black/[0.06] dark:hover:bg-white/[0.1] text-xs font-medium apple-button flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                  >
                    <ImageIcon className="w-3.5 h-3.5" />
                    Upload Photo
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={() => setAvatarUrl('')}
                      className="px-2.5 py-1.5 rounded-xl text-xs text-red-500 hover:bg-red-500/10"
                    >
                      Clear Photo
                    </button>
                  )}
                </div>

                {/* Description / Backstory */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                    Persona Backstory & Appearance
                  </label>
                  <textarea
                    rows={4}
                    placeholder="Describe your character's physical traits, connection to {{char}}, profession, or personality..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full p-3.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-xs leading-relaxed focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 sm:p-5 border-t border-black/[0.06] dark:border-white/[0.08] bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between gap-3">
          {mode === 'list' ? (
            <>
              <p className="text-xs text-muted-foreground hidden sm:block">
                Selected: <strong>{personas.find((p) => p.id === selectedPersonaId)?.name || 'Default'}</strong>
              </p>
              <button
                onClick={handleConfirmSelection}
                className="w-full sm:w-auto ml-auto px-6 py-2.5 rounded-full bg-accent text-white hover:bg-accent-hover text-xs sm:text-sm font-semibold apple-button flex items-center justify-center gap-2 shadow-sm"
              >
                <span>Start Roleplay</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setMode('list')}
                className="px-4 py-2 text-xs font-medium rounded-full hover:bg-black/5 dark:hover:bg-white/10 apple-button"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSavePersona}
                className="px-5 py-2 rounded-full bg-accent text-white hover:bg-accent-hover text-xs font-semibold apple-button flex items-center gap-1.5 shadow-sm"
              >
                <Check className="w-3.5 h-3.5" />
                Save & Select
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
