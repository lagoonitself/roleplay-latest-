import type { Character } from '@/lib/supabase/types';

export interface CharacterCardV2 {
  spec: 'chara_card_v2';
  spec_version: '2.0';
  data: {
    name: string;
    description: string;
    personality: string;
    scenario: string;
    first_mes: string;
    mes_example: string;
    creator_notes?: string;
    system_prompt?: string;
    post_history_instructions?: string;
    alternate_greetings?: string[];
    tags?: string[];
    creator?: string;
    character_version?: string;
  };
}

/**
 * Parses raw JSON string (or parsed object) of Character Card V2, V1, or V3 format.
 */
export function parseCharacterCardJson(raw: string | object): Partial<Character> {
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // Character Card V2 spec format
  if (obj.spec === 'chara_card_v2' && obj.data) {
    const d = obj.data;
    return {
      name: d.name || 'Unnamed Character',
      description: d.description || '',
      personality: d.personality || '',
      scenario: d.scenario || '',
      first_message: d.first_mes || '',
      alternate_greetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings : [],
      example_dialogue: d.mes_example || '',
      creator_notes: d.creator_notes || '',
      system_prompt: d.system_prompt || '',
      post_history_instructions: d.post_history_instructions || '',
      tags: Array.isArray(d.tags) ? d.tags : [],
    };
  }

  // Legacy V1 / Chub simple format
  return {
    name: obj.name || obj.char_name || 'Unnamed Character',
    description: obj.description || obj.char_persona || '',
    personality: obj.personality || '',
    scenario: obj.scenario || obj.world_scenario || '',
    first_message: obj.first_mes || obj.char_greeting || '',
    alternate_greetings: Array.isArray(obj.alternate_greetings) ? obj.alternate_greetings : [],
    example_dialogue: obj.mes_example || obj.example_dialogue || '',
    creator_notes: obj.creator_notes || '',
    system_prompt: obj.system_prompt || '',
    post_history_instructions: obj.post_history_instructions || '',
    tags: Array.isArray(obj.tags) ? obj.tags : [],
  };
}

/**
 * Serializes a Character entity into Character Card V2 JSON format.
 */
export function exportCharacterToCardV2(character: Character): CharacterCardV2 {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data: {
      name: character.name,
      description: character.description,
      personality: character.personality,
      scenario: character.scenario,
      first_mes: character.first_message,
      mes_example: character.example_dialogue,
      creator_notes: character.creator_notes,
      system_prompt: character.system_prompt,
      post_history_instructions: character.post_history_instructions,
      alternate_greetings: character.alternate_greetings || [],
      tags: character.tags || [],
    },
  };
}
