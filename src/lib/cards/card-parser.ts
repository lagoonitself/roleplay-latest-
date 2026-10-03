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
    extensions?: Record<string, any>;
  };
}

export interface ParsedCardResult {
  character: Partial<Character>;
  avatarDataUrl?: string;
}

export function makeCharacter(overrides: Partial<Character>): Character {
  return {
    id: overrides.id || `char-${Date.now()}`,
    user_id: overrides.user_id || 'guest',
    name: overrides.name || 'Unnamed Character',
    avatar_url:
      overrides.avatar_url ??
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
    tagline: overrides.tagline || '',
    description: overrides.description || '',
    personality: overrides.personality || '',
    scenario: overrides.scenario || '',
    first_message: overrides.first_message || '*I look at you with quiet curiosity.*',
    alternate_greetings: overrides.alternate_greetings || [],
    example_dialogue: overrides.example_dialogue || '',
    speech_style: overrides.speech_style || '',
    system_prompt: overrides.system_prompt || '',
    post_history_instructions: overrides.post_history_instructions || '',
    creator_notes: overrides.creator_notes || '',
    tags: overrides.tags || ['Custom'],
    content_rating: overrides.content_rating || 'mature',
    behavior: overrides.behavior || {
      pov: '2nd',
      tense: 'present',
      verbosity: 'medium',
      temperature: 1.15,
      thinking_enabled: false,
    },
    generation: overrides.generation || {},
    accent_color: overrides.accent_color || null,
    favorite: overrides.favorite ?? false,
    chat_count: overrides.chat_count ?? 0,
    last_chatted_at: overrides.last_chatted_at || null,
    created_at: overrides.created_at || new Date().toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString(),
  };
}

/**
 * Parses raw JSON string (or parsed object) of Character Card V2, V1, Tavern, or Janitor AI format.
 */
export function parseCharacterCardJson(raw: string | object): Partial<Character> {
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;

  // Character Card V2 spec format (Janitor AI, Chub AI, SillyTavern standard)
  if (obj.spec === 'chara_card_v2' && obj.data) {
    const d = obj.data;
    return {
      name: d.name || 'Unnamed Character',
      tagline: d.creator_notes || d.personality?.slice(0, 100) || '',
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

  // Legacy V1 / Chub / Tavern / Janitor simple format
  const name = obj.name || obj.char_name || 'Unnamed Character';
  const desc = obj.description || obj.char_persona || obj.personality || '';
  const scenario = obj.scenario || obj.world_scenario || '';
  const firstMes = obj.first_mes || obj.char_greeting || obj.greeting || '';
  const dialogue = obj.mes_example || obj.example_dialogue || '';

  return {
    name,
    tagline: obj.creator_notes || desc.slice(0, 100) || '',
    description: desc,
    personality: obj.personality || desc,
    scenario,
    first_message: firstMes,
    alternate_greetings: Array.isArray(obj.alternate_greetings) ? obj.alternate_greetings : [],
    example_dialogue: dialogue,
    creator_notes: obj.creator_notes || '',
    system_prompt: obj.system_prompt || '',
    post_history_instructions: obj.post_history_instructions || '',
    tags: Array.isArray(obj.tags) ? obj.tags : [],
  };
}

/**
 * Extracts character card metadata and embedded avatar from a PNG image file
 * conforming to Tavern / Janitor AI / Chub AI PNG character card standards.
 */
export function parseCharacterFromPng(buffer: ArrayBuffer): ParsedCardResult {
  const bytes = new Uint8Array(buffer);

  // Validate PNG signature: 89 50 4E 47 0D 0A 1A 0A
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < pngSignature.length; i++) {
    if (bytes[i] !== pngSignature[i]) {
      throw new Error('File is not a valid PNG image');
    }
  }

  let offset = 8;
  const view = new DataView(buffer);
  let cardJsonStr: string | null = null;

  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) break;

    const length = view.getUint32(offset);
    offset += 4;

    const typeChars = [
      String.fromCharCode(bytes[offset]),
      String.fromCharCode(bytes[offset + 1]),
      String.fromCharCode(bytes[offset + 2]),
      String.fromCharCode(bytes[offset + 3]),
    ].join('');
    offset += 4;

    if (typeChars === 'tEXt' && length > 0) {
      const chunkData = bytes.slice(offset, offset + length);
      // tEXt format: keyword (null-terminated) + text
      let nullIndex = -1;
      for (let i = 0; i < chunkData.length; i++) {
        if (chunkData[i] === 0) {
          nullIndex = i;
          break;
        }
      }

      if (nullIndex !== -1) {
        const keyword = new TextDecoder('latin1').decode(chunkData.slice(0, nullIndex));
        const textBytes = chunkData.slice(nullIndex + 1);

        if (keyword.toLowerCase() === 'chara' || keyword.toLowerCase() === 'ccv3') {
          const rawText = new TextDecoder('utf-8').decode(textBytes);
          try {
            // Usually base64 encoded UTF-8 JSON
            const decodedJson = atob(rawText);
            cardJsonStr = decodedJson;
          } catch {
            // Sometimes stored directly as JSON text
            cardJsonStr = rawText;
          }
          break;
        }
      }
    }

    // Skip chunk data and 4-byte CRC
    offset += length + 4;
  }

  // Create avatar data URL from the PNG
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const avatarDataUrl = `data:image/png;base64,${btoa(binary)}`;

  if (!cardJsonStr) {
    // If not embedded, return just the avatar so user can create character with this picture!
    return {
      character: {},
      avatarDataUrl,
    };
  }

  const parsed = parseCharacterCardJson(cardJsonStr);
  return {
    character: parsed,
    avatarDataUrl,
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
      creator_notes: character.creator_notes || character.tagline,
      system_prompt: character.system_prompt,
      post_history_instructions: character.post_history_instructions,
      alternate_greetings: character.alternate_greetings || [],
      tags: character.tags || [],
    },
  };
}
