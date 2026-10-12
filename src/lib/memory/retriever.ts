import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { scanWorldInfo, type ActivatedLore, type WorldInfoScanEntry } from '@/lib/lorebook/matcher';
import { retrieveVectorMemories, type VectorRetrievalResult } from '@/lib/memory/vectors';
import { MEMORY_COLUMNS } from '@/lib/memory/queries';
import type { Memory, Summary, ChatState, LorebookEntry, Message, Character, Persona } from '@/lib/supabase/types';

export interface RetrievedContext {
  pinnedMemories: Memory[];
  relevantMemories: Memory[];
  /** The full active memory bank for this chat — what the memory pass reasons over. */
  allMemories: Memory[];
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
  /**
   * The caller's authenticated client. Pass it whenever the request authenticated
   * with a bearer token: a fresh cookie-based client would run as anonymous, and
   * row-level security would silently return no memories.
   */
  supabase?: SupabaseClient;
  /**
   * Client-held context for local/guest chats (localStorage), or as a fallback when
   * the database is unreachable. Same shapes the database returns.
   */
  clientContext?: {
    memories?: Memory[];
    summary?: Summary | null;
    chatState?: ChatState | null;
  };
  /**
   * The caller has just read memories/summary/state (e.g. the memory API's
   * `list`): reuse `clientContext` for them instead of re-fetching the exact
   * same rows. Default false — other callers get the fresh database read.
   */
  reuseClientContext?: boolean;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Gathers everything the assembler needs for one turn: pinned facts, recalled
 * memories, the running summary, scene state, and triggered lorebook entries.
 */
export async function retrieveContextForChat(
  chatIdOrParams: string | RetrieveContextParams,
  characterIdFallback?: string,
  userQueryFallback?: string
): Promise<RetrievedContext> {
  let chatId: string;
  let characterId: string;
  let userQuery: string;
  let history: Message[] = [];
  let character: Character | null = null;
  let persona: Persona | null = null;
  let clientContext: RetrieveContextParams['clientContext'];
  let reuseContext = false;
  let providedClient: SupabaseClient | undefined;

  if (typeof chatIdOrParams === 'object') {
    chatId = chatIdOrParams.chatId;
    character = chatIdOrParams.character;
    characterId = character.id;
    persona = chatIdOrParams.persona || null;
    history = chatIdOrParams.history || [];
    userQuery = chatIdOrParams.latestUserMessage;
    clientContext = chatIdOrParams.clientContext;
    reuseContext = !!chatIdOrParams.reuseClientContext && !!clientContext;
    providedClient = chatIdOrParams.supabase;
  } else {
    chatId = chatIdOrParams;
    characterId = characterIdFallback || '';
    userQuery = userQueryFallback || '';
  }

  const charName = character?.name || 'Character';
  const userName = persona?.name || 'User';

  const isDbBacked = UUID_REGEX.test(chatId);
  const localMemories = clientContext?.memories || [];

  let pinnedMemories: Memory[] = [];
  let allMemories: Memory[] = localMemories;
  let summary: Summary | null = clientContext?.summary ?? null;
  let chatState: ChatState | null = clientContext?.chatState ?? null;

  const needsDb = isDbBacked || !!characterId;
  const supabase = needsDb ? providedClient ?? (await createClient()) : null;

  // Memories, summary, scene state and lorebooks are independent — fetch them in
  // one round trip instead of five sequential ones. When the caller just read
  // memories/summary/state (`reuseClientContext`), only lore is fetched.
  const [memoryRes, summaryRes, stateRes, loreRes] = await Promise.all([
    isDbBacked && supabase && !reuseContext
      ? supabase
          .from('memories')
          .select(MEMORY_COLUMNS)
          .eq('chat_id', chatId)
          .is('superseded_by', null)
          .order('created_at', { ascending: false })
          .limit(300)
      : null,
    isDbBacked && supabase && !reuseContext
      ? supabase
          .from('summaries')
          .select('*')
          .eq('chat_id', chatId)
          .eq('superseded', false)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      : null,
    isDbBacked && supabase && !reuseContext ? supabase.from('chat_state').select('*').eq('chat_id', chatId).maybeSingle() : null,
    characterId && supabase ? loadLorebookEntries(supabase, characterId) : Promise.resolve([] as LorebookEntry[]),
  ]).catch((err) => {
    console.warn('Context fetch warning:', err);
    return [null, null, null, [] as LorebookEntry[]] as const;
  });

  if (memoryRes?.data?.length) allMemories = memoryRes.data as Memory[];
  if (summaryRes?.data) summary = summaryRes.data as Summary;
  if (stateRes?.data) chatState = stateRes.data as ChatState;

  pinnedMemories = allMemories.filter((m) => m.pinned);

  // Recall: relevant older memories for this moment (SillyTavern vector memory).
  const vectorResult = await retrieveVectorMemories({
    chatId,
    userQuery,
    history,
    memories: allMemories,
    trackAccess: isDbBacked,
    supabase: supabase ?? undefined,
    charName,
    userName,
  });

  const relevantMemories: Memory[] = vectorResult.memories;

  // Lorebooks via the SillyTavern World Info scanner (selective logic, regex, recursion).
  let activatedLore: ActivatedLore | undefined;
  let triggeredLore: LorebookEntry[] = [];

  if (loreRes.length > 0) {
    try {
      const scanEntries: WorldInfoScanEntry[] = loreRes.map((e: LorebookEntry) => ({
        ...e,
        keys: e.keys || [],
        secondary_keys: e.secondary_keys || [],
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
    } catch (err) {
      console.warn('Lorebook scan warning:', err);
    }
  }

  return {
    pinnedMemories,
    relevantMemories,
    allMemories,
    vectorMemories: vectorResult,
    summary,
    chatState,
    triggeredLore,
    activatedLore,
  };
}

async function loadLorebookEntries(supabase: SupabaseClient, characterId: string): Promise<LorebookEntry[]> {
  const { data: links } = await supabase
    .from('character_lorebooks')
    .select('lorebook_id')
    .eq('character_id', characterId);
  if (!links?.length) return [];
  const { data: entries } = await supabase
    .from('lorebook_entries')
    .select('*')
    .in(
      'lorebook_id',
      links.map((l) => l.lorebook_id)
    )
    .eq('enabled', true);
  return (entries as LorebookEntry[]) || [];
}
