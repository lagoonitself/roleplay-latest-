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
          className="btn btn-primary min-h-11 flex items-center justify-center"
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
    <div className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 pt-4 sm:pt-6 pb-[calc(env(safe-area-inset-bottom,0px)+6rem)] md:pb-10 space-y-6 sm:space-y-8">
      {/* Top navigation */}
      <nav className="flex items-center justify-between gap-2" aria-label="Character navigation">
        <Link
          href="/"
          className="icon-btn min-h-11 min-w-11"
          aria-label="Back to explore"
        >
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
        </Link>

        <div className="flex items-center gap-2">
          {/* TODO(ios): add character edit action when edit route/flow is implemented */}
          <button
            type="button"
            onClick={handleExportCard}
            className="btn btn-ghost min-h-11 min-w-11 p-0 sm:px-3 flex items-center justify-center gap-1.5 text-xs sm:text-sm"
            aria-label="Export card V2"
            title="Export card V2"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Export card V2</span>
          </button>
          <button
            type="button"
            onClick={handleDeleteCharacter}
            className="btn btn-danger min-h-11 min-w-11 p-0 sm:px-3 flex items-center justify-center gap-1.5 text-xs sm:text-sm"
            aria-label="Delete character"
            title="Delete this character"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Delete character</span>
          </button>
        </div>
      </nav>

      {/* Portrait plate */}
      <div className="w-full max-w-sm mx-auto aspect-[3/4] rounded-xl overflow-hidden border border-line bg-sunken">
        <CharacterAvatar
          name={character.name}
          avatarUrl={character.avatar_url}
          accentColor={character.accent_color}
          className="w-full h-full object-cover"
        />
      </div>

      {/* Character header */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="type-page font-serif">
            {character.name}
          </h1>
          {character.content_rating !== 'sfw' && (
            <span className="chip chip-danger flex items-center gap-1">
              <Flame className="w-3 h-3" aria-hidden="true" />
              18+
            </span>
          )}
        </div>

        {character.tagline && (
          <p className="text-accent-text type-sec">
            {character.tagline}
          </p>
        )}

        {!!character.tags?.length && (
          <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0 py-1">
            {character.tags.map((tag) => (
              <span key={tag} className="chip shrink-0">
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Primary action */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-raised px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] md:static md:border-0 md:bg-transparent md:p-0">
        <button
          type="button"
          onClick={handleStartChat}
          className="btn btn-primary w-full min-h-11 flex items-center justify-center gap-2 md:w-auto"
        >
          <MessageSquare className="w-4 h-4" aria-hidden="true" />
          Start roleplay
        </button>
      </div>

      {/* Description */}
      <section className="space-y-2 pt-6 border-t border-line">
        <h2 className="type-sec">
          Description
        </h2>
        <div className="prose-rp text-ink leading-relaxed">
          {character.description || 'No description yet.'}
        </div>
      </section>

      {/* Personality */}
      <section className="space-y-2 pt-6 border-t border-line">
        <h2 className="type-sec">
          Personality
        </h2>
        <div className="prose-rp text-ink leading-relaxed">
          {character.personality || 'No custom personality defined.'}
        </div>
      </section>

      {/* Starting scenario */}
      <section className="space-y-2 pt-6 border-t border-line">
        <h2 className="type-sec">
          Starting scenario
        </h2>
        <div className="prose-rp text-ink leading-relaxed">
          {character.scenario || 'No custom scenario defined.'}
        </div>
      </section>

      {/* Opening greetings preview */}
      <section className="space-y-3 pt-6 border-t border-line">
        <div className="flex items-center justify-between gap-3">
          <h2 className="type-sec">
            Opening greetings ({greetings.length})
          </h2>

          {greetings.length > 1 && (
            <div className="flex items-center gap-1.5" role="group" aria-label="Choose greeting">
              {greetings.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setSelectedGreetingIndex(i)}
                  className={`min-h-9 min-w-9 flex items-center justify-center text-xs ${
                    selectedGreetingIndex === i ? 'chip chip-accent' : 'chip'
                  }`}
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
      </section>

      <PersonaModal
        open={personaModalOpen}
        onClose={() => setPersonaModalOpen(false)}
        character={character}
        onSelectPersona={handleConfirmStartChat}
      />
    </div>
  );
}
