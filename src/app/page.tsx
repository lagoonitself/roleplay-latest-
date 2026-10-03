'use client';

import React, { useState, useEffect } from 'react';
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
  Heart,
  SlidersHorizontal,
} from 'lucide-react';
import { DEFAULT_CHARACTERS } from '@/lib/data/default-characters';
import { createClient } from '@/lib/supabase/client';
import { useSettings } from '@/lib/store/settings';
import type { Character, Chat } from '@/lib/supabase/types';

export default function HomePage() {
  const router = useRouter();
  const [settings] = useSettings();
  const supabase = createClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('All');
  const [characters, setCharacters] = useState<Character[]>([]);
  const [recentChats, setRecentChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);

  const tags = ['All', 'Fantasy', 'Romance', 'Sci-Fi', 'Cyberpunk', 'Mystery', 'Mature', 'Companion'];

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        // Fetch custom characters from Supabase if any
        const { data: dbChars } = await supabase
          .from('characters')
          .select('*')
          .order('created_at', { ascending: false });

        // Merge DB characters with default seed characters
        const defaultFormatted = DEFAULT_CHARACTERS.map((c, i) => ({
          id: `seed-${i}-${c.name.toLowerCase().replace(/\s+/g, '-')}`,
          user_id: 'default',
          created_at: new Date(Date.now() - i * 86400000).toISOString(),
          updated_at: new Date().toISOString(),
          ...c,
        })) as Character[];

        const combined = [...(dbChars || []), ...defaultFormatted];
        setCharacters(combined);

        // Fetch user's recent chats if authenticated
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
    }

    loadData();
  }, [supabase]);

  // Filtered characters
  const filteredCharacters = characters.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.tagline.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description.toLowerCase().includes(searchQuery.toLowerCase());

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
      // Create new chat session in Supabase
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
    router.push(`/chat/${localChatId}?charId=${encodeURIComponent(character.name)}`);
  };

  return (
    <div className="flex-1 flex flex-col max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 md:py-10 space-y-10">
      {/* Hero Section */}
      <section className="relative overflow-hidden rounded-3xl p-8 sm:p-12 glass-card border border-black/[0.06] dark:border-white/[0.08] shadow-sm">
        <div className="relative z-10 max-w-2xl space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-semibold uppercase tracking-wider">
            <Sparkles className="w-3.5 h-3.5" />
            DeepSeek V4.1 Flash • 1M Context Engine
          </div>

          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight text-foreground leading-[1.12]">
            Immersive Roleplay.
            <br />
            <span className="text-muted-foreground font-normal">Uncensored Fiction & Deep Memory.</span>
          </h1>

          <p className="text-sm sm:text-base text-muted-foreground max-w-xl leading-relaxed">
            Craft deep personas, explore intricate storylines, and co-author stories with true long-term memory and high-velocity streaming powered by your OpenCode Go subscription.
          </p>

          <div className="pt-2 flex flex-wrap items-center gap-3">
            <Link
              href="/c/new"
              className="px-5 py-2.5 rounded-full bg-accent text-white hover:bg-accent-hover text-xs sm:text-sm font-medium apple-button flex items-center gap-2 shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Create Character
            </Link>
            <a
              href="#gallery"
              className="px-5 py-2.5 rounded-full bg-black/[0.05] dark:bg-white/[0.08] hover:bg-black/[0.08] dark:hover:bg-white/[0.12] text-xs sm:text-sm font-medium apple-button flex items-center gap-2"
            >
              <Compass className="w-4 h-4" />
              Explore Characters
            </a>
          </div>
        </div>

        {/* Ambient background glow */}
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full bg-accent/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 right-48 w-80 h-80 rounded-full bg-purple-500/15 blur-3xl pointer-events-none" />
      </section>

      {/* Continue Chatting Shelf (If any) */}
      {recentChats.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-accent" />
              Continue Where You Left Off
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {recentChats.map((chat) => (
              <Link
                key={chat.id}
                href={`/chat/${chat.id}`}
                className="p-4 rounded-2xl glass-card flex items-center gap-3 group"
              >
                <div className="w-12 h-12 rounded-xl overflow-hidden bg-black/10 shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={chat.character?.avatar_url || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80'}
                    alt={chat.character?.name || 'Character'}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate group-hover:text-accent transition-colors">
                    {chat.character?.name || chat.title}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {chat.message_count} messages • Active
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-accent group-hover:translate-x-1 transition-all" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Gallery Section */}
      <section id="gallery" className="space-y-6">
        {/* Search & Tags */}
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
          {/* Search bar */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by name, archetype, or keywords..."
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

                {/* Name & Tagline on Card Top Overlay */}
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
                    {character.chat_count || 12} stories
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

        {filteredCharacters.length === 0 && !loading && (
          <div className="py-16 text-center space-y-3">
            <Compass className="w-8 h-8 text-muted-foreground mx-auto opacity-50" />
            <h3 className="text-sm font-semibold">No characters found</h3>
            <p className="text-xs text-muted-foreground">
              Try adjusting your search terms or create your own custom roleplay character.
            </p>
            <Link
              href="/c/new"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-accent text-white text-xs font-medium apple-button"
            >
              <Plus className="w-3.5 h-3.5" />
              Create New Character
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
