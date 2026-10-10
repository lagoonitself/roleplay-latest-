/**
 * Prompt Assembly Pipeline
 * ------------------------
 * Builds the message array sent to the model. Block order and injection semantics
 * follow SillyTavern's chat-completion pipeline:
 *
 *   [system]  main / system prompt          (or a preset / character override)
 *   [system]  world info before character
 *   [system]  user persona
 *   [system]  character sheet (description, personality, scenario, speech,
 *             and the card's own system prompt as <creator_directives>)
 *   [system]  house-style preset as <style_direction>
 *   [system]  world info after character
 *   [system]  pinned facts
 *   [chat]    dialogue examples            (all-or-nothing, "[Example Chat]" blocks)
 *   [chat]    history                      (newest kept, oldest dropped to fit)
 *   [chat]    in-chat injections           (depth N = N messages above the newest)
 *   [user]    scene state + latest message + post-history reminder
 *
 * Modes (SillyTavern's generation types):
 *   normal       reply to the latest user message
 *   continue     the last assistant reply stays in history and an OOC nudge asks
 *                the model to carry on from exactly where it stopped
 *   impersonate  draft the *user's* next message (the result goes back into the
 *                composer, it is never stored as a character reply)
 *
 * Depth semantics match SillyTavern exactly: depth 0 is the slot immediately
 * before the model's reply, depth 4 is four messages above the newest, and
 * several injections at the same depth are merged in `order` sequence.
 *
 * Budgeting is dynamic: the static prefix is measured, recall blocks are capped,
 * and the remainder goes to history (see tokens.ts). Nothing here is a fixed
 * constant that quietly breaks when a character card is large or a model is small.
 *
 * Macros: live content (authorial text, the current message, notes) gets full
 * macro expansion. Stored history only gets deterministic macros — re-rolling
 * {{random::…}} or re-stamping {{time}} on old messages would rewrite the past.
 */

import { buildSystemPrompt, VERBOSITY_GUIDE } from './system-prompt';
import { substituteMacros, formatRoleplayText, formatHistoryText, type MacroContext } from './macros';
import { estimateTokens, truncateToTokens, computeContextBudget, MIN_HISTORY_TOKENS } from './tokens';
import type { ActivatedLore, WorldInfoScanEntry } from '@/lib/lorebook/matcher';
import type { VectorRetrievalResult } from '@/lib/memory/vectors';
import type { Character, Persona, Memory, Summary, ChatState, LorebookEntry, Message } from '@/lib/supabase/types';
import type { ChatMessage } from '@/lib/llm/client';

export type GenerationMode = 'normal' | 'continue' | 'impersonate';

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
  /** Generation type. Defaults to `normal`. */
  mode?: GenerationMode;
  /** House-style preset text, layered under the card as <style_direction>. */
  stylePreset?: string;
  /** Optional budget overrides — when absent, budgets are derived from the model. */
  historyTokenBudget?: number;
  loreTokenBudget?: number;
  authorsNoteDepth?: number;
  summaryDepth?: number;
  vectorsDepth?: number;
  /** Used to size the context window when computing budgets. */
  model?: string;
  maxResponseTokens?: number;
  thinking?: boolean;
}

export const DEFAULT_HISTORY_TOKEN_BUDGET = 7000;
export const DEFAULT_LORE_TOKEN_BUDGET = 1200;
export const EXAMPLE_DIALOGUE_TOKEN_BUDGET = 900;

export const SILLY_TAVERN_PROMPT_DEFAULTS = {
  mainPrompt: "Write {{char}}'s next reply in a fictional chat between {{charIfNotGroup}} and {{user}}.",
  personalityFormat: "[{{char}}'s personality: {{personality}}]",
  scenarioFormat: '[Circumstances and context of the dialogue: {{scenario}}]',
  summaryTemplate: '[Summary: {{summary}}]',
  vectorsTemplate: 'Past events:\n{{text}}',
  authorsNoteTemplate: "[Author's note: {{note}}]",
  chatStart: '[Start a new Chat]',
  exampleChat: '[Example Chat]',
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
/** Opening words of this many recent replies are fed back as "don't open like this". */
const REPETITION_LOOKBACK = 3;

function tag(name: string, body: string, attrs = ''): string {
  const trimmed = body.trim();
  return trimmed ? `<${name}${attrs ? ' ' + attrs : ''}>\n${trimmed}\n</${name}>` : '';
}

function escapeAttr(v: string): string {
  return v.replace(/"/g, "'");
}

/**
 * Example dialogue is all-or-nothing *per exchange*, like SillyTavern: whole
 * <START> blocks are kept until the budget runs out. A block cut in half teaches
 * the model a broken voice.
 */
function fitExampleBlocks(text: string, budget: number): string {
  const blocks = text
    .split(/<START>/i)
    .map((b) => b.trim())
    .filter(Boolean);
  const kept: string[] = [];
  let used = 0;
  for (const block of blocks) {
    const cost = estimateTokens(block) + 4;
    if (used + cost > budget) {
      // Never send zero examples just because the first one is long.
      if (!kept.length) kept.push(truncateToTokens(block, budget));
      break;
    }
    kept.push(block);
    used += cost;
  }
  return kept.map((b) => `${SILLY_TAVERN_PROMPT_DEFAULTS.exampleChat}\n${b}`).join('\n\n');
}

/** First few words of a reply, stripped of markup, for the repetition hint. */
function openingOf(text: string): string {
  const plain = text.replace(/[*_"“”]/g, '').replace(/\s+/g, ' ').trim();
  const words = plain.split(' ').slice(0, 7).join(' ');
  return words.length > 3 ? words : '';
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
 * SillyTavern's populationInjectionPrompts algorithm.
 *
 * `messages` is chronological (oldest first). A depth-0 injection lands in the
 * slot immediately before the model's reply; depth N lands N messages above the
 * newest message. Injections sharing a depth are merged in ascending `order`.
 */
export function populateInChatInjections(
  messages: ChatMessage[],
  injections: InChatInjection[]
): ChatMessage[] {
  if (!injections.length || !messages.length) return [...messages];

  const result = [...messages];
  const maxDepth = Math.max(...injections.map((i) => i.depth), 0);

  for (let depth = 0; depth <= maxDepth; depth++) {
    const depthPrompts = injections
      .filter((i) => i.depth === depth && i.content.trim())
      .sort((a, b) => a.order - b.order);

    if (!depthPrompts.length) continue;

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

export interface AssembledPrompt {
  messages: ChatMessage[];
  budget: {
    contextWindow: number;
    responseReserve: number;
    prefixTokens: number;
    historyTokens: number;
    /** Tokens history was allowed to use this turn (the memory trigger keys off it). */
    historyBudget: number;
    historyMessages: number;
    recallTokens: number;
  };
}

/**
 * Full assembly with a budget report (used for dev logs and the token HUD).
 */
export function assemblePromptDetailed(params: AssemblePromptParams): AssembledPrompt {
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
    mode = 'normal',
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
  };

  const fmt = (t: string) => truncateToTokens(formatRoleplayText(t, macroCtx), CHARACTER_FIELD_CAP);
  const fmtStored = (t: string) => truncateToTokens(formatHistoryText(t, macroCtx), CHARACTER_FIELD_CAP);

  // ── 1. Static prefix ───────────────────────────────────────────────────────

  const baseSystemPrompt = buildSystemPrompt({
    charName,
    userName,
    contentRating: character.content_rating,
    pov: character.behavior?.pov || '2nd',
    tense: character.behavior?.tense || 'present',
    verbosity: character.behavior?.verbosity || 'medium',
    thinking: params.thinking,
  });

  // The card's own system prompt. SillyTavern semantics: it replaces the main
  // prompt, and {{original}} splices the default main prompt back in.
  const creatorDirectives = character.system_prompt?.trim()
    ? substituteMacros(
        character.system_prompt
          .trim()
          .replace(/\{\{\s*original\s*\}\}/gi, () => SILLY_TAVERN_PROMPT_DEFAULTS.mainPrompt),
        macroCtx
      )
    : '';

  const styleDirection = params.stylePreset?.trim() ? substituteMacros(params.stylePreset.trim(), macroCtx) : '';

  const wiBeforeList: WorldInfoScanEntry[] = activatedLore?.worldInfoBefore ?? [];
  const wiBeforeContent = wiBeforeList
    .map((e) => (e.title ? `## ${e.title}\n${e.content}` : e.content))
    .join('\n\n');
  const wiBeforeBlock = wiBeforeContent ? tag('world_info_before', fmt(wiBeforeContent)) : '';

  const personaBlock = persona?.description?.trim()
    ? tag('user_persona', fmt(persona.description), `name="${escapeAttr(userName)}"`)
    : `<user_persona name="${escapeAttr(userName)}">No details provided. Do not invent facts about ${userName}; learn them from the story.</user_persona>`;

  const charBlock = [
    `<character name="${escapeAttr(charName)}">`,
    character.tagline ? tag('tagline', fmt(character.tagline)) : '',
    tag('description', character.description ? fmt(character.description) : ''),
    tag('personality', character.personality ? fmt(character.personality) : ''),
    tag('scenario', character.scenario ? fmt(character.scenario) : ''),
    tag('speech_style', character.speech_style ? fmt(character.speech_style) : ''),
    tag('creator_directives', creatorDirectives ? truncateToTokens(creatorDirectives, CHARACTER_FIELD_CAP) : ''),
    `</character>`,
  ]
    .filter(Boolean)
    .join('\n');

  const styleBlock = styleDirection ? tag('style_direction', truncateToTokens(styleDirection, 600)) : '';

  const wiAfterList: WorldInfoScanEntry[] = activatedLore?.worldInfoAfter ?? [];
  const wiAfterContent = wiAfterList
    .map((e) => (e.title ? `## ${e.title}\n${e.content}` : e.content))
    .join('\n\n');
  const wiAfterBlock = wiAfterContent ? tag('world_info_after', fmt(wiAfterContent)) : '';

  const pinnedBlock = pinnedMemories.length
    ? tag('pinned_facts', pinnedMemories.map((m) => `- ${formatRoleplayText(m.content, macroCtx)}`).join('\n'))
    : '';

  const exampleBlock = character.example_dialogue?.trim()
    ? tag(
        'example_dialogue',
        fitExampleBlocks(formatRoleplayText(character.example_dialogue, macroCtx), EXAMPLE_DIALOGUE_TOKEN_BUDGET),
        'purpose="voice and style reference only; these exchanges never happened"'
      )
    : '';

  const staticPrefix = [
    baseSystemPrompt,
    wiBeforeBlock,
    personaBlock,
    charBlock,
    styleBlock,
    wiAfterBlock,
    pinnedBlock,
    exampleBlock,
  ]
    .filter(Boolean)
    .join('\n\n');

  // ── 2. Budget split ────────────────────────────────────────────────────────

  const verbosity = character.behavior?.verbosity || 'medium';
  const maxResponseTokens = params.maxResponseTokens ?? (VERBOSITY_GUIDE[verbosity] ?? VERBOSITY_GUIDE.medium).maxTokens;

  const requestedRecall =
    estimateTokens(summary?.content) +
    estimateTokens(vectorMemories?.formattedText) +
    estimateTokens(authorsNote) +
    estimateTokens(retrievedMemories.map((m) => m.content).join('\n')) +
    estimateTokens(triggeredLore.map((l) => l.content).join('\n'));

  const budget = computeContextBudget({
    model: params.model,
    maxResponseTokens,
    thinking: params.thinking,
    prefixTokens: estimateTokens(staticPrefix),
    requestedRecallTokens: requestedRecall,
    minHistoryTokens: MIN_HISTORY_TOKENS,
  });

  const historyTokenBudget = params.historyTokenBudget ?? budget.historyBudget;
  const loreTokenBudget = params.loreTokenBudget ?? Math.max(DEFAULT_LORE_TOKEN_BUDGET, Math.floor(budget.recallBudget * 0.5));

  const messages: ChatMessage[] = [{ role: 'system', content: staticPrefix }];

  // ── 3. History (newest kept, oldest dropped to fit) ────────────────────────

  const latestFormatted = formatRoleplayText(latestUserMessage, macroCtx).trim();

  let turns: ChatMessage[] = history
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content?.trim() && m.status !== 'error')
    .map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: fmtStored(m.content || '').trim(),
    }));

  // Drop the latest user message if it is already persisted in history. Compare
  // against both macro styles: history keeps volatile macros unexpanded, while the
  // live message below is fully expanded.
  const latestStored = fmtStored(latestUserMessage).trim();
  const lastTurn = turns[turns.length - 1];
  if (
    mode === 'normal' &&
    lastTurn &&
    lastTurn.role === 'user' &&
    (lastTurn.content === latestFormatted || lastTurn.content === latestStored)
  ) {
    turns = turns.slice(0, -1);
  }

  // Preserve the character's opening greeting as turn zero.
  if (turns.length > 0 && turns[0].role !== 'assistant' && character.first_message?.trim()) {
    turns.unshift({ role: 'assistant', content: fmtStored(character.first_message).trim() });
  }

  let usedTokens = 0;
  const keptTurns: ChatMessage[] = [];
  for (let i = turns.length - 1; i >= 0; i--) {
    const cost = estimateTokens(turns[i].content) + 4;
    if (usedTokens + cost > historyTokenBudget && keptTurns.length >= 2) break;
    keptTurns.unshift(turns[i]);
    usedTokens += cost;
  }

  // ── 4. Recall blocks & in-chat injections ──────────────────────────────────

  const inChatInjections: InChatInjection[] = [];
  let recallSpent = 0;

  const spend = (text: string, cap: number): string => {
    if (!text.trim()) return '';
    const room = Math.max(0, budget.recallBudget - recallSpent);
    const allowed = Math.min(cap, room);
    if (allowed <= 0) return '';
    const out = truncateToTokens(text, allowed);
    recallSpent += estimateTokens(out);
    return out;
  };

  if (authorsNote?.trim()) {
    const formattedNote = spend(substituteMacros(authorsNote.trim(), macroCtx), 400);
    if (formattedNote) {
      inChatInjections.push({
        identifier: 'authorsNote',
        role: 'system',
        content: SILLY_TAVERN_PROMPT_DEFAULTS.authorsNoteTemplate.replace('{{note}}', formattedNote),
        depth: authorsNoteDepth,
        order: 100,
      });
    }
  }

  if (summary?.content?.trim()) {
    const formattedSummary = spend(formatHistoryText(summary.content.trim(), macroCtx), 700);
    if (formattedSummary) {
      inChatInjections.push({
        identifier: 'summary',
        role: 'system',
        content: SILLY_TAVERN_PROMPT_DEFAULTS.summaryTemplate.replace('{{summary}}', formattedSummary),
        depth: summaryDepth,
        order: 90,
      });
    }
  }

  const recallText = vectorMemories?.formattedText?.trim()
    ? vectorMemories.formattedText.trim()
    : retrievedMemories.length > 0
      ? `Past events:\n${retrievedMemories.map((m) => `- ${formatHistoryText(m.content, macroCtx)}`).join('\n')}`
      : '';
  const recallUsed = spend(recallText, 600);
  if (recallUsed) {
    inChatInjections.push({
      identifier: 'vectorsMemory',
      role: 'system',
      content: recallUsed,
      depth: vectorsDepth,
      order: 80,
    });
  }

  // Lorebook fallback when the World Info scanner wasn't available.
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
    if (loreParts.length) {
      messages[0].content += '\n\n' + tag('world_lore', loreParts.join('\n\n'));
    }
  }

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

  const injectedTurns = populateInChatInjections(keptTurns, inChatInjections);

  // Merge consecutive same-role turns for strict API validation.
  for (const turn of injectedTurns) {
    const prev = messages[messages.length - 1];
    if (prev.role === turn.role && prev.role !== 'system') {
      prev.content += '\n\n' + turn.content;
    } else {
      messages.push({ ...turn });
    }
  }

  // ── 5. The final turn: scene state + the live message + reminder ──────────

  // Repetition guard: models fall into loops of opening every reply the same way.
  // Naming the recent openings is far more effective than a generic "be varied".
  const recentOpenings = keptTurns
    .filter((t) => t.role === 'assistant')
    .slice(-REPETITION_LOOKBACK)
    .map((t) => openingOf(t.content))
    .filter(Boolean);
  const repetitionHint = recentOpenings.length >= 2
    ? `Your recent replies opened with: ${recentOpenings.map((o) => `"${o}…"`).join(', ')}. Open this one differently.`
    : '';

  const postHistory = character.post_history_instructions?.trim()
    ? substituteMacros(
        character.post_history_instructions.trim().replace(/\{\{\s*original\s*\}\}/gi, ''),
        macroCtx
      ).trim()
    : '';

  let finalContent: string;

  if (mode === 'continue') {
    finalContent = tag(
      'ooc_note',
      [
        `Continue ${charName}'s last reply from exactly where it stops — mid-sentence if it stops mid-sentence. Do not repeat or rephrase any of it, and do not start a new reply.`,
        `Keep the same voice, scene, point of view, and tense, and still never write ${userName}'s words or actions.`,
        postHistory,
      ]
        .filter(Boolean)
        .join('\n')
    );
  } else if (mode === 'impersonate') {
    finalContent = tag(
      'ooc_note',
      [
        `For this one message only, write ${userName}'s next turn instead of ${charName}'s. This replaces the usual rule against writing ${userName}.`,
        `Match how ${userName} has been writing in this chat — their voice, length, and formatting — and stay true to <user_persona>.`,
        `Write only ${userName}'s own words and actions. Don't write ${charName}'s dialogue or decide ${charName}'s reactions. Keep it to one short paragraph.`,
        `Output the message itself, with no name prefix or commentary.`,
      ].join('\n')
    );
  } else {
    const sceneBlock =
      chatState?.state && Object.keys(chatState.state).length > 0
        ? `${tag('scene_state', formatSceneState(chatState.state, charName))}\n\n`
        : '';

    const reminder = [
      postHistory,
      `Write only ${charName}'s reply and the world around them — never ${userName}'s words, actions, or feelings. Stay in ${charName}'s voice.`,
      repetitionHint,
    ]
      .filter(Boolean)
      .join('\n');

    finalContent = `${sceneBlock}${latestFormatted}\n\n${tag('character_reminder', reminder)}`;
  }

  const tail = messages[messages.length - 1];
  if (tail.role === 'user') {
    tail.content += '\n\n' + finalContent;
  } else {
    messages.push({ role: 'user', content: finalContent });
  }

  return {
    messages,
    budget: {
      contextWindow: budget.contextWindow,
      responseReserve: budget.responseReserve,
      prefixTokens: estimateTokens(staticPrefix),
      historyTokens: usedTokens,
      historyBudget: historyTokenBudget,
      historyMessages: keptTurns.length,
      recallTokens: recallSpent,
    },
  };
}

/**
 * Builds the ordered, role-alternating message list sent to the model.
 */
export function assemblePrompt(params: AssemblePromptParams): ChatMessage[] {
  return assemblePromptDetailed(params).messages;
}
