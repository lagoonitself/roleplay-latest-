import type { SupabaseClient } from '@supabase/supabase-js';
import type { Character } from '@/lib/supabase/types';
import { repairMojibake } from '@/lib/prompt/macros';

export interface CharacterBookEntry {
  keys: string[];
  content: string;
  enabled?: boolean;
  insertion_order?: number;
  case_sensitive?: boolean;
  name?: string;
  priority?: number;
  id?: number | string;
  comment?: string;
  selective?: boolean;
  secondary_keys?: string[];
  constant?: boolean;
  position?: 'before_char' | 'after_char' | 'at_depth';
  extensions?: Record<string, unknown>;
}

export interface CharacterBook {
  name?: string;
  description?: string;
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
  extensions?: Record<string, unknown>;
  entries: CharacterBookEntry[];
}

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
    character_book?: CharacterBook;
    tags?: string[];
    creator?: string;
    character_version?: string;
    extensions?: Record<string, unknown>;
  };
}

export interface ParsedCardResult {
  character: Partial<Character>;
  avatarDataUrl?: string;
  characterBook?: CharacterBook | null;
}

export function makeCharacter(overrides: Partial<Character>): Character {
  return {
    id: overrides.id || `char-${Date.now()}`,
    user_id: overrides.user_id || 'guest',
    name: overrides.name || 'Unnamed Character',
    avatar_url: overrides.avatar_url || null,
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

const clean = (val: unknown): string => (typeof val === 'string' ? repairMojibake(val).trim() : '');

/**
 * Normalizes an embedded CharacterBook from SillyTavern or Chub card
 */
export function normalizeCharacterBook(raw: unknown): CharacterBook | null {
  if (!raw || typeof raw !== 'object') return null;
  const rawBook = raw as Record<string, unknown>;

  const entries: CharacterBookEntry[] = (Array.isArray(rawBook.entries) ? rawBook.entries : [])
    .map((e: Record<string, unknown>): CharacterBookEntry => {
      const keys = Array.isArray(e.keys)
        ? e.keys.map(clean).filter(Boolean)
        : typeof e.key === 'string'
        ? e.key.split(',').map(clean).filter(Boolean)
        : [];

      const secondaryKeys = Array.isArray(e.secondary_keys)
        ? e.secondary_keys.map(clean).filter(Boolean)
        : typeof e.secondary_keys === 'string'
        ? e.secondary_keys.split(',').map(clean).filter(Boolean)
        : [];

      return {
        keys,
        secondary_keys: secondaryKeys,
        content: clean(e.content),
        name: clean(e.name || e.comment || e.title),
        comment: clean(e.comment),
        enabled: e.enabled !== false,
        constant: Boolean(e.constant),
        selective: Boolean(e.selective),
        case_sensitive: Boolean(e.case_sensitive),
        priority: typeof e.priority === 'number' ? e.priority : (typeof e.insertion_order === 'number' ? e.insertion_order : 100),
        insertion_order: typeof e.insertion_order === 'number' ? e.insertion_order : 100,
        position: e.position === 'after_char' ? 'after_char' : (e.position === 'at_depth' ? 'at_depth' : 'before_char'),
        extensions: (e.extensions as Record<string, unknown>) || {},
      };
    })
    .filter((e: CharacterBookEntry) => e.content.length > 0 && (e.keys.length > 0 || e.constant));

  return {
    name: clean(rawBook.name) || 'Embedded Lorebook',
    description: clean(rawBook.description) || '',
    scan_depth: typeof rawBook.scan_depth === 'number' ? rawBook.scan_depth : 4,
    token_budget: typeof rawBook.token_budget === 'number' ? rawBook.token_budget : 1200,
    recursive_scanning: rawBook.recursive_scanning !== false,
    extensions: (rawBook.extensions as Record<string, unknown>) || {},
    entries,
  };
}

/**
 * Parses raw JSON string (or parsed object) of Character Card V2, V1, Tavern, or Janitor AI format.
 */
export function parseCharacterCardJson(raw: string | object): ParsedCardResult {
  const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
  let characterBook: CharacterBook | null = null;

  // Character Card V2 spec format (Janitor AI, Chub AI, SillyTavern standard)
  if (obj.spec === 'chara_card_v2' && obj.data) {
    const d = obj.data;
    const name = clean(d.name) || 'Unnamed Character';
    const desc = clean(d.description);
    const personality = clean(d.personality);
    const scenario = clean(d.scenario);
    const firstMes = clean(d.first_mes);
    const notes = clean(d.creator_notes);
    const tagline = notes ? (notes.length > 120 ? notes.slice(0, 117) + '...' : notes) : (personality.slice(0, 80) ? personality.slice(0, 80) + '...' : '');

    if (d.character_book) {
      characterBook = normalizeCharacterBook(d.character_book);
    }

    return {
      character: {
        name,
        tagline,
        description: desc,
        personality,
        scenario,
        first_message: firstMes,
        alternate_greetings: Array.isArray(d.alternate_greetings) ? d.alternate_greetings.map(clean).filter(Boolean) : [],
        example_dialogue: clean(d.mes_example),
        creator_notes: notes,
        system_prompt: clean(d.system_prompt),
        post_history_instructions: clean(d.post_history_instructions),
        speech_style: clean(d.extensions?.speech_style || d.extensions?.talkativeness || ''),
        tags: Array.isArray(d.tags) ? d.tags.map(clean).filter(Boolean) : [],
      },
      characterBook,
    };
  }

  // Legacy V1 / Chub / Tavern / Janitor simple format
  const name = clean(obj.name || obj.char_name) || 'Unnamed Character';
  const desc = clean(obj.description || obj.char_persona);
  const personality = clean(obj.personality || desc);
  const scenario = clean(obj.scenario || obj.world_scenario);
  const firstMes = clean(obj.first_mes || obj.char_greeting || obj.greeting);
  const dialogue = clean(obj.mes_example || obj.example_dialogue);
  const notes = clean(obj.creator_notes);
  const tagline = notes ? (notes.length > 120 ? notes.slice(0, 117) + '...' : notes) : (desc.slice(0, 80) ? desc.slice(0, 80) + '...' : '');

  if (obj.character_book) {
    characterBook = normalizeCharacterBook(obj.character_book);
  }

  return {
    character: {
      name,
      tagline,
      description: desc,
      personality,
      scenario,
      first_message: firstMes,
      alternate_greetings: Array.isArray(obj.alternate_greetings) ? obj.alternate_greetings.map(clean).filter(Boolean) : [],
      example_dialogue: dialogue,
      creator_notes: notes,
      system_prompt: clean(obj.system_prompt),
      post_history_instructions: clean(obj.post_history_instructions),
      speech_style: clean(obj.speech_style || ''),
      tags: Array.isArray(obj.tags) ? obj.tags.map(clean).filter(Boolean) : [],
    },
    characterBook,
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
            cardJsonStr = atob(rawText);
          } catch {
            cardJsonStr = rawText;
          }
          break;
        }
      }
    }

    offset += length + 4;
  }

  // Create avatar data URL from the PNG
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const avatarDataUrl = `data:image/png;base64,${btoa(binary)}`;

  if (!cardJsonStr) {
    return {
      character: {},
      avatarDataUrl,
      characterBook: null,
    };
  }

  const parsedResult = parseCharacterCardJson(cardJsonStr);
  return {
    ...parsedResult,
    avatarDataUrl,
  };
}

/**
 * Saves an embedded CharacterBook into Supabase lorebooks, entries, and character_lorebooks association.
 */
export async function saveEmbeddedCharacterBook(
  supabase: SupabaseClient,
  characterId: string,
  userId: string,
  book: CharacterBook
): Promise<string | null> {
  if (!book || !book.entries?.length || !userId) return null;

  try {
    // 1. Create Lorebook
    const { data: bookRow, error: bookErr } = await supabase
      .from('lorebooks')
      .insert({
        user_id: userId,
        name: book.name || 'Character Lore',
        description: book.description || '',
        scan_depth: book.scan_depth || 4,
        token_budget: book.token_budget || 1200,
      })
      .select('id')
      .single();

    if (bookErr || !bookRow) {
      console.warn('Failed to insert lorebook:', bookErr?.message);
      return null;
    }

    const lorebookId = bookRow.id;

    // 2. Insert Entries
    const entryRows = book.entries.map((e) => ({
      lorebook_id: lorebookId,
      user_id: userId,
      title: e.name || e.comment || 'Entry',
      keys: e.keys,
      secondary_keys: e.secondary_keys || [],
      content: e.content,
      constant: Boolean(e.constant),
      enabled: e.enabled !== false,
      priority: e.priority ?? e.insertion_order ?? 100,
      case_sensitive: Boolean(e.case_sensitive),
    }));

    if (entryRows.length > 0) {
      await supabase.from('lorebook_entries').insert(entryRows);
    }

    // 3. Link to Character
    await supabase.from('character_lorebooks').upsert({
      character_id: characterId,
      lorebook_id: lorebookId,
      user_id: userId,
    });

    return lorebookId;
  } catch (err) {
    console.error('Error saving embedded character book:', err);
    return null;
  }
}

/**
 * Serializes a Character entity into Character Card V2 JSON format.
 */
export function exportCharacterToCardV2(
  character: Character,
  characterBook?: CharacterBook | null
): CharacterCardV2 {
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
      character_book: characterBook || undefined,
      tags: character.tags || [],
    },
  };
}
