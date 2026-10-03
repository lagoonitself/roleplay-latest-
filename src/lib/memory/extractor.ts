import { jsonCompletion } from '@/lib/llm/client';
import { createClient } from '@/lib/supabase/server';
import type { ChatState, Memory } from '@/lib/supabase/types';

interface ExtractionResult {
  facts: Array<{
    content: string;
    kind: 'fact' | 'event' | 'preference' | 'relationship' | 'promise' | 'secret' | 'trait';
    entities?: string[];
    importance: number;
  }>;
  state_patch: {
    location?: string;
    time_of_day?: string;
    char_mood?: string;
    relationship_score_delta?: number;
    affection_level?: string;
    inventory_added?: string[];
    inventory_removed?: string[];
    current_clothing?: string;
  };
  contradicts_memory_ids?: string[];
}

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
    const memoryContext = existingMemories.slice(0, 10).map((m) => `[ID: ${m.id}] ${m.content}`).join('\n');

    const prompt = [
      {
        role: 'system' as const,
        content: `You are an analytical memory archivist for an ongoing fictional roleplay between ${charName} and ${userName}.
Extract durable, significant long-term facts, relationship progression, and scene state updates from the latest dialogue turn.
Do NOT record trivial transient actions (e.g. "he walked to the door"). Only record durable facts, emotional shifts, secrets, promises, or traits.

Output JSON strictly adhering to this schema:
{
  "facts": [
    {
      "content": "Clear, concise fact in third person",
      "kind": "fact" | "event" | "preference" | "relationship" | "promise" | "secret" | "trait",
      "entities": ["entity1", "entity2"],
      "importance": 1-10
    }
  ],
  "state_patch": {
    "location": "updated location or omit if unchanged",
    "time_of_day": "morning/afternoon/evening/night or omit",
    "char_mood": "current emotion of ${charName}",
    "relationship_score_delta": -5 to +5 (integer change),
    "affection_level": "stranger/acquaintance/friend/close/romantic/devoted/hostile or omit",
    "inventory_added": ["item"],
    "inventory_removed": ["item"],
    "current_clothing": "description if changed"
  },
  "contradicts_memory_ids": ["id-of-old-memory-that-is-now-false"]
}`,
      },
      {
        role: 'user' as const,
        content: `EXISTING MEMORIES:
${memoryContext || 'None'}

CURRENT SCENE STATE:
${JSON.stringify(currentState)}

LATEST EXCHANGE:
[${userName}]: ${userMessage}
[${charName}]: ${assistantMessage}`,
      },
    ];

    const result = await jsonCompletion<ExtractionResult>(prompt, {
      apiKey,
      sessionId: `mem-${chatId}`,
    });

    if (!result) return;

    const supabase = await createClient();

    // 1. Insert new extracted facts into memories
    if (result.facts && Array.isArray(result.facts) && result.facts.length > 0) {
      const memoryRows = result.facts.map((f) => ({
        chat_id: chatId,
        user_id: userId,
        content: f.content,
        kind: f.kind || 'fact',
        entities: f.entities || [],
        importance: Math.min(10, Math.max(1, f.importance || 5)),
        pinned: false,
      }));

      await supabase.from('memories').insert(memoryRows);
    }

    // 2. Mark any contradicted memories as superseded
    if (result.contradicts_memory_ids && result.contradicts_memory_ids.length > 0) {
      await supabase
        .from('memories')
        .update({ superseded_by: chatId }) // or flag as superseded
        .in('id', result.contradicts_memory_ids);
    }

    // 3. Patch chat_state
    const patch = result.state_patch || {};
    const newRelationshipScore = Math.min(
      100,
      Math.max(
        -100,
        (currentState.relationship_score ?? 0) + (patch.relationship_score_delta ?? 0)
      )
    );

    let updatedInventory = [...(currentState.inventory || [])];
    if (patch.inventory_added) {
      updatedInventory.push(...patch.inventory_added);
    }
    if (patch.inventory_removed) {
      updatedInventory = updatedInventory.filter(
        (item) => !patch.inventory_removed?.includes(item)
      );
    }

    const updatedState = {
      ...currentState,
      location: patch.location || currentState.location,
      time_of_day: patch.time_of_day || currentState.time_of_day,
      char_mood: patch.char_mood || currentState.char_mood,
      relationship_score: newRelationshipScore,
      affection_level: patch.affection_level || currentState.affection_level,
      inventory: updatedInventory,
      current_clothing: patch.current_clothing || currentState.current_clothing,
    };

    await supabase
      .from('chat_state')
      .upsert({
        chat_id: chatId,
        user_id: userId,
        state: updatedState,
      });

  } catch (error) {
    console.error('Error during memory & state extraction:', error);
  }
}
