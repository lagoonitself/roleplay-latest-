'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  X,
  Plus,
  Trash2,
  MoreVertical,
  MessageSquare,
  Layers,
  ArrowUpDown,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
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

  // Close menus on outside click / escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmDeleteCharacter) setConfirmDeleteCharacter(false);
        else if (confirmDeleteAll) setConfirmDeleteAll(false);
        else if (menuOpen) setMenuOpen(false);
        else onClose();
      }
    };
    if (open) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, menuOpen, confirmDeleteAll, confirmDeleteCharacter, onClose]);

  if (!open || !character) return null;

  // Sort chats based on selected tab: 'latest' vs 'oldest'
  const sortedChats = [...chats].sort((a, b) => {
    const timeA = new Date(a.last_message_at || a.created_at || 0).getTime();
    const timeB = new Date(b.last_message_at || b.created_at || 0).getTime();
    return sortOrder === 'latest' ? timeB - timeA : timeA - timeB;
  });

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
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 backdrop-blur-sm animate-in fade-in duration-200"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      {/* Backdrop overlay */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Bottom Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Chats with ${character.name}`}
        onClick={(e) => e.stopPropagation()}
        className="panel relative z-10 w-full max-w-lg rounded-t-3xl sm:rounded-2xl flex flex-col max-h-[88vh] overflow-hidden animate-in slide-in-from-bottom duration-200 pb-[env(safe-area-inset-bottom)]"
      >
        {/* Handle bar on top */}
        <div className="w-full flex items-center justify-center pt-3 pb-2">
          <div className="w-8 h-1 rounded-full bg-line-strong" aria-hidden />
        </div>

        {/* Header: Character thumbnail + Name + "X chats" pill + 3-dots */}
        <div className="px-5 py-3 flex items-center justify-between gap-2 border-b border-line">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-12 h-12 rounded-lg overflow-hidden bg-sunken shrink-0 border border-line relative">
              <CharacterAvatar
                name={character.name}
                avatarUrl={character.avatar_url}
                accentColor={character.accent_color}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="min-w-0">
              <h2 className="font-serif text-lg font-medium text-ink truncate">{character.name}</h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="chip">
                  <Layers className="w-3 h-3" aria-hidden />
                  {chats.length} {chats.length === 1 ? 'chat' : 'chats'}
                </span>
                {character.content_rating !== 'sfw' && <span className="chip-danger chip">18+</span>}
              </div>
            </div>
          </div>

          {/* Right Action Menu */}
          <div className="relative shrink-0">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="icon-btn"
              aria-label="More options"
              aria-expanded={menuOpen}
            >
              <MoreVertical className="w-5 h-5" aria-hidden />
            </button>

            {menuOpen && (
              <div className="panel absolute right-0 top-full mt-1 w-56 rounded-xl bg-raised shadow-float p-1.5 z-30 animate-in fade-in duration-150">
                <Link
                  href={`/c/${character.id}`}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-ink-2 rounded-lg hover:text-ink"
                >
                  <ExternalLink className="w-4 h-4 text-ink-3" aria-hidden />
                  View character profile
                </Link>
                <button
                  onClick={() => {
                    setConfirmDeleteAll(true);
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-danger rounded-lg text-left"
                >
                  <Trash2 className="w-4 h-4" aria-hidden />
                  Delete all chats with {character.name}
                </button>
                <button
                  onClick={() => {
                    setConfirmDeleteCharacter(true);
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-danger rounded-lg text-left font-semibold border-t border-line mt-1 pt-2"
                >
                  <Trash2 className="w-4 h-4" aria-hidden />
                  Delete character from roster
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Delete Character Confirmation Dialog */}
        {confirmDeleteCharacter && (
          <div className="mx-5 my-3 p-4 rounded-lg border border-danger-line bg-danger-wash text-xs space-y-3 animate-in fade-in duration-200">
            <div className="flex items-center gap-2 font-semibold text-danger">
              <AlertTriangle className="w-4 h-4" aria-hidden />
              Delete &ldquo;{character.name}&rdquo; from your roster?
            </div>
            <p className="text-ink-2 leading-relaxed">
              This removes this character and all of your chats with them. You cannot undo this.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={() => setConfirmDeleteCharacter(false)} className="btn btn-quiet">
                Cancel
              </button>
              <button onClick={handleDeleteCharacterFromRoster} className="btn btn-danger">
                <Trash2 className="w-3.5 h-3.5" aria-hidden />
                Delete character
              </button>
            </div>
          </div>
        )}

        {/* Delete All Chats Confirmation Dialog */}
        {confirmDeleteAll && (
          <div className="mx-5 my-3 p-4 rounded-lg border border-danger-line bg-danger-wash text-xs space-y-3 animate-in fade-in duration-200">
            <div className="flex items-center gap-2 font-semibold text-danger">
              <AlertTriangle className="w-4 h-4" aria-hidden />
              Delete all {chats.length} chats?
            </div>
            <p className="text-ink-2 leading-relaxed">
              This removes every message with {character.name}. You cannot undo this.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button onClick={() => setConfirmDeleteAll(false)} className="btn btn-quiet">
                Cancel
              </button>
              <button onClick={handleDeleteAllChats} className="btn btn-danger">
                <Trash2 className="w-3.5 h-3.5" aria-hidden />
                Delete all
              </button>
            </div>
          </div>
        )}

        {/* Segmented Sort: Oldest | Latest */}
        <div className="px-5 pt-3.5 pb-2">
          <div
            role="group"
            aria-label="Sort chats"
            className="grid grid-cols-2 p-1 rounded-full border border-line"
          >
            {(['oldest', 'latest'] as const).map((order) => (
              <button
                key={order}
                onClick={() => setSortOrder(order)}
                aria-pressed={sortOrder === order}
                className={`py-2 text-xs font-medium rounded-full flex items-center justify-center gap-1.5 capitalize ${
                  sortOrder === order ? 'bg-accent-wash text-accent-text' : 'text-ink-3'
                }`}
              >
                <ArrowUpDown className="w-3.5 h-3.5" aria-hidden />
                {order}
              </button>
            ))}
          </div>
        </div>

        {/* Chat Sessions List */}
        <div className="flex-1 overflow-y-auto px-5 py-2">
          {sortedChats.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <MessageSquare className="w-8 h-8 mx-auto text-ink-3" aria-hidden />
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
                    className="group relative flex items-center justify-between gap-3 py-2.5"
                  >
                    {/* Whole row body is a real link — keyboard, middle-click and
                        Cmd/Ctrl-click all work. Delete is a sibling, never nested. */}
                    <Link
                      href={chatHref}
                      onClick={onClose}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3"
                    >
                    {/* Left: Thumbnail */}
                    <div className="w-11 h-11 rounded-md overflow-hidden bg-sunken shrink-0 border border-line relative">
                      <CharacterAvatar
                        name={character.name}
                        avatarUrl={character.avatar_url}
                        accentColor={character.accent_color}
                        className="w-full h-full object-cover"
                      />
                    </div>

                    {/* Middle: Title & preview snippet */}
                    <div className="flex-1 min-w-0 pr-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-serif text-[0.9rem] font-medium text-ink truncate">
                          {character.name}
                        </span>
                        <span className="type-meta shrink-0">{cleanTimestamp}</span>
                      </div>

                      <p className="type-meta line-clamp-2 mt-0.5 leading-snug">{snippet}</p>

                      <div className="flex items-center gap-2 mt-1">
                        <span className="inline-flex items-center gap-1 type-meta">
                          <MessageSquare className="w-3 h-3" aria-hidden />
                          {messageCount}
                        </span>
                      </div>
                    </div>
                    </Link>

                    {/* Right: quiet delete */}
                    <div className="shrink-0 flex items-center">
                      <button
                        onClick={(e) => handleDeleteSingleChat(e, chat.id)}
                        disabled={deletingId === chat.id}
                        className="icon-btn opacity-70 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 hover:text-danger focus-visible:text-danger"
                        aria-label="Delete this chat"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Bottom Full-Width Action: "Start new chat" */}
        <div className="p-4 sm:p-5 border-t border-line">
          <button
            onClick={() => {
              onClose();
              onStartNewChat(character);
            }}
            className="btn btn-ghost w-full py-3"
          >
            <Plus className="w-4 h-4 text-accent-text" aria-hidden />
            Start new chat
          </button>
          <button onClick={onClose} className="sr-only" aria-label="Close chats">
            <X className="w-4 h-4" aria-hidden />
          </button>
        </div>
      </div>
    </div>
  );
}
