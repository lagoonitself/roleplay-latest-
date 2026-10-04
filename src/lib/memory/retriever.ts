import { createClient } from '@/lib/supabase/server';
import { scanWorldInfo, type ActivatedLore, type WorldInfoScanEntry } from '@/lib/lorebook/matcher';
import { retrieveVectorMemories, type VectorRetrievalResult } from '@/lib/memory/vectors';
import type { Memory, Summary, ChatState, LorebookEntry, Message, Character, Persona } from '@/lib/supabase/types';

export interface RetrievedContext {
  pinnedMemories: Memory[];
  relevantMemories: Memory[];
  vectorMemories?: VectorRetrievalResult;
  summary: Summary | null;
  chatState: ChatState | null;
  triggeredLore: LorebookEntry[];
  activatedLore?: ActivatedLore;
}

export interface RetrieveContextParams {
  chatId: string;
  character: Character;
  persona?: Persona | null;
  history: Message[];
  latestUserMessage: string;
}

export async function retrieveContextForChat(
  chatIdOrParams: string | RetrieveContextParams,
  characterIdFallback?: string,
  userQueryFallback?: string
): Promise<RetrievedContext> {
  const supabase = await createClient();

  let chatId: string;
  let characterId: string;
  let userQuery: string;
  let history: Message[] = [];
  let character: Character | null = null;
  let persona: Persona | null = null;

  if (typeof chatIdOrParams === 'object') {
    chatId = chatIdOrParams.chatId;
    character = chatIdOrParams.character;
    characterId = character.id;
    persona = chatIdOrParams.persona || null;
    history = chatIdOrParams.history || [];
    userQuery = chatIdOrParams.latestUserMessage;
  } else {
    chatId = chatIdOrParams;
    characterId = characterIdFallback || '';
    userQuery = userQueryFallback || '';
  }

  // 1. Fetch pinned memories
  const { data: pinnedData } = await supabase
    .from('memories')
    .select('*')
    .eq('chat_id', chatId)
    .eq('pinned', true)
    .is('superseded_by', null)
    .order('created_at', { ascending: false });

  const pinnedMemories: Memory[] = pinnedData || [];

  // 2. Fetch Vector Semantic Memories (SillyTavern protected window)
  const charName = character?.name || 'Character';
  const userName = persona?.name || 'User';

  const vectorResult = await retrieveVectorMemories({
    chatId,
    userQuery,
    history,
    charName,
    userName,
  });

  const relevantMemories: Memory[] = vectorResult.memories;

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

  // 5. Scan Lorebooks using SillyTavern World Info Engine (selective logic, regex, recursion)
  let activatedLore: ActivatedLore | undefined;
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

      if (entries && entries.length > 0) {
        const scanEntries: WorldInfoScanEntry[] = entries.map((e: LorebookEntry) => ({
          ...e,
          keys: e.keys || [],
          secondary_keys: e.secondary_keys || [],
          case_sensitive: e.case_sensitive,
          constant: e.constant,
          enabled: e.enabled,
          priority: e.priority,
          content: e.content,
        }));

        activatedLore = scanWorldInfo(scanEntries, {
          chatMessages: history.map((m) => ({ role: m.role, content: m.content || '' })),
          scanDepth: 4,
          tokenBudget: 1200,
          maxRecursionSteps: 2,
          globalScanData: {
            userMessage: userQuery,
            charDescription: character?.description,
            charPersonality: character?.personality,
            scenario: character?.scenario,
            personaDescription: persona?.description,
          },
        });

        triggeredLore = (activatedLore.allActivated as LorebookEntry[]) || [];
      }
    }
  } catch (err) {
    console.warn('Lorebook scan warning:', err);
  }

  return {
    pinnedMemories,
    relevantMemories,
    vectorMemories: vectorResult,
    summary,
    chatState,
    triggeredLore,
    activatedLore,
  };
}
