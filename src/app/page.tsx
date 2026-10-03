'use client';

import React, { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  Compass,
  MessageSquare,
  Flame,
  Search,
  Plus,
  BookOpen,
  ArrowRight,
  Upload,
  UserPlus,
  Shield,
  Zap,
  HelpCircle,
} from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import { parseCharacterCardJson, parseCharacterFromPng, makeCharacter } from '@/lib/cards/card-parser';
import { toast } from 'sonner';
import type { Character, Chat } from '@/lib/supabase/types';

export default function HomePage() {
  const router = useRouter();
  const [settings] = useSettings();
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('All');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [recentChats, setRecentChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [showImportGuide, setShowImportGuide] = useState(false);

  const tags = ['All', 'Fantasy', 'Romance', 'Sci-Fi', 'Cyberpunk', 'Mystery', 'Mature', 'Companion'];

  const loadData = async () => {
    setLoading(true);
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

      // 3. Combine without duplicates
      const dbList = (dbChars as Character[]) || [];
      const dbIds = new Set(dbList.map((c) => c.id));
      const combined = [...dbList, ...localChars.filter((c) => !dbIds.has(c.id))];
      setCharacters(combined);

      // 4. Fetch user's recent chats if authenticated
      const { data: authData } = await supabase.auth.getUser();
      if (authData.user) {
        const { data: chatsData } = await supabase
          .from('chats')
          .select('*, character:characters(*)')
          .eq('archived', false)
          .order('last_message_at', { ascending: false })
          .limit(6);

        if (chatsData) {
          setRecentChats(chatsData as Chat[]);
        }
      }
    } catch (err) {
      console.error('Failed to load characters:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [supabase]);

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
        avatar_url: avatarUrl || parsedChar.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
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

  // Filtered characters
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

  const handleStartChat = async (character: Character) => {
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;

    if (userId) {
      const { data: newChat, error } = await supabase
        .from('chats')
        .insert({
          user_id: userId,
          character_id: character.id,
          title: `Chat with ${character.name}`,
          persona_id: settings.activePersonaId || null,
        })
        .select()
        .single();

      if (!error && newChat) {
        router.push(`/chat/${newChat.id}`);
        return;
      }
    }

    // Guest / local fallback session
    const localChatId = 'local-' + Date.now();
    router.push(`/chat/${localChatId}?charId=${encodeURIComponent(character.id || character.name)}`);
  };

  return (
    <div className="flex-1 flex flex-col max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 md:py-10 space-y-10">
      {/* Top Banner / Hero */}
      <section className="relative overflow-hidden rounded-3xl p-8 sm:p-12 glass-card border border-black/[0.06] dark:border-white/[0.08] shadow-sm">
        <div className="relative z-10 max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" />
            DeepSeek V4.1 Flash • 1M Context Engine
          </div>

          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-foreground leading-[1.12]">
            Your Private Roleplay Studio.
            <br />
            <span className="text-muted-foreground font-normal">Uncensored Fiction & Deep Memory.</span>
          </h1>

          <p className="text-sm sm:text-base text-muted-foreground max-w-xl leading-relaxed">
            Create completely custom characters from scratch, auto-generate them with DeepSeek, or drop in cards from Janitor AI and Chub AI.
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <Link
              href="/c/new"
              className="px-5 py-2.5 rounded-full bg-accent text-white hover:bg-accent-hover font-semibold text-xs sm:text-sm apple-button flex items-center gap-2 shadow-md shadow-accent/20"
            >
              <UserPlus className="w-4 h-4" />
              Create Character
            </Link>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] text-foreground font-medium text-xs sm:text-sm apple-button flex items-center gap-2"
            >
              <Upload className="w-4 h-4" />
              Import Card (JSON / PNG)
            </button>

            <button
              onClick={() => setShowImportGuide(!showImportGuide)}
              className="px-3.5 py-2.5 rounded-full hover:bg-black/[0.04] dark:hover:bg-white/[0.06] text-muted-foreground hover:text-foreground text-xs apple-button flex items-center gap-1.5"
            >
              <HelpCircle className="w-4 h-4" />
              <span>Import Guide</span>
            </button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json, .png, image/png, application/json"
              onChange={handleDirectImport}
              className="hidden"
            />
          </div>
        </div>

        {/* Ambient subtle glow background */}
        <div className="absolute -right-20 -bottom-20 w-96 h-96 rounded-full bg-gradient-to-tr from-accent/20 to-purple-500/10 blur-3xl pointer-events-none" />
      </section>

      {/* Janitor AI / Chub AI Import Guide (Expandable) */}
      {showImportGuide && (
        <section className="p-6 rounded-3xl glass-panel border border-accent/20 bg-accent/5 space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-foreground">
              <BookOpen className="w-4 h-4 text-accent" />
              How to Import from Janitor AI, Chub AI & Tavern
            </h3>
            <button
              onClick={() => setShowImportGuide(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs text-muted-foreground">
            <div className="p-4 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] space-y-2">
              <span className="font-semibold text-foreground block">1. Download Card</span>
              <p>
                On <strong>Janitor AI</strong>, <strong>Chub.ai</strong>, or <strong>CharacterHub</strong>, find any character and click <em>Export / Download Card</em>. You can download either a <code>.png</code> character image or <code>.json</code> file.
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] space-y-2">
              <span className="font-semibold text-foreground block">2. Click Import Card</span>
              <p>
                Click <strong>Import Card (JSON / PNG)</strong> above and select the downloaded file. Cadenza automatically extracts the name, backstory, personality, greeting, and embedded avatar.
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-black/[0.03] dark:bg-white/[0.04] space-y-2">
              <span className="font-semibold text-foreground block">3. Chat Immediately</span>
              <p>
                Your imported character is added to your roster instantly. Click <strong>Chat</strong> to begin roleplaying powered by DeepSeek V4.1 Flash with layered memory.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* Recent Chats Shelf */}
      {recentChats.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wider text-muted-foreground uppercase flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-accent" />
              Continue Recent Chats
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {recentChats.map((chat) => (
              <Link
                key={chat.id}
                href={`/chat/${chat.id}`}
                className="group flex items-center justify-between p-4 rounded-2xl glass-card hover:border-accent/40 transition-all shadow-sm"
              >
                <div className="flex items-center space-x-3 truncate">
                  <div className="w-10 h-10 rounded-full overflow-hidden bg-black/10 shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={
                        (chat as any).character?.avatar_url ||
                        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80'
                      }
                      alt="Avatar"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  </div>
                  <div className="truncate">
                    <div className="text-sm font-medium group-hover:text-accent transition-colors truncate">
                      {(chat as any).character?.name || chat.title}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {chat.title}
                    </div>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-accent group-hover:translate-x-1 transition-all" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Roster / Gallery Section */}
      <section id="gallery" className="space-y-6">
        {/* Search & Tags */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search your characters by name or keywords..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 rounded-full bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          {/* Tags Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
            {tags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                  selectedTag === tag
                    ? 'bg-foreground text-background font-semibold shadow-sm'
                    : 'bg-black/[0.04] dark:bg-white/[0.06] text-muted-foreground hover:text-foreground'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* Character Cards Grid */}
        {filteredCharacters.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-6">
            {filteredCharacters.map((character) => (
              <div
                key={character.id}
                className="flex flex-col rounded-3xl overflow-hidden glass-card group cursor-pointer"
                onClick={() => handleStartChat(character)}
              >
                {/* Image & Header */}
                <div className="relative h-48 w-full overflow-hidden bg-black/10">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={character.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80'}
                    alt={character.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                  {/* Rating badge */}
                  {character.content_rating !== 'sfw' && (
                    <div className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-red-500/80 backdrop-blur-md text-[10px] font-bold text-white uppercase tracking-wider flex items-center gap-1">
                      <Flame className="w-3 h-3" />
                      18+
                    </div>
                  )}

                  {/* Name & Tagline */}
                  <div className="absolute bottom-3 left-4 right-4 text-white">
                    <h3 className="font-semibold text-base sm:text-lg tracking-tight group-hover:text-accent transition-colors">
                      {character.name}
                    </h3>
                    <p className="text-xs text-white/80 line-clamp-1">
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
                        className="px-2 py-0.5 rounded-md bg-black/[0.04] dark:bg-white/[0.06] text-[10px] text-muted-foreground"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Bottom Actions */}
                  <div className="pt-2 border-t border-black/[0.04] dark:border-white/[0.06] flex items-center justify-between text-xs">
                    <span className="text-muted-foreground text-[11px]">
                      {character.first_message ? 'Ready to chat' : 'Custom'}
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/c/${character.id}`);
                        }}
                        className="px-2.5 py-1 rounded-full hover:bg-black/5 dark:hover:bg-white/10 text-muted-foreground hover:text-foreground text-[11px] transition-colors"
                      >
                        Details
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleStartChat(character);
                        }}
                        className="px-3.5 py-1 rounded-full bg-accent text-white hover:bg-accent-hover text-xs font-semibold apple-button flex items-center gap-1 shadow-sm"
                      >
                        Chat
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Apple-grade Empty State */}
        {characters.length === 0 && !loading && (
          <div className="py-14 px-6 rounded-3xl glass-card border border-dashed border-black/10 dark:border-white/15 text-center max-w-2xl mx-auto space-y-5 animate-in fade-in duration-300">
            <div className="w-14 h-14 rounded-2xl bg-accent/15 flex items-center justify-center text-accent mx-auto">
              <UserPlus className="w-7 h-7" />
            </div>

            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold tracking-tight">Your Character Roster is Empty</h3>
              <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
                Create a bespoke roleplay character, generate one with DeepSeek V4.1 Flash, or import any Character Card (JSON or PNG) from Janitor AI or Chub.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <Link
                href="/c/new"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-accent text-white text-xs sm:text-sm font-semibold apple-button shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Create First Character
              </Link>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] text-xs sm:text-sm font-medium apple-button"
              >
                <Upload className="w-4 h-4" />
                Import Janitor / Chub Card
              </button>
            </div>
          </div>
        )}

        {/* Filtered empty state (when search produces 0 matches) */}
        {characters.length > 0 && filteredCharacters.length === 0 && !loading && (
          <div className="py-12 text-center space-y-3">
            <Compass className="w-8 h-8 text-muted-foreground mx-auto opacity-50" />
            <h3 className="text-sm font-semibold">No characters matching &ldquo;{searchQuery}&rdquo;</h3>
            <p className="text-xs text-muted-foreground">
              Try adjusting your search terms or filter tags.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
