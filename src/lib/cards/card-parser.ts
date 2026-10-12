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
    id: overrides.id || `char-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

const clean = (val: unknown): string => {
  if (typeof val === 'string') return repairMojibake(val).trim();
  // Some exporters put numbers/booleans in text fields — keep the data instead of
  // silently dropping it. Everything else (objects, arrays, null) stays ''.
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  if (typeof val === 'boolean') return String(val);
  return '';
};

/** Hard caps so a hostile card cannot exhaust memory / localStorage / DB rows. */
const MAX_CARD_JSON_CHARS = 20_000_000;
const MAX_JSON_DEPTH = 30;
const MAX_TEXT_FIELD_CHARS = 200_000;
const MAX_ALT_GREETINGS = 50;
const MAX_TAGS = 100;
const MAX_BOOK_ENTRIES = 500;
const MAX_KEYS_PER_ENTRY = 50;
const MAX_ENTRY_CONTENT_CHARS = 20_000;

const cleanCapped = (val: unknown, cap = MAX_TEXT_FIELD_CHARS): string => clean(val).slice(0, cap);

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Recursively drops prototype-pollution keys from untrusted parsed JSON and
 * bounds the depth/size of what downstream code will walk. JSON.parse itself
 * does not pollute, but these objects are merged/spread into app state later —
 * never let hostile keys past the parser.
 */
function sanitizeParsedJson<T>(value: T, depth = 0): T {
  if (depth > MAX_JSON_DEPTH || value === null || typeof value !== 'object') {
    return (depth > MAX_JSON_DEPTH ? null : value) as T;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 10_000).map((v) => sanitizeParsedJson(v, depth + 1)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    out[key] = sanitizeParsedJson((value as Record<string, unknown>)[key], depth + 1);
  }
  return out as unknown as T;
}

/**
 * Normalizes an embedded CharacterBook from SillyTavern or Chub card
 */
export function normalizeCharacterBook(raw: unknown): CharacterBook | null {
  if (!raw || typeof raw !== 'object') return null;
  const rawBook = raw as Record<string, unknown>;

  const entries: CharacterBookEntry[] = (Array.isArray(rawBook.entries) ? rawBook.entries.slice(0, MAX_BOOK_ENTRIES) : [])
    .filter((e: unknown): e is Record<string, unknown> => !!e && typeof e === 'object' && !Array.isArray(e))
    .map((e: Record<string, unknown>): CharacterBookEntry => {
      const keys = (Array.isArray(e.keys)
        ? e.keys.map(clean).filter(Boolean)
        : typeof e.key === 'string'
        ? e.key.split(',').map(clean).filter(Boolean)
        : []
      ).slice(0, MAX_KEYS_PER_ENTRY);

      const secondaryKeys = (Array.isArray(e.secondary_keys)
        ? e.secondary_keys.map(clean).filter(Boolean)
        : typeof e.secondary_keys === 'string'
        ? e.secondary_keys.split(',').map(clean).filter(Boolean)
        : []
      ).slice(0, MAX_KEYS_PER_ENTRY);

      return {
        keys,
        secondary_keys: secondaryKeys,
        content: cleanCapped(e.content, MAX_ENTRY_CONTENT_CHARS),
        name: clean(e.name || e.comment || e.title).slice(0, 200),
        comment: clean(e.comment).slice(0, 500),
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
 * Input is size-capped, JSON is parsed defensively, and prototype-pollution keys
 * are stripped before any of it reaches app state.
 */
export function parseCharacterCardJson(raw: string | object): ParsedCardResult {
  let obj: unknown;
  if (typeof raw === 'string') {
    if (raw.length > MAX_CARD_JSON_CHARS) {
      throw new Error('Character card is too large to import.');
    }
    try {
      obj = JSON.parse(raw);
    } catch (err) {
      throw new Error(
        `File does not contain valid JSON character card data (${err instanceof Error ? err.message : 'parse error'}).`
      );
    }
  } else {
    obj = raw;
  }
  obj = sanitizeParsedJson(obj);
  if (!obj || typeof obj !== 'object') {
    return { character: {}, characterBook: null };
  }
  const record = obj as Record<string, unknown>;
  let characterBook: CharacterBook | null = null;

  // Character Card V2 spec format (Janitor AI, Chub AI, SillyTavern standard)
  if (record.spec === 'chara_card_v2' && record.data && typeof record.data === 'object') {
    const d = record.data as Record<string, unknown>;
    const name = cleanCapped(d.name, 200) || 'Unnamed Character';
    const desc = cleanCapped(d.description);
    const personality = cleanCapped(d.personality);
    const scenario = cleanCapped(d.scenario);
    const firstMes = cleanCapped(d.first_mes);
    const notes = cleanCapped(d.creator_notes);
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
        alternate_greetings: Array.isArray(d.alternate_greetings)
          ? d.alternate_greetings.map((g) => cleanCapped(g)).filter(Boolean).slice(0, MAX_ALT_GREETINGS)
          : [],
        example_dialogue: cleanCapped(d.mes_example),
        creator_notes: notes,
        system_prompt: cleanCapped(d.system_prompt),
        post_history_instructions: cleanCapped(d.post_history_instructions),
        speech_style: clean((d.extensions as Record<string, unknown> | undefined)?.speech_style || (d.extensions as Record<string, unknown> | undefined)?.talkativeness || ''),
        tags: Array.isArray(d.tags) ? d.tags.map((t) => clean(t)).filter(Boolean).slice(0, MAX_TAGS) : [],
      },
      characterBook,
    };
  }

  // Legacy V1 / Chub / Tavern / Janitor simple format
  const name = cleanCapped(record.name || record.char_name, 200) || 'Unnamed Character';
  const desc = cleanCapped(record.description || record.char_persona);
  const personality = cleanCapped(record.personality) || desc;
  const scenario = cleanCapped(record.scenario || record.world_scenario);
  const firstMes = cleanCapped(record.first_mes || record.char_greeting || record.greeting);
  const dialogue = cleanCapped(record.mes_example || record.example_dialogue);
  const notes = cleanCapped(record.creator_notes);
  const tagline = notes ? (notes.length > 120 ? notes.slice(0, 117) + '...' : notes) : (desc.slice(0, 80) ? desc.slice(0, 80) + '...' : '');

  if (record.character_book) {
    characterBook = normalizeCharacterBook(record.character_book);
  }

  return {
    character: {
      name,
      tagline,
      description: desc,
      personality,
      scenario,
      first_message: firstMes,
      alternate_greetings: Array.isArray(record.alternate_greetings)
        ? record.alternate_greetings.map((g) => cleanCapped(g)).filter(Boolean).slice(0, MAX_ALT_GREETINGS)
        : [],
      example_dialogue: dialogue,
      creator_notes: notes,
      system_prompt: cleanCapped(record.system_prompt),
      post_history_instructions: cleanCapped(record.post_history_instructions),
      speech_style: clean(record.speech_style || ''),
      tags: Array.isArray(record.tags) ? record.tags.map((t) => clean(t)).filter(Boolean).slice(0, MAX_TAGS) : [],
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

    // Trust the chunk length only within the bytes that actually exist — a
    // hostile file can claim a 4 GB chunk and walk the parser off the buffer.
    const dataLength = Math.min(length, bytes.length - offset - 4);

    if (typeChars === 'tEXt' && dataLength > 0) {
      const chunkData = bytes.slice(offset, offset + dataLength);
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
          // The chunk payload is base64 of UTF-8 JSON. atob yields a *binary*
          // string, so non-ASCII characters would be mojibake — decode the
          // bytes as UTF-8 instead. Unencoded payloads fall back to the raw text.
          let decoded: string | null = null;
          try {
            const binary = atob(new TextDecoder('latin1').decode(textBytes).trim());
            const jsonBytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) jsonBytes[i] = binary.charCodeAt(i);
            decoded = new TextDecoder('utf-8').decode(jsonBytes);
          } catch {
            decoded = null;
          }
          const rawText = new TextDecoder('utf-8').decode(textBytes);
          // Only trust the base64 decode when it actually produced JSON —
          // some tools ship the payload unencoded, and pure-ASCII payloads can
          // decode into garbage without throwing.
          cardJsonStr = decoded && /^[\s\uFEFF]*[{[]/.test(decoded) ? decoded : rawText;
          break;
        }
      }
    }

    if (length > bytes.length) break;
    offset += length + 4;
  }

  // Create avatar data URL from the PNG (chunked so multi-MB images can't
  // blow the string builder or btoa's length limit).
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
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

    // 2. Insert Entries (batched; every batch must land or the book is useless)
    const entryRows = book.entries.slice(0, 500).map((e) => ({
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

    for (let i = 0; i < entryRows.length; i += 200) {
      const { error: entryErr } = await supabase.from('lorebook_entries').insert(entryRows.slice(i, i + 200));
      if (entryErr) {
        console.warn('Failed to insert lorebook entries:', entryErr.message);
        // Don't leave a half-written book behind — roll back and let the caller
        // know the import failed instead of silently keeping partial data.
        await supabase.from('lorebooks').delete().eq('id', lorebookId);
        return null;
      }
    }

    // 3. Link to Character
    const { error: linkErr } = await supabase.from('character_lorebooks').upsert({
      character_id: characterId,
      lorebook_id: lorebookId,
      user_id: userId,
    });
    if (linkErr) {
      console.warn('Failed to link lorebook to character:', linkErr.message);
      await supabase.from('lorebooks').delete().eq('id', lorebookId);
      return null;
    }

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
