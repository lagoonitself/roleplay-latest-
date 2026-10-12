import { z } from 'zod';

/**
 * Shared zod building blocks for API request validation.
 *
 * Guideline: absurd payloads are truncated where truncation is harmless
 * (history arrays, card fields) and rejected only where the shape itself is
 * wrong. Untrusted values must never reach LLM prompts or provider requests
 * unbounded.
 */

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const uuidString = z.string().regex(UUID_REGEX, 'expected a UUID');

/** Truncates over-long text instead of rejecting real-world content. */
export const boundedString = (max: number) =>
  z.string().transform((s) => (s.length > max ? s.slice(0, max) : s));

/** Text fields that tolerate corrupt local state: non-strings collapse to ''. */
export const lenientString = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v : v == null ? '' : String(v)),
    z.string().transform((s) => (s.length > max ? s.slice(0, max) : s))
  );

const toFiniteNumber = (v: unknown): number | unknown => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : v;
};

/** Number input that clamps into [min, max]; garbage is rejected, null is "unset". */
export const boundedNumber = (min: number, max: number) =>
  z.preprocess(
    (v) => {
      const n = toFiniteNumber(v);
      return typeof n === 'number' ? Math.min(max, Math.max(min, n)) : n;
    },
    z.number().optional()
  );

/** Integer input that clamps and rounds into [min, max]. */
export const intBetween = (min: number, max: number) =>
  z.preprocess(
    (v) => {
      const n = toFiniteNumber(v);
      return typeof n === 'number' ? Math.min(max, Math.max(min, Math.round(n))) : n;
    },
    z.number().int().optional()
  );

/** BYOK API keys: bounded and stripped of header-injectable characters. */
export const apiKeyString = z
  .union([z.string().max(500), z.null()])
  .optional()
  .transform((s) => (typeof s === 'string' ? s.replace(/[\r\n\0]/g, '').trim() : undefined));

export const clientMessageSchema = z.looseObject({
  id: lenientString(200).optional(),
  role: z.enum(['user', 'assistant', 'system']),
  content: lenientString(60_000),
  reasoning: lenientString(60_000).nullish(),
  status: lenientString(20).optional(),
  parent_id: lenientString(200).nullish(),
  created_at: lenientString(40).optional(),
});

/** Newest N turns, newest-last; callers read chronologically. */
export const historySchema = z
  .array(clientMessageSchema)
  .transform((a) => a.slice(-200)) as unknown as z.ZodType<
  Array<z.infer<typeof clientMessageSchema>>
>;

export const clientMemorySchema = z.looseObject({
  id: lenientString(200).optional(),
  content: lenientString(2000),
  kind: lenientString(40).optional(),
  entities: z.array(lenientString(120)).transform((a) => a.slice(0, 12)).optional(),
  importance: boundedNumber(0, 10).optional(),
  pinned: z.boolean().nullish(),
  created_at: lenientString(40).optional(),
});

export const memoriesSchema = z
  .array(clientMemorySchema)
  .transform((a) => a.slice(0, 300)) as unknown as z.ZodType<
  Array<z.infer<typeof clientMemorySchema>>
>;

export const clientSummarySchema = z.looseObject({
  id: lenientString(200).optional(),
  content: lenientString(20_000),
  level: lenientString(20).optional(),
  message_ids: z.array(lenientString(200)).transform((a) => a.slice(0, 500)).optional(),
  last_message_id: lenientString(200).nullish(),
  token_estimate: boundedNumber(0, 1_000_000).optional(),
  user_edited: z.boolean().nullish(),
  superseded: z.boolean().nullish(),
  created_at: lenientString(40).optional(),
});

export const clientStateSchema = z.looseObject({
  location: lenientString(400).nullish(),
  time_of_day: lenientString(100).nullish(),
  char_mood: lenientString(200).nullish(),
  relationship_score: boundedNumber(-100, 100).optional(),
  affection_level: lenientString(100).nullish(),
  inventory: z.array(lenientString(200)).transform((a) => a.slice(0, 50)).optional(),
  current_clothing: lenientString(500).nullish(),
  active_events: z.array(lenientString(300)).transform((a) => a.slice(0, 30)).optional(),
  custom: z.record(z.string(), z.unknown()).optional(),
});

export const clientPersonaSchema = z.looseObject({
  id: z.string().max(200).optional(),
  name: lenientString(120),
  avatar_url: z.string().max(4000).nullish(),
  description: lenientString(8000).nullish(),
  is_default: z.boolean().nullish(),
});

export const clientCharacterSchema = z.looseObject({
  id: z.string().max(200).optional(),
  user_id: z.string().max(200).optional(),
  name: lenientString(200).optional(),
  avatar_url: z.string().max(4000).nullish(),
  tagline: lenientString(500).optional(),
  description: lenientString(20_000).optional(),
  personality: lenientString(8000).optional(),
  scenario: lenientString(8000).optional(),
  first_message: lenientString(20_000).optional(),
  alternate_greetings: z.array(lenientString(20_000)).transform((a) => a.slice(0, 10)).optional(),
  example_dialogue: lenientString(40_000).optional(),
  speech_style: lenientString(4000).optional(),
  system_prompt: lenientString(20_000).optional(),
  post_history_instructions: lenientString(8000).optional(),
  creator_notes: lenientString(8000).optional(),
  tags: z.array(lenientString(100)).transform((a) => a.slice(0, 50)).optional(),
  content_rating: lenientString(20).optional(),
  behavior: z
    .looseObject({
      pov: lenientString(20).optional(),
      tense: lenientString(20).optional(),
      verbosity: lenientString(20).optional(),
      temperature: boundedNumber(0, 2).optional(),
      thinking_enabled: z.boolean().nullish(),
      presence_penalty: boundedNumber(-2, 2).optional(),
      frequency_penalty: boundedNumber(-2, 2).optional(),
    })
    .nullish(),
  generation: z.record(z.string(), z.unknown()).nullish(),
  accent_color: z.string().max(20).nullish(),
  favorite: z.boolean().nullish(),
  chat_count: intBetween(0, 1_000_000).optional(),
  last_chatted_at: z.string().max(40).nullish(),
  created_at: z.string().max(40).optional(),
  updated_at: z.string().max(40).optional(),
});

/** Partner character context for the persona generator prompt. */
export const partnerCharacterSchema = z.looseObject({
  name: lenientString(200).optional(),
  tagline: lenientString(200).optional(),
  description: lenientString(2000).optional(),
  personality: lenientString(2000).optional(),
  scenario: lenientString(2000).optional(),
  first_message: lenientString(2000).optional(),
  speech_style: lenientString(2000).optional(),
  tags: z.array(lenientString(100)).transform((a) => a.slice(0, 30)).optional(),
  content_rating: lenientString(20).optional(),
});
