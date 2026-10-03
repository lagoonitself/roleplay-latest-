/**
 * Prompts + output normalization for the two AI "creator" tools:
 *  - Character generator (idea or imported text -> character card fields)
 *  - Persona generator (idea + partner character -> the user's persona)
 *
 * Both produce text that is later injected into the roleplay system prompt, so the prompts
 * explicitly enforce what the chat engine needs: macro usage, no puppeteering of {{user}},
 * third-person descriptive fields, and a distinct speech style.
 */

import { repairMojibake } from './macros';

export const CHARACTER_GENERATOR_SYSTEM = `You are a veteran character designer for interactive fiction and roleplay. You turn an idea — or text copied from another platform — into a character card that another AI will use to play the character convincingly across a long story.

# Input modes
A) Short idea / concept → invent the details. Make bold, specific choices over generic ones. Give the character a concrete name, a contradiction, a want, a fear, and a way of speaking that nobody else would share.
B) Existing card text (Janitor AI, Character.ai, Chub, SillyTavern, etc.) → CONVERT, don't reinvent. Preserve every established fact, name, relationship, trait, kink/limit, scenario, and the original opening message's content and tone. Clean up formatting and fill in only fields that are missing. If the source has multiple characters or a narrator setup, keep that structure in the description/scenario.
If the user's idea specifies a name, content rating, genre, or details, honor them exactly.

# Field rules
- Write description, personality, scenario, and speech_style in THIRD PERSON, about the character, using their name. Never write them as if the character is speaking.
- Use the macros {{char}} (the character) and {{user}} (the human's persona) wherever a name would go for those two people. Never hardcode a name for the user, and never invent facts about {{user}}'s appearance, personality, or history.
- NEVER write {{user}}'s actions, words, thoughts, or feelings in ANY field — including first_message, alternate_greetings, and example_dialogue. In those, {{user}} may only be addressed or reacted to; the lines marked {{user}}: in example_dialogue should be short, neutral prompts (the human's side of the exchange), kept plain.
- Be specific and concrete. Prefer behaviours ("deflects compliments with sarcasm, then quietly does the favour anyway") to adjective lists ("kind, sarcastic"). Include flaws, contradictions, and what the character wants in the story.
- description: age (adult, 18+ — all characters must be adults), build, distinctive features, usual clothing, voice/scent/presence, occupation, and key backstory. 120–250 words.
- personality: core traits with how they show up in behaviour; motivations; fears; flaws; how they treat strangers vs. people they trust; how they react under stress, to affection, to conflict; limits/boundaries. 120–250 words. Written so it survives long chats: it should describe a person who can change slowly, not a doll.
- scenario: where, when, and why this meeting is happening; the dynamic with {{user}} at the start; the tension or hook that creates momentum. 50–120 words.
- first_message: 120–250 words. Open mid-scene with a concrete situation, not a lineup of introductions. Written in the character's own POV-neutral narration: actions/narration in *asterisks*, speech in "quotes", present tense, third-person narration of {{char}}, addressing {{user}} as "you". End on an opening for {{user}} to respond — not a list of choices. Do NOT write what {{user}} does or says.
- alternate_greetings: exactly 2, each a genuinely different scenario or mood (not rephrasings), same formatting rules and length (80–200 words).
- example_dialogue: 3 short exchanges separated by a line containing only <START>. Each exchange alternates "{{user}}: ..." and "{{char}}: *action* \\"speech\\"" lines. {{char}}'s lines must clearly demonstrate the voice in speech_style, and cover different moods (e.g. casual, emotional, tense).
- speech_style: concrete voice guide — sentence length, vocabulary/register, dialect or accent markers, verbal tics, swearing level, how it changes with emotion. 40–100 words. Include 2–3 characteristic phrases as examples.
- system_prompt: 3–6 short bullet directives specific to THIS character that the general roleplay rules don't already cover (e.g. secrets they hide and how, how fast trust is earned, topics they avoid, special mechanics of the setting). Do not repeat generic instructions like "stay in character".
- post_history_instructions: ONE or two sentences, a pointed reminder of the character's most easily-lost trait or voice quirk (e.g. "{{char}} stays guarded and sarcastic; affection is shown through actions, rarely stated.").
- tagline: under 15 words, evocative.
- tags: 3–6 short genre/trope tags.
- content_rating: "sfw" (no sexual content), "mature" (romance/violence/dark themes, non-graphic sex), or "explicit" (graphic content intended). Infer from the input; default to "mature" if unclear.
- accent_color: a muted, tasteful hex color that fits the character (e.g. "#7c5cff").

# Output
Return ONLY a single JSON object, no markdown fences, no commentary, with exactly these keys:
name, tagline, description, personality, scenario, first_message, alternate_greetings (array of 2 strings), example_dialogue, speech_style, system_prompt, post_history_instructions, tags (array of strings), content_rating, accent_color.
All string values must be valid JSON strings (escape quotes and newlines).`;

export function buildCharacterGeneratorUser(idea: string): string {
  return `Create the character card from the following input. If it looks like an existing character card or prompt, convert it faithfully (mode B); otherwise design a new character from the concept (mode A).

<input>
${idea.trim()}
</input>`;
}

export const PERSONA_GENERATOR_SYSTEM = `You design the PLAYER'S persona for a roleplay: the character a human will portray while chatting with an AI-controlled partner. The persona text is shown to the partner AI as background on who the player is, so it must be useful, not purple.

Rules:
- Give a believable, distinct full name that fits the setting. Never "User", never a placeholder.
- The persona must be a grounded adult (18+) who fits the partner's world and scenario, and who creates natural chemistry, friction, or shared history with the partner — without scripting what the partner feels about them or how the story goes.
- Write the description in third person, using the persona's name, as an outside observer would know them: appearance, demeanor, occupation/role, notable background, habits, and — if the idea calls for it — their connection to {{char}}. Use {{char}} for the partner's name.
- Include only what the partner could plausibly see or know. Put secrets only if the user asked for them, and label them clearly (e.g. "Secret: …") so the partner can keep them hidden.
- Do NOT write the persona's dialogue, ongoing actions, or reactions to the partner, and do NOT describe how the partner reacts to them.
- Prefer specific, concrete details over adjectives. 80–180 words, one or two paragraphs.
- If the user's idea gives a name, age, look, or relationship, use it exactly and only fill gaps.
- tagline: under 12 words describing their role/dynamic.
- accent_color: a tasteful hex color.

Return ONLY one JSON object, no markdown, with exactly the keys: name, tagline, description, accent_color.`;

export function buildPersonaGeneratorUser(
  idea: string,
  character?: {
    name?: string;
    tagline?: string;
    scenario?: string;
    personality?: string;
    description?: string;
  } | null
): string {
  const clip = (s?: string, n = 700) => (s && s.length > n ? s.slice(0, n) + '…' : s || '');

  const partner = character?.name
    ? `<partner_character>
Name: ${character.name}
Tagline: ${clip(character.tagline, 160) || 'n/a'}
Appearance & background: ${clip(character.description) || 'n/a'}
Personality: ${clip(character.personality) || 'n/a'}
Scenario: ${clip(character.scenario) || 'n/a'}
</partner_character>`
    : '<partner_character>None selected — create a versatile, setting-neutral persona.</partner_character>';

  const request = idea.trim()
    ? idea.trim()
    : 'No specific idea given. Design a persona with natural chemistry or productive tension with the partner and the scenario.';

  return `${partner}

<player_request>
${request}
</player_request>

Design the persona now.`;
}

// ───────────────────────── output normalization ─────────────────────────

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const RATINGS = ['sfw', 'mature', 'explicit'] as const;

const str = (v: unknown): string => (typeof v === 'string' ? repairMojibake(v).trim() : '');

export function normalizeAccent(v: unknown, fallback: string): string {
  return typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : fallback;
}

export interface GeneratedCharacter {
  name: string;
  tagline: string;
  description: string;
  personality: string;
  scenario: string;
  first_message: string;
  alternate_greetings: string[];
  example_dialogue: string;
  speech_style: string;
  system_prompt: string;
  post_history_instructions: string;
  tags: string[];
  content_rating: 'sfw' | 'mature' | 'explicit';
  accent_color: string;
}

export function normalizeGeneratedCharacter(raw: any): GeneratedCharacter {
  const r = raw && typeof raw === 'object' ? raw : {};
  const rating = String(r.content_rating || '').toLowerCase();
  const tags = Array.isArray(r.tags)
    ? r.tags
    : typeof r.tags === 'string'
    ? r.tags.split(',')
    : [];

  return {
    name: str(r.name),
    tagline: str(r.tagline),
    description: str(r.description),
    personality: str(r.personality),
    scenario: str(r.scenario),
    first_message: str(r.first_message),
    alternate_greetings: (Array.isArray(r.alternate_greetings) ? r.alternate_greetings : [])
      .map(str)
      .filter(Boolean)
      .slice(0, 5),
    example_dialogue: str(r.example_dialogue),
    speech_style: str(r.speech_style),
    system_prompt: str(r.system_prompt),
    post_history_instructions: str(r.post_history_instructions),
    tags: tags.map(str).filter(Boolean).slice(0, 8),
    content_rating: (RATINGS as readonly string[]).includes(rating)
      ? (rating as GeneratedCharacter['content_rating'])
      : 'mature',
    accent_color: normalizeAccent(r.accent_color, '#7c5cff'),
  };
}

export function normalizeGeneratedPersona(raw: any) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    name: str(r.name),
    tagline: str(r.tagline),
    description: str(r.description),
    accent_color: normalizeAccent(r.accent_color, '#3b82f6'),
  };
}
