import { jsonCompletion } from '@/lib/llm/client';
import { createClient } from '@/lib/supabase/server';
import type { ChatState, Memory } from '@/lib/supabase/types';

const MEMORY_KINDS = ['fact', 'event', 'preference', 'relationship', 'promise', 'secret', 'trait'] as const;
type MemoryKind = (typeof MEMORY_KINDS)[number];

interface ExtractionResult {
  facts?: Array<{
    content?: string;
    kind?: string;
    entities?: string[];
    importance?: number;
  }>;
  state_patch?: {
    location?: string | null;
    time_of_day?: string | null;
    char_mood?: string | null;
    relationship_score_delta?: number | null;
    affection_level?: string | null;
    inventory_added?: string[] | null;
    inventory_removed?: string[] | null;
    current_clothing?: string | null;
  };
  contradicts_memory_ids?: string[];
}

const AFFECTION_LEVELS = ['hostile', 'wary', 'stranger', 'acquaintance', 'friend', 'close', 'romantic', 'devoted'];

function buildExtractorSystem(charName: string, userName: string): string {
  return `You maintain the long-term memory and scene tracker for an ongoing fictional roleplay between ${charName} (AI-controlled) and ${userName} (human-controlled). You read ONE new exchange and output what should be remembered. You are a neutral record-keeper: record what happened in the story without judging, censoring, or softening it.

# What to remember (facts)
Save only information that will still matter many turns from now:
- Commitments and promises, plans, deadlines, debts, agreements.
- Revealed backstory, secrets (who knows them), and names/relationships of new people.
- Changes in how ${charName} feels about or treats ${userName} (and why).
- Stable preferences, boundaries, fears, habits, or traits revealed by either character.
- Significant events: first kiss, fight, injury, betrayal, gift, decision, death, location change that matters.
- Concrete world facts introduced (a place, an object's properties, a rule of the setting).
Do NOT save: momentary actions or gestures, small talk, scenery, restatements of things already in EXISTING MEMORIES, or anything speculative. Most turns produce 0–2 facts; many produce none. Return an empty list when nothing durable happened.

# How to write each fact
- One self-contained sentence in third person, past or present as appropriate, using names (never "he/she/they/the user"): e.g. "${charName} promised ${userName} she would not tell Marcus about the safe." Someone reading it alone, months later, must understand it.
- Attribute information to who knows it. If ${userName} reveals something only to ${charName}, say so.
- Don't include quotation marks, formatting, or markdown.
- kind: "fact" (world/background), "event" (something that happened), "preference" (likes/dislikes/boundaries), "relationship" (feelings/status between characters), "promise" (commitment), "secret" (hidden info), "trait" (personality/habit).
- importance 1–10: 1–3 minor detail, 4–6 useful context, 7–8 shapes the story, 9–10 defining moment or core identity. Skip anything you'd rate below 3.
- entities: names of people, places, and key objects involved.

# Contradictions
If the new exchange makes an EXISTING MEMORY false or outdated (e.g. a promise broken, a relationship changed, a secret revealed), put its exact ID in contradicts_memory_ids AND add a new fact stating the updated truth. Only use IDs from the EXISTING MEMORIES list; never invent IDs.

# Scene state (state_patch)
Report ONLY values that changed or were newly established in this exchange; use null for anything unchanged.
- location: short place description. time_of_day: e.g. morning, afternoon, evening, night (or a specific time if given).
- char_mood: ${charName}'s dominant emotion right now, 1–4 words.
- affection_level: one of ${AFFECTION_LEVELS.join(', ')} — only if the relationship category genuinely shifted.
- relationship_score_delta: integer from -5 to 5 for this exchange alone. Most turns are 0 or ±1; use ±3 or more only for major moments (a confession, a betrayal). Judge by how ${charName} would actually feel, not by politeness.
- inventory_added / inventory_removed: notable items ${userName} or ${charName} acquired or lost (not trivial props).
- current_clothing: ${charName}'s current outfit, only if it changed or was first described.

# Output
Return ONLY one JSON object, no markdown, in this shape:
{"facts":[{"content":"...","kind":"event","entities":["..."],"importance":6}],"state_patch":{"location":null,"time_of_day":null,"char_mood":null,"relationship_score_delta":0,"affection_level":null,"inventory_added":[],"inventory_removed":[],"current_clothing":null},"contradicts_memory_ids":[]}`;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const cleanStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() && !/^(null|none|unchanged|n\/a)$/i.test(v.trim()) ? v.trim() : undefined;

/**
 * Runs asynchronously after an assistant message completes.
 * Extracts facts, updates scene state, and persists to Supabase.
 */
export async function extractMemoriesAndState(params: {
  chatId: string;
  userId: string;
  charName: string;
  userName: string;
  userMessage: string;
  assistantMessage: string;
  existingMemories?: Memory[];
  currentState?: ChatState['state'];
  apiKey?: string;
}) {
  const {
    chatId,
    userId,
    charName,
    userName,
    userMessage,
    assistantMessage,
    existingMemories = [],
    currentState = {},
    apiKey,
  } = params;

  try {
    const visibleMemories = existingMemories.slice(0, 15);
    const validIds = new Set(visibleMemories.map((m) => m.id));
    const memoryContext = visibleMemories.map((m) => `[ID: ${m.id}] (${m.kind}) ${m.content}`).join('\n');

    const result = await jsonCompletion<ExtractionResult>(
      [
        { role: 'system', content: buildExtractorSystem(charName, userName) },
        {
          role: 'user',
          content: `<existing_memories>
${memoryContext || 'None yet.'}
</existing_memories>

<current_scene_state>
${JSON.stringify(currentState)}
</current_scene_state>

<latest_exchange>
${userName}: ${userMessage}

${charName}: ${assistantMessage}
</latest_exchange>

Extract memories and scene-state changes from the latest exchange only.`,
        },
      ],
      { apiKey, sessionId: `mem-${chatId}`, temperature: 0.2, max_tokens: 1500 }
    );

    if (!result) return;
    const supabase = await createClient();

    // 1. Insert new, validated facts (skipping near-duplicates of what we already hold)
    const existingNorm = new Set(existingMemories.map((m) => m.content.toLowerCase().replace(/\W+/g, ' ').trim()));
    const memoryRows = (Array.isArray(result.facts) ? result.facts : [])
      .map((f) => {
        const content = cleanStr(f.content);
        if (!content) return null;
        const importance = clamp(Math.round(Number(f.importance) || 5), 1, 10);
        if (importance < 3) return null;
        const kind: MemoryKind = (MEMORY_KINDS as readonly string[]).includes(String(f.kind))
          ? (f.kind as MemoryKind)
          : 'fact';
        return {
          chat_id: chatId,
          user_id: userId,
          content,
          kind,
          entities: Array.isArray(f.entities) ? f.entities.map(String).slice(0, 8) : [],
          importance,
          pinned: false,
        };
      })
      .filter((r): r is NonNullable<typeof r> => !!r)
      .filter((r) => !existingNorm.has(r.content.toLowerCase().replace(/\W+/g, ' ').trim()))
      .slice(0, 6);

    let firstNewId: string | null = null;
    if (memoryRows.length > 0) {
      const { data: inserted, error } = await supabase.from('memories').insert(memoryRows).select('id');
      if (error) console.error('Memory insert failed:', error.message);
      firstNewId = inserted?.[0]?.id ?? null;
    }

    // 2. Mark contradicted memories as superseded by a real memory row (FK -> memories.id).
    //    Pinned (user-authored) memories are never auto-superseded.
    const contradicted = (result.contradicts_memory_ids || []).filter((id) => validIds.has(id));
    if (contradicted.length > 0 && firstNewId) {
      const unpinned = contradicted.filter((id) => !existingMemories.find((m) => m.id === id)?.pinned);
      if (unpinned.length > 0) {
        await supabase.from('memories').update({ superseded_by: firstNewId }).in('id', unpinned);
      }
    }

    // 3. Patch chat_state
    const patch = result.state_patch || {};
    const delta = clamp(Math.round(Number(patch.relationship_score_delta) || 0), -5, 5);
    const newRelationshipScore = clamp((currentState.relationship_score ?? 0) + delta, -100, 100);

    const removed = new Set((patch.inventory_removed || []).map((s) => String(s).toLowerCase()));
    const inventory = [
      ...new Set([...(currentState.inventory || []), ...(patch.inventory_added || []).map(String)]),
    ].filter((item) => !removed.has(item.toLowerCase()));

    const affection = cleanStr(patch.affection_level)?.toLowerCase();

    const updatedState = {
      ...currentState,
      location: cleanStr(patch.location) || currentState.location,
      time_of_day: cleanStr(patch.time_of_day) || currentState.time_of_day,
      char_mood: cleanStr(patch.char_mood) || currentState.char_mood,
      relationship_score: newRelationshipScore,
      affection_level: affection && AFFECTION_LEVELS.includes(affection) ? affection : currentState.affection_level,
      inventory,
      current_clothing: cleanStr(patch.current_clothing) || currentState.current_clothing,
    };

    await supabase.from('chat_state').upsert({
      chat_id: chatId,
      user_id: userId,
      state: updatedState,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error during memory & state extraction:', error);
  }
}
