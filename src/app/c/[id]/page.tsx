'use client';

import React, { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  MessageSquare,
  Download,
  Flame,
  Trash2,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { exportCharacterToCardV2 } from '@/lib/cards/card-parser';
import { CharacterAvatar } from '@/components/character-avatar';
import { PersonaModal } from '@/components/persona-modal';
import { deleteCharacter, saveLocalChat, saveLocalMessages, ensureCharacterInCloud, isUuid } from '@/lib/chats/chat-manager';
import { formatRoleplayText } from '@/lib/prompt/macros';
import { toast } from 'sonner';
import type { Character, Persona } from '@/lib/supabase/types';

export default function CharacterProfilePage() {
  const params = useParams();
  const router = useRouter();
  const charId = params?.id as string;
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
        const localList: Character[] = JSON.parse(localStorage.getItem('cadenza_local_characters') || '[]');
        const found = localList.find((c) => c.id === charId || c.name === charId);
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
        <h2 className="type-page">Character not found</h2>
        <p className="type-meta">This character is not in your roster, or it was removed.</p>
        <Link
          href="/"
          className="btn btn-primary"
        >
          Back to explore
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
      try {
        const cloudChar = await ensureCharacterInCloud(character, userId, supabase);
        const safePersonaId = persona?.id && isUuid(persona.id) ? persona.id : null;

        const { data: newChat, error } = await supabase
          .from('chats')
          .insert({
            user_id: userId,
            character_id: cloudChar.id,
            title: `Chat with ${cloudChar.name}`,
            persona_id: safePersonaId,
            last_message_at: new Date().toISOString(),
            message_count: 1,
          })
          .select('*, character:characters(*)')
          .single();

        if (error) {
          console.error('Failed to create cloud chat:', error);
          toast.error('Failed to create chat in database: ' + error.message);
        } else if (newChat) {
          // Seed the opening greeting in DB so cloud history is never empty from turn 0
          const firstMsg = cloudChar.first_message || '*I look at you with quiet attention.*';
          const formattedGreeting = formatRoleplayText(firstMsg, cloudChar.name, persona.name);
          const rawSwipes = [firstMsg, ...(cloudChar.alternate_greetings || [])];
          const formattedSwipes = rawSwipes.map((s) => formatRoleplayText(s, cloudChar.name, persona.name));

          const { data: greetingRow } = await supabase
            .from('messages')
            .insert({
              chat_id: newChat.id,
              user_id: userId,
              parent_id: null,
              role: 'assistant',
              content: formattedGreeting,
              status: 'done',
              meta: {
                swipes: formattedSwipes,
                active_swipe_index: 0,
              },
            })
            .select('id')
            .single();

          saveLocalMessages(newChat.id, [
            {
              id: greetingRow?.id || 'msg-greeting',
              chat_id: newChat.id,
              user_id: userId,
              parent_id: null,
              role: 'assistant',
              content: formattedGreeting,
              reasoning: null,
              status: 'done',
              meta: {
                swipes: formattedSwipes,
                active_swipe_index: 0,
              },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ]);

          router.push(`/chat/${newChat.id}`);
          return;
        }
      } catch (err) {
        console.error('Error starting cloud chat:', err);
        toast.error('Error starting cloud chat: ' + (err instanceof Error ? err.message : String(err)));
      }
    }

    const localChatId = 'local-' + Date.now();
    saveLocalChat({
      id: localChatId,
      user_id: 'guest',
      character_id: character.id,
      character: character,
      persona_id: persona.id,
      title: `Chat with ${character.name}`,
      leaf_id: null,
      memory_cursor_id: null,
      authors_note: '',
      settings: {},
      pinned: false,
      archived: false,
      message_count: 1,
      last_message_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    router.push(`/chat/${localChatId}?charId=${encodeURIComponent(character.id || character.name)}`);
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
    // Deferred revoke: revoking synchronously can cancel the download in
    // some browsers before it starts.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success('Character Card V2 JSON downloaded!');
  };

  const handleDeleteCharacter = async () => {
    if (!character) return;
    if (window.confirm(`Permanently delete "${character.name}" and all associated chats? This cannot be undone.`)) {
      try {
        const ok = await deleteCharacter(character.id);
        if (ok) {
          toast.success(`Deleted "${character.name}"`);
        } else {
          toast.error(`Could not delete "${character.name}" — please try again`);
        }
      } catch {
        toast.error(`Could not delete "${character.name}" — please try again`);
      }
      router.push('/');
    }
  };

  return (
    <div className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
      {/* Top navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="icon-btn"
          aria-label="Back to explore"
        >
          <ArrowLeft className="w-5 h-5" aria-hidden />
        </Link>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCard}
            className="btn btn-ghost flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5" aria-hidden />
            Export card V2
          </button>
          <button
            type="button"
            onClick={handleDeleteCharacter}
            className="btn btn-danger flex items-center gap-1.5"
            title="Delete this character"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden />
            Delete character
          </button>
        </div>
      </div>

      {/* Hero */}
      <div className="surface rounded-xl p-6 sm:p-8 space-y-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
          <div className="w-32 h-32 sm:w-40 sm:h-40 rounded-xl overflow-hidden shrink-0 border border-line" style={{ width: 160, height: 160 }}>
            <CharacterAvatar
              name={character.name}
              avatarUrl={character.avatar_url}
              accentColor={character.accent_color}
              className="w-full h-full"
            />
          </div>

          <div className="flex-1 text-center sm:text-left space-y-2 min-w-0">
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
              <h1 className="type-page font-serif">
                {character.name}
              </h1>
              {character.content_rating !== 'sfw' && (
                <span className="chip chip-danger flex items-center gap-1">
                  <Flame className="w-3 h-3" aria-hidden />
                  18+
                </span>
              )}
            </div>

            {character.tagline && (
              <p className="text-accent-text type-sec">
                {character.tagline}
              </p>
            )}

            <div className="prose-rp !text-[0.95rem]">
              {character.description || 'No description yet.'}
            </div>

            {!!character.tags?.length && (
              <div className="pt-2 flex flex-wrap items-center justify-center sm:justify-start gap-1.5">
                {character.tags?.map((tag) => (
                  <span key={tag} className="chip">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            <div className="pt-4">
              <button
                type="button"
                onClick={handleStartChat}
                className="btn btn-primary w-full sm:w-auto flex items-center justify-center gap-2"
              >
                <MessageSquare className="w-4 h-4" aria-hidden />
                Start roleplay
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Personality and scenario */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="surface rounded-xl p-6 space-y-2">
          <h3 className="type-sec">
            Personality
          </h3>
          <p className="text-sm text-ink leading-relaxed">
            {character.personality || 'No custom personality defined.'}
          </p>
        </div>

        <div className="surface rounded-xl p-6 space-y-2">
          <h3 className="type-sec">
            Starting scenario
          </h3>
          <p className="text-sm text-ink leading-relaxed">
            {character.scenario || 'No custom scenario defined.'}
          </p>
        </div>
      </div>

      {/* Opening greetings preview */}
      <div className="surface rounded-xl p-6 sm:p-8 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="type-sec">
            Opening greetings ({greetings.length})
          </h3>

          {greetings.length > 1 && (
            <div className="flex items-center gap-1.5" role="group" aria-label="Choose greeting">
              {greetings.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedGreetingIndex(i)}
                  className={selectedGreetingIndex === i ? 'chip chip-accent' : 'chip'}
                  aria-pressed={selectedGreetingIndex === i}
                  aria-label={`Show greeting ${i + 1}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="well p-4 whitespace-pre-wrap prose-rp roleplay-prose">
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
