import { createClient } from '@/lib/supabase/server';
import type { Memory, Summary, ChatState, LorebookEntry } from '@/lib/supabase/types';

export interface RetrievedContext {
  pinnedMemories: Memory[];
  relevantMemories: Memory[];
  summary: Summary | null;
  chatState: ChatState | null;
  triggeredLore: LorebookEntry[];
}

export async function retrieveContextForChat(
  chatId: string,
  characterId: string,
  userQuery: string
): Promise<RetrievedContext> {
  const supabase = await createClient();

  // 1. Fetch pinned memories
  const { data: pinnedData } = await supabase
    .from('memories')
    .select('*')
    .eq('chat_id', chatId)
    .eq('pinned', true)
    .is('superseded_by', null)
    .order('created_at', { ascending: false });

  const pinnedMemories: Memory[] = pinnedData || [];

  // 2. Fetch relevant episodic memories
  let relevantMemories: Memory[] = [];
  try {
    // Attempt hybrid search via match_memories RPC
    const { data: rpcData, error } = await supabase.rpc('match_memories', {
      p_chat_id: chatId,
      p_query_embedding: null, // embedding can be null for FTS + recency
      p_query_text: userQuery || '',
      p_match_count: 8,
    });

    if (!error && rpcData && rpcData.length > 0) {
      relevantMemories = rpcData;
    } else {
      // Fallback: select top 8 non-pinned, non-superseded memories ordered by importance and recency
      const { data: fallbackData } = await supabase
        .from('memories')
        .select('*')
        .eq('chat_id', chatId)
        .eq('pinned', false)
        .is('superseded_by', null)
        .order('importance', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(8);

      relevantMemories = fallbackData || [];
    }
  } catch (err) {
    console.warn('Fallback memory retrieval used:', err);
  }

  // 3. Fetch latest active story summary
  const { data: summaryData } = await supabase
    .from('summaries')
    .select('*')
    .eq('chat_id', chatId)
    .eq('superseded', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const summary: Summary | null = summaryData || null;

  // 4. Fetch current scene state
  const { data: stateData } = await supabase
    .from('chat_state')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle();

  const chatState: ChatState | null = stateData || null;

  // 5. Scan lorebooks associated with character
  let triggeredLore: LorebookEntry[] = [];
  try {
    const { data: charLorebooks } = await supabase
      .from('character_lorebooks')
      .select('lorebook_id')
      .eq('character_id', characterId);

    if (charLorebooks && charLorebooks.length > 0) {
      const bookIds = charLorebooks.map((b) => b.lorebook_id);
      const { data: entries } = await supabase
        .from('lorebook_entries')
        .select('*')
        .in('lorebook_id', bookIds)
        .eq('enabled', true);

      if (entries) {
        const queryLower = userQuery.toLowerCase();
        triggeredLore = entries.filter((entry: LorebookEntry) => {
          if (entry.constant) return true;
          return entry.keys.some((key: string) => {
            const trimmed = key.trim().toLowerCase();
            return trimmed.length > 0 && queryLower.includes(trimmed);
          });
        });
      }
    }
  } catch (err) {
    console.warn('Lorebook scan warning:', err);
  }

  return {
    pinnedMemories,
    relevantMemories,
    summary,
    chatState,
    triggeredLore,
  };
}
