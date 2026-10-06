'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  SlidersHorizontal,
  Menu,
  ChevronRight,
  Compass,
  X,
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
    const result = groups.filter((g) => {
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

  const sortOptions = [
    { value: 'recent' as const, label: 'Most recent' },
    { value: 'name' as const, label: 'Character name' },
    { value: 'chats' as const, label: 'Most chat threads' },
  ];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col space-y-4 px-4 pt-3 pb-24 sm:px-6">
      {/* Top Bar: Sort | "My chats" | Settings */}
      <div className="relative flex h-12 items-center justify-between">
        {/* Left: Filter / Sort button */}
        <div className="relative">
          <button
            onClick={() => setShowSortMenu(!showSortMenu)}
            className={`icon-btn border ${
              showSortMenu ? 'text-accent-text bg-accent-wash border-accent-line' : 'text-ink-2 border-line'
            }`}
            aria-label="Sort conversations"
            aria-expanded={showSortMenu}
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>

          {showSortMenu && (
            <div className="panel bg-raised absolute top-full left-0 z-30 mt-2 w-48 p-1.5 animate-in fade-in duration-150">
              <div className="type-meta px-3 py-1.5">Sort conversations</div>
              {sortOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => {
                    setSortOption(option.value);
                    setShowSortMenu(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs transition-colors ${
                    sortOption === option.value
                      ? 'text-accent-text bg-accent-wash font-medium'
                      : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  <span>{option.label}</span>
                  {sortOption === option.value && (
                    <span className="bg-accent h-1.5 w-1.5 rounded-full" aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Center: Title */}
        <h1 className="type-page">My chats</h1>

        {/* Right: Settings button */}
        <button
          onClick={onOpenSettings}
          className="icon-btn border border-line text-ink-2"
          aria-label="Settings"
        >
          <Menu className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {/* Search */}
      <div className="relative w-full">
        <Search
          className="pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2 text-ink-3"
          aria-hidden="true"
        />
        <input
          type="text"
          placeholder="Search by name, e.g. Elara…"
          aria-label="Search your chats"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="field pr-10 pl-11"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
            className="icon-btn absolute top-1/2 right-2 h-7 w-7 -translate-y-1/2"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Character index */}
      <div className="divide-y divide-line">
        {filteredGroups.length === 0 ? (
          <div className="space-y-4 px-6 py-16 text-center">
            <div className="space-y-1">
              <h3 className="type-display text-2xl">
                {searchQuery ? 'No matching characters' : 'No chats yet'}
              </h3>
              <p className="mx-auto max-w-sm text-sm text-ink-2">
                {searchQuery
                  ? 'Try a different name or spelling.'
                  : 'Pick a character and start a conversation. Your chats will appear here.'}
              </p>
            </div>
            {!searchQuery && (
              <button onClick={onExploreClick} className="btn btn-primary text-xs">
                <Compass className="h-4 w-4" aria-hidden="true" />
                Explore characters
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
                className="group flex cursor-pointer items-center justify-between gap-3.5 py-3 transition-colors hover:bg-[color-mix(in_oklab,var(--ink)_4%,transparent)]"
              >
                {/* Left: portrait plate */}
                <div className="bg-sunken h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-line">
                  <CharacterAvatar
                    name={group.character.name}
                    avatarUrl={group.character.avatar_url}
                    accentColor={group.character.accent_color}
                    className="h-full w-full object-cover"
                  />
                </div>

                {/* Center: name and counts */}
                <div className="min-w-0 flex-1">
                  <h3 className="truncate font-serif text-[17px] leading-snug text-ink">
                    {group.character.name}
                  </h3>

                  <div className="mt-1 flex items-center gap-2">
                    <span className="chip">
                      {chatCount} {chatCount === 1 ? 'chat' : 'chats'}
                    </span>
                    {group.character.content_rating !== 'sfw' && (
                      <span className="chip chip-danger">18+</span>
                    )}
                  </div>
                </div>

                {/* Right: timestamp and chevron */}
                <div className="flex shrink-0 items-center gap-2">
                  <span className="type-meta">{timeStr}</span>
                  <ChevronRight
                    className="h-4 w-4 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5"
                    aria-hidden="true"
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
