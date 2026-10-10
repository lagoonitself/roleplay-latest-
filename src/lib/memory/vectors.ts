/**
 * Memory Recall (SillyTavern "vectors memory", without the embeddings)
 * --------------------------------------------------------------------
 * SillyTavern's vector memory recalls chunks of older conversation that sit
 * *outside* the protected recent window and re-injects them as "Past events:"
 * at depth 2. Its defaults are the ones used here:
 *
 *   protect = 5   the last N messages are never recalled (they're already in context)
 *   insert  = 3   the top-K recalled items are injected
 *   query   = 2   the last N messages form the recall query
 *   score   = 0.25 minimum relevance
 *
 * SillyTavern matches by embedding cosine similarity. There is no embedding
 * endpoint in front of us, so recall is scored in-process instead: entity overlap
 * (names, places, objects), salient-term overlap, memory importance, and recency.
 * The same shape, the same budget — different similarity function. If an embedding
 * provider is ever configured (see EMBEDDINGS_ENDPOINT), the hybrid query can pick
 * it up without any change to callers.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { formatHistoryText } from '@/lib/prompt/macros';
import type { Memory, Message } from '@/lib/supabase/types';

export const DEFAULT_VECTORS_TEMPLATE = 'Past events:\n{{text}}';
export const DEFAULT_VECTORS_DEPTH = 2;
export const DEFAULT_VECTORS_PROTECT = 5;
export const DEFAULT_VECTORS_INSERT = 3;
export const DEFAULT_VECTORS_QUERY_MESSAGES = 2;
export const DEFAULT_SCORE_THRESHOLD = 0.25;

export interface VectorQueryOptions {
  chatId: string;
  userQuery: string;
  history: Message[];
  /** Pre-loaded memories (guest / local chats). When omitted they are fetched. */
  memories?: Memory[];
  /** Update access tracking on recalled rows (database-backed chats only). */
  trackAccess?: boolean;
  /** The caller's authenticated client (see retriever.ts). */
  supabase?: SupabaseClient;
  protectCount?: number;
  insertCount?: number;
  queryMessageCount?: number;
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
  /** Why each item was recalled — surfaced in the memory inspector. */
  scores?: number[];
}

// ── Query understanding ───────────────────────────────────────────────────────

const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from has have he her him his i if in into is it its me my of on or our she ' +
    'so that the their them then there these they this to was we were what when where which who will with you your ' +
    'not no nor do does did done been being am than too very just about after before over under again more most ' +
    'some such only own same s t don should now up down out off further once here why how all any both each few ' +
    'other can would could ought m re ve ll d'
  ).split(/\s+/)
);

export interface QueryProfile {
  terms: string[];
  names: string[];
}

/**
 * Pulls the salient vocabulary out of recent chat text: proper nouns (best signal
 * for "who and what is this about") plus content words.
 */
export function analyzeQuery(text: string): QueryProfile {
  if (!text) return { terms: [], names: [] };

  const names = Array.from(
    new Set(
      (text.match(/\b[A-Z][a-zA-Z][a-zA-Z'’-]{1,}\b/g) || [])
        .filter((w) => !STOPWORDS.has(w.toLowerCase()))
        .filter((w) => !/^(I|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(w))
    )
  ).slice(0, 12);

  const terms = Array.from(
    new Set(
      (text.toLowerCase().match(/[a-zA-Z][a-zA-Z'’-]{2,}/g) || [])
        .map((w) => w.replace(/['’]/g, "'"))
        .filter((w) => !STOPWORDS.has(w))
    )
  ).slice(0, 40);

  return { terms, names };
}

export function scoreMemory(memory: Memory, profile: QueryProfile): number {
  const content = (memory.content || '').toLowerCase();
  if (!content) return 0;

  const memoryTerms = new Set(
    (content.match(/[a-zA-Z][a-zA-Z'’-]{2,}/g) || []).map((w) => w.replace(/['’]/g, "'")).filter((w) => !STOPWORDS.has(w))
  );

  let termHits = 0;
  for (const term of profile.terms) {
    if (memoryTerms.has(term)) termHits += 1;
    else if (term.length > 5 && content.includes(term)) termHits += 0.5;
  }
  const termScore = profile.terms.length ? Math.min(1, termHits / Math.min(6, profile.terms.length)) : 0;

  const memoryEntities = (memory.entities || []).map((e) => e.toLowerCase());
  let entityHits = 0;
  for (const name of profile.names) {
    const lower = name.toLowerCase();
    if (memoryEntities.some((e) => e === lower || e.includes(lower) || lower.includes(e))) entityHits += 1;
    else if (content.includes(lower)) entityHits += 0.5;
  }
  const entityScore = Math.min(1, entityHits / 2);

  const importanceScore = Math.min(10, Math.max(1, memory.importance ?? 5)) / 10;

  const ageDays = memory.created_at
    ? Math.max(0, (Date.now() - new Date(memory.created_at).getTime()) / 86_400_000)
    : 0;
  const recencyScore = Math.exp(-ageDays / 21);

  return 0.4 * termScore + 0.3 * entityScore + 0.15 * importanceScore + 0.15 * recencyScore;
}

/**
 * Retrieves memories relevant to the current moment, excluding anything derived
 * from the protected recent message window (it would duplicate live history).
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
    queryMessageCount = DEFAULT_VECTORS_QUERY_MESSAGES,
    scoreThreshold = DEFAULT_SCORE_THRESHOLD,
    template = DEFAULT_VECTORS_TEMPLATE,
    charName = 'Character',
    userName = 'User',
  } = options;

  const empty: VectorRetrievalResult = {
    memories: [],
    formattedText: '',
    depth: DEFAULT_VECTORS_DEPTH,
    role: 'system',
    scores: [],
  };

  // SillyTavern builds the recall query from the last N messages, not just the
  // newest line — a reply is usually about the exchange, not the last sentence.
  const recent = history.slice(-queryMessageCount);
  const queryText = [userQuery, ...recent.map((m) => m.content || '')].join('\n').trim();
  if (!chatId || !queryText) return empty;

  const profile = analyzeQuery(queryText);

  // Protected window: the live tail is already in context, so never recall from it.
  const protectedTurns = history.slice(-protectCount);
  const protectedMessageIds = new Set(protectedTurns.map((m) => m.id).filter(Boolean));

  let candidates: Memory[] = [];

  if (options.memories) {
    candidates = options.memories.filter((m) => !m.superseded_by && !m.pinned);
  } else {
    try {
      const supabase = options.supabase ?? (await createClient());

      // Broad but bounded candidate set: entity hits + recent + important.
      const queries = [
        profile.names.length
          ? supabase
              .from('memories')
              .select('*')
              .eq('chat_id', chatId)
              .is('superseded_by', null)
              .eq('pinned', false)
              .overlaps('entities', profile.names.slice(0, 8))
              .limit(30)
          : Promise.resolve({ data: [] as Memory[] }),
        supabase
          .from('memories')
          .select('*')
          .eq('chat_id', chatId)
          .is('superseded_by', null)
          .eq('pinned', false)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('memories')
          .select('*')
          .eq('chat_id', chatId)
          .is('superseded_by', null)
          .eq('pinned', false)
          .order('importance', { ascending: false })
          .limit(20),
      ];

      const results = await Promise.all(queries);
      const byId = new Map<string, Memory>();
      for (const r of results) {
        for (const row of (r.data || []) as Memory[]) byId.set(row.id, row);
      }
      candidates = Array.from(byId.values());
    } catch (err) {
      console.warn('Memory recall warning:', err);
      return empty;
    }
  }

  const scored = candidates
    .filter((m) => {
      if (Array.isArray(m.source_message_ids) && m.source_message_ids.some((id) => protectedMessageIds.has(id))) {
        return false;
      }
      return true;
    })
    .map((m) => ({ memory: m, score: scoreMemory(m, profile) }))
    .filter((s) => s.score >= scoreThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, insertCount);

  if (scored.length === 0) return empty;

  const textItems = scored.map(({ memory }) => `- ${formatHistoryText(memory.content, charName, userName)}`);
  const formattedText = template.replace(/\{\{\s*text\s*\}\}/gi, textItems.join('\n'));

  // Touch access tracking so the recency signal in the store stays meaningful.
  // Touch access tracking without holding up the reply: it is best-effort only.
  if (options.trackAccess) {
    const ids = scored.map((s) => s.memory.id);
    void (async () => {
      try {
        const supabase = options.supabase ?? (await createClient());
        await supabase.from('memories').update({ last_accessed_at: new Date().toISOString() }).in('id', ids);
      } catch {
        // never let it break a reply
      }
    })();
  }

  return {
    memories: scored.map((s) => s.memory),
    formattedText,
    depth: DEFAULT_VECTORS_DEPTH,
    role: 'system',
    scores: scored.map((s) => Number(s.score.toFixed(3))),
  };
}
