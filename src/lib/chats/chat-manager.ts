import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import type { Chat, Character, Message, Memory, Summary } from '@/lib/supabase/types';

export const LOCAL_CHATS_KEY = 'cadenza_local_chats';
export const LOCAL_MESSAGES_PREFIX = 'cadenza_local_messages_';
export const LOCAL_STATE_PREFIX = 'cadenza_local_state_';
export const LOCAL_MEMORIES_PREFIX = 'cadenza_local_memories_';
export const LOCAL_SUMMARY_PREFIX = 'cadenza_local_summary_';
export const LOCAL_AUTHORS_NOTE_PREFIX = 'cadenza_local_authors_note_';
export const CHATS_CHANGED_EVENT = 'cadenza-chats-changed';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(id: string | null | undefined): boolean {
  return typeof id === 'string' && UUID_REGEX.test(id);
}

export async function ensureCharacterInCloud(
  character: Character,
  userId: string,
  supabaseClient?: SupabaseClient
): Promise<Character> {
  const supabase = supabaseClient || createClient();

  if (isUuid(character.id)) {
    try {
      const { data } = await supabase
        .from('characters')
        .select('*')
        .eq('id', character.id)
        .maybeSingle();
      if (data) return data as Character;
    } catch {}
  }

  try {
    const { data: savedChar, error } = await supabase
      .from('characters')
      .insert({
        user_id: userId,
        name: character.name || 'Character',
        avatar_url: character.avatar_url || null,
        tagline: character.tagline || '',
        description: character.description || '',
        personality: character.personality || '',
        scenario: character.scenario || '',
        first_message: character.first_message || '*I look at you quietly.*',
        alternate_greetings: character.alternate_greetings || [],
        example_dialogue: character.example_dialogue || '',
        speech_style: character.speech_style || '',
        system_prompt: character.system_prompt || '',
        post_history_instructions: character.post_history_instructions || '',
        tags: character.tags && character.tags.length > 0 ? character.tags : ['Custom'],
        content_rating: character.content_rating || 'mature',
        behavior: character.behavior || {},
        generation: character.generation || {},
        accent_color: character.accent_color || null,
      })
      .select()
      .single();

    if (!error && savedChar) {
      if (typeof window !== 'undefined') {
        try {
          const localChars: Character[] = JSON.parse(localStorage.getItem('cadenza_local_characters') || '[]');
          const idx = localChars.findIndex((c) => c.id === character.id || c.name === character.name);
          if (idx >= 0) {
            localChars[idx] = savedChar as Character;
            localStorage.setItem('cadenza_local_characters', JSON.stringify(localChars));
          }
        } catch {}
      }
      return savedChar as Character;
    }
  } catch (e) {
    console.warn('Failed to ensure character in cloud:', e);
  }

  return character;
}

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
 * Get a specific chat from localStorage by ID
 */
export function getLocalChat(chatId: string): Chat | null {
  if (typeof window === 'undefined' || !chatId) return null;
  try {
    const chats = getLocalChats();
    return chats.find((c) => c.id === chatId) || null;
  } catch {
    return null;
  }
}

/**
 * Save or update a chat in localStorage
 */
export function saveLocalChat(chat: Partial<Chat> & { id: string }): void {
  if (typeof window === 'undefined' || !chat?.id) return;
  try {
    const existing = getLocalChats();
    const index = existing.findIndex((c) => c.id === chat.id);
    let updated: Chat[];

    if (index >= 0) {
      const prev = existing[index];

      // Never let a fallback/dummy character overwrite a legitimate character
      const isNewCharFallback =
        chat.character &&
        (chat.character.name === 'Roleplay Partner' ||
          chat.character.name === 'Unnamed Character' ||
          !chat.character.name);
      const isPrevCharValid =
        prev.character &&
        prev.character.name !== 'Roleplay Partner' &&
        prev.character.name !== 'Unnamed Character' &&
        Boolean(prev.character.name);

      const mergedCharacter =
        isNewCharFallback && isPrevCharValid
          ? prev.character
          : (chat.character || prev.character);

      const isNewTitleFallback =
        chat.title &&
        (chat.title === 'Chat with Roleplay Partner' ||
          chat.title === 'Chat with Unnamed Character' ||
          chat.title === 'Chat with Character');
      const isPrevTitleValid =
        prev.title &&
        prev.title !== 'Chat with Roleplay Partner' &&
        prev.title !== 'Chat with Unnamed Character' &&
        prev.title !== 'Chat with Character';

      const mergedTitle =
        isNewTitleFallback && isPrevTitleValid
          ? prev.title
          : (chat.title || prev.title);

      const mergedCharId =
        (isNewCharFallback && isPrevCharValid ? prev.character_id : (chat.character_id || prev.character_id));

      updated = [...existing];
      updated[index] = {
        ...prev,
        ...chat,
        character_id: mergedCharId || prev.character_id,
        character: mergedCharacter,
        title: mergedTitle || prev.title,
        updated_at: new Date().toISOString(),
      };
    } else {
      updated = [chat as Chat, ...existing];
    }

    localStorage.setItem(LOCAL_CHATS_KEY, JSON.stringify(updated));
    notifyChatsChanged();
  } catch (err) {
    console.error('Failed to save local chat:', err);
  }
}

/**
 * Get all messages for a specific chat from localStorage
 */
export function getLocalMessages(chatId: string): Message[] {
  if (typeof window === 'undefined' || !chatId) return [];
  try {
    const raw = localStorage.getItem(`${LOCAL_MESSAGES_PREFIX}${chatId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Save messages for a specific chat to localStorage
 */
export function saveLocalMessages(chatId: string, messages: Message[]): void {
  if (typeof window === 'undefined' || !chatId) return;
  try {
    localStorage.setItem(`${LOCAL_MESSAGES_PREFIX}${chatId}`, JSON.stringify(messages));
  } catch (err) {
    console.error('Failed to save local messages:', err);
  }
}

/**
 * Get memories for a specific chat from localStorage
 */
export function getLocalMemories(chatId: string): Memory[] {
  if (typeof window === 'undefined' || !chatId) return [];
  try {
    const raw = localStorage.getItem(`${LOCAL_MEMORIES_PREFIX}${chatId}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Save memories for a specific chat to localStorage
 */
export function saveLocalMemories(chatId: string, memories: Memory[]): void {
  if (typeof window === 'undefined' || !chatId) return;
  try {
    localStorage.setItem(`${LOCAL_MEMORIES_PREFIX}${chatId}`, JSON.stringify(memories));
  } catch (err) {
    console.error('Failed to save local memories:', err);
  }
}

/**
 * Get state for a specific chat from localStorage
 */
export function getLocalChatState(chatId: string): Record<string, unknown> {
  if (typeof window === 'undefined' || !chatId) return {};
  try {
    const raw = localStorage.getItem(`${LOCAL_STATE_PREFIX}${chatId}`);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Save state for a specific chat to localStorage
 */
export function saveLocalChatState(chatId: string, state: Record<string, unknown>): void {
  if (typeof window === 'undefined' || !chatId) return;
  try {
    localStorage.setItem(`${LOCAL_STATE_PREFIX}${chatId}`, JSON.stringify(state));
  } catch (err) {
    console.error('Failed to save local chat state:', err);
  }
}

/**
 * Get active summary for a specific chat from localStorage
 */
export function getLocalSummary(chatId: string): Summary | null {
  if (typeof window === 'undefined' || !chatId) return null;
  try {
    const raw = localStorage.getItem(`${LOCAL_SUMMARY_PREFIX}${chatId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Save active summary for a specific chat to localStorage
 */
export function saveLocalSummary(chatId: string, summary: Summary | null): void {
  if (typeof window === 'undefined' || !chatId) return;
  try {
    if (summary) {
      localStorage.setItem(`${LOCAL_SUMMARY_PREFIX}${chatId}`, JSON.stringify(summary));
    } else {
      localStorage.removeItem(`${LOCAL_SUMMARY_PREFIX}${chatId}`);
    }
  } catch (err) {
    console.error('Failed to save local summary:', err);
  }
}

export interface LocalAuthorsNote {
  prompt: string;
  depth: number;
  interval: number;
  role: 'system' | 'user' | 'assistant';
  position: 'in_chat' | 'before_scenario' | 'after_scenario';
}

/**
 * Get Author's Note configuration for a specific chat
 */
export function getLocalAuthorsNote(chatId: string): LocalAuthorsNote | null {
  if (typeof window === 'undefined' || !chatId) return null;
  try {
    const raw = localStorage.getItem(`${LOCAL_AUTHORS_NOTE_PREFIX}${chatId}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Save Author's Note configuration for a specific chat
 */
export function saveLocalAuthorsNote(chatId: string, note: LocalAuthorsNote): void {
  if (typeof window === 'undefined' || !chatId) return;
  try {
    localStorage.setItem(`${LOCAL_AUTHORS_NOTE_PREFIX}${chatId}`, JSON.stringify(note));
  } catch (err) {
    console.error('Failed to save local author note:', err);
  }
}

/**
 * Fetch unified chats from Supabase (if logged in) + localStorage with deep character resolution
 */
export async function getUnifiedChats(charactersList: Character[] = []): Promise<Chat[]> {
  const supabase = createClient();
  const localList = getLocalChats();
  let dbChats: Chat[] = [];

  try {
    const { data: authData } = await supabase.auth.getUser();
    if (authData.user) {
      const userId = authData.user.id;
      const { data, error } = await supabase
        .from('chats')
        .select('*, character:characters(*)')
        .eq('archived', false)
        .order('last_message_at', { ascending: false });

      if (!error && data) {
        dbChats = data as Chat[];
      }

      // Auto-migrate any local chats that have user messages
      const localToMigrate = localList.filter((c) => c.id.startsWith('local-'));
      for (const lc of localToMigrate) {
        const msgs = getLocalMessages(lc.id);
        const hasUserMsg = msgs.some((m) => m.role === 'user');
        if (hasUserMsg) {
          try {
            const rawChar = lc.character || charactersList.find((ch) => ch.id === lc.character_id || ch.name === lc.character?.name);
            if (rawChar) {
              const cloudChar = await ensureCharacterInCloud(rawChar, userId, supabase);
              const { data: newDbChat, error: chatErr } = await supabase
                .from('chats')
                .insert({
                  user_id: userId,
                  character_id: cloudChar.id,
                  title: lc.title || `Chat with ${cloudChar.name}`,
                  last_message_at: lc.last_message_at || new Date().toISOString(),
                  message_count: msgs.length,
                })
                .select('*, character:characters(*)')
                .single();

              if (!chatErr && newDbChat) {
                const msgPayloads = msgs.map((m) => ({
                  chat_id: newDbChat.id,
                  user_id: userId,
                  role: m.role,
                  content: m.content,
                  reasoning: m.reasoning || null,
                  status: 'done',
                  meta: m.meta || {},
                  created_at: m.created_at || new Date().toISOString(),
                }));
                if (msgPayloads.length > 0) {
                  await supabase.from('messages').insert(msgPayloads);
                }
                saveLocalMessages(newDbChat.id, msgs);
                deleteChat(lc.id);
                dbChats.unshift({ ...(newDbChat as Chat), character: cloudChar });
              }
            }
          } catch (e) {
            console.warn('Error auto-migrating local chat:', e);
          }
        }
      }
    }
  } catch (err) {
    console.error('Error fetching Supabase chats:', err);
  }

  // Aggregate all known characters from props + localStorage
  const allCharacters: Character[] = [...charactersList];
  if (typeof window !== 'undefined') {
    try {
      const localChars: Character[] = JSON.parse(localStorage.getItem('cadenza_local_characters') || '[]');
      const knownIds = new Set(allCharacters.map((c) => c.id));
      for (const lc of localChars) {
        if (!knownIds.has(lc.id)) {
          allCharacters.push(lc);
          knownIds.add(lc.id);
        }
      }
    } catch {}
  }

  // Helper to reliably find the Character object for a given chat
  function resolveCharacterForChat(chat: Chat): Character | undefined {
    // 1. If chat already has a valid character object with a name and not fallback
    if (
      chat.character &&
      chat.character.name &&
      chat.character.name !== 'Roleplay Partner' &&
      chat.character.name !== 'Unnamed Character'
    ) {
      // If missing avatar_url, try to find full version
      if (!chat.character.avatar_url && allCharacters.length > 0) {
        const full = allCharacters.find(
          (c) => c.id === chat.character?.id || c.name.toLowerCase() === chat.character?.name.toLowerCase()
        );
        if (full?.avatar_url) {
          return { ...chat.character, avatar_url: full.avatar_url };
        }
      }
      return chat.character;
    }

    const targetId = chat.character_id;
    const cleanTitle = chat.title?.replace(/^Chat with\s+/i, '').trim();

    // 2. Try match by ID or exact name
    let found = allCharacters.find((ch) => {
      if (targetId && (ch.id === targetId || ch.name.toLowerCase() === targetId.toLowerCase())) {
        return true;
      }
      if (cleanTitle && ch.name.toLowerCase() === cleanTitle.toLowerCase()) {
        return true;
      }
      return false;
    });

    // 3. Try fuzzy/partial match on title
    if (!found && cleanTitle) {
      found = allCharacters.find((ch) => {
        return (
          ch.name.toLowerCase().includes(cleanTitle.toLowerCase()) ||
          cleanTitle.toLowerCase().includes(ch.name.toLowerCase())
        );
      });
    }

    return found;
  }

  // Combine and deduplicate
  const chatMap = new Map<string, Chat>();

  // Add DB chats first
  for (const c of dbChats) {
    const resolvedChar = resolveCharacterForChat(c);
    if (resolvedChar) {
      c.character = resolvedChar;
    }
    chatMap.set(c.id, c);
  }

  // Add local chats
  let hasLocalUpdates = false;
  for (const c of localList) {
    if (!chatMap.has(c.id)) {
      const resolvedChar = resolveCharacterForChat(c);
      if (resolvedChar) {
        if (!c.character || c.character.name !== resolvedChar.name || !c.character.avatar_url) {
          c.character = resolvedChar;
          c.character_id = resolvedChar.id;
          hasLocalUpdates = true;
        }
      }
      chatMap.set(c.id, c);
    }
  }

  // If we enriched any local chats with proper characters, persist it
  if (hasLocalUpdates && typeof window !== 'undefined') {
    try {
      localStorage.setItem(LOCAL_CHATS_KEY, JSON.stringify(localList));
    } catch {}
  }

  const allChats = Array.from(chatMap.values());

  // Final pass for character resolution
  for (const chat of allChats) {
    if (!chat.character) {
      const resolvedChar = resolveCharacterForChat(chat);
      if (resolvedChar) {
        chat.character = resolvedChar;
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
      localStorage.removeItem(`${LOCAL_MESSAGES_PREFIX}${chatId}`);
      localStorage.removeItem(`${LOCAL_STATE_PREFIX}${chatId}`);
      localStorage.removeItem(`${LOCAL_MEMORIES_PREFIX}${chatId}`);
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
          localStorage.removeItem(`${LOCAL_MESSAGES_PREFIX}${c.id}`);
          localStorage.removeItem(`${LOCAL_STATE_PREFIX}${c.id}`);
          localStorage.removeItem(`${LOCAL_MEMORIES_PREFIX}${c.id}`);
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
 * Delete a character from the roster completely (Supabase + localStorage)
 * and clean up all associated chats and messages
 */
export async function deleteCharacter(characterId: string): Promise<boolean> {
  const supabase = createClient();
  let success = false;

  // 1. Delete associated chats first
  try {
    await deleteChatsForCharacter(characterId);
  } catch (err) {
    console.error('Failed to delete associated chats:', err);
  }

  // 2. Delete from Supabase characters table
  try {
    const { error } = await supabase.from('characters').delete().eq('id', characterId);
    if (!error) success = true;
  } catch (err) {
    console.error('Failed to delete character from Supabase:', err);
  }

  // 3. Delete from LocalStorage
  if (typeof window !== 'undefined') {
    try {
      const localChars: Character[] = JSON.parse(localStorage.getItem('cadenza_local_characters') || '[]');
      const filtered = localChars.filter((c) => c.id !== characterId && c.name !== characterId);
      localStorage.setItem('cadenza_local_characters', JSON.stringify(filtered));

      // Also track in deleted IDs list so public characters are filtered out for this client
      const deletedIds: string[] = JSON.parse(localStorage.getItem('cadenza_deleted_character_ids') || '[]');
      if (!deletedIds.includes(characterId)) {
        deletedIds.push(characterId);
        localStorage.setItem('cadenza_deleted_character_ids', JSON.stringify(deletedIds));
      }

      success = true;
    } catch (err) {
      console.error('Failed to delete character from localStorage:', err);
    }
  }

  notifyChatsChanged();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('cadenza-characters-changed'));
  }
  return success;
}

/**
 * Group list of chats by character (matching JanitorAI's structure)
 */
export function groupChatsByCharacter(chats: Chat[], allCharacters: Character[] = []): CharacterChatGroup[] {
  const groupsMap = new Map<string, CharacterChatGroup>();

  // Ensure all characters list includes local characters
  const fullCharactersList: Character[] = [...allCharacters];
  if (typeof window !== 'undefined') {
    try {
      const localChars: Character[] = JSON.parse(localStorage.getItem('cadenza_local_characters') || '[]');
      const knownIds = new Set(fullCharactersList.map((c) => c.id));
      for (const lc of localChars) {
        if (!knownIds.has(lc.id)) {
          fullCharactersList.push(lc);
          knownIds.add(lc.id);
        }
      }
    } catch {}
  }

  for (const chat of chats) {
    const cleanTitle = chat.title?.replace(/^Chat with\s+/i, '').trim();
    let charId = chat.character_id || (chat.character?.id ?? 'unknown');

    let resolvedChar =
      chat.character ||
      fullCharactersList.find(
        (c) =>
          c.id === charId ||
          c.name.toLowerCase() === charId.toLowerCase() ||
          (cleanTitle && c.name.toLowerCase() === cleanTitle.toLowerCase())
      );

    if (resolvedChar) {
      charId = resolvedChar.id;
    } else {
      resolvedChar = {
        id: charId,
        user_id: 'system',
        name: cleanTitle || 'Character',
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
