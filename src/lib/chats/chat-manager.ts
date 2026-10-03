import { createClient } from '@/lib/supabase/client';
import type { Chat, Character } from '@/lib/supabase/types';

export const LOCAL_CHATS_KEY = 'cadenza_local_chats';
export const CHATS_CHANGED_EVENT = 'cadenza-chats-changed';

export interface CharacterChatGroup {
  characterId: string;
  character: Character;
  chats: Chat[];
  lastMessageAt: string;
  totalMessages: number;
}

export function notifyChatsChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHATS_CHANGED_EVENT));
  }
}

/**
 * Get all local chats stored in localStorage
 */
export function getLocalChats(): Chat[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_CHATS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Save or update a chat in localStorage
 */
export function saveLocalChat(chat: Chat): void {
  if (typeof window === 'undefined') return;
  try {
    const existing = getLocalChats();
    const index = existing.findIndex((c) => c.id === chat.id);
    let updated: Chat[];
    if (index >= 0) {
      updated = [...existing];
      updated[index] = { ...updated[index], ...chat, updated_at: new Date().toISOString() };
    } else {
      updated = [chat, ...existing];
    }
    localStorage.setItem(LOCAL_CHATS_KEY, JSON.stringify(updated));
    notifyChatsChanged();
  } catch (err) {
    console.error('Failed to save local chat:', err);
  }
}

/**
 * Fetch unified chats from Supabase (if logged in) + localStorage
 */
export async function getUnifiedChats(charactersList: Character[] = []): Promise<Chat[]> {
  const supabase = createClient();
  const localList = getLocalChats();
  let dbChats: Chat[] = [];

  try {
    const { data: authData } = await supabase.auth.getUser();
    if (authData.user) {
      const { data, error } = await supabase
        .from('chats')
        .select('*, character:characters(*)')
        .eq('archived', false)
        .order('last_message_at', { ascending: false });

      if (!error && data) {
        dbChats = data as Chat[];
      }
    }
  } catch (err) {
    console.error('Error fetching Supabase chats:', err);
  }

  // Combine and deduplicate
  const chatMap = new Map<string, Chat>();

  // Add DB chats first
  for (const c of dbChats) {
    chatMap.set(c.id, c);
  }

  // Add local chats (if not already present in DB)
  for (const c of localList) {
    if (!chatMap.has(c.id)) {
      // Attach character object if not present
      if (!c.character && charactersList.length > 0) {
        const found = charactersList.find((ch) => ch.id === c.character_id || ch.name === c.character_id);
        if (found) {
          c.character = found;
        }
      }
      chatMap.set(c.id, c);
    }
  }

  const allChats = Array.from(chatMap.values());

  // Attach characters for any chat missing its character relation
  for (const chat of allChats) {
    if (!chat.character && charactersList.length > 0) {
      const found = charactersList.find((ch) => ch.id === chat.character_id || ch.name === chat.character_id);
      if (found) {
        chat.character = found;
      }
    }
  }

  // Sort by last_message_at descending (newest first)
  return allChats.sort((a, b) => {
    const dateA = new Date(a.last_message_at || a.created_at || 0).getTime();
    const dateB = new Date(b.last_message_at || b.created_at || 0).getTime();
    return dateB - dateA;
  });
}

/**
 * Delete an individual chat session completely
 */
export async function deleteChat(chatId: string): Promise<boolean> {
  const supabase = createClient();
  let success = false;

  // 1. Delete from Supabase if authenticated and exists
  try {
    const { error } = await supabase.from('chats').delete().eq('id', chatId);
    if (!error) success = true;
  } catch (err) {
    console.error('Failed to delete chat from Supabase:', err);
  }

  // 2. Delete from localStorage
  if (typeof window !== 'undefined') {
    try {
      const local = getLocalChats();
      const filtered = local.filter((c) => c.id !== chatId);
      localStorage.setItem(LOCAL_CHATS_KEY, JSON.stringify(filtered));
      localStorage.removeItem(`cadenza_local_messages_${chatId}`);
      localStorage.removeItem(`cadenza_local_state_${chatId}`);
      success = true;
    } catch (err) {
      console.error('Failed to delete chat from localStorage:', err);
    }
  }

  notifyChatsChanged();
  return success;
}

/**
 * Delete all chats for a given character
 */
export async function deleteChatsForCharacter(characterId: string, chatIds: string[] = []): Promise<boolean> {
  const supabase = createClient();
  let success = false;

  try {
    if (chatIds.length > 0) {
      await supabase.from('chats').delete().in('id', chatIds);
    } else {
      await supabase.from('chats').delete().eq('character_id', characterId);
    }
    success = true;
  } catch (err) {
    console.error('Failed to delete character chats from Supabase:', err);
  }

  if (typeof window !== 'undefined') {
    try {
      const local = getLocalChats();
      const filtered = local.filter((c) => {
        const match = c.character_id === characterId || chatIds.includes(c.id);
        if (match) {
          localStorage.removeItem(`cadenza_local_messages_${c.id}`);
          localStorage.removeItem(`cadenza_local_state_${c.id}`);
        }
        return !match;
      });
      localStorage.setItem(LOCAL_CHATS_KEY, JSON.stringify(filtered));
      success = true;
    } catch (err) {
      console.error('Failed to delete character chats from localStorage:', err);
    }
  }

  notifyChatsChanged();
  return success;
}

/**
 * Group list of chats by character (matching JanitorAI's structure)
 */
export function groupChatsByCharacter(chats: Chat[], allCharacters: Character[] = []): CharacterChatGroup[] {
  const groupsMap = new Map<string, CharacterChatGroup>();

  for (const chat of chats) {
    const charId = chat.character_id || (chat.character?.id ?? 'unknown');
    let resolvedChar = chat.character || allCharacters.find((c) => c.id === charId || c.name === charId);

    if (!resolvedChar) {
      resolvedChar = {
        id: charId,
        user_id: 'system',
        name: chat.title?.replace(/^Chat with\s+/i, '') || 'Character',
        avatar_url: null,
        tagline: 'Roleplay Character',
        description: '',
        personality: '',
        scenario: '',
        first_message: '',
        alternate_greetings: [],
        example_dialogue: '',
        speech_style: '',
        system_prompt: '',
        post_history_instructions: '',
        creator_notes: '',
        tags: [],
        content_rating: 'mature',
        behavior: {},
        generation: {},
        accent_color: null,
        favorite: false,
        chat_count: 1,
        last_chatted_at: chat.last_message_at,
        created_at: chat.created_at,
        updated_at: chat.updated_at,
      };
    }

    if (!groupsMap.has(charId)) {
      groupsMap.set(charId, {
        characterId: charId,
        character: resolvedChar,
        chats: [chat],
        lastMessageAt: chat.last_message_at || chat.created_at,
        totalMessages: chat.message_count || 1,
      });
    } else {
      const group = groupsMap.get(charId)!;
      group.chats.push(chat);
      group.totalMessages += chat.message_count || 1;
      const curTime = new Date(chat.last_message_at || chat.created_at || 0).getTime();
      const prevTime = new Date(group.lastMessageAt || 0).getTime();
      if (curTime > prevTime) {
        group.lastMessageAt = chat.last_message_at || chat.created_at;
      }
    }
  }

  return Array.from(groupsMap.values()).sort((a, b) => {
    const timeA = new Date(a.lastMessageAt || 0).getTime();
    const timeB = new Date(b.lastMessageAt || 0).getTime();
    return timeB - timeA;
  });
}

/**
 * Format timestamp nicely like JanitorAI (e.g. 17:31, Wed, 19/09/26)
 */
export function formatChatTimestamp(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return '';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  // Today -> 17:31
  if (diffDays === 0 && date.getDate() === now.getDate()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  // Within past 6 days -> Wed, Thu
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }

  // Older -> 19/09/26
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear()).slice(-2);
  return `${day}/${month}/${year}`;
}
