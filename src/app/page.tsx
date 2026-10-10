'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Search,
  Plus,
  ArrowRight,
  Trash2,
  X,
  User,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { parseCharacterCardJson, parseCharacterFromPng, makeCharacter, type CharacterBook } from '@/lib/cards/card-parser';
import { CharacterAvatar } from '@/components/character-avatar';
import { PersonaModal } from '@/components/persona-modal';
import { PersonaDrawer } from '@/components/persona-drawer';
import { CharacterChatsDrawer } from '@/components/character-chats-drawer';
import { MyChatsView } from '@/components/my-chats-view';
import { MobileDock, type AppTab } from '@/components/mobile-dock';
import { CreateDrawer } from '@/components/create-drawer';
import { SettingsDialog } from '@/components/settings-dialog';
import { ProfileView } from '@/components/profile/profile-view';
import {
  getUnifiedChats,
  groupChatsByCharacter,
  deleteChat,
  deleteCharacter,
  saveLocalChat,
  saveLocalMessages,
  ensureCharacterInCloud,
  isUuid,
  formatChatTimestamp,
  CHATS_CHANGED_EVENT,
  type CharacterChatGroup,
} from '@/lib/chats/chat-manager';
import { formatRoleplayText } from '@/lib/prompt/macros';
import { toast } from 'sonner';
import type { Character, Chat, Persona } from '@/lib/supabase/types';

function HomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [settings] = useSettings();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // App Tabs: 'explore' | 'chats' | 'create' | 'profile'
  const initialTab = (searchParams.get('tab') as AppTab) || 'explore';
  const [activeTab, setActiveTab] = useState<AppTab>(initialTab);

  // Search & Filters in Explore
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('All');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);

  // Drawers and Modals
  const [showImportGuide, setShowImportGuide] = useState(false);
  const [createDrawerOpen, setCreateDrawerOpen] = useState(false);
  const [personaModalOpen, setPersonaModalOpen] = useState(false);
  const [personaDrawerOpen, setPersonaDrawerOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [activePersonaName, setActivePersonaName] = useState<string>('Standard Persona');

  // Character selection for chat and drawer
  const [selectedCharForChat, setSelectedCharForChat] = useState<Character | null>(null);
  const [drawerCharacter, setDrawerCharacter] = useState<Character | null>(null);

  const tags = ['All', 'Romance', 'Fantasy', 'Sci-Fi', 'Cyberpunk', 'Mystery', 'Mature', 'Companion'];

  // Resolve active persona name
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const localList: Persona[] = JSON.parse(localStorage.getItem('cadenza_local_personas') || '[]');
        const found =
          localList.find((p) => p.id === settings.activePersonaId) ||
          localList.find((p) => p.is_default) ||
          localList[0];
        if (found) setActivePersonaName(found.name);
      } catch {}
    }, 0);
    return () => clearTimeout(timer);
  }, [settings.activePersonaId, personaDrawerOpen]);

  // Load all characters and unified chats
  const loadData = useCallback(async () => {
    try {
      // 1. Fetch custom characters from Supabase
      const { data: dbChars } = await supabase
        .from('characters')
        .select('*')
        .order('created_at', { ascending: false });

      // 2. Fetch locally stored characters
      let localChars: Character[] = [];
      try {
        localChars = JSON.parse(localStorage.getItem('cadenza_local_characters') || '[]');
      } catch {}

      // 3. Combine characters without duplicates
      const dbList = (dbChars as Character[]) || [];
      const dbIds = new Set(dbList.map((c) => c.id));
      const combinedChars = [...dbList, ...localChars.filter((c) => !dbIds.has(c.id))];

      // 4. Filter out any deleted characters
      let deletedIds: string[] = [];
      try {
        deletedIds = JSON.parse(localStorage.getItem('cadenza_deleted_character_ids') || '[]');
      } catch {}
      const activeChars = combinedChars.filter((c) => !deletedIds.includes(c.id));
      setCharacters(activeChars);

      // 5. Load Unified Chats (Supabase + LocalStorage), solo chats only — duo lives on /duo
      const unifiedChats = await getUnifiedChats(activeChars);
      setChats(unifiedChats.filter((c) => (c as Chat).mode !== 'duo' && !(c.settings as Record<string, unknown>)?.duo));
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void loadData();
    }, 0);

    // Real-time synchronization: listen for chats changes from any device
    const channel = supabase
      .channel('home-chats-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'chats' },
        () => {
          loadData();
        }
      )
      .subscribe();

    // Listen to cross-tab/cross-component chat & character updates
    const handleChanged = () => {
      loadData();
    };

    window.addEventListener(CHATS_CHANGED_EVENT, handleChanged);
    window.addEventListener('cadenza-characters-changed', handleChanged);
    return () => {
      clearTimeout(timer);
      supabase.removeChannel(channel);
      window.removeEventListener(CHATS_CHANGED_EVENT, handleChanged);
      window.removeEventListener('cadenza-characters-changed', handleChanged);
    };
  }, [loadData, supabase]);

  // Sync tab with URL query parameter if present
  useEffect(() => {
    const timer = setTimeout(() => {
      const tabParam = searchParams.get('tab') as AppTab;
      if (tabParam && ['explore', 'chats', 'create', 'profile'].includes(tabParam)) {
        setActiveTab(tabParam);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [searchParams]);

  // Grouped chats for the "My chats" index
  const chatGroups: CharacterChatGroup[] = React.useMemo(() => {
    return groupChatsByCharacter(chats, characters);
  }, [chats, characters]);

  // Filtered chats for the currently opened drawer character
  const chatsForDrawer = React.useMemo(() => {
    if (!drawerCharacter) return [];
    return chats.filter(
      (c) =>
        c.character_id === drawerCharacter.id ||
        c.character?.id === drawerCharacter.id ||
        c.character?.name === drawerCharacter.name
    );
  }, [chats, drawerCharacter]);

  // Handle Tab Switch from Mobile Dock or Top Bar
  // Feature 2: `profile` is now a full dedicated view (not a popup drawer).
  const handleTabChange = (tab: AppTab) => {
    if (tab === 'create') {
      setCreateDrawerOpen(true);
      return;
    }
    if (tab === 'profile') {
      setActiveTab('profile');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setActiveTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Direct Card Import Handler
  const handleDirectImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      let parsedChar: Partial<Character> = {};
      let avatarUrl = '';
      let embeddedBook: CharacterBook | null = null;

      if (file.name.toLowerCase().endsWith('.png') || file.type === 'image/png') {
        const buffer = await file.arrayBuffer();
        const res = parseCharacterFromPng(buffer);
        parsedChar = res.character;
        avatarUrl = res.avatarDataUrl || '';
        embeddedBook = res.characterBook || null;
      } else {
        const text = await file.text();
        const res = parseCharacterCardJson(text);
        parsedChar = res.character;
        embeddedBook = res.characterBook || null;
      }

      if (!parsedChar.name && !parsedChar.first_message) {
        throw new Error('File does not appear to contain valid Character Card data.');
      }

      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id;

      const newCharPayload = {
        name: parsedChar.name || file.name.replace(/\.[^/.]+$/, ''),
        avatar_url: avatarUrl || parsedChar.avatar_url || null,
        tagline: parsedChar.tagline || parsedChar.creator_notes || 'Imported Character',
        description: parsedChar.description || '',
        personality: parsedChar.personality || '',
        scenario: parsedChar.scenario || '',
        first_message: parsedChar.first_message || '*I look at you with quiet attention.*',
        alternate_greetings: parsedChar.alternate_greetings || [],
        example_dialogue: parsedChar.example_dialogue || '',
        speech_style: '',
        system_prompt: parsedChar.system_prompt || '',
        post_history_instructions: parsedChar.post_history_instructions || '',
        tags: parsedChar.tags && parsedChar.tags.length > 0 ? parsedChar.tags : ['Imported'],
        content_rating: 'mature' as const,
        behavior: {
          pov: '2nd' as const,
          tense: 'present' as const,
          verbosity: 'medium' as const,
          temperature: settings.defaultTemperature,
        },
      };

      if (userId) {
        const { data: savedDbChar, error } = await supabase
          .from('characters')
          .insert({
            user_id: userId,
            ...newCharPayload,
          })
          .select()
          .single();

        if (error) throw error;

        // Auto-save embedded lorebook if card contains one
        if (embeddedBook && savedDbChar?.id) {
          const { saveEmbeddedCharacterBook } = await import('@/lib/cards/card-parser');
          await saveEmbeddedCharacterBook(supabase, savedDbChar.id, userId, embeddedBook);
        }

        toast.success(`Successfully imported "${newCharPayload.name}"!`);
        await loadData();
        return;
      }

      // Guest / local storage fallback
      const localChar: Character = makeCharacter({
        id: `local-char-${Date.now()}`,
        user_id: 'guest',
        ...newCharPayload,
      });

      const localList = JSON.parse(localStorage.getItem('cadenza_local_characters') || '[]');
      localStorage.setItem('cadenza_local_characters', JSON.stringify([localChar, ...localList]));
      toast.success(`Imported "${newCharPayload.name}" to your roster!`);
      await loadData();
    } catch (err) {
      toast.error((err instanceof Error ? err.message : '') || 'Failed to import character card');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Filtered characters for Explore view
  const filteredCharacters = characters.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.tagline?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesTag =
      selectedTag === 'All' ||
      c.tags?.some((t) => t.toLowerCase() === selectedTag.toLowerCase()) ||
      (selectedTag === 'Mature' && (c.content_rating === 'mature' || c.content_rating === 'explicit'));

    return matchesSearch && matchesTag;
  });

  const handleStartChat = (character: Character) => {
    setSelectedCharForChat(character);
    setPersonaModalOpen(true);
  };

  const handleStartChatWithPersona = async (persona: Persona) => {
    if (!selectedCharForChat) return;
    const character = selectedCharForChat;
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

    // Guest / local session (only when unauthenticated)
    const localChatId = 'local-' + Date.now();
    saveLocalChat({
      id: localChatId,
      user_id: 'guest',
      character_id: character.id,
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
      character: character,
    });

    router.push(`/chat/${localChatId}?charId=${encodeURIComponent(character.id || character.name)}`);
  };

  const handleDeleteRecentChat = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    e.preventDefault();
    await deleteChat(chatId);
    toast.success('Chat removed from history');
    await loadData();
  };

  return (
    <div className="flex-1 flex flex-col w-full pb-24 md:pb-10">
      {/* ─────────────────── TAB: PROFILE (Feature 2 — full dedicated section) ─────────────────── */}
      {activeTab === 'profile' ? (
        <ProfileView onOpenSettingsDialog={() => setSettingsDialogOpen(true)} />
      ) : activeTab === 'chats' ? (
        <MyChatsView
          groups={chatGroups}
          onSelectCharacter={(char) => setDrawerCharacter(char)}
          onExploreClick={() => setActiveTab('explore')}
          onOpenSettings={() => setPersonaDrawerOpen(true)}
        />
      ) : (
        /* ─────────────────── TAB 1: EXPLORE / CHARACTERS VIEW (Clean, No Cluttered Hero) ─────────────────── */
        <div className="flex-1 flex flex-col max-w-7xl w-full mx-auto px-4 sm:px-6 py-4 md:py-6 space-y-6">
          {/* Top Control Bar: Search & Filter Pills */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              {/* Search Bar */}
              <div className="relative max-w-md flex-1">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-ink-3"
                  aria-hidden="true"
                />
                <input
                  type="text"
                  placeholder="Search by name, e.g. Elara…"
                  aria-label="Search characters"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="field pr-9 pl-9"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="icon-btn absolute top-1/2 right-1.5 h-7 w-7 -translate-y-1/2"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>

              {/* Action Buttons: Persona Switcher & Create */}
              <div className="flex shrink-0 items-center gap-2">
                {/* Persona Pill: View and Switch Personas */}
                <button
                  onClick={() => setPersonaDrawerOpen(true)}
                  className="chip gap-1.5 px-3 py-2 text-xs transition-colors hover:text-ink"
                  title="View and switch your roleplay persona"
                  aria-label="Your Personas"
                >
                  <User className="h-3.5 w-3.5 text-ink-2" aria-hidden="true" />
                  <span className="hidden text-ink-3 sm:inline">Persona:</span>
                  <span className="max-w-[110px] truncate font-medium">{activePersonaName}</span>
                </button>

                <button
                  onClick={() => setCreateDrawerOpen(true)}
                  className="btn btn-primary text-xs"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Create</span>
                </button>
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="scrollbar-none flex items-center gap-1.5 overflow-x-auto pb-1.5">
              {tags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(tag)}
                  aria-pressed={selectedTag === tag}
                  className={`whitespace-nowrap transition-colors ${
                    selectedTag === tag
                      ? 'chip-accent chip inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-semibold'
                      : 'chip hover:text-ink px-3.5 py-1.5 text-xs'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Duo entry: two of your people, talking on their own */}
          {!searchQuery && selectedTag === 'All' && (
            <Link
              href="/duo"
              className="group flex items-center gap-3 border-y border-line py-3.5 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium text-accent-text">
                  Duo scenes
                  <span className="chip chip-accent">New</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-ink-2">
                  Pick two characters or personas — they talk, you watch. It keeps going while
                  you&apos;re away.
                </div>
              </div>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>
          )}

          {/* Jump Back In (Compact Recent Chats Strip with Delete Option) */}
          {chats.length > 0 && !searchQuery && selectedTag === 'All' && (
            <section className="space-y-2.5 pt-1">
              <div className="flex items-center justify-between">
                <h2 className="type-sec">Continue recent chats</h2>
                <button
                  onClick={() => setActiveTab('chats')}
                  className="btn btn-quiet text-xs text-accent-text"
                >
                  View all ({chats.length})
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </button>
              </div>

              {/* Compact list of Recent Chats */}
              <div className="divide-y divide-line border-y border-line">
                {chats.slice(0, 3).map((chat) => {
                  const resolvedChar =
                    chat.character ||
                    characters.find(
                      (c) =>
                        c.id === chat.character_id ||
                        c.name.toLowerCase() === chat.character_id?.toLowerCase() ||
                        c.name.toLowerCase() === chat.title.replace(/^Chat with\s+/i, '').toLowerCase()
                    );
                  const charName = resolvedChar?.name || chat.character?.name || chat.title.replace(/^Chat with\s+/i, '');
                  const avatarUrl = resolvedChar?.avatar_url || chat.character?.avatar_url;
                  const timeFormatted = formatChatTimestamp(chat.last_message_at || chat.created_at);
                  const charIdentifier = resolvedChar?.id || chat.character_id || chat.character?.id || resolvedChar?.name || '';
                  const queryParam = charIdentifier ? `?charId=${encodeURIComponent(charIdentifier)}` : '';

                  return (
                    <div
                      key={chat.id}
                      onClick={() => router.push(`/chat/${chat.id}${queryParam}`)}
                      className="group flex cursor-pointer items-center justify-between gap-3 py-2.5 transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_3%,transparent)]"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="bg-sunken h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-line">
                          <CharacterAvatar
                            name={charName}
                            avatarUrl={avatarUrl}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-ink">
                            {charName}
                          </div>
                          <div className="truncate text-xs text-ink-2">
                            {chat.title}
                          </div>
                          <div className="type-meta mt-0.5">
                            {timeFormatted}
                          </div>
                        </div>
                      </div>

                      {/* Delete button on recent chat pill */}
                      <button
                        onClick={(e) => handleDeleteRecentChat(e, chat.id)}
                        className="icon-btn h-8 w-8 shrink-0 opacity-0 transition-[opacity,color,background-color] group-hover:opacity-100 focus-visible:opacity-100"
                        title="Delete chat from recent history"
                        aria-label={`Delete chat with ${charName}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Character Roster Gallery */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="type-sec">Featured characters</h2>
              <span className="type-meta">
                {filteredCharacters.length} {filteredCharacters.length === 1 ? 'character' : 'characters'}
              </span>
            </div>

            {filteredCharacters.length > 0 ? (
              <div className="grid grid-cols-2 gap-x-5 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
                {filteredCharacters.map((character) => (
                  <div
                    key={character.id}
                    onClick={() => handleStartChat(character)}
                    className="group flex cursor-pointer flex-col"
                  >
                    {/* Portrait plate */}
                    <div className="bg-sunken relative aspect-[3/4] overflow-hidden rounded-xl border border-line">
                      <CharacterAvatar
                        name={character.name}
                        avatarUrl={character.avatar_url}
                        accentColor={character.accent_color}
                        className="h-full w-full object-cover"
                      />

                      {/* Rating marker */}
                      {character.content_rating !== 'sfw' && (
                        <span className="chip chip-danger absolute top-2 left-2">
                          18+
                        </span>
                      )}
                    </div>

                    {/* Caption beneath the plate */}
                    <div className="min-w-0 pt-2">
                      <h3 className="truncate font-serif text-[17px] leading-snug text-ink">
                        {character.name}
                      </h3>
                      {character.tagline && (
                        <p className="type-meta mt-0.5 line-clamp-1">
                          {character.tagline}
                        </p>
                      )}
                      {character.tags && character.tags.length > 0 && (
                        <p className="type-meta mt-0.5 truncate">
                          {character.tags.slice(0, 3).join(', ')}
                        </p>
                      )}

                      {/* Actions, revealed on hover or keyboard focus */}
                      <div className="flex items-center gap-1 pt-1.5 opacity-0 transition-[opacity] duration-150 group-hover:opacity-100 focus-within:opacity-100">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/c/${character.id}`);
                          }}
                          className="btn btn-quiet text-xs"
                        >
                          Details
                        </button>

                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (window.confirm(`Permanently delete "${character.name}" from your roster?`)) {
                              await deleteCharacter(character.id);
                              toast.success(`Deleted "${character.name}"`);
                              await loadData();
                            }
                          }}
                          className="icon-btn h-8 w-8"
                          title="Delete character"
                          aria-label={`Delete ${character.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartChat(character);
                          }}
                          className="btn btn-primary ml-auto text-xs"
                        >
                          Chat
                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Empty Search State */
              !loading && (
                <div className="space-y-3 py-14 text-center">
                  <h3 className="type-display text-2xl">
                    {searchQuery || selectedTag !== 'All' ? 'Nothing matches' : 'Your roster is empty'}
                  </h3>
                  <p className="mx-auto max-w-sm text-sm text-ink-2">
                    {searchQuery
                      ? `Nothing matches \u201c${searchQuery}\u201d. Try another word, or clear the filter.`
                      : selectedTag !== 'All'
                      ? `Nothing is tagged ${selectedTag}. Clear the filter to see everything.`
                      : 'Create a character from scratch, or import a card from Janitor AI or Chub.'}
                  </p>
                  {searchQuery || selectedTag !== 'All' ? (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setSelectedTag('All');
                      }}
                      className="btn btn-ghost text-xs"
                    >
                      Clear filters
                    </button>
                  ) : (
                    <button
                      onClick={() => setCreateDrawerOpen(true)}
                      className="btn btn-primary text-xs"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      Create character
                    </button>
                  )}
                </div>
              )
            )}
          </section>
        </div>
      )}

      {/* ─────────────────── FLOATING MOBILE DOCK ─────────────────── */}
      <MobileDock
        activeTab={activeTab}
        onTabChange={handleTabChange}
        totalChatsCount={chats.length}
      />

      {/* ─────────────────── JANITOR-AI CHAT SESSIONS DRAWER (Images 4 & 5) ─────────────────── */}
      <CharacterChatsDrawer
        open={Boolean(drawerCharacter)}
        onClose={() => setDrawerCharacter(null)}
        character={drawerCharacter}
        chats={chatsForDrawer}
        onStartNewChat={(char) => {
          setDrawerCharacter(null);
          handleStartChat(char);
        }}
        onChatDeleted={loadData}
        onCharacterDeleted={loadData}
      />

      {/* ─────────────────── CREATE / IMPORT DRAWER ─────────────────── */}
      <CreateDrawer
        open={createDrawerOpen}
        onClose={() => setCreateDrawerOpen(false)}
        onImportFile={handleDirectImport}
        onOpenImportGuide={() => setShowImportGuide(true)}
      />

      {/* ─────────────────── IMPORT GUIDE MODAL ─────────────────── */}
      {showImportGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="panel bg-raised relative w-full max-w-lg space-y-4 p-6">
            <div className="flex items-center justify-between">
              <h3 className="type-sec text-sm">Import a character card</h3>
              <button
                onClick={() => setShowImportGuide(false)}
                aria-label="Close"
                className="icon-btn h-8 w-8"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
            <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line">
              <li className="flex items-start gap-3 p-3.5">
                <span className="type-code w-5 shrink-0 pt-0.5 text-ink" aria-hidden="true">1</span>
                <div className="space-y-1">
                  <span className="block text-xs font-medium text-ink">Export the card</span>
                  <p className="text-xs leading-relaxed text-ink-2">On the character&apos;s page, choose the export or download option and save the PNG or JSON file.</p>
                </div>
              </li>
              <li className="flex items-start gap-3 p-3.5">
                <span className="type-code w-5 shrink-0 pt-0.5 text-ink" aria-hidden="true">2</span>
                <div className="space-y-1">
                  <span className="block text-xs font-medium text-ink">Choose import</span>
                  <p className="text-xs leading-relaxed text-ink-2">Select your downloaded file. Cadenza reads the personality, scenario, greeting and avatar from it.</p>
                </div>
              </li>
              <li className="flex items-start gap-3 p-3.5">
                <span className="type-code w-5 shrink-0 pt-0.5 text-ink" aria-hidden="true">3</span>
                <div className="space-y-1">
                  <span className="block text-xs font-medium text-ink">Start chatting</span>
                  <p className="text-xs leading-relaxed text-ink-2">The character is ready straight away, with its memory and instructions intact.</p>
                </div>
              </li>
            </ol>
            <button
              onClick={() => setShowImportGuide(false)}
              className="btn btn-primary w-full text-xs"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* ─────────────────── PERSONA MODAL ─────────────────── */}
      <PersonaModal
        open={personaModalOpen}
        onClose={() => setPersonaModalOpen(false)}
        character={selectedCharForChat}
        onSelectPersona={handleStartChatWithPersona}
      />

      {/* ─────────────────── PERSONA DRAWER (Full Persona Viewing, Switching & Management) ─────────────────── */}
      <PersonaDrawer
        open={personaDrawerOpen}
        onClose={() => setPersonaDrawerOpen(false)}
        onOpenSettingsDialog={() => setSettingsDialogOpen(true)}
      />

      {/* ─────────────────── SETTINGS DIALOG ─────────────────── */}
      <SettingsDialog
        open={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
      />
    </div>
  );
}

export default function HomePage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center p-12">
          <div className="border-accent h-8 w-8 animate-spin rounded-full border-2 border-t-transparent" />
        </div>
      }
    >
      <HomePageContent />
    </React.Suspense>
  );
}
