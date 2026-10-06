/**
 * SillyTavern-Compatible Vector Memory Engine
 *
 * Implements:
 * - Episodic & semantic memory retrieval outside recent chat window
 * - `protect` window (e.g. last 5 turns protected from vector duplication)
 * - `insert` chunk count (default: 3)
 * - SillyTavern template formatting: "Past events:\n{{text}}"
 * - In-chat injection positioning (default depth: 2, role: 'system')
 */

import { createClient } from '@/lib/supabase/server';
import { formatRoleplayText } from '@/lib/prompt/macros';
import type { Memory, Message } from '@/lib/supabase/types';

export const DEFAULT_VECTORS_TEMPLATE = 'Past events:\n{{text}}';
export const DEFAULT_VECTORS_DEPTH = 2;
export const DEFAULT_VECTORS_PROTECT = 5;
export const DEFAULT_VECTORS_INSERT = 3;
export const DEFAULT_SCORE_THRESHOLD = 0.25;

export interface VectorQueryOptions {
  chatId: string;
  userQuery: string;
  history: Message[];
  protectCount?: number;
  insertCount?: number;
  scoreThreshold?: number;
  template?: string;
  charName?: string;
  userName?: string;
}

export interface VectorRetrievalResult {
  memories: Memory[];
  formattedText: string;
  depth: number;
  role: 'system' | 'user';
}

/**
 * Retrieves past semantic memories matching the current context, excluding the protected recent message window.
 */
export async function retrieveVectorMemories(
  options: VectorQueryOptions
): Promise<VectorRetrievalResult> {
  const {
    chatId,
    userQuery,
    history,
    protectCount = DEFAULT_VECTORS_PROTECT,
    insertCount = DEFAULT_VECTORS_INSERT,
    scoreThreshold = DEFAULT_SCORE_THRESHOLD,
    template = DEFAULT_VECTORS_TEMPLATE,
    charName = 'Character',
    userName = 'User',
  } = options;

  if (!chatId || !userQuery?.trim()) {
    return { memories: [], formattedText: '', depth: DEFAULT_VECTORS_DEPTH, role: 'system' };
  }

  const supabase = await createClient();

  // 1. Identify IDs of protected recent messages so we don't duplicate immediate history
  const protectedTurns = history.slice(-protectCount);
  const protectedMessageIds = new Set(protectedTurns.map((m) => m.id).filter(Boolean));

  let retrievedMemories: Memory[] = [];

  try {
    // Attempt hybrid search via match_memories RPC
    const { data: rpcData, error } = await supabase.rpc('match_memories', {
      p_chat_id: chatId,
      p_query_embedding: null,
      p_query_text: userQuery,
      p_match_count: insertCount * 2,
    });

    if (!error && Array.isArray(rpcData) && rpcData.length > 0) {
      retrievedMemories = rpcData.filter((m: Memory & { score?: number }) => {
        const score = typeof m.score === 'number' ? m.score : 1;
        // Filter out items below threshold
        if (score < scoreThreshold) return false;
        // Filter out memories derived from protected recent turns
        if (Array.isArray(m.source_message_ids) && m.source_message_ids.some((id: string) => protectedMessageIds.has(id))) {
          return false;
        }
        return true;
      }).slice(0, insertCount);
    } else {
      // Fallback query from memories table
      const { data: fallbackData } = await supabase
        .from('memories')
        .select('*')
        .eq('chat_id', chatId)
        .eq('pinned', false)
        .is('superseded_by', null)
        .order('importance', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(insertCount * 2);

      if (fallbackData) {
        retrievedMemories = fallbackData.filter((m: Memory) => {
          if (Array.isArray(m.source_message_ids) && m.source_message_ids.some((id) => protectedMessageIds.has(id))) {
            return false;
          }
          return true;
        }).slice(0, insertCount);
      }
    }
  } catch (err) {
    console.warn('Vector memory retrieval warning:', err);
  }

  if (retrievedMemories.length === 0) {
    return { memories: [], formattedText: '', depth: DEFAULT_VECTORS_DEPTH, role: 'system' };
  }

  // Format chunks using SillyTavern template
  const textItems = retrievedMemories.map((m) => `- ${formatRoleplayText(m.content, charName, userName)}`);
  const joinedText = textItems.join('\n');
  const formattedText = template.replace(/\{\{\s*text\s*\}\}/gi, joinedText);

  return {
    memories: retrievedMemories,
    formattedText,
    depth: DEFAULT_VECTORS_DEPTH,
    role: 'system',
  };
}
