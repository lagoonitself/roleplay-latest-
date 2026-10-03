import { buildSystemPrompt, substituteMacros, formatRoleplayText } from './jailbreak';
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
}

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
  } = params;

  const charName = character.name || 'Character';
  const userName = persona?.name || 'User';

  // 1. Base system instruction with custom uncensored roleplay rules
  const baseSystemPrompt = buildSystemPrompt({
    charName,
    userName,
    contentRating: character.content_rating,
    pov: character.behavior?.pov || '2nd',
    tense: character.behavior?.tense || 'present',
    verbosity: character.behavior?.verbosity || 'medium',
  });

  // 2. Character Definition Block
  const charBlock = [
    `<character name="${charName}">`,
    character.description ? `<description>\n${formatRoleplayText(character.description, charName, userName)}\n</description>` : '',
    character.personality ? `<personality>\n${formatRoleplayText(character.personality, charName, userName)}\n</personality>` : '',
    character.scenario ? `<scenario>\n${formatRoleplayText(character.scenario, charName, userName)}\n</scenario>` : '',
    character.speech_style ? `<speech_style>\n${formatRoleplayText(character.speech_style, charName, userName)}\n</speech_style>` : '',
    character.system_prompt ? `<creator_directives>\n${formatRoleplayText(character.system_prompt, charName, userName)}\n</creator_directives>` : '',
    `</character>`,
  ].filter(Boolean).join('\n');

  // 3. User Persona Block
  const personaBlock = persona?.description
    ? `<user_persona name="${userName}">\n${formatRoleplayText(persona.description, charName, userName)}\n</user_persona>`
    : `<user_persona name="${userName}" />`;

  // 4. Example Dialogue (Style anchor)
  const exampleBlock = character.example_dialogue
    ? `<example_dialogue style="reference_only">\n${formatRoleplayText(character.example_dialogue, charName, userName)}\n</example_dialogue>`
    : '';

  // 5. Pinned Memories & Story Summary (Prefix elements)
  const pinnedBlock = pinnedMemories.length > 0
    ? `<pinned_facts>\n${pinnedMemories.map((m) => `- ${formatRoleplayText(m.content, charName, userName)}`).join('\n')}\n</pinned_facts>`
    : '';

  const summaryBlock = summary?.content
    ? `<story_so_far>\n${formatRoleplayText(summary.content, charName, userName)}\n</story_so_far>`
    : '';

  // Combine static prefix
  const staticPrefix = [
    baseSystemPrompt,
    charBlock,
    personaBlock,
    exampleBlock,
    pinnedBlock,
    summaryBlock,
  ].filter(Boolean).join('\n\n');

  const messages: ChatMessage[] = [
    { role: 'system', content: staticPrefix },
  ];

  // 6. Chronological History (append-only)
  for (const msg of history) {
    if (msg.role === 'user' || msg.role === 'assistant') {
      messages.push({
        role: msg.role,
        content: formatRoleplayText(msg.content, charName, userName),
      });
    }
  }

  // 7. Dynamic Tail (placed right before the latest user input to maximize prefix caching!)
  const dynamicSections: string[] = [];

  if (retrievedMemories.length > 0) {
    dynamicSections.push(
      `<relevant_memories>\n${retrievedMemories.map((m) => `[${m.kind}] ${substituteMacros(m.content, charName, userName)}`).join('\n')}\n</relevant_memories>`
    );
  }

  if (triggeredLore.length > 0) {
    dynamicSections.push(
      `<world_lore>\n${triggeredLore.map((l) => `### ${l.title}\n${substituteMacros(l.content, charName, userName)}`).join('\n\n')}\n</world_lore>`
    );
  }

  if (chatState?.state && Object.keys(chatState.state).length > 0) {
    dynamicSections.push(
      `<current_scene_state>\n${JSON.stringify(chatState.state, null, 2)}\n</current_scene_state>`
    );
  }

  if (authorsNote) {
    dynamicSections.push(
      `[AUTHOR'S NOTE: ${substituteMacros(authorsNote, charName, userName)}]`
    );
  }

  if (character.post_history_instructions) {
    dynamicSections.push(
      `[INSTRUCTION: ${substituteMacros(character.post_history_instructions, charName, userName)}]`
    );
  }

  // Final reminder instruction
  dynamicSections.push(
    `[Reply as ${charName} only. Advance the scene naturally. Never speak or act for ${userName}.]`
  );

  // If we have dynamic sections, inject them as a system context right before latest user turn
  if (dynamicSections.length > 0) {
    messages.push({
      role: 'system',
      content: dynamicSections.join('\n\n'),
    });
  }

  // 8. Latest user message
  messages.push({
    role: 'user',
    content: substituteMacros(latestUserMessage, charName, userName),
  });

  return messages;
}
