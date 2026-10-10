/**
 * Automatic Memory Engine
 * -----------------------
 * One background "memory pass" regenerates everything the story needs to remember:
 *
 *   1. the running story summary      → injected as "[Summary: …]"
 *   2. durable fact memories          → injected by recall as "Past events:" / <pinned_facts>
 *   3. revisions of stale memories    → keeps the fact bank self-healing over long chats
 *   4. the scene state patch          → injected as <scene_state>
 *
 * Cadence follows the SillyTavern model: nothing runs on every single turn. The pass
 * fires on a message interval (or when the un-summarised stretch gets long, or when the
 * conversation is about to push older turns out of the assembled context), so long chats
 * stay coherent without a per-turn tax.
 *
 * Everything is regenerated rather than appended: the summary is rewritten from the
 * previous summary plus the new stretch, and the fact bank is merged and superseded as
 * needed. That is what keeps a 500-message chat as tight as a 20-message one.
 */

import { jsonCompletion } from '@/lib/llm/client';
import { estimateTokens, truncateToTokensMiddle } from '@/lib/prompt/tokens';
import type { Memory, Summary, ChatState, Message } from '@/lib/supabase/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export const MEMORY_PASS_INTERVAL_MESSAGES = 10;
export const MEMORY_PASS_INTERVAL_TOKENS = 1500;
export const MEMORY_PASS_MAX_DELTA_MESSAGES = 30;
export const DEFAULT_SUMMARY_WORDS = 200;
export const SUMMARY_TOKEN_CAP = 900;
/** Backstop: never let the fact bank grow without bound on very long chats. */
export const MAX_ACTIVE_MEMORIES = 140;

export const MEMORY_KINDS = ['fact', 'event', 'preference', 'relationship', 'promise', 'secret', 'trait'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

const AFFECTION_LEVELS = ['hostile', 'wary', 'stranger', 'acquaintance', 'friend', 'close', 'romantic', 'devoted'];

export interface MemoryPassInput {
  chatId: string;
  userId: string;
  charName: string;
  userName: string;
  /** Full known transcript, oldest first. */
  history: Message[];
  /** Messages already folded into memory (chats.memory_cursor_id). */
  cursorMessageId?: string | null;
  /** The active (non-superseded) summary, if any. */
  summary?: Summary | null;
  /** Active memories, used to dedupe and to detect contradictions. */
  memories?: Memory[];
  currentState?: ChatState['state'];
  /** User-locked summary: never overwrite it. */
  frozen?: boolean;
  summaryWords?: number;
  apiKey?: string;
}

export interface MemoryPassResult {
  summary: Summary | null;
  newMemories: Memory[];
  /** Applied rewrites of existing memories: { id, content }. */
  revisions: Array<{ id: string; content: string }>;
  supersededMemoryIds: string[];
  state: ChatState['state'] | null;
  /** Whether a pass actually ran (false when the trigger said "not yet"). */
  ran: boolean;
}

interface PassPayload {
  summary?: unknown;
  facts?: unknown;
  revisions?: unknown;
  contradicts_memory_ids?: unknown;
  state_patch?: unknown;
}

interface ParsedFact {
  content: string;
  kind: MemoryKind;
  entities: string[];
  importance: number;
}

export function cleanSummaryOutput(raw: string): string {
  let cleaned = (raw || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();

  cleaned = cleaned.replace(/^\[?summary:\s*/i, '').replace(/\]$/, '').trim();
  return cleaned;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const cleanStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() && !/^(null|none|unchanged|n\/a)$/i.test(v.trim()) ? v.trim() : undefined;

const normalize = (s: string) => s.toLowerCase().replace(/\W+/g, ' ').trim();

// ── Trigger ───────────────────────────────────────────────────────────────────

/**
 * Decides whether it is time to run a pass. Uses the message interval, the size of the
 * un-summarised stretch, and — crucially — whether the conversation is close to pushing
 * older turns out of the assembled prompt. Summarising *before* context is lost is the
 * whole point.
 */
export function shouldRunMemoryPass(params: {
  history: Message[];
  cursorMessageId?: string | null;
  hasSummary: boolean;
  historyTokenBudget?: number;
  /** Message count between passes (SillyTavern's summary interval). */
  intervalMessages?: number;
  force?: boolean;
}): { run: boolean; delta: Message[]; reason: string } {
  const {
    history,
    cursorMessageId,
    hasSummary,
    historyTokenBudget = 7000,
    intervalMessages = MEMORY_PASS_INTERVAL_MESSAGES,
    force = false,
  } = params;

  const clean = history.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim());
  let startIndex = 0;
  if (cursorMessageId) {
    const idx = clean.findIndex((m) => m.id === cursorMessageId);
    if (idx !== -1) startIndex = idx + 1;
  }

  const delta = clean.slice(startIndex);
  const deltaTokens = estimateTokens(delta.map((m) => m.content).join('\n'));

  if (force) return { run: true, delta, reason: 'forced' };
  if (delta.length === 0) return { run: false, delta, reason: 'no new messages' };
  if (!hasSummary && clean.length >= 6) return { run: true, delta, reason: 'no summary yet' };
  if (delta.length >= intervalMessages) return { run: true, delta, reason: 'message interval' };
  // Context pressure: once the un-summarised stretch fills half of the history
  // window, its oldest turns are about to fall out of the prompt — fold them in
  // first. (Comparing the *whole* transcript against the window instead fires on
  // nearly every turn of a long chat, since older turns are already summarised.)
  const pressureTokens = Math.max(MEMORY_PASS_INTERVAL_TOKENS, Math.floor(historyTokenBudget * 0.5));
  if (deltaTokens >= pressureTokens && delta.length >= 2) {
    return { run: true, delta, reason: 'context pressure' };
  }

  return { run: false, delta, reason: 'below interval' };
}

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildMemoryPassSystem(charName: string, userName: string, summaryWords: number): string {
  return `You are the continuity editor for a long-running work of interactive fiction between ${charName} (played by the app) and ${userName} (played by a human). Periodically you receive the story's existing records plus a newly written stretch of exchanges, and you regenerate the story's memory so the writers never lose the thread.

You are a neutral record-keeper: record what the story says happened, without judging, censoring, softening, or embellishing it. Never write story prose yourself.

Return ONE JSON object with exactly these keys: "summary", "facts", "revisions", "contradicts_memory_ids", "state_patch".

## "summary" — the running story summary (regenerate it completely)
Plain text, no markdown, no bullet characters, at most ${summaryWords} words. It must be self-contained: someone who has never read the chat must understand where the story stands. Use exactly these labelled lines, in this order:
STORY: <the overall arc so far — what this story is about, in 2-4 sentences>
NOW: <where things stand at the very latest moment: place, situation, immediate tension>
RELATIONSHIP: <how ${charName} and ${userName} stand with each other right now: feelings, status, unresolved tension>
OPEN THREADS: <unresolved promises, plans, secrets, threats, questions the story has raised — or "none">
KEY FACTS: <stable truths that must never be contradicted: names, places, established history — or "none">
Compression rule: as the story grows, spend fewer words on old events. Keep NOW and RELATIONSHIP current. Never drop an open thread, a promise, or a key fact to make room — compress old narration first.

## "facts" — durable individual memories
Save only information that will still matter many turns from now:
- Commitments and promises, plans, deadlines, debts, agreements.
- Revealed backstory, secrets (note who knows them), and names/relationships of new people.
- Changes in how ${charName} feels about or treats ${userName}, and why.
- Stable preferences, boundaries, fears, habits, or traits revealed by either side.
- Significant events: a first kiss, a fight, an injury, a betrayal, a gift, a decision, a death, a move that matters.
- Concrete world facts introduced (a place, an object's properties, a rule of the setting).
Do NOT save: momentary gestures, small talk, scenery, restatements of things already in EXISTING MEMORIES, or anything speculative. Most stretches produce 1-3 facts; many produce none. Return an empty list when nothing durable happened.
Each fact: one self-contained sentence in third person, past or present as appropriate, using names — never "he", "she", "they", or "the user". Someone reading it alone months later must understand it. Attribute information to whoever knows it. No quotation marks, no formatting, no markdown.
- kind: "fact" (world/background), "event" (something that happened), "preference", "relationship", "promise", "secret", "trait".
- importance 1-10: 1-3 minor detail, 4-6 useful context, 7-8 shapes the story, 9-10 defining moment or core identity. Skip anything you would rate below 3.
- entities: names of people, places, and key objects involved.

## "revisions" — regenerating existing memories
Existing memories sometimes need rewriting: two records say the same thing, or one has been overtaken by events. You may rewrite up to 3 existing memories per pass:
- Merge duplicates into one clearer sentence, or refresh a record whose wording is now misleading.
- Never lose information: the rewritten sentence must carry everything the original held that is still true.
- Each entry is {"id": "<existing memory id>", "content": "<rewritten sentence>"}.
- Only use IDs from EXISTING MEMORIES. Never touch a memory marked [pinned] — the writer wrote those by hand.

## "contradicts_memory_ids"
If the new exchanges make an EXISTING MEMORY false or outdated (a promise broken, a relationship changed, a secret revealed), list its exact ID here AND write a new fact stating the updated truth. Only IDs from EXISTING MEMORIES; never invent IDs. Never contradict a [pinned] memory.

## "state_patch" — the scene tracker
Report ONLY values that changed or were newly established in this stretch; use null for anything unchanged.
- location: short place description.
- time_of_day: morning, afternoon, evening, night (or a specific time if given).
- char_mood: ${charName}'s dominant emotion right now, 1-4 words.
- affection_level: one of ${AFFECTION_LEVELS.join(', ')} — only if the relationship category genuinely shifted.
- relationship_score_delta: integer from -5 to 5 for this stretch alone. Most stretches are 0 or ±1; use ±3 or more only for major moments (a confession, a betrayal). Judge by how ${charName} would actually feel, not by politeness.
- inventory_added / inventory_removed: notable items either side acquired or lost (not trivial props).
- current_clothing: ${charName}'s current outfit, only if it changed or was first described.`;
}

function buildMemoryPassUserMessage(input: {
  charName: string;
  userName: string;
  summary: string | null;
  memories: Memory[];
  delta: Message[];
  currentState: ChatState['state'];
  summaryWords: number;
}): string {
  const memoryLines = input.memories.length
    ? input.memories
        .map(
          (m) =>
            `[ID: ${m.id}] (${m.kind}${m.pinned ? ', pinned' : ''}) ${m.content}`
        )
        .join('\n')
    : 'None yet.';

  const exchangeLines = input.delta
    .map((m) => {
      const speaker = m.role === 'assistant' ? input.charName : input.userName;
      return `${speaker}: ${(m.content || '').trim()}`;
    })
    .join('\n\n');

  return `<existing_summary>
${input.summary?.trim() || 'None yet.'}
</existing_summary>

<existing_memories>
${memoryLines}
</existing_memories>

<current_scene_state>
${JSON.stringify(input.currentState || {})}
</current_scene_state>

<new_exchanges>
${exchangeLines}
</new_exchanges>

Regenerate the story memory from the records above plus the new exchanges. Return only the JSON object.`;
}

function parseFacts(raw: unknown): ParsedFact[] {
  if (!Array.isArray(raw)) return [];
  const out: ParsedFact[] = [];
  for (const f of raw) {
    if (!f || typeof f !== 'object') continue;
    const content = cleanStr((f as Record<string, unknown>).content);
    if (!content) continue;
    const importance = clamp(Math.round(Number((f as Record<string, unknown>).importance) || 5), 1, 10);
    if (importance < 3) continue;
    const kindRaw = String((f as Record<string, unknown>).kind || 'fact');
    const kind: MemoryKind = (MEMORY_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as MemoryKind) : 'fact';
    const entities = Array.isArray((f as Record<string, unknown>).entities)
      ? ((f as Record<string, unknown>).entities as unknown[]).map(String).filter(Boolean).slice(0, 8)
      : [];
    out.push({ content: content.slice(0, 400), kind, entities, importance });
  }
  return out.slice(0, 8);
}

// ── Persistence ───────────────────────────────────────────────────────────────

interface PersistTarget {
  supabase: SupabaseClient;
  chatId: string;
  userId: string;
  isDbBacked: boolean;
}

async function persistSummary(
  target: PersistTarget,
  content: string,
  delta: Message[],
  previous: Summary | null
): Promise<Summary | null> {
  const summaryRow: Summary = {
    id: `sum-${Date.now()}`,
    chat_id: target.chatId,
    user_id: target.userId,
    level: 'chunk',
    content,
    message_ids: delta.map((m) => m.id).filter(Boolean),
    last_message_id: delta[delta.length - 1]?.id || null,
    token_estimate: estimateTokens(content),
    user_edited: false,
    superseded: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (!target.isDbBacked) return summaryRow;

  try {
    if (previous?.id) {
      await target.supabase.from('summaries').update({ superseded: true }).eq('id', previous.id);
    }
    const { data, error } = await target.supabase
      .from('summaries')
      .insert({
        chat_id: target.chatId,
        user_id: target.userId,
        level: 'chunk',
        content,
        message_ids: summaryRow.message_ids,
        last_message_id: summaryRow.last_message_id,
        token_estimate: summaryRow.token_estimate,
        user_edited: false,
        superseded: false,
      })
      .select()
      .single();
    if (!error && data) return data as Summary;
  } catch (err) {
    console.warn('Memory pass: summary persistence failed:', err);
  }
  return summaryRow;
}

async function persistFacts(
  target: PersistTarget,
  facts: ParsedFact[],
  existing: Memory[],
  sourceMessageIds: string[]
): Promise<Memory[]> {
  const seen = new Set(existing.map((m) => normalize(m.content)));
  const rows = facts
    .filter((f) => {
      const key = normalize(f.content);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((f) => ({
      chat_id: target.chatId,
      user_id: target.userId,
      content: f.content,
      kind: f.kind,
      entities: f.entities,
      importance: f.importance,
      pinned: false,
      source_message_ids: sourceMessageIds.slice(-8),
    }));

  if (!rows.length) return [];
  if (!target.isDbBacked) {
    return rows.map((r, i) => ({
      ...r,
      id: `mem-${Date.now()}-${i}`,
      embedding: null,
      superseded_by: null,
      access_count: 0,
      last_accessed_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })) as Memory[];
  }

  try {
    const { data, error } = await target.supabase.from('memories').insert(rows).select('*');
    if (error) {
      console.warn('Memory pass: fact insert failed:', error.message);
      return [];
    }
    return (data || []) as Memory[];
  } catch (err) {
    console.warn('Memory pass: fact persistence failed:', err);
    return [];
  }
}

async function persistRevisions(
  target: PersistTarget,
  revisions: Array<{ id: string; content: string }>,
  existing: Memory[]
): Promise<Array<{ id: string; content: string }>> {
  const applied: Array<{ id: string; content: string }> = [];
  const byId = new Map(existing.map((m) => [m.id, m]));

  for (const rev of revisions.slice(0, 3)) {
    const current = byId.get(rev.id);
    const content = cleanStr(rev.content);
    // Pinned (user-authored) memories are never auto-rewritten.
    if (!current || current.pinned || !content || normalize(content) === normalize(current.content)) continue;
    applied.push({ id: rev.id, content });
    if (target.isDbBacked) {
      try {
        await target.supabase.from('memories').update({ content, updated_at: new Date().toISOString() }).eq('id', rev.id);
      } catch (err) {
        console.warn('Memory pass: revision failed:', err);
      }
    } else {
      current.content = content;
    }
  }
  return applied;
}

async function persistContradictions(
  target: PersistTarget,
  ids: string[],
  existing: Memory[],
  supersedingId: string | null
): Promise<string[]> {
  const valid = new Set(existing.map((m) => m.id));
  const contradicted = ids
    .filter((id) => valid.has(id))
    .filter((id) => {
      const m = existing.find((x) => x.id === id);
      return m && !m.pinned;
    });

  if (!contradicted.length) return [];
  if (target.isDbBacked) {
    try {
      if (supersedingId) {
        await target.supabase.from('memories').update({ superseded_by: supersedingId }).in('id', contradicted);
      } else {
        // Nothing new was written to supersede them — they are simply false now.
        await target.supabase.from('memories').delete().in('id', contradicted);
      }
    } catch (err) {
      console.warn('Memory pass: supersede failed:', err);
    }
  }
  return contradicted;
}

async function persistState(target: PersistTarget, state: ChatState['state']) {
  if (!target.isDbBacked) return;
  try {
    await target.supabase
      .from('chat_state')
      .upsert({ chat_id: target.chatId, user_id: target.userId, state, updated_at: new Date().toISOString() });
  } catch (err) {
    console.warn('Memory pass: state persistence failed:', err);
  }
}

/** Prunes the oldest low-value auto-memories once the bank outgrows its cap. */
async function pruneMemoryBank(target: PersistTarget, existing: Memory[]): Promise<string[]> {
  const auto = existing.filter((m) => !m.pinned && m.importance <= 4);
  const overflow = auto.length + existing.filter((m) => !m.pinned && m.importance > 4).length - MAX_ACTIVE_MEMORIES;
  if (overflow <= 0) return [];

  const doomed = auto
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''))
    .slice(0, overflow)
    .map((m) => m.id);

  if (doomed.length && target.isDbBacked) {
    try {
      await target.supabase.from('memories').delete().in('id', doomed);
    } catch (err) {
      console.warn('Memory pass: prune failed:', err);
    }
  }
  return doomed;
}

// ── The pass ──────────────────────────────────────────────────────────────────

/**
 * Runs the memory pass over `delta` (messages not yet folded into memory) and persists
 * everything. Safe to call for guests: pass `isDbBacked: false` and the result is returned
 * for the client to store locally instead of being written to Supabase.
 */
export async function runMemoryPass(
  input: MemoryPassInput,
  options: { supabase?: SupabaseClient; isDbBacked?: boolean } = {}
): Promise<MemoryPassResult> {
  const summaryWords = input.summaryWords ?? DEFAULT_SUMMARY_WORDS;
  const memories = (input.memories || []).filter((m) => !m.superseded_by);

  // Biggest recent stretch not yet folded in, capped so one pass can never blow up.
  const clean = input.history.filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim());
  let startIndex = 0;
  if (input.cursorMessageId) {
    const idx = clean.findIndex((m) => m.id === input.cursorMessageId);
    if (idx !== -1) startIndex = idx + 1;
  }
  const delta = clean.slice(startIndex).slice(-MEMORY_PASS_MAX_DELTA_MESSAGES);

  const empty: MemoryPassResult = {
    summary: input.summary ?? null,
    newMemories: [],
    revisions: [],
    supersededMemoryIds: [],
    state: null,
    ran: false,
  };
  if (!delta.length) return empty;

  const target: PersistTarget = {
    supabase: options.supabase as SupabaseClient,
    chatId: input.chatId,
    userId: input.userId,
    isDbBacked: options.isDbBacked ?? !!options.supabase,
  };

  // Show the model only what it needs: recent-ish, non-superseded memories, newest first.
  const visibleMemories = [...memories]
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, 80);

  let payload: PassPayload | null = null;
  try {
    payload = await jsonCompletion<PassPayload>(
      [
        { role: 'system', content: buildMemoryPassSystem(input.charName, input.userName, summaryWords) },
        {
          role: 'user',
          content: buildMemoryPassUserMessage({
            charName: input.charName,
            userName: input.userName,
            summary: input.summary?.content ?? null,
            memories: visibleMemories,
            delta,
            currentState: input.currentState || {},
            summaryWords,
          }),
        },
      ],
      { apiKey: input.apiKey, sessionId: `memory-${input.chatId}`, temperature: 0.2, max_tokens: 3000 }
    );
  } catch (err) {
    console.error('Memory pass: model call failed:', err);
    return empty;
  }

  if (!payload) return empty;

  // 1. Summary — regenerated wholesale, unless the writer locked it.
  let summaryOut: Summary | null = input.summary ?? null;
  const summaryText = cleanSummaryOutput(String(payload.summary || ''));
  if (!input.frozen && summaryText.length >= 40) {
    summaryOut = await persistSummary(
      target,
      truncateToTokensMiddle(summaryText, SUMMARY_TOKEN_CAP),
      delta,
      input.summary ?? null
    );
  }

  // 2. New facts.
  const sourceIds = delta.map((m) => m.id).filter(Boolean);
  const newMemories = await persistFacts(target, parseFacts(payload.facts), memories, sourceIds);

  // 3. Revisions + contradictions (both keep the bank self-healing).
  const revisions = Array.isArray(payload.revisions)
    ? payload.revisions
        .filter((r): r is { id: string; content: string } =>
          !!r && typeof r === 'object' && typeof (r as Record<string, unknown>).id === 'string'
        )
        .map((r) => ({ id: r.id, content: String(r.content || '') }))
    : [];
  const appliedRevisions = await persistRevisions(target, revisions, memories);

  const contradictIds = Array.isArray(payload.contradicts_memory_ids)
    ? payload.contradicts_memory_ids.map(String)
    : [];
  const supersededMemoryIds = await persistContradictions(
    target,
    contradictIds,
    memories,
    newMemories[0]?.id ?? null
  );

  // 4. Scene state patch.
  let state: ChatState['state'] | null = null;
  const patch = (payload.state_patch || {}) as Record<string, unknown>;
  const deltaScore = clamp(Math.round(Number(patch.relationship_score_delta) || 0), -5, 5);
  const current = input.currentState || {};
  const removed = new Set(((patch.inventory_removed as string[]) || []).map((s) => String(s).toLowerCase()));
  const inventory = [
    ...new Set([...(current.inventory || []), ...((patch.inventory_added as string[]) || []).map(String)]),
  ].filter((item) => !removed.has(item.toLowerCase()));

  const affection = cleanStr(patch.affection_level)?.toLowerCase();
  const hasChange =
    cleanStr(patch.location) ||
    cleanStr(patch.time_of_day) ||
    cleanStr(patch.char_mood) ||
    cleanStr(patch.current_clothing) ||
    affection ||
    deltaScore !== 0 ||
    ((patch.inventory_added as string[]) || []).length > 0 ||
    ((patch.inventory_removed as string[]) || []).length > 0;

  if (hasChange) {
    state = {
      ...current,
      location: cleanStr(patch.location) || current.location,
      time_of_day: cleanStr(patch.time_of_day) || current.time_of_day,
      char_mood: cleanStr(patch.char_mood) || current.char_mood,
      relationship_score: clamp((current.relationship_score ?? 0) + deltaScore, -100, 100),
      affection_level: affection && AFFECTION_LEVELS.includes(affection) ? affection : current.affection_level,
      inventory,
      current_clothing: cleanStr(patch.current_clothing) || current.current_clothing,
    };
    await persistState(target, state);
  }

  // 5. Cursor: everything in `delta` is now folded into memory.
  if (target.isDbBacked) {
    const lastId = delta[delta.length - 1]?.id;
    try {
      if (lastId) {
        await target.supabase.from('chats').update({ memory_cursor_id: lastId }).eq('id', input.chatId);
      }
      await pruneMemoryBank(target, memories);
    } catch (err) {
      console.warn('Memory pass: cursor/prune failed:', err);
    }
  }

  return {
    summary: summaryOut,
    newMemories,
    revisions: appliedRevisions,
    supersededMemoryIds,
    state,
    ran: true,
  };
}

/**
 * Entry point used by the chat route's background task and the /api/chat/memory endpoint.
 * Runs a pass only when the trigger says it is time. Returns `ran: false` otherwise.
 */
export async function regenerateMemoryIfNeeded(
  input: MemoryPassInput & { historyTokenBudget?: number; intervalMessages?: number; force?: boolean },
  options: { supabase?: SupabaseClient; isDbBacked?: boolean } = {}
): Promise<MemoryPassResult> {
  const trigger = shouldRunMemoryPass({
    history: input.history,
    cursorMessageId: input.cursorMessageId,
    hasSummary: !!input.summary,
    historyTokenBudget: input.historyTokenBudget,
    intervalMessages: input.intervalMessages,
    force: input.force,
  });

  if (!trigger.run) {
    return {
      summary: input.summary ?? null,
      newMemories: [],
      revisions: [],
      supersededMemoryIds: [],
      state: null,
      ran: false,
    };
  }

  return runMemoryPass({ ...input, history: input.history }, options);
}
