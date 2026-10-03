'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  X,
  Plus,
  Trash2,
  MoreVertical,
  MessageSquare,
  Clock,
  Layers,
  ArrowUpDown,
  ExternalLink,
  ChevronRight,
  AlertTriangle,
} from 'lucide-react';
import { CharacterAvatar } from '@/components/character-avatar';
import { formatChatTimestamp, deleteChat, deleteChatsForCharacter } from '@/lib/chats/chat-manager';
import { toast } from 'sonner';
import type { Character, Chat } from '@/lib/supabase/types';

interface CharacterChatsDrawerProps {
  open: boolean;
  onClose: () => void;
  character: Character | null;
  chats: Chat[];
  onStartNewChat: (character: Character) => void;
  onChatDeleted?: () => void;
}

export function CharacterChatsDrawer({
  open,
  onClose,
  character,
  chats,
  onStartNewChat,
  onChatDeleted,
}: CharacterChatsDrawerProps) {
  const router = useRouter();
  const [sortOrder, setSortOrder] = useState<'latest' | 'oldest'>('latest');
  const [menuOpen, setMenuOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  // Close menus on outside click / escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (confirmDeleteAll) setConfirmDeleteAll(false);
        else if (menuOpen) setMenuOpen(false);
        else onClose();
      }
    };
    if (open) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, menuOpen, confirmDeleteAll, onClose]);

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

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Backdrop overlay */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* JanitorAI Style Bottom Sheet */}
      <div
        className="relative z-10 w-full max-w-lg bg-[#18181b] dark:bg-[#121214] text-zinc-100 rounded-t-[2.25rem] border-t border-white/[0.09] shadow-2xl flex flex-col max-h-[88vh] overflow-hidden animate-in slide-in-from-bottom duration-300 pb-[env(safe-area-inset-bottom)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar on top */}
        <div className="w-full flex items-center justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
          <div className="w-12 h-1.5 rounded-full bg-zinc-600/60" />
        </div>

        {/* Header: Character thumbnail + Name + "X chats" pill + 3-dots */}
        <div className="px-5 py-3 flex items-center justify-between border-b border-white/[0.06]">
          <div className="flex items-center gap-3.5 min-w-0">
            <div className="w-13 h-13 rounded-2xl overflow-hidden bg-zinc-800 shrink-0 border border-white/10 shadow-sm relative">
              <CharacterAvatar
                name={character.name}
                avatarUrl={character.avatar_url}
                accentColor={character.accent_color}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="min-w-0">
              <h2 className="font-bold text-base sm:text-lg tracking-tight text-white truncate">
                {character.name}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-purple-500/25 text-purple-300 font-semibold text-xs border border-purple-500/20">
                  <Layers className="w-3 h-3" />
                  {chats.length} {chats.length === 1 ? 'chat' : 'chats'}
                </span>
                {character.content_rating !== 'sfw' && (
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                    18+
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right Action Menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="p-2 rounded-full hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors apple-button"
              aria-label="More options"
            >
              <MoreVertical className="w-5 h-5" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 rounded-2xl bg-[#202024] border border-white/10 shadow-2xl p-1.5 z-30 animate-in fade-in duration-150">
                <Link
                  href={`/c/${character.id}`}
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-zinc-200 hover:bg-white/5 rounded-xl transition-colors"
                >
                  <ExternalLink className="w-4 h-4 text-zinc-400" />
                  View Character Profile
                </Link>
                <button
                  onClick={() => {
                    setConfirmDeleteAll(true);
                    setMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs text-red-400 hover:bg-red-500/10 rounded-xl transition-colors text-left"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete all chats with {character.name}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Delete All Confirmation Dialog */}
        {confirmDeleteAll && (
          <div className="mx-5 my-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/30 text-xs text-red-200 space-y-3 animate-in fade-in duration-200">
            <div className="flex items-center gap-2 font-semibold text-red-300">
              <AlertTriangle className="w-4 h-4" />
              Delete all {chats.length} chat conversations?
            </div>
            <p className="text-zinc-300">
              This will permanently remove all messages and memories with {character.name}. This action cannot be undone.
            </p>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setConfirmDeleteAll(false)}
                className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAllChats}
                className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Yes, Delete All
              </button>
            </div>
          </div>
        )}

        {/* Segmented Sort Pills: Oldest | Latest (Matches JanitorAI Image 4) */}
        <div className="px-5 pt-3.5 pb-2">
          <div className="grid grid-cols-2 p-1 rounded-2xl bg-[#202024] border border-white/[0.05]">
            <button
              onClick={() => setSortOrder('oldest')}
              className={`py-2 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all apple-button ${
                sortOrder === 'oldest'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              Oldest
            </button>
            <button
              onClick={() => setSortOrder('latest')}
              className={`py-2 text-xs font-semibold rounded-xl flex items-center justify-center gap-1.5 transition-all apple-button ${
                sortOrder === 'latest'
                  ? 'bg-purple-600 text-white shadow-md'
                  : 'text-zinc-400 hover:text-white'
              }`}
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              Latest
            </button>
          </div>
        </div>

        {/* Chat Sessions List (Matches JanitorAI Images 4 & 5) */}
        <div className="flex-1 overflow-y-auto px-5 py-2 space-y-2.5 divide-y divide-white/[0.04]">
          {sortedChats.length === 0 ? (
            <div className="py-12 text-center space-y-2 text-zinc-400">
              <MessageSquare className="w-8 h-8 mx-auto opacity-40 text-purple-400" />
              <p className="text-sm">No active chats with {character.name}.</p>
            </div>
          ) : (
            sortedChats.map((chat) => {
              const snippet =
                chat.title?.replace(/^Chat with\s+/i, '') !== character.name
                  ? chat.title
                  : character.first_message || 'Start the story...';

              const cleanTimestamp = formatChatTimestamp(chat.last_message_at || chat.created_at);
              const messageCount = chat.message_count || 1;

              return (
                <div
                  key={chat.id}
                  onClick={() => {
                    onClose();
                    router.push(`/chat/${chat.id}`);
                  }}
                  className="group relative pt-2.5 flex items-center justify-between gap-3 p-2.5 -mx-2 rounded-2xl hover:bg-white/[0.04] active:bg-white/[0.08] cursor-pointer transition-colors"
                >
                  {/* Left: Thumbnail */}
                  <div className="w-12 h-12 rounded-xl overflow-hidden bg-zinc-800 shrink-0 border border-white/10 relative">
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
                      <span className="font-semibold text-xs sm:text-sm text-zinc-100 truncate group-hover:text-purple-300 transition-colors">
                        {character.name}
                      </span>
                      <span className="text-[11px] text-zinc-400 font-medium shrink-0">
                        {cleanTimestamp}
                      </span>
                    </div>

                    <p className="text-[11px] sm:text-xs text-zinc-400 line-clamp-2 mt-0.5 leading-snug">
                      {snippet}
                    </p>

                    <div className="flex items-center gap-2 mt-1">
                      <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500 font-medium">
                        <MessageSquare className="w-3 h-3" />
                        {messageCount}
                      </span>
                    </div>
                  </div>

                  {/* Right: Red Delete Button (Matches JanitorAI Image 5) */}
                  <div className="shrink-0 flex items-center">
                    <button
                      onClick={(e) => handleDeleteSingleChat(e, chat.id)}
                      disabled={deletingId === chat.id}
                      className="w-10 h-10 rounded-xl bg-red-600/90 hover:bg-red-500 active:scale-95 text-white flex items-center justify-center shadow-md transition-all apple-button"
                      title="Delete this chat session"
                      aria-label="Delete chat"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Bottom Full-Width Action: "Start new chat" (Matches JanitorAI Image 4) */}
        <div className="p-4 sm:p-5 border-t border-white/[0.06] bg-[#161618]">
          <button
            onClick={() => {
              onClose();
              onStartNewChat(character);
            }}
            className="w-full py-3.5 px-4 rounded-2xl bg-zinc-700/80 hover:bg-zinc-600 active:bg-zinc-800 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-all apple-button shadow-md"
          >
            <Plus className="w-4 h-4 text-purple-300" />
            Start new chat
          </button>
        </div>
      </div>
    </div>
  );
}
