import { buildSystemPrompt } from './system-prompt';
import { substituteMacros, formatRoleplayText } from './macros';
import { estimateTokens, truncateToTokens } from './tokens';
import type { Character, Persona, Memory, Summary, ChatState, LorebookEntry, Message } from '@/lib/supabase/types';
import type { ChatMessage } from '@/lib/llm/client';

export interface AssemblePromptParams {
  character: Character;
  persona?: Persona | null;
  history: Message[];
  retrievedMemories?: Memory[];
  pinnedMemories?: Memory[];
  summary?: Summary | null;
  chatState?: ChatState | null;
  triggeredLore?: LorebookEntry[];
  authorsNote?: string;
  latestUserMessage: string;
  /** Max estimated tokens of chat history to include (newest kept). */
  historyTokenBudget?: number;
  /** Max estimated tokens of lorebook content per turn. */
  loreTokenBudget?: number;
}

export const DEFAULT_HISTORY_TOKEN_BUDGET = 7000;
export const DEFAULT_LORE_TOKEN_BUDGET = 1200;

const CHARACTER_FIELD_CAP = 3500; // tokens, per field — guards against pathological imported cards

function tag(name: string, body: string, attrs = ''): string {
  const trimmed = body.trim();
  return trimmed ? `<${name}${attrs ? ' ' + attrs : ''}>\n${trimmed}\n</${name}>` : '';
}

function escapeAttr(v: string): string {
  return v.replace(/"/g, "'");
}

/** Renders the scene-state JSON as readable lines the model can use, omitting empty fields. */
function formatSceneState(state: NonNullable<ChatState['state']>, charName: string): string {
  const lines: string[] = [];
  if (state.location) lines.push(`Location: ${state.location}`);
  if (state.time_of_day) lines.push(`Time of day: ${state.time_of_day}`);
  if (state.char_mood) lines.push(`${charName}'s mood: ${state.char_mood}`);
  if (state.affection_level) lines.push(`Relationship: ${state.affection_level}`);
  if (typeof state.relationship_score === 'number') {
    lines.push(`Relationship score: ${state.relationship_score} (-100 hostile … 0 neutral … 100 devoted)`);
  }
  if (state.current_clothing) lines.push(`Current clothing: ${state.current_clothing}`);
  if (state.inventory && state.inventory.length > 0) lines.push(`Notable items: ${state.inventory.join(', ')}`);
  if (state.active_events && state.active_events.length > 0) lines.push(`Ongoing events: ${state.active_events.join('; ')}`);
  return lines.join('\n');
}

/**
 * Builds the ordered, role-alternating message list sent to the model.
 *
 * Layout (optimised for provider prefix caching — stable content first, volatile content last):
 *   1. system : rules + character + persona + examples + pinned facts + story summary
 *   2. history: trimmed to a token budget, newest kept
 *   3. user   : <turn_context> (memories, lore, scene state, author's note, reminder) + latest message
 *
 * Per-turn context is attached to the final user message rather than injected as a mid-conversation
 * system message: many chat templates mishandle non-leading system roles, and instructions placed
 * adjacent to the latest turn carry the most weight.
 */
export function assemblePrompt(params: AssemblePromptParams): ChatMessage[] {
  const {
    character,
    persona,
    history,
    retrievedMemories = [],
    pinnedMemories = [],
    summary,
    chatState,
    triggeredLore = [],
    authorsNote,
    latestUserMessage,
    historyTokenBudget = DEFAULT_HISTORY_TOKEN_BUDGET,
    loreTokenBudget = DEFAULT_LORE_TOKEN_BUDGET,
  } = params;

  const charName = character.name || 'Character';
  const userName = persona?.name || 'User';
  const fmt = (t: string) => truncateToTokens(formatRoleplayText(t, charName, userName), CHARACTER_FIELD_CAP);

  // ── 1. Static system prefix ───────────────────────────────────────────────
  const baseSystemPrompt = buildSystemPrompt({
    charName,
    userName,
    contentRating: character.content_rating,
    pov: character.behavior?.pov || '2nd',
    tense: character.behavior?.tense || 'present',
    verbosity: character.behavior?.verbosity || 'medium',
  });

  const charBlock = [
    `<character name="${escapeAttr(charName)}">`,
    character.tagline ? tag('tagline', fmt(character.tagline)) : '',
    tag('description', character.description ? fmt(character.description) : ''),
    tag('personality', character.personality ? fmt(character.personality) : ''),
    tag('scenario', character.scenario ? fmt(character.scenario) : ''),
    tag('speech_style', character.speech_style ? fmt(character.speech_style) : ''),
    tag('creator_directives', character.system_prompt ? fmt(character.system_prompt) : ''),
    `</character>`,
  ]
    .filter(Boolean)
    .join('\n');

  const personaBlock = persona?.description?.trim()
    ? tag('user_persona', fmt(persona.description), `name="${escapeAttr(userName)}"`)
    : `<user_persona name="${escapeAttr(userName)}">No details provided. Do not invent facts about ${userName}; learn them from the story.</user_persona>`;

  const exampleBlock = character.example_dialogue
    ? tag(
        'example_dialogue',
        fmt(character.example_dialogue).replace(/<START>/gi, '--- example ---'),
        'purpose="voice and style reference only; these exchanges never happened"'
      )
    : '';

  const pinnedBlock = pinnedMemories.length
    ? tag('pinned_facts', pinnedMemories.map((m) => `- ${formatRoleplayText(m.content, charName, userName)}`).join('\n'))
    : '';

  const summaryBlock = summary?.content
    ? tag('story_so_far', formatRoleplayText(summary.content, charName, userName))
    : '';

  const staticPrefix = [baseSystemPrompt, charBlock, personaBlock, exampleBlock, pinnedBlock, summaryBlock]
    .filter(Boolean)
    .join('\n\n');

  const messages: ChatMessage[] = [{ role: 'system', content: staticPrefix }];

  // ── 2. History (budgeted, newest kept, cleaned) ───────────────────────────
  const latestFormatted = formatRoleplayText(latestUserMessage, charName, userName).trim();

  let turns: ChatMessage[] = history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim() && m.status !== 'error')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: formatRoleplayText(m.content, charName, userName).trim(),
    }));

  // The route persists the new user message before loading history, so drop it here to avoid sending it twice.
  const lastTurn = turns[turns.length - 1];
  if (lastTurn && lastTurn.role === 'user' && lastTurn.content === latestFormatted) {
    turns = turns.slice(0, -1);
  }

  // Keep the opening scene in context even when history comes from a store that doesn't persist the greeting.
  if (turns.length > 0 && turns[0].role !== 'assistant' && character.first_message?.trim()) {
    turns.unshift({ role: 'assistant', content: formatRoleplayText(character.first_message, charName, userName).trim() });
  }

  // Walk backwards, keeping the newest turns that fit. Always keep at least the last 2 turns.
  let used = 0;
  const kept: ChatMessage[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = estimateTokens(turns[i].content) + 4;
    if (used + cost > historyTokenBudget && kept.length >= 2) break;
    kept.unshift(turns[i]);
    used += cost;
  }

  // Merge consecutive same-role turns (can occur after deletions/errors) — some providers reject them.
  for (const turn of kept) {
    const prev = messages[messages.length - 1];
    if (prev.role === turn.role && prev.role !== 'system') {
      prev.content += '\n\n' + turn.content;
    } else {
      messages.push({ ...turn });
    }
  }

  // ── 3. Turn context attached to the latest user message ──────────────────
  const ctx: string[] = [];

  if (retrievedMemories.length > 0) {
    ctx.push(
      tag(
        'relevant_memories',
        retrievedMemories.map((m) => `- (${m.kind}) ${formatRoleplayText(m.content, charName, userName)}`).join('\n')
      )
    );
  }

  if (triggeredLore.length > 0) {
    const sorted = [...triggeredLore].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    let loreUsed = 0;
    const loreParts: string[] = [];
    for (const l of sorted) {
      const body = formatRoleplayText(l.content, charName, userName);
      const cost = estimateTokens(body) + estimateTokens(l.title) + 4;
      if (loreUsed + cost > loreTokenBudget) continue;
      loreUsed += cost;
      loreParts.push(l.title ? `## ${l.title}\n${body}` : body);
    }
    if (loreParts.length) ctx.push(tag('world_lore', loreParts.join('\n\n')));
  }

  if (chatState?.state && Object.keys(chatState.state).length > 0) {
    ctx.push(tag('scene_state', formatSceneState(chatState.state, charName)));
  }

  if (authorsNote?.trim()) {
    ctx.push(tag('authors_note', substituteMacros(authorsNote.trim(), charName, userName)));
  }

  const reminder = [
    character.post_history_instructions?.trim()
      ? substituteMacros(character.post_history_instructions.trim(), charName, userName)
      : '',
    `Reply only as ${charName} and the world. Never write ${userName}'s words, actions, or feelings. Keep ${charName}'s voice consistent and avoid repeating phrasing from your recent replies.`,
  ]
    .filter(Boolean)
    .join('\n');
  ctx.push(tag('character_reminder', reminder));

  const finalContent = `${tag('turn_context', ctx.join('\n\n'))}\n\n${userName}'s message:\n${latestFormatted}`;

  const tail = messages[messages.length - 1];
  if (tail.role === 'user') {
    // Defensive: history ended on a user turn (e.g. the assistant reply errored) — merge so roles keep alternating.
    tail.content += '\n\n' + finalContent;
  } else {
    messages.push({ role: 'user', content: finalContent });
  }

  return messages;
}
