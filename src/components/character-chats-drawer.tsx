'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  Plus,
  Trash2,
  MoreVertical,
  MessageSquare,
  ArrowUpDown,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { CharacterAvatar } from '@/components/character-avatar';
import { formatChatTimestamp, deleteChat, deleteChatsForCharacter, deleteCharacter } from '@/lib/chats/chat-manager';
import { toast } from 'sonner';
import type { Character, Chat } from '@/lib/supabase/types';

interface CharacterChatsDrawerProps {
  open: boolean;
  onClose: () => void;
  character: Character | null;
  chats: Chat[];
  onStartNewChat: (character: Character) => void;
  onChatDeleted?: () => void;
  onCharacterDeleted?: () => void;
}

export function CharacterChatsDrawer({
  open,
  onClose,
  character,
  chats,
  onStartNewChat,
  onChatDeleted,
  onCharacterDeleted,
}: CharacterChatsDrawerProps) {
  const [sortOrder, setSortOrder] = useState<'latest' | 'oldest'>('latest');
  const [menuOpen, setMenuOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [confirmDeleteCharacter, setConfirmDeleteCharacter] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Handle Escape key for nested menus and confirmation dialogs
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmDeleteCharacter) {
          e.stopPropagation();
          setConfirmDeleteCharacter(false);
        } else if (confirmDeleteAll) {
          e.stopPropagation();
          setConfirmDeleteAll(false);
        } else if (menuOpen) {
          e.stopPropagation();
          setMenuOpen(false);
        }
      }
    };
    if (open) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, menuOpen, confirmDeleteAll, confirmDeleteCharacter]);

  // Click outside to close 3-dots more menu
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  // Sort chats based on selected tab: 'latest' vs 'oldest'
  const sortedChats = useMemo(() => {
    return [...chats].sort((a, b) => {
      const timeA = new Date(a.last_message_at || a.created_at || 0).getTime();
      const timeB = new Date(b.last_message_at || b.created_at || 0).getTime();
      return sortOrder === 'latest' ? timeB - timeA : timeA - timeB;
    });
  }, [chats, sortOrder]);

  const handleDeleteSingleChat = async (e: React.MouseEvent, chatId: string) => {
    e.stopPropagation();
    try {
      setDeletingId(chatId);
      await deleteChat(chatId);
      toast.success('Chat deleted');
      onChatDeleted?.();
      // If no chats left for this character, close the drawer
      if (chats.length <= 1) {
        onClose();
      }
    } catch {
      toast.error('Failed to delete chat');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteAllChats = async () => {
    if (!character) return;
    try {
      const chatIds = chats.map((c) => c.id);
      await deleteChatsForCharacter(character.id, chatIds);
      toast.success(`Deleted all chats with ${character.name}`);
      setConfirmDeleteAll(false);
      setMenuOpen(false);
      onChatDeleted?.();
      onClose();
    } catch {
      toast.error('Failed to delete chats');
    }
  };

  const handleDeleteCharacterFromRoster = async () => {
    if (!character) return;
    try {
      await deleteCharacter(character.id);
      toast.success(`Removed "${character.name}" from your roster`);
      setConfirmDeleteCharacter(false);
      setMenuOpen(false);
      onCharacterDeleted?.();
      onClose();
    } catch {
      toast.error('Failed to delete character');
    }
  };

  return (
    <>
      <Sheet
        open={open && !!character}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        size="tall"
        title={character?.name || 'Chats'}
        description={
          character
            ? `${chats.length} ${chats.length === 1 ? 'conversation' : 'conversations'}`
            : undefined
        }
        footer={
          character ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onStartNewChat(character);
              }}
              className="btn btn-primary w-full min-h-11"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Start new chat
            </button>
          ) : null
        }
        bodyClassName="px-4 pb-4 space-y-3"
      >
        {character && (
          <>
            {/* Sub-header bar: Character avatar plate + more actions menu */}
            <div className="flex items-center justify-between gap-3 pb-3 border-b border-line">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-line bg-sunken">
                  <CharacterAvatar
                    name={character.name}
                    avatarUrl={character.avatar_url}
                    accentColor={character.accent_color}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="min-w-0 truncate text-xs text-ink-2">
                      {character.tagline || 'Character conversations'}
                    </p>
                    {character.content_rating !== 'sfw' && (
                      <span className="chip chip-danger text-[10px] px-1.5 py-0 shrink-0">18+</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Character Actions: View profile + More Options */}
              <div className="relative shrink-0 flex items-center gap-1">
                <Link
                  href={`/c/${character.id}`}
                  onClick={onClose}
                  className="icon-btn text-ink-2 hover:text-ink min-h-11 min-w-11"
                  aria-label="View character profile"
                  title="View character profile"
                >
                  <ExternalLink className="h-4 w-4" aria-hidden="true" />
                </Link>

                <div className="relative" ref={menuRef}>
                  <button
                    type="button"
                    onClick={() => setMenuOpen(!menuOpen)}
                    className="icon-btn text-ink-2 hover:text-ink min-h-11 min-w-11"
                    aria-label="More options"
                    aria-expanded={menuOpen}
                  >
                    <MoreVertical className="h-4 w-4" aria-hidden="true" />
                  </button>

                  {menuOpen && (
                    <div className="panel bg-raised shadow-float absolute right-0 top-full z-30 mt-1 w-56 p-1.5 animate-in fade-in duration-150">
                      <Link
                        href={`/c/${character.id}`}
                        onClick={() => {
                          setMenuOpen(false);
                          onClose();
                        }}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-ink-2 hover:text-ink"
                      >
                        <ExternalLink className="h-4 w-4 text-ink-3" aria-hidden="true" />
                        View character profile
                      </Link>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteAll(true);
                          setMenuOpen(false);
                        }}
                        className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs text-danger hover:bg-danger-wash"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Delete all chats with {character.name}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setConfirmDeleteCharacter(true);
                          setMenuOpen(false);
                        }}
                        className="mt-1 flex w-full items-center gap-2.5 border-t border-line pt-2 px-3 py-2 text-left text-xs font-semibold text-danger hover:bg-danger-wash"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        Delete character from roster
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Segmented Sort: Oldest | Latest (only if 2+ chats) */}
            {chats.length > 1 && (
              <div
                role="group"
                aria-label="Sort chats"
                className="grid grid-cols-2 p-1 rounded-full border border-line"
              >
                {(['latest', 'oldest'] as const).map((order) => (
                  <button
                    key={order}
                    type="button"
                    onClick={() => setSortOrder(order)}
                    aria-pressed={sortOrder === order}
                    className={`min-h-9 py-1.5 text-xs font-medium rounded-full flex items-center justify-center gap-1.5 capitalize transition-colors ${
                      sortOrder === order
                        ? 'bg-accent-wash text-accent-text'
                        : 'text-ink-2 hover:text-ink'
                    }`}
                  >
                    <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
                    {order}
                  </button>
                ))}
              </div>
            )}

            {/* Chat Sessions List */}
            {sortedChats.length === 0 ? (
              <div className="py-12 text-center space-y-2">
                <MessageSquare className="h-8 w-8 mx-auto text-ink-3" aria-hidden="true" />
                <p className="type-meta">No chats with {character.name} yet.</p>
              </div>
            ) : (
              <div className="divide-y divide-line">
                {sortedChats.map((chat) => {
                  const snippet =
                    chat.title?.replace(/^Chat with\s+/i, '') !== character.name
                      ? chat.title
                      : character.first_message || 'Start the story…';

                  const cleanTimestamp = formatChatTimestamp(chat.last_message_at || chat.created_at);
                  const messageCount = chat.message_count || 1;
                  const charIdentifier = character.id || character.name;
                  const chatHref = `/chat/${chat.id}${
                    charIdentifier ? `?charId=${encodeURIComponent(charIdentifier)}` : ''
                  }`;

                  return (
                    <div
                      key={chat.id}
                      className="group relative flex min-h-[56px] items-center justify-between gap-3 py-2.5"
                    >
                      <Link
                        href={chatHref}
                        onClick={onClose}
                        className="row-press flex min-h-[56px] min-w-0 flex-1 items-center gap-3 pr-1 rounded-xl"
                      >
                        {/* Left: Thumbnail 44px */}
                        <div className="h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-line bg-sunken">
                          <CharacterAvatar
                            name={character.name}
                            avatarUrl={character.avatar_url}
                            accentColor={character.accent_color}
                            className="h-full w-full object-cover"
                          />
                        </div>

                        {/* Middle: Title & preview snippet */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="min-w-0 truncate font-serif text-[15px] font-medium text-ink">
                              {chat.title && chat.title.replace(/^Chat with\s+/i, '').trim() !== character.name
                                ? chat.title
                                : character.name}
                            </span>
                            <span className="type-meta shrink-0 ml-2">{cleanTimestamp}</span>
                          </div>

                          <p className="type-meta mt-0.5 truncate text-xs text-ink-2">
                            {snippet}
                          </p>

                          <div className="mt-1 flex items-center gap-2">
                            <span className="type-meta inline-flex items-center gap-1 text-[11px]">
                              <MessageSquare className="h-3 w-3" aria-hidden="true" />
                              {messageCount}
                            </span>
                          </div>
                        </div>
                      </Link>

                      {/* Right: quiet delete - visible on mobile, hover on md */}
                      <div className="shrink-0 flex items-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            handleDeleteSingleChat(e, chat.id);
                          }}
                          disabled={deletingId === chat.id}
                          className="icon-btn text-ink-3 hover:text-danger focus-visible:text-danger opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 min-h-11 min-w-11"
                          aria-label={`Delete chat from ${cleanTimestamp || 'this character'}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Sheet>

      {/* Confirm Dialogs rendered OUTSIDE Sheet so vaul's transform doesn't clip fixed positioning */}
      {confirmDeleteCharacter && character && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-character-title"
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setConfirmDeleteCharacter(false)}
        >
          <div
            className="panel bg-raised w-full max-w-sm rounded-2xl p-5 border border-line shadow-float max-h-[85dvh] scroll-y space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 font-semibold text-danger" id="delete-character-title">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Delete &ldquo;{character.name}&rdquo; from roster?</span>
            </div>
            <p className="text-xs text-ink-2 leading-relaxed">
              This removes this character and all of your chats with them. You cannot undo this.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteCharacter(false)}
                className="btn btn-quiet min-h-10 px-3"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteCharacterFromRoster}
                className="btn btn-danger min-h-10 px-3"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete character
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDeleteAll && character && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-all-chats-title"
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setConfirmDeleteAll(false)}
        >
          <div
            className="panel bg-raised w-full max-w-sm rounded-2xl p-5 border border-line shadow-float max-h-[85dvh] scroll-y space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 font-semibold text-danger" id="delete-all-chats-title">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>Delete all {chats.length} chats?</span>
            </div>
            <p className="text-xs text-ink-2 leading-relaxed">
              This removes every message with {character.name}. You cannot undo this.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteAll(false)}
                className="btn btn-quiet min-h-10 px-3"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteAllChats}
                className="btn btn-danger min-h-10 px-3"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete all
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
