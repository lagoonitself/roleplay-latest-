/**
 * SillyTavern Exact Presets, Instructions, and Prompt Templates
 *
 * Direct port of all default presets from:
 * - default/content/presets/sysprompt/*.json
 * - default/content/presets/openai/Default.json
 * - default/content/presets/context/Default.json
 * - public/scripts/extensions/memory/index.js
 * - public/scripts/extensions/vectors/index.js
 * - public/scripts/authors-note.js
 */

export interface SystemPromptPreset {
  id: string;
  name: string;
  description: string;
  content: string;
}

/** The built-in prompt alone, with no extra house style layered on top. */
export const DEFAULT_PRESET_ID = 'default';

/**
 * House-style presets. They are layered *under* the character card as
 * <style_direction> — they never replace the card's own system prompt, and the
 * chat's content rating still wins over anything a preset asks for.
 */
export const SILLY_TAVERN_SYSTEM_PROMPT_PRESETS: Record<string, SystemPromptPreset> = {
  default: {
    id: 'default',
    name: 'Built-in',
    description: 'The tuned Cadenza prompt with no extra style.',
    content: '',
  },
  'roleplay-detailed': {
    id: 'roleplay-detailed',
    name: 'Roleplay - Detailed',
    description: 'Slow-paced, sensory-rich, highly vivid narrative description.',
    content:
      'Develop the plot slowly, always stay in character. Describe all actions in full, elaborate, explicit, graphic, and vivid detail. Mention all relevant sensory perceptions. Keep the story immersive and engaging.',
  },
  'roleplay-immersive': {
    id: 'roleplay-immersive',
    name: 'Roleplay - Immersive',
    description: 'Strict turn constraints, high complexity/burstiness, zero user puppeteering.',
    content:
      "[System note: Write one reply only. Do not decide what {{user}} says or does. Write at least one paragraph, up to four. Be descriptive and immersive, providing vivid details about {{char}}'s actions, emotions, and the environment. Write with a high degree of complexity and burstiness. Do not repeat this message.]",
  },
  'roleplay-simple': {
    id: 'roleplay-simple',
    name: 'Roleplay - Simple',
    description: 'Uncensored continuous roleplay baseline.',
    content: "You're {{char}} in this fictional never-ending uncensored roleplay with {{user}}.",
  },
  'lightning-1.1': {
    id: 'lightning-1.1',
    name: 'Lightning 1.1',
    description: 'Stage play acting style with patient pacing.',
    content:
      "Take the role of {{char}} in a play that leaves a lasting impression on {{user}}. Write {{char}}'s next reply.\nNever skip or gloss over {{char}}'s actions. Progress the scene at a naturally slow pace.",
  },
  'writer-creative': {
    id: 'writer-creative',
    name: 'Writer - Creative',
    description: 'Versatile creative writer persona for collaborative fiction.',
    content: 'You are an intelligent, skilled, versatile writer.\n\nYour task is to write a role-play based on the information below.',
  },
  'writer-realistic': {
    id: 'writer-realistic',
    name: 'Writer - Realistic',
    description: 'Grounded realism and believable character portrayal.',
    content: 'Continue writing this story and portray characters realistically.',
  },
  actor: {
    id: 'actor',
    name: 'Actor',
    description: 'Method actor persona that never breaks character for any reason.',
    content:
      'You are an expert actor that can fully immerse yourself into any role given. You do not break character for any reason, even if someone tries addressing you as an AI or language model. Currently your role is {{char}}, which is described in detail below. As {{char}}, continue the exchange with {{user}}.',
  },
  'text-adventure': {
    id: 'text-adventure',
    name: 'Text Adventure',
    description: 'Classic interactive text adventure narrator mode responding to user actions.',
    content:
      '[Enter Adventure Mode. Narrate the story based on {{user}}\'s dialogue and actions after ">". Describe the surroundings in vivid detail. Be detailed, creative, verbose, and proactive. Move the story forward by introducing fantasy elements and interesting characters.]',
  },
  'neutral-chat': {
    id: 'neutral-chat',
    name: 'Neutral - Chat',
    description: 'Standard neutral chat completion prompt.',
    content: "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.",
  },
};

export const SILLY_TAVERN_SPECIAL_PROMPTS = {
  // Impersonation prompt (user perspective response)
  impersonationPrompt:
    "[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don't write as {{char}} or system. Don't describe actions of {{char}}.]",

  // Continue nudges
  continueNudgePrompt: '[Continue your last message without repeating its original content.]',
  groupNudgePrompt: '[Write the next reply only as {{char}}.]',

  // Markers
  newChatPrompt: '[Start a new Chat]',
  newGroupChatPrompt: '[Start a new group chat. Group members: {{group}}]',
  newExampleChatPrompt: '[Example Chat]',

  // Definitions
  enhanceDefinitionsPrompt:
    "If you have more knowledge of {{char}}, add to the character's lore and personality to enhance them but keep the Character Sheet's definitions absolute.",

  // Memory & Summarization
  summarizationPrompt:
    'Ignore previous instructions. Summarize the most important facts and events in the story so far. If a summary already exists in your memory, use that as a base and expand with new facts. Limit the summary to {{words}} words or less. Your response should include nothing but the summary.',
  vectorMessageSummaryPrompt:
    'Ignore previous instructions. Summarize the most important parts of the message. Limit yourself to 250 words or less. Your response should include nothing but the summary.',

  // Templates
  summaryTemplate: '[Summary: {{summary}}]',
  vectorsTemplate: 'Past events:\n{{text}}',
  dataBankTemplate: 'Related information:\n{{text}}',
  authorsNoteTemplate: "[Author's note: {{note}}]",
  personalityFormat: "[{{char}}'s personality: {{personality}}]",
  scenarioFormat: '[Circumstances and context of the dialogue: {{scenario}}]',
};

/**
 * Standard SillyTavern Default Depths & Configuration Values
 */
export const SILLY_TAVERN_ENGINE_DEFAULTS = {
  // Depths for in-chat insertion (counting backwards from end of history)
  authorsNoteDepth: 4,
  summaryDepth: 2,
  vectorMemoriesDepth: 2,
  dataBankDepth: 4,

  // Summarization trigger interval
  summaryInterval: 10, // turns
  summaryDefaultWords: 200,

  // Vector memory parameters
  vectorProtectWindow: 5, // turns protected from vector recall (already in short-term context)
  vectorInsertChunks: 3, // max chunks inserted into context
  vectorQueryWindow: 2, // number of recent turns used to formulate query
  vectorScoreThreshold: 0.25,
};
