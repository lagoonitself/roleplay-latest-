/**
 * SillyTavern-Compatible Prompt Manager & Prompt Assembly Pipeline
 *
 * Implements:
 * 1. Modular Prompt Collection & Ordering:
 *    - main: Primary system instruction (supports character.system_prompt override)
 *    - worldInfoBefore: Lorebook entries before character
 *    - personaDescription: Formatted user persona
 *    - charDescription: Character description
 *    - charPersonality: Formatted personality [{{char}}'s personality: ...]
 *    - scenario: Formatted scenario [Circumstances and context of the dialogue: ...]
 *    - enhanceDefinitions: Canon adherence directive
 *    - nsfw / style: Content rating & tone rules
 *    - worldInfoAfter: Lorebook entries after character
 *    - dialogueExamples: Formatted multi-turn or <START> dialogue examples
 *    - chatHistory: Chronological budgeted message history
 *    - jailbreak / post-history: Character reminder / post-history instructions
 *
 * 2. SillyTavern In-Chat Injection Engine (populationInjectionPrompts):
 *    - Prompts with ABSOLUTE injection positions are inserted into chat history at specific depths:
 *      - authorsNote: In-chat depth 4 (or relative), role: system
 *      - summary: In-chat depth 2, role: system, formatted as [Summary: {{summary}}]
 *      - vectorsMemory: In-chat depth 2, role: system, formatted as Past events:\n{{text}}
 *      - inChatLore: Lorebook entries targeted at depth
 *    - Sorts multiple injections at the same depth by injection_order
 *
 * 3. Prefix-cache friendly structuring:
 *    - Stable system prefix remains consistent across turns for KV cache hits
 *    - In-chat depth injections placed naturally in history
 *    - Turn context attached to latest user turn without role disruption
 */

import { buildSystemPrompt } from './system-prompt';
import { substituteMacros, formatRoleplayText, type MacroContext } from './macros';
import { estimateTokens, truncateToTokens } from './tokens';
import type { ActivatedLore, WorldInfoScanEntry } from '@/lib/lorebook/matcher';
import type { VectorRetrievalResult } from '@/lib/memory/vectors';
import type { Character, Persona, Memory, Summary, ChatState, LorebookEntry, Message } from '@/lib/supabase/types';
import type { ChatMessage } from '@/lib/llm/client';

export interface AssemblePromptParams {
  character: Character;
  persona?: Persona | null;
  history: Message[];
  retrievedMemories?: Memory[];
  pinnedMemories?: Memory[];
  vectorMemories?: VectorRetrievalResult;
  summary?: Summary | null;
  chatState?: ChatState | null;
  triggeredLore?: LorebookEntry[];
  activatedLore?: ActivatedLore;
  authorsNote?: string;
  latestUserMessage: string;
  historyTokenBudget?: number;
  loreTokenBudget?: number;
  authorsNoteDepth?: number;
  summaryDepth?: number;
  vectorsDepth?: number;
}

export const DEFAULT_HISTORY_TOKEN_BUDGET = 7000;
export const DEFAULT_LORE_TOKEN_BUDGET = 1200;

export const SILLY_TAVERN_PROMPT_DEFAULTS = {
  mainPrompt: "Write {{char}}'s next reply in a fictional chat between {{charIfNotGroup}} and {{user}}.",
  personalityFormat: "[{{char}}'s personality: {{personality}}]",
  scenarioFormat: '[Circumstances and context of the dialogue: {{scenario}}]',
  enhanceDefinitions: "If you have more knowledge of {{char}}, add to the character's lore and personality to enhance them but keep the Character Sheet's definitions absolute.",
  summaryTemplate: '[Summary: {{summary}}]',
  vectorsTemplate: 'Past events:\n{{text}}',
  authorsNoteTemplate: "[Author's note: {{note}}]",
};

export enum InjectionPosition {
  RELATIVE = 0,
  ABSOLUTE = 1,
}

export interface InChatInjection {
  identifier: string;
  role: 'system' | 'user' | 'assistant';
  content: string;
  depth: number;
  order: number;
}

const CHARACTER_FIELD_CAP = 3500;

function tag(name: string, body: string, attrs = ''): string {
  const trimmed = body.trim();
  return trimmed ? `<${name}${attrs ? ' ' + attrs : ''}>\n${trimmed}\n</${name}>` : '';
}

function escapeAttr(v: string): string {
  return v.replace(/"/g, "'");
}

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
 * Implements SillyTavern's populationInjectionPrompts algorithm.
 * Inserts absolute prompts into the chat history array at their designated depths and orders.
 */
export function populateInChatInjections(
  messages: ChatMessage[],
  injections: InChatInjection[]
): ChatMessage[] {
  if (!injections.length || !messages.length) return [...messages];

  const result = [...messages];
  const maxDepth = Math.max(...injections.map((i) => i.depth), 0);

  // Group injections by depth
  for (let depth = 0; depth <= maxDepth; depth++) {
    const depthPrompts = injections
      .filter((i) => i.depth === depth && i.content.trim())
      .sort((a, b) => a.order - b.order);

    if (!depthPrompts.length) continue;

    // Group prompts at this depth by role
    const combinedContent = depthPrompts.map((p) => p.content.trim()).join('\n\n');
    const primaryRole = depthPrompts[0].role || 'system';

    const insertIndex = Math.max(0, result.length - depth);
    result.splice(insertIndex, 0, {
      role: primaryRole,
      content: combinedContent,
    });
  }

  return result;
}

/**
 * Builds the ordered, role-alternating message list sent to the model using SillyTavern's architecture.
 */
export function assemblePrompt(params: AssemblePromptParams): ChatMessage[] {
  const {
    character,
    persona,
    history,
    retrievedMemories = [],
    pinnedMemories = [],
    vectorMemories,
    summary,
    chatState,
    triggeredLore = [],
    activatedLore,
    authorsNote,
    latestUserMessage,
    historyTokenBudget = DEFAULT_HISTORY_TOKEN_BUDGET,
    loreTokenBudget = DEFAULT_LORE_TOKEN_BUDGET,
    authorsNoteDepth = 4,
    summaryDepth = 2,
    vectorsDepth = 2,
  } = params;

  const charName = character.name || 'Character';
  const userName = persona?.name || 'User';

  const macroCtx: MacroContext = {
    charName,
    userName,
    description: character.description,
    personality: character.personality,
    scenario: character.scenario,
    personaDescription: persona?.description,
    lastUserMessage: latestUserMessage,
  };

  const fmt = (t: string) => truncateToTokens(formatRoleplayText(t, macroCtx), CHARACTER_FIELD_CAP);

  // ── 1. SillyTavern Prompt Collection & Ordering ───────────────────────────

  // (a) Base System Prompt & Content Rating
  const baseSystemPrompt = buildSystemPrompt({
    charName,
    userName,
    contentRating: character.content_rating,
    pov: character.behavior?.pov || '2nd',
    tense: character.behavior?.tense || 'present',
    verbosity: character.behavior?.verbosity || 'medium',
  });

  // (b) Main Prompt (with Character System Prompt Override / Directive)
  const mainPromptTemplate = character.system_prompt?.trim()
    ? character.system_prompt.trim()
    : SILLY_TAVERN_PROMPT_DEFAULTS.mainPrompt;
  const mainPromptBlock = substituteMacros(mainPromptTemplate, macroCtx);

  // (c) World Info (Before Character)
  const wiBeforeList: WorldInfoScanEntry[] = activatedLore?.worldInfoBefore ?? [];
  const wiBeforeContent = wiBeforeList
    .map((e) => (e.title ? `## ${e.title}\n${e.content}` : e.content))
    .join('\n\n');
  const wiBeforeBlock = wiBeforeContent ? tag('world_info_before', fmt(wiBeforeContent)) : '';

  // (d) Persona Description
  const personaBlock = persona?.description?.trim()
    ? tag('user_persona', fmt(persona.description), `name="${escapeAttr(userName)}"`)
    : `<user_persona name="${escapeAttr(userName)}">No details provided. Do not invent facts about ${userName}; learn them from the story.</user_persona>`;

  // (e) Character Sheet
  const charBlock = [
    `<character name="${escapeAttr(charName)}">`,
    character.tagline ? tag('tagline', fmt(character.tagline)) : '',
    tag('description', character.description ? fmt(character.description) : ''),
    tag('personality', character.personality ? fmt(character.personality) : ''),
    tag('scenario', character.scenario ? fmt(character.scenario) : ''),
    tag('speech_style', character.speech_style ? fmt(character.speech_style) : ''),
    `</character>`,
  ]
    .filter(Boolean)
    .join('\n');

  // (f) Enhance Definitions Directive
  const enhanceDefBlock = substituteMacros(SILLY_TAVERN_PROMPT_DEFAULTS.enhanceDefinitions, macroCtx);

  // (g) World Info (After Character)
  const wiAfterList: WorldInfoScanEntry[] = activatedLore?.worldInfoAfter ?? [];
  const wiAfterContent = wiAfterList
    .map((e) => (e.title ? `## ${e.title}\n${e.content}` : e.content))
    .join('\n\n');
  const wiAfterBlock = wiAfterContent ? tag('world_info_after', fmt(wiAfterContent)) : '';

  // If no activatedLore was passed, fallback to triggeredLore in lore block
  let fallbackLoreBlock = '';
  if (!activatedLore && triggeredLore.length > 0) {
    const sorted = [...triggeredLore].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
    let loreUsed = 0;
    const loreParts: string[] = [];
    for (const l of sorted) {
      const body = formatRoleplayText(l.content, macroCtx);
      const cost = estimateTokens(body) + estimateTokens(l.title) + 4;
      if (loreUsed + cost > loreTokenBudget) continue;
      loreUsed += cost;
      loreParts.push(l.title ? `## ${l.title}\n${body}` : body);
    }
    if (loreParts.length) fallbackLoreBlock = tag('world_lore', loreParts.join('\n\n'));
  }

  // (h) Pinned Facts
  const pinnedBlock = pinnedMemories.length
    ? tag('pinned_facts', pinnedMemories.map((m) => `- ${formatRoleplayText(m.content, macroCtx)}`).join('\n'))
    : '';

  // (i) Dialogue Examples
  const exampleBlock = character.example_dialogue
    ? tag(
        'example_dialogue',
        fmt(character.example_dialogue).replace(/<START>/gi, '--- example ---'),
        'purpose="voice and style reference only; these exchanges never happened"'
      )
    : '';

  // Assemble the static system block
  const staticPrefix = [
    baseSystemPrompt,
    mainPromptBlock,
    wiBeforeBlock,
    personaBlock,
    charBlock,
    enhanceDefBlock,
    wiAfterBlock,
    fallbackLoreBlock,
    pinnedBlock,
    exampleBlock,
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: ChatMessage[] = [{ role: 'system', content: staticPrefix }];

  // ── 2. History (Budgeted, Newest Kept) ─────────────────────────────────────
  const latestFormatted = formatRoleplayText(latestUserMessage, macroCtx).trim();

  let turns: ChatMessage[] = history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim() && m.status !== 'error')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: formatRoleplayText(m.content, macroCtx).trim(),
    }));

  // Drop duplicate latest user message if already persisted
  const lastTurn = turns[turns.length - 1];
  if (lastTurn && lastTurn.role === 'user' && lastTurn.content === latestFormatted) {
    turns = turns.slice(0, -1);
  }

  // Preserve initial greeting
  if (turns.length > 0 && turns[0].role !== 'assistant' && character.first_message?.trim()) {
    turns.unshift({ role: 'assistant', content: formatRoleplayText(character.first_message, macroCtx).trim() });
  }

  // Walk backwards to fit within history token budget (keep at least 2 turns)
  let usedTokens = 0;
  const keptTurns: ChatMessage[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = estimateTokens(turns[i].content) + 4;
    if (usedTokens + cost > historyTokenBudget && keptTurns.length >= 2) break;
    keptTurns.unshift(turns[i]);
    usedTokens += cost;
  }

  // ── 3. SillyTavern In-Chat Injections (Author's Note, Summary, Vectors) ────
  const inChatInjections: InChatInjection[] = [];

  // (a) Author's Note / Floating Prompt (default depth 4, order 100)
  if (authorsNote?.trim()) {
    const formattedNote = substituteMacros(authorsNote.trim(), macroCtx);
    const templatedNote = SILLY_TAVERN_PROMPT_DEFAULTS.authorsNoteTemplate.replace('{{note}}', formattedNote);
    inChatInjections.push({
      identifier: 'authorsNote',
      role: 'system',
      content: templatedNote,
      depth: authorsNoteDepth,
      order: 100,
    });
  }

  // (b) Chat Summary (default depth 2, order 100)
  if (summary?.content?.trim()) {
    const formattedSummary = substituteMacros(summary.content.trim(), macroCtx);
    const templatedSummary = SILLY_TAVERN_PROMPT_DEFAULTS.summaryTemplate.replace('{{summary}}', formattedSummary);
    inChatInjections.push({
      identifier: 'summary',
      role: 'system',
      content: templatedSummary,
      depth: summaryDepth,
      order: 90,
    });
  }

  // (c) Vector Memory / Past Events (default depth 2, order 100)
  if (vectorMemories?.formattedText?.trim()) {
    inChatInjections.push({
      identifier: 'vectorsMemory',
      role: vectorMemories.role || 'system',
      content: vectorMemories.formattedText.trim(),
      depth: vectorsDepth,
      order: 80,
    });
  } else if (retrievedMemories.length > 0) {
    // Fallback if vectorMemories wrapper was not passed
    const memText = retrievedMemories.map((m) => `- (${m.kind}) ${formatRoleplayText(m.content, macroCtx)}`).join('\n');
    inChatInjections.push({
      identifier: 'vectorsMemory',
      role: 'system',
      content: `Past events:\n${memText}`,
      depth: vectorsDepth,
      order: 80,
    });
  }

  // (d) In-chat Lorebook entries (position: 'at_depth')
  if (activatedLore?.inChatEntries?.length) {
    for (const entry of activatedLore.inChatEntries) {
      if (!entry.content?.trim()) continue;
      inChatInjections.push({
        identifier: entry.id || `lore-${entry.title}`,
        role: 'system',
        content: entry.title ? `[${entry.title}: ${entry.content}]` : entry.content,
        depth: entry.depth ?? 4,
        order: entry.order ?? 100,
      });
    }
  }

  // Apply In-Chat Injections into kept turns
  const injectedTurns = populateInChatInjections(keptTurns, inChatInjections);

  // Merge consecutive same-role turns for strict API validation
  for (const turn of injectedTurns) {
    const prev = messages[messages.length - 1];
    if (prev.role === turn.role && prev.role !== 'system') {
      prev.content += '\n\n' + turn.content;
    } else {
      messages.push({ ...turn });
    }
  }

  // ── 4. Turn Context Attached to Latest User Message ───────────────────────
  const ctx: string[] = [];

  if (chatState?.state && Object.keys(chatState.state).length > 0) {
    ctx.push(tag('scene_state', formatSceneState(chatState.state, charName)));
  }

  // Jailbreak / Post-History Instructions
  const jailbreakReminder = [
    character.post_history_instructions?.trim()
      ? substituteMacros(character.post_history_instructions.trim(), macroCtx)
      : '',
    `Reply only as ${charName} and the world. Never write ${userName}'s words, actions, or feelings. Keep ${charName}'s voice consistent and avoid repeating phrasing from your recent replies.`,
  ]
    .filter(Boolean)
    .join('\n');

  ctx.push(tag('character_reminder', jailbreakReminder));

  const turnContextBlock = ctx.length > 0 ? `${tag('turn_context', ctx.join('\n\n'))}\n\n` : '';
  const finalContent = `${turnContextBlock}${userName}'s message:\n${latestFormatted}`;

  const tail = messages[messages.length - 1];
  if (tail.role === 'user') {
    tail.content += '\n\n' + finalContent;
  } else {
    messages.push({ role: 'user', content: finalContent });
  }

  return messages;
}
