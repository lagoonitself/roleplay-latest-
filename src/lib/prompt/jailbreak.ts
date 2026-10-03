/**
 * Backwards-compatibility shim. The system prompt now lives in ./system-prompt.
 */
export { buildSystemPrompt } from './system-prompt';
export type { SystemPromptConfig } from './system-prompt';
export { substituteMacros, formatRoleplayText, repairMojibake } from './macros';
