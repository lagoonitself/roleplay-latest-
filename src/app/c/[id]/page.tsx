'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  MessageSquare,
  Download,
  Share2,
  Flame,
  Sparkles,
  Edit,
  Tag,
  BookOpen,
  Trash2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { exportCharacterToCardV2 } from '@/lib/cards/card-parser';
import { CharacterAvatar } from '@/components/character-avatar';
import { PersonaModal } from '@/components/persona-modal';
import { deleteCharacter } from '@/lib/chats/chat-manager';
import { useSettings } from '@/lib/store/settings';
import { toast } from 'sonner';
import type { Character, Persona } from '@/lib/supabase/types';

export default function CharacterProfilePage() {
  const params = useParams();
  const router = useRouter();
  const charId = params?.id as string;
  const [settings] = useSettings();
  const supabase = createClient();

  const [character, setCharacter] = useState<Character | null>(null);
  const [selectedGreetingIndex, setSelectedGreetingIndex] = useState(0);
  const [notFound, setNotFound] = useState(false);
  const [personaModalOpen, setPersonaModalOpen] = useState(false);

  useEffect(() => {
    async function loadChar() {
      // 1. Check database
      const { data } = await supabase
        .from('characters')
        .select('*')
        .eq('id', charId)
        .maybeSingle();

      if (data) {
        setCharacter(data as Character);
        return;
      }

      // 2. Check local storage
      try {
        const localList = JSON.parse(localStorage.getItem('cadenza_local_characters') || '[]');
        const found = localList.find((c: any) => c.id === charId || c.name === charId);
        if (found) {
          setCharacter(found as Character);
          return;
        }
      } catch {}

      setNotFound(true);
    }

    loadChar();
  }, [charId, supabase]);

  if (notFound) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4 text-center">
        <h2 className="text-xl font-bold">Character Not Found</h2>
        <p className="text-sm text-muted-foreground">This character does not exist in your roster or has been removed.</p>
        <Link
          href="/"
          className="px-4 py-2 rounded-full bg-accent text-white text-xs font-medium apple-button"
        >
          Return to Explore
        </Link>
      </div>
    );
  }

  if (!character) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const greetings = [character.first_message, ...(character.alternate_greetings || [])];

  const handleStartChat = () => {
    setPersonaModalOpen(true);
  };

  const handleConfirmStartChat = async (persona: Persona) => {
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;

    if (userId) {
      const { data: newChat, error } = await supabase
        .from('chats')
        .insert({
          user_id: userId,
          character_id: character.id,
          title: `Chat with ${character.name}`,
          persona_id: persona.id,
        })
        .select()
        .single();

      if (!error && newChat) {
        router.push(`/chat/${newChat.id}`);
        return;
      }
    }

    const localChatId = 'local-' + Date.now();
    router.push(`/chat/${localChatId}?charId=${encodeURIComponent(character.name)}`);
  };

  const handleExportCard = () => {
    const cardData = exportCharacterToCardV2(character);
    const jsonStr = JSON.stringify(cardData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${character.name.toLowerCase().replace(/\s+/g, '_')}_card.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Character Card V2 JSON downloaded!');
  };

  const handleDeleteCharacter = async () => {
    if (!character) return;
    if (window.confirm(`Permanently delete "${character.name}" and all associated chats? This cannot be undone.`)) {
      await deleteCharacter(character.id);
      toast.success(`Deleted "${character.name}"`);
      router.push('/');
    }
  };

  return (
    <div className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="p-2 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCard}
            className="px-3.5 py-1.5 rounded-full bg-black/[0.04] dark:bg-white/[0.06] hover:bg-black/[0.08] dark:hover:bg-white/[0.1] text-xs font-medium apple-button flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" />
            Export Card V2
          </button>
          <button
            onClick={handleDeleteCharacter}
            className="px-3.5 py-1.5 rounded-full bg-red-600/15 hover:bg-red-600/25 text-red-500 hover:text-red-400 border border-red-500/20 text-xs font-medium apple-button flex items-center gap-1.5 transition-colors"
            title="Delete this character"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete Character
          </button>
        </div>
      </div>

      {/* Hero Banner & Details */}
      <div className="glass-card rounded-3xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
          {/* Avatar */}
          <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-3xl overflow-hidden bg-black/10 shrink-0 border border-white/20 shadow-md">
            <CharacterAvatar
              name={character.name}
              avatarUrl={character.avatar_url}
              accentColor={character.accent_color}
              className="w-full h-full"
            />
          </div>

          {/* Info */}
          <div className="flex-1 text-center sm:text-left space-y-2">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                {character.name}
              </h1>
              {character.content_rating !== 'sfw' && (
                <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-500 text-xs font-bold uppercase tracking-wider flex items-center gap-1">
                  <Flame className="w-3 h-3" />
                  18+
                </span>
              )}
            </div>

            <p className="text-sm font-medium text-accent">
              {character.tagline}
            </p>

            <p className="text-xs text-muted-foreground leading-relaxed pt-1">
              {character.description}
            </p>

            {/* Tags */}
            <div className="pt-2 flex flex-wrap items-center justify-center sm:justify-start gap-1.5">
              {character.tags?.map((tag) => (
                <span
                  key={tag}
                  className="px-2.5 py-1 rounded-lg bg-black/[0.04] dark:bg-white/[0.06] text-xs text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>

            {/* Start Chat Button */}
            <div className="pt-4">
              <button
                onClick={handleStartChat}
                className="w-full sm:w-auto px-6 py-2.5 rounded-full bg-accent text-white hover:bg-accent-hover font-semibold text-sm apple-button flex items-center justify-center gap-2 shadow-sm"
              >
                <MessageSquare className="w-4 h-4" />
                Start Roleplay
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Personality & Scenario */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-card p-6 rounded-3xl space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Personality & Psychology
          </h3>
          <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed">
            {character.personality || 'No custom personality defined.'}
          </p>
        </div>

        <div className="glass-card p-6 rounded-3xl space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Starting Scenario
          </h3>
          <p className="text-xs sm:text-sm text-foreground/90 leading-relaxed">
            {character.scenario || 'No custom scenario defined.'}
          </p>
        </div>
      </div>

      {/* Opening Greetings Preview */}
      <div className="glass-card p-6 sm:p-8 rounded-3xl space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Opening Greetings ({greetings.length})
          </h3>

          {greetings.length > 1 && (
            <div className="flex items-center gap-1">
              {greetings.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setSelectedGreetingIndex(i)}
                  className={`w-6 h-6 rounded-full text-xs font-medium flex items-center justify-center transition-colors ${
                    selectedGreetingIndex === i
                      ? 'bg-accent text-white'
                      : 'hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] border border-black/[0.04] dark:border-white/[0.06] text-xs sm:text-sm leading-relaxed whitespace-pre-wrap roleplay-prose">
          {greetings[selectedGreetingIndex]}
        </div>
      </div>

      <PersonaModal
        open={personaModalOpen}
        onClose={() => setPersonaModalOpen(false)}
        character={character}
        onSelectPersona={handleConfirmStartChat}
      />
    </div>
  );
}
