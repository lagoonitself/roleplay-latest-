'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
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
  const sortMenuRef = useRef<HTMLDivElement>(null);

  // Close sort menu on Escape or outside click
  useEffect(() => {
    if (!showSortMenu) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowSortMenu(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setShowSortMenu(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSortMenu]);

  // Filter and sort groups
  const filteredGroups = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    const result = groups.filter((g) => {
      if (!q) return true;
      return (
        g.character.name.toLowerCase().includes(q) ||
        g.character.tagline?.toLowerCase().includes(q) ||
        g.chats.some((c) => c.title?.toLowerCase().includes(q))
      );
    });

    return [...result].sort((a, b) => {
      if (sortOption === 'recent') {
        return new Date(b.lastMessageAt || 0).getTime() - new Date(a.lastMessageAt || 0).getTime();
      }
      if (sortOption === 'name') {
        return a.character.name.localeCompare(b.character.name);
      }
      if (sortOption === 'chats') {
        return b.chats.length - a.chats.length;
      }
      return 0;
    });
  }, [groups, searchQuery, sortOption]);

  const sortOptions = [
    { value: 'recent' as const, label: 'Most recent' },
    { value: 'name' as const, label: 'Character name' },
    { value: 'chats' as const, label: 'Most chat threads' },
  ];

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col space-y-4 px-4 pt-3 pb-6 sm:px-6">
      {/* Top Bar: Sort | "My chats" | Settings */}
      <div className="relative flex h-12 items-center justify-between">
        {/* Left: Filter / Sort button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowSortMenu(!showSortMenu)}
            className={`icon-btn border ${
              showSortMenu ? 'text-accent-text bg-accent-wash border-accent-line' : 'text-ink-2 border-line'
            }`}
            aria-label="Sort conversations"
            aria-expanded={showSortMenu}
            aria-haspopup="true"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>

          {showSortMenu && (
            <div
              ref={sortMenuRef}
              role="menu"
              aria-label="Sort options"
              className="panel bg-raised shadow-float absolute top-full left-0 z-30 mt-2 w-48 p-1.5 animate-in fade-in duration-150"
            >
              <div className="type-meta px-3 py-1.5">Sort conversations</div>
              {sortOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={sortOption === option.value}
                  onClick={() => {
                    setSortOption(option.value);
                    setShowSortMenu(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs transition-colors ${
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
          type="button"
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
          type="search"
          enterKeyHint="search"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="Search by name, e.g. Elara…"
          aria-label="Search your chats"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="field pr-10 pl-11"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
            className="icon-btn absolute top-1/2 right-2 h-7 w-7 -translate-y-1/2"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Character index as iOS-style list */}
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
              <button
                type="button"
                onClick={onExploreClick}
                className="btn btn-primary text-xs"
              >
                <Compass className="h-4 w-4" aria-hidden="true" />
                Explore characters
              </button>
            )}
          </div>
        ) : (
          filteredGroups.map((group) => {
            const timeStr = formatChatTimestamp(group.lastMessageAt);
            const chatCount = group.chats.length;

            const latestChat =
              group.chats.length > 0
                ? [...group.chats].sort((a, b) => {
                    const timeA = new Date(a.last_message_at || a.created_at || 0).getTime();
                    const timeB = new Date(b.last_message_at || b.created_at || 0).getTime();
                    return timeB - timeA;
                  })[0]
                : null;

            const cleanTitle = latestChat?.title?.replace(/^Chat with\s+/i, '').trim();
            const hasCustomTitle = Boolean(
              cleanTitle && cleanTitle.toLowerCase() !== group.character.name.toLowerCase()
            );
            const preview =
              (hasCustomTitle ? cleanTitle : null) ||
              group.character.first_message ||
              group.character.tagline ||
              'Start the story…';

            return (
              <button
                key={group.characterId}
                type="button"
                onClick={() => onSelectCharacter(group.character)}
                className="row-press group flex min-h-16 w-full items-center gap-3.5 py-3 text-left transition-colors"
              >
                {/* Left: portrait plate 48px */}
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-line bg-sunken">
                  <CharacterAvatar
                    name={group.character.name}
                    avatarUrl={group.character.avatar_url}
                    accentColor={group.character.accent_color}
                    className="h-full w-full object-cover"
                  />
                </div>

                {/* Center: name, last message preview, and timestamp */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="truncate font-serif text-[17px] font-medium leading-snug text-ink">
                        {group.character.name}
                      </h3>
                      {group.character.content_rating !== 'sfw' && (
                        <span className="chip chip-danger shrink-0 text-[10px] px-1.5 py-0">18+</span>
                      )}
                    </div>
                    <span className="type-meta shrink-0 ml-2">{timeStr}</span>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className="type-meta truncate text-xs text-ink-2">
                      {preview}
                    </p>
                    {chatCount > 1 && (
                      <span className="chip shrink-0 text-[10px] px-1.5 py-0">
                        {chatCount}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: chevron indicator */}
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-ink-3 transition-transform duration-150 group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
