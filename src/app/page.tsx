'use client';

import React, { useState, useEffect, useRef, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Compass,
  MessageSquare,
  Flame,
  Search,
  Plus,
  BookOpen,
  ArrowRight,
  Upload,
  UserPlus,
  Sparkles,
  Layers,
  Trash2,
  ExternalLink,
  Settings,
  X,
  User,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { parseCharacterCardJson, parseCharacterFromPng, makeCharacter } from '@/lib/cards/card-parser';
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
    try {
      const localList: Persona[] = JSON.parse(localStorage.getItem('cadenza_local_personas') || '[]');
      const found =
        localList.find((p) => p.id === settings.activePersonaId) ||
        localList.find((p) => p.is_default) ||
        localList[0];
      if (found) setActivePersonaName(found.name);
    } catch {}
  }, [settings.activePersonaId, personaDrawerOpen]);

  // Load all characters and unified chats
  const loadData = async () => {
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

      // 5. Load Unified Chats (Supabase + LocalStorage)
      const unifiedChats = await getUnifiedChats(activeChars);
      setChats(unifiedChats);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();

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
      supabase.removeChannel(channel);
      window.removeEventListener(CHATS_CHANGED_EVENT, handleChanged);
      window.removeEventListener('cadenza-characters-changed', handleChanged);
    };
  }, [supabase]);

  // Sync tab with URL query parameter if present
  useEffect(() => {
    const tabParam = searchParams.get('tab') as AppTab;
    if (tabParam && ['explore', 'chats', 'create', 'profile'].includes(tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  // Grouped chats for JanitorAI-style "My Chats"
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

      if (file.name.toLowerCase().endsWith('.png') || file.type === 'image/png') {
        const buffer = await file.arrayBuffer();
        const res = parseCharacterFromPng(buffer);
        parsedChar = res.character;
        avatarUrl = res.avatarDataUrl || '';
      } else {
        const text = await file.text();
        parsedChar = parseCharacterCardJson(text);
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
    } catch (err: any) {
      toast.error(err.message || 'Failed to import character card');
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
      } catch (err: any) {
        console.error('Error starting cloud chat:', err);
        toast.error('Error starting cloud chat: ' + err.message);
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
    <div className="flex-1 flex flex-col w-full pb-20">
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
              <div className="relative flex-1 max-w-md">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search characters or keywords..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2.5 rounded-2xl bg-zinc-800/40 dark:bg-zinc-800/60 border border-white/[0.08] text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/40 transition-all"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Action Buttons: Persona Switcher & Create */}
              <div className="flex items-center gap-2 shrink-0">
                {/* Persona Pill: View and Switch Personas */}
                <button
                  onClick={() => setPersonaDrawerOpen(true)}
                  className="px-3 py-2 rounded-full bg-zinc-800/60 hover:bg-zinc-700/60 border border-white/[0.08] text-zinc-200 hover:text-white transition-all apple-button flex items-center gap-1.5 text-xs font-medium shadow-xs"
                  title="Click to view and switch your roleplay persona"
                  aria-label="Your Personas"
                >
                  <User className="w-3.5 h-3.5 text-purple-400" />
                  <span className="hidden sm:inline text-zinc-400">Persona:</span>
                  <span className="font-semibold max-w-[110px] truncate">{activePersonaName}</span>
                </button>

                <button
                  onClick={() => setCreateDrawerOpen(true)}
                  className="px-3.5 py-2 rounded-full bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs apple-button flex items-center gap-1.5 shadow-md shadow-purple-600/20"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create</span>
                </button>
              </div>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 scrollbar-none">
              {tags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSelectedTag(tag)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap apple-button ${
                    selectedTag === tag
                      ? 'bg-purple-600 text-white font-semibold shadow-sm'
                      : 'bg-zinc-800/50 hover:bg-zinc-800 border border-white/[0.06] text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          {/* Jump Back In (Compact Recent Chats Strip with Delete Option) */}
          {chats.length > 0 && !searchQuery && selectedTag === 'All' && (
            <section className="space-y-2.5 pt-1">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-bold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5 text-purple-400" />
                  Continue Recent Chats
                </h2>
                <button
                  onClick={() => setActiveTab('chats')}
                  className="text-xs font-semibold text-purple-400 hover:text-purple-300 flex items-center gap-1 apple-button"
                >
                  View All ({chats.length})
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>

              {/* Horizontal Scroll / Compact Grid of Recent Chats */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
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
                      className="group relative flex items-center justify-between p-3 rounded-2xl bg-zinc-800/40 hover:bg-zinc-800/70 border border-white/[0.06] hover:border-purple-500/30 transition-all cursor-pointer shadow-xs"
                    >
                      <div className="flex items-center space-x-3 truncate">
                        <div className="w-11 h-11 rounded-xl overflow-hidden bg-zinc-800 shrink-0 border border-white/10 relative">
                          <CharacterAvatar
                            name={charName}
                            avatarUrl={avatarUrl}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="truncate">
                          <div className="text-xs sm:text-sm font-semibold text-foreground group-hover:text-purple-300 transition-colors truncate">
                            {charName}
                          </div>
                          <div className="text-[11px] text-muted-foreground truncate">
                            {chat.title}
                          </div>
                          <div className="text-[10px] text-zinc-500 font-medium mt-0.5">
                            {timeFormatted}
                          </div>
                        </div>
                      </div>

                      {/* Delete button on recent chat pill */}
                      <button
                        onClick={(e) => handleDeleteRecentChat(e, chat.id)}
                        className="opacity-0 group-hover:opacity-100 p-2 rounded-lg hover:bg-red-500/20 text-zinc-400 hover:text-red-400 transition-all apple-button shrink-0"
                        title="Delete chat from recent history"
                        aria-label="Delete chat"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
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
              <h2 className="text-xs font-bold tracking-wider text-muted-foreground uppercase flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                Featured Characters
              </h2>
              <span className="text-xs text-muted-foreground">
                {filteredCharacters.length} {filteredCharacters.length === 1 ? 'character' : 'characters'}
              </span>
            </div>

            {filteredCharacters.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-5">
                {filteredCharacters.map((character) => (
                  <div
                    key={character.id}
                    onClick={() => handleStartChat(character)}
                    className="flex flex-col rounded-3xl overflow-hidden bg-zinc-900/40 hover:bg-zinc-800/40 border border-white/[0.06] hover:border-purple-500/30 group cursor-pointer transition-all shadow-sm"
                  >
                    {/* Image & Header */}
                    <div className="relative h-52 w-full overflow-hidden bg-zinc-900">
                      <CharacterAvatar
                        name={character.name}
                        avatarUrl={character.avatar_url}
                        accentColor={character.accent_color}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-transparent pointer-events-none" />

                      {/* Rating badge */}
                      {character.content_rating !== 'sfw' && (
                        <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-red-600/80 backdrop-blur-md text-[10px] font-bold text-white uppercase tracking-wider flex items-center gap-1 shadow-sm">
                          <Flame className="w-3 h-3" />
                          18+
                        </div>
                      )}

                      {/* Name & Tagline */}
                      <div className="absolute bottom-3 left-4 right-4 text-white">
                        <h3 className="font-bold text-base sm:text-lg tracking-tight group-hover:text-purple-300 transition-colors">
                          {character.name}
                        </h3>
                        <p className="text-xs text-zinc-300 line-clamp-1 mt-0.5">
                          {character.tagline}
                        </p>
                      </div>
                    </div>

                    {/* Card Body */}
                    <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {character.description}
                      </p>

                      {/* Tags */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {character.tags?.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="px-2 py-0.5 rounded-md bg-white/[0.05] text-[10px] text-zinc-400"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>

                      {/* Bottom Actions */}
                      <div className="pt-2 border-t border-white/[0.04] flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/c/${character.id}`);
                            }}
                            className="px-2.5 py-1 rounded-full hover:bg-white/10 text-muted-foreground hover:text-foreground text-[11px] transition-colors"
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
                            className="p-1.5 rounded-full hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-colors apple-button"
                            title="Delete character"
                            aria-label="Delete character"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartChat(character);
                          }}
                          className="px-4 py-1.5 rounded-full bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold apple-button flex items-center gap-1 shadow-sm"
                        >
                          Chat
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              /* Empty Search State */
              !loading && (
                <div className="py-14 text-center space-y-3 bg-zinc-900/20 rounded-3xl border border-white/[0.04]">
                  <Compass className="w-8 h-8 text-muted-foreground mx-auto opacity-40" />
                  <h3 className="text-sm font-semibold">No characters found matching &ldquo;{searchQuery}&rdquo;</h3>
                  <p className="text-xs text-muted-foreground">
                    Try adjusting your search query or switching categories.
                  </p>
                </div>
              )
            )}
          </section>
        </div>
      )}

      {/* ─────────────────── FLOATING MOBILE PWA DOCK (Matching JanitorAI Image 3) ─────────────────── */}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="relative w-full max-w-lg bg-[#18181b] border border-white/10 rounded-3xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <BookOpen className="w-4 h-4 text-purple-400" />
                Importing from Janitor AI & Chub
              </h3>
              <button
                onClick={() => setShowImportGuide(false)}
                className="p-1 rounded-full text-zinc-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs text-muted-foreground">
              <div className="p-3.5 rounded-2xl bg-white/[0.03] space-y-1">
                <span className="font-semibold text-foreground block">1. Export Card</span>
                <p>On Janitor AI or Chub.ai, open any character and click <em>Export / Download Card (PNG or JSON)</em>.</p>
              </div>
              <div className="p-3.5 rounded-2xl bg-white/[0.03] space-y-1">
                <span className="font-semibold text-foreground block">2. Tap Import Card</span>
                <p>Select your downloaded image or JSON file. Cadenza automatically extracts personality, scenario, greeting, and embedded avatar.</p>
              </div>
              <div className="p-3.5 rounded-2xl bg-white/[0.03] space-y-1">
                <span className="font-semibold text-foreground block">3. Immediate Play</span>
                <p>The character is ready to chat immediately with deep memory and uncensored responses.</p>
              </div>
            </div>
            <button
              onClick={() => setShowImportGuide(false)}
              className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold apple-button"
            >
              Got it
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
          <div className="w-8 h-8 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
        </div>
      }
    >
      <HomePageContent />
    </React.Suspense>
  );
}
