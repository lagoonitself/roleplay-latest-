'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  SlidersHorizontal,
  Menu,
  ChevronRight,
  Layers,
  MessageSquare,
  Sparkles,
  Compass,
  X,
  Trash2,
} from 'lucide-react';
import { CharacterAvatar } from '@/components/character-avatar';
import { formatChatTimestamp, type CharacterChatGroup } from '@/lib/chats/chat-manager';
import type { Character } from '@/lib/supabase/types';

interface MyChatsViewProps {
  groups: CharacterChatGroup[];
  onSelectCharacter: (character: Character) => void;
  onExploreClick: () => void;
  onOpenSettings?: () => void;
}

export function MyChatsView({
  groups,
  onSelectCharacter,
  onExploreClick,
  onOpenSettings,
}: MyChatsViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<'recent' | 'name' | 'chats'>('recent');
  const [showSortMenu, setShowSortMenu] = useState(false);

  // Filter and sort groups
  const filteredGroups = useMemo(() => {
    let result = groups.filter((g) => {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      return (
        g.character.name.toLowerCase().includes(q) ||
        g.character.tagline?.toLowerCase().includes(q) ||
        g.chats.some((c) => c.title?.toLowerCase().includes(q))
      );
    });

    if (sortOption === 'recent') {
      result.sort((a, b) => new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime());
    } else if (sortOption === 'name') {
      result.sort((a, b) => a.character.name.localeCompare(b.character.name));
    } else if (sortOption === 'chats') {
      result.sort((a, b) => b.chats.length - a.chats.length);
    }

    return result;
  }, [groups, searchQuery, sortOption]);

  return (
    <div className="flex-1 flex flex-col w-full max-w-2xl mx-auto px-4 sm:px-6 pt-3 pb-24 space-y-4">
      {/* Top Bar: Filter Icon | "My Chats" Title | Menu / Settings (Matches JanitorAI Image 3) */}
      <div className="flex items-center justify-between h-12 relative">
        {/* Left: Filter / Sort button */}
        <div className="relative">
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors apple-button border ${
              showSortMenu
                ? 'bg-purple-600/20 border-purple-500/30 text-purple-400'
                : 'bg-zinc-800/80 hover:bg-zinc-700/80 border-white/[0.08] text-zinc-300'
            }`}
            aria-label="Filter and Sort"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>

          {showSortMenu && (
            <div className="absolute left-0 top-full mt-2 w-48 rounded-2xl bg-[#202024] border border-white/10 shadow-xl p-1.5 z-30 animate-in fade-in duration-150">
              <div className="px-3 py-1.5 text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                Sort Conversations
              </div>
              <button
                onClick={() => {
                  setSortOption('recent');
                  setShowSortMenu(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between ${
                  sortOption === 'recent'
                    ? 'bg-purple-600/30 text-purple-300 font-semibold'
                    : 'text-zinc-300 hover:bg-white/5'
                }`}
              >
                <span>Most Recent</span>
                {sortOption === 'recent' && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
              </button>
              <button
                onClick={() => {
                  setSortOption('name');
                  setShowSortMenu(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between ${
                  sortOption === 'name'
                    ? 'bg-purple-600/30 text-purple-300 font-semibold'
                    : 'text-zinc-300 hover:bg-white/5'
                }`}
              >
                <span>Character Name</span>
                {sortOption === 'name' && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
              </button>
              <button
                onClick={() => {
                  setSortOption('chats');
                  setShowSortMenu(false);
                }}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs flex items-center justify-between ${
                  sortOption === 'chats'
                    ? 'bg-purple-600/30 text-purple-300 font-semibold'
                    : 'text-zinc-300 hover:bg-white/5'
                }`}
              >
                <span>Most Chat Threads</span>
                {sortOption === 'chats' && <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />}
              </button>
            </div>
          )}
        </div>

        {/* Center: "My Chats" Title */}
        <h1 className="text-base sm:text-lg font-bold tracking-tight text-foreground">
          My Chats
        </h1>

        {/* Right: Hamburger / Settings button */}
        <button
          onClick={onOpenSettings}
          className="w-10 h-10 rounded-full flex items-center justify-center bg-zinc-800/80 hover:bg-zinc-700/80 border border-white/[0.08] text-zinc-300 transition-colors apple-button"
          aria-label="Settings"
        >
          <Menu className="w-4 h-4" />
        </button>
      </div>

      {/* Search Bar: "Enter character name" (Matches JanitorAI Image 3) */}
      <div className="relative w-full">
        <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-zinc-400" />
        <input
          type="text"
          placeholder="Enter character name"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-11 pr-10 py-3 rounded-2xl bg-zinc-800/70 hover:bg-zinc-800 focus:bg-zinc-800 border border-white/[0.08] focus:border-purple-500/40 text-sm text-foreground placeholder:text-zinc-500 focus:outline-none transition-all shadow-inner"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-200"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Character Chats List (Matches JanitorAI Image 3) */}
      <div className="space-y-1.5 divide-y divide-white/[0.04]">
        {filteredGroups.length === 0 ? (
          <div className="py-16 text-center space-y-4 px-6 rounded-3xl bg-zinc-900/40 border border-white/[0.06]">
            <div className="w-14 h-14 rounded-2xl bg-purple-500/15 text-purple-400 flex items-center justify-center mx-auto">
              <MessageSquare className="w-7 h-7" />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-base text-foreground">
                {searchQuery ? 'No matching characters' : 'No chats yet'}
              </h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                {searchQuery
                  ? 'Try searching with a different character name.'
                  : 'Start an uncensored roleplay story with any character to manage conversations here.'}
              </p>
            </div>
            {!searchQuery && (
              <button
                onClick={onExploreClick}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs apple-button shadow-md shadow-purple-600/20"
              >
                <Compass className="w-4 h-4" />
                Explore Characters
              </button>
            )}
          </div>
        ) : (
          filteredGroups.map((group) => {
            const timeStr = formatChatTimestamp(group.lastMessageAt);
            const chatCount = group.chats.length;

            return (
              <div
                key={group.characterId}
                onClick={() => onSelectCharacter(group.character)}
                className="group flex items-center justify-between gap-3.5 py-3 px-3 -mx-2 rounded-2xl hover:bg-zinc-800/50 active:bg-zinc-800/80 cursor-pointer transition-colors"
              >
                {/* Left: Avatar (Square with smooth rounded corners, ~52px) */}
                <div className="w-13 h-13 rounded-2xl overflow-hidden bg-zinc-800 shrink-0 border border-white/10 shadow-sm relative">
                  <CharacterAvatar
                    name={group.character.name}
                    avatarUrl={group.character.avatar_url}
                    accentColor={group.character.accent_color}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                </div>

                {/* Center: Character Name & "X chats" purple pill */}
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-sm sm:text-base text-foreground group-hover:text-purple-300 transition-colors truncate">
                    {group.character.name}
                  </h3>

                  <div className="flex items-center gap-2 mt-1">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-semibold text-[11px] border border-purple-500/25">
                      <Layers className="w-3 h-3" />
                      {chatCount} {chatCount === 1 ? 'chat' : 'chats'}
                    </span>
                    {group.character.content_rating !== 'sfw' && (
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                        18+
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: Timestamp & Chevron Arrow */}
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-zinc-400 font-medium">
                    {timeStr}
                  </span>
                  <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
