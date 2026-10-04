/**
 * SillyTavern-Compatible Regex Scripts & Output Formatting Engine
 *
 * Provides:
 * 1. Client-side and prompt-time regex transformations
 * 2. Dialogue Highlighter: Highlights character speech (“...”) in distinct hues and prose (*...*) in soft italics
 * 3. Sanitizers: Strips unwanted model artifacts (lingering <think>, canned AI phrases, tokens, glitches)
 * 4. Custom Macro Expansion: {{roll::2d6}}, {{random::a,b}}, {{card::title|body}}, {{status::...}}
 * 5. Full SillyTavern Regex Extension format compatibility (import/export)
 */

import { repairMojibake } from '@/lib/prompt/macros';

export type RegexScope = 'display' | 'prompt' | 'both';
export type RegexTarget = 'all' | 'assistant' | 'user';
export type RegexCategory = 'dialogue' | 'sanitizer' | 'macro' | 'visual' | 'custom';

export interface RegexScript {
  id: string;
  name: string;
  description: string;
  findRegex: string; // e.g. "/pattern/flags" or "pattern"
  replaceString: string;
  flags?: string; // defaults to 'g' or extracted from pattern
  trimStrings?: string[];
  scope: RegexScope; // 'display' (client render), 'prompt' (before API send), 'both'
  target: RegexTarget; // 'all', 'assistant', 'user'
  enabled: boolean;
  isPreset: boolean;
  category: RegexCategory;
}

export interface MacroContext {
  charName?: string;
  userName?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  personaDescription?: string;
}

/**
 * Built-in Preset Regex Scripts
 */
export const DEFAULT_REGEX_SCRIPTS: RegexScript[] = [
  // ── Sanitizers ──
  {
    id: 'sanitizer-lingering-think',
    name: 'Lingering <think> & Thought Stripper',
    description: 'Strips unclosed or lingering <think>, <thought>, <reasoning> tags and internal reasoning leaks.',
    findRegex: '/<(?:think|thought|reasoning|cognitive_process)>[\\s\\S]*?(?:<\\/(?:think|thought|reasoning|cognitive_process)>|$)/gi',
    replaceString: '',
    scope: 'both',
    target: 'assistant',
    enabled: true,
    isPreset: true,
    category: 'sanitizer',
  },
  {
    id: 'sanitizer-model-tokens',
    name: 'Model Token & Special Artifacts',
    description: 'Removes special LLM tokens like <|im_start|>, <|im_end|>, <s>, </s>, [INST], etc.',
    findRegex: '/<\\|(?:im_start|im_end|endoftext|eot_id|start_header_id|end_header_id)\\|?>|<\\/?s>|\\[\\/?INST\\]|### (?:Instruction|Response|System):/gi',
    replaceString: '',
    scope: 'both',
    target: 'all',
    enabled: true,
    isPreset: true,
    category: 'sanitizer',
  },
  {
    id: 'sanitizer-ai-preambles',
    name: 'Canned AI Preambles & Meta Sign-offs',
    description: 'Strips robotic prefixes like "Certainly! Here is...", "As an AI...", and polite sign-offs.',
    findRegex: '/(?:^(?:Certainly|Sure|Of course|Understood|Alright)[!,.]\\s*(?:Here(?:[\'’]s| is) (?:the |your )?(?:continuation|next part|response|scene)[^:\\n]*:?\\s*|I(?:[\'’]d| would) be happy to[^:\\n]*:?\\s*)?|^\\s*(?:As an AI(?: language model)?|In this roleplay scenario)[^.\\n]*[.\\n]\\s*|(?:I hope (?:this|the) (?:response|continuation) (?:meets|pleases|helps)[^.\\n]*[.\\n]\\s*|Is there anything else (?:I can|you[\'’]d like me to)[^?\\n]*\\?\\s*)$)/gim',
    replaceString: '',
    scope: 'display',
    target: 'assistant',
    enabled: true,
    isPreset: true,
    category: 'sanitizer',
  },
  {
    id: 'sanitizer-speaker-labels',
    name: 'Redundant Speaker Label Stripper',
    description: 'Removes redundant "Character Name: " speaker prefixes generated at line starts.',
    findRegex: '/^(?:\\*\\*)?(?:{{char}}|Assistant|Bot|Narrator)(?:\\*\\*)?\\s*:\\s*/gim',
    replaceString: '',
    scope: 'display',
    target: 'assistant',
    enabled: true,
    isPreset: true,
    category: 'sanitizer',
  },
  {
    id: 'sanitizer-formatting-glitches',
    name: 'Whitespace & Punctuation Glitch Cleaner',
    description: 'Collapses 3+ consecutive newlines to 2 and fixes dangling trailing punctuation.',
    findRegex: '/\\n{3,}/g',
    replaceString: '\n\n',
    scope: 'both',
    target: 'all',
    enabled: true,
    isPreset: true,
    category: 'sanitizer',
  },

  // ── Dialogue & Prose ──
  {
    id: 'dialogue-highlighter',
    name: 'Dialogue Spoken Text Highlighter',
    description: 'Highlights character spoken dialogue in quotes with vivid luminous hue and typography.',
    findRegex: '/(?:“([^”]+)”|"([^"]+)"|「([^」]+)」|«([^»]+)»)/g',
    replaceString: '[[rp-dialogue]]$1$2$3$4[[/rp-dialogue]]',
    scope: 'display',
    target: 'all',
    enabled: true,
    isPreset: true,
    category: 'dialogue',
  },
  {
    id: 'prose-action-styler',
    name: 'Prose & Action Italicizer',
    description: 'Refines narrative action blocks in asterisks (*...*) with soft, expressive italics.',
    findRegex: '/(?:\\*([^*\\n]+)\\*)/g',
    replaceString: '[[rp-action]]$1[[/rp-action]]',
    scope: 'display',
    target: 'all',
    enabled: true,
    isPreset: true,
    category: 'dialogue',
  },

  // ── Macros ──
  {
    id: 'macro-dice-roll',
    name: 'Interactive Dice Roll Macro ({{roll::2d6}})',
    description: 'Expands dice rolls into interactive visual dice chips with live roll formulas.',
    findRegex: '/\\{\\{\\s*roll::([0-9dD+-]+)\\s*\\}\\}/gi',
    replaceString: '[[rp-roll formula="$1"]]',
    scope: 'display',
    target: 'all',
    enabled: true,
    isPreset: true,
    category: 'macro',
  },
  {
    id: 'macro-random-choice',
    name: 'Random Choice Macro ({{random::a,b,c}})',
    description: 'Dynamically selects an item from a comma-separated list.',
    findRegex: '/\\{\\{\\s*(?:random|pick)::([^}]+)\\}\\}/gi',
    replaceString: '$1',
    scope: 'both',
    target: 'all',
    enabled: true,
    isPreset: true,
    category: 'macro',
  },

  // ── Visual & RPG Formatters ──
  {
    id: 'visual-rpg-card',
    name: 'Glass Roleplay Card Tag (<card> or {{card}})',
    description: 'Transforms <card title="..." badge="...">...</card> into luxury glassmorphism cards.',
    findRegex: '/<(?:card|item|quest)\\s+(?:title="([^"]*)")?(?:\\s*badge="([^"]*)")?(?:\\s*icon="([^"]*)")?>([\\s\\S]*?)<\\/(?:card|item|quest)>/gi',
    replaceString: '[[rp-card title="$1" badge="$2" icon="$3"]]$4[[/rp-card]]',
    scope: 'display',
    target: 'all',
    enabled: true,
    isPreset: true,
    category: 'visual',
  },
  {
    id: 'visual-rpg-status',
    name: 'RPG Status & Stat Bar Tag (<status> or [STATUS])',
    description: 'Renders RPG health/mana HUD bars and stats cleanly in an interactive card.',
    findRegex: '/<(?:status|stats|vitals)\\s+([^>]+)\\s*\\/?>|\\[STATUS:\\s*([^\\]]+)\\]/gi',
    replaceString: '[[rp-status raw="$1$2"]]',
    scope: 'display',
    target: 'all',
    enabled: true,
    isPreset: true,
    category: 'visual',
  },
  {
    id: 'visual-thought-box',
    name: 'Inner Thought & Monologue Box (<thought>)',
    description: 'Wraps internal character monologue in an introspective frosted glass disclosure block.',
    findRegex: '/<(?:thought|inner_monologue|whisper)>([\\s\\S]*?)<\\/(?:thought|inner_monologue|whisper)>/gi',
    replaceString: '[[rp-thought]]$1[[/rp-thought]]',
    scope: 'display',
    target: 'all',
    enabled: true,
    isPreset: true,
    category: 'visual',
  },
  {
    id: 'visual-ooc-note',
    name: 'OOC & Director Note Pill ((OOC: ...))',
    description: 'Styles Out-Of-Character dialogue in an unobtrusive translucent director badge.',
    findRegex: '/(?:\\(\\(\\s*(?:OOC:?\\s*)?([^)]+)\\s*\\)\\)|\\[OOC:?\\s*([^\\]]+)\\])/gi',
    replaceString: '[[rp-ooc]]$1$2[[/rp-ooc]]',
    scope: 'display',
    target: 'all',
    enabled: true,
    isPreset: true,
    category: 'visual',
  },
  {
    id: 'visual-scene-divider',
    name: 'Scene Break Flourish (--- or ***)',
    description: 'Converts plain horizontal rules into an ornamental chapter break ornament.',
    findRegex: '/^(?:---|\\*\\*\\*|___|---[*~]---)\\s*$/gm',
    replaceString: '[[rp-divider]]',
    scope: 'display',
    target: 'all',
    enabled: true,
    isPreset: true,
    category: 'visual',
  },
];

/**
 * Safely compiles a regex pattern string that may be in `/pattern/flags` format or just `pattern`.
 */
export function compileRegex(patternStr: string, defaultFlags = 'g'): RegExp | null {
  if (!patternStr) return null;
  try {
    const trimmed = patternStr.trim();
    if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
      const lastSlash = trimmed.lastIndexOf('/');
      const pattern = trimmed.slice(1, lastSlash);
      const flags = trimmed.slice(lastSlash + 1) || defaultFlags;
      return new RegExp(pattern, flags);
    }
    return new RegExp(trimmed, defaultFlags);
  } catch (err) {
    console.warn(`[RegexEngine] Invalid regex pattern "${patternStr}":`, err);
    return null;
  }
}

/**
 * Evaluates dice roll expressions like 2d6, 1d20+4, 3d8-1.
 * Returns both the total sum and individual die outcomes.
 */
export function rollDice(expression: string): { total: number; rolls: number[]; count: number; sides: number; modifier: number } {
  const match = expression.trim().match(/^(\d+)d(\d+)(?:([+-])(\d+))?$/i);
  if (!match) {
    return { total: 0, rolls: [], count: 0, sides: 0, modifier: 0 };
  }
  const count = Math.min(Math.max(parseInt(match[1], 10) || 1, 1), 100);
  const sides = Math.min(Math.max(parseInt(match[2], 10) || 6, 2), 1000);
  const sign = match[3];
  const modVal = match[4] ? parseInt(match[4], 10) : 0;
  const modifier = sign === '-' ? -modVal : modVal;

  const rolls: number[] = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const r = Math.floor(Math.random() * sides) + 1;
    rolls.push(r);
    sum += r;
  }
  const total = sum + modifier;
  return { total, rolls, count, sides, modifier };
}

/**
 * Replaces macros dynamically in text.
 */
export function expandStandardMacros(text: string, ctx: MacroContext = {}): string {
  if (!text) return '';
  const safeChar = (ctx.charName || 'Character').trim();
  const safeUser = (ctx.userName || 'User').trim();
  const now = new Date();

  let res = text
    // Possessive macros
    .replace(/\{\{\s*char\s*\}\}['’]s/gi, `${safeChar}'s`)
    .replace(/\{\{\s*user\s*\}\}['’]s/gi, `${safeUser}'s`)
    // Character names
    .replace(/\{\{\s*CHAR\s*\}\}/g, safeChar.toUpperCase())
    .replace(/\{\{\s*Char\s*\}\}/g, safeChar)
    .replace(/\{\{\s*char\s*\}\}/gi, safeChar)
    .replace(/\{\{\s*bot\s*\}\}/gi, safeChar)
    .replace(/\{\{\s*char_name\s*\}\}/gi, safeChar)
    .replace(/\{\{\s*charIfNotGroup\s*\}\}/gi, safeChar)
    // User names
    .replace(/\{\{\s*USER\s*\}\}/g, safeUser.toUpperCase())
    .replace(/\{\{\s*User\s*\}\}/g, safeUser)
    .replace(/\{\{\s*user\s*\}\}/gi, safeUser)
    .replace(/\{\{\s*persona\s*\}\}/gi, safeUser)
    // Time & Date
    .replace(/\{\{\s*time\s*\}\}/gi, now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
    .replace(/\{\{\s*date\s*\}\}/gi, now.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }))
    .replace(/\{\{\s*weekday\s*\}\}/gi, now.toLocaleDateString([], { weekday: 'long' }))
    .replace(/\{\{\s*isodate\s*\}\}/gi, now.toISOString().split('T')[0]);

  // {{random::a,b,c}} or {{pick::a,b,c}}
  res = res.replace(/\{\{\s*(?:random|pick)::([^}]+)\}\}/gi, (_match, group: string) => {
    const choices = group.split(',').map((s) => s.trim()).filter(Boolean);
    if (!choices.length) return '';
    return choices[Math.floor(Math.random() * choices.length)];
  });

  return res;
}

/**
 * Resolves prompt-time dice rolls into numeric results so the model sees the actual outcome.
 */
export function resolvePromptTimeDiceRolls(text: string): string {
  if (!text) return '';
  return text.replace(/\{\{\s*roll::([0-9dD+-]+)\s*\}\}/gi, (_m, formula: string) => {
    const { total, rolls, modifier } = rollDice(formula);
    const modStr = modifier !== 0 ? (modifier > 0 ? `+${modifier}` : `${modifier}`) : '';
    return `[Roll ${formula} (${rolls.join('+')}${modStr}) = ${total}]`;
  });
}

/**
 * Executes a replacement string with support for $1, $2, character placeholders, and custom tags.
 */
function performReplacement(
  text: string,
  regex: RegExp,
  replaceStr: string,
  ctx: MacroContext
): string {
  const safeChar = ctx.charName || 'Character';
  const safeUser = ctx.userName || 'User';

  const expandedReplacement = replaceStr
    .replace(/\{\{\s*char\s*\}\}/gi, safeChar)
    .replace(/\{\{\s*user\s*\}\}/gi, safeUser);

  return text.replace(regex, expandedReplacement);
}

/**
 * Runs a list of regex scripts on a given text for a specific scope and target.
 */
export function applyRegexScripts(
  text: string,
  scripts: RegexScript[],
  scope: 'display' | 'prompt',
  targetRole: 'assistant' | 'user' | 'all' = 'assistant',
  ctx: MacroContext = {}
): string {
  if (!text) return '';

  let output = text;

  // Filter applicable active scripts
  const activeScripts = scripts.filter((s) => {
    if (!s.enabled) return false;
    if (s.scope !== 'both' && s.scope !== scope) return false;
    if (s.target !== 'all' && s.target !== targetRole) return false;
    return true;
  });

  for (const script of activeScripts) {
    // Special handling for dynamic macros
    if (script.id === 'macro-dice-roll' && scope === 'prompt') {
      output = resolvePromptTimeDiceRolls(output);
      continue;
    }
    if (script.id === 'macro-random-choice') {
      // Handled via expandStandardMacros
      continue;
    }

    // Dynamic {{char}} replacement in script regex
    let patternStr = script.findRegex;
    if (ctx.charName) {
      patternStr = patternStr.replace(/\{\{char\}\}/gi, ctx.charName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
    if (ctx.userName) {
      patternStr = patternStr.replace(/\{\{user\}\}/gi, ctx.userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }

    const rx = compileRegex(patternStr, script.flags || 'g');
    if (!rx) continue;

    try {
      output = performReplacement(output, rx, script.replaceString, ctx);
    } catch (err) {
      console.warn(`[RegexEngine] Error executing script "${script.name}":`, err);
    }

    // Trim strings if specified
    if (script.trimStrings?.length) {
      for (const t of script.trimStrings) {
        if (t) output = output.split(t).join('');
      }
    }
  }

  return output;
}

/**
 * Complete Prompt-Time Sanitization & Transformation Pipeline.
 * Call this before sending prompt turns to the LLM.
 */
export function processPromptTime(
  rawText: string,
  scripts: RegexScript[],
  ctx: MacroContext = {}
): string {
  if (!rawText) return '';
  let text = repairMojibake(rawText);
  text = expandStandardMacros(text, ctx);
  text = applyRegexScripts(text, scripts, 'prompt', 'user', ctx);
  return text.trim();
}

/**
 * Complete Display-Time Pipeline (Text transformations before React component rendering).
 */
export function processDisplayTime(
  rawText: string,
  scripts: RegexScript[],
  targetRole: 'assistant' | 'user',
  ctx: MacroContext = {}
): string {
  if (!rawText) return '';
  let text = repairMojibake(rawText);
  text = expandStandardMacros(text, ctx);
  text = applyRegexScripts(text, scripts, 'display', targetRole, ctx);
  return text;
}

/**
 * Model Output Sanitizer: High-performance sanitization for API routes and logs.
 * Strips lingering <think>, special tokens, speaker labels, and canned preambles.
 */
export function sanitizeModelOutput(text: string, charName?: string): string {
  if (!text) return '';

  let sanitized = repairMojibake(text);

  // 1. Strip lingering complete or unclosed thinking blocks
  sanitized = sanitized.replace(/<(?:think|thought|reasoning|cognitive_process)>[\s\S]*?(?:<\/(?:think|thought|reasoning|cognitive_process)>|$)/gi, '');

  // 2. Strip special tokens
  sanitized = sanitized.replace(/<\|(?:im_start|im_end|endoftext|eot_id|start_header_id|end_header_id)\|?>|<\/?s>|\[\/?INST\]|### (?:Instruction|Response|System):/gi, '');

  // 3. Strip speaker tag if at start
  if (charName) {
    const escaped = charName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    sanitized = sanitized.replace(new RegExp(`^\\s*(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*:\\s*`, 'i'), '');
  }
  sanitized = sanitized.replace(/^(?:\*\*)?(?:Assistant|Bot|Narrator)(?:\*\*)?\s*:\s*/gim, '');

  // 4. Strip canned AI assistant preambles
  sanitized = sanitized.replace(/^(?:Certainly|Sure|Of course|Understood|Alright)[!,.]\s*(?:Here(?:['’]s| is) (?:the |your )?(?:continuation|next part|response|scene)[^:\n]*:?\s*|I(?:['’]d| would) be happy to[^:\n]*:?\s*)?/gim, '');
  sanitized = sanitized.replace(/^\s*(?:As an AI(?: language model)?|In this roleplay scenario)[^.\n]*[.\n]\s*/gim, '');

  // 5. Strip canned sign-offs
  sanitized = sanitized.replace(/(?:I hope (?:this|the) (?:response|continuation) (?:meets|pleases|helps)[^.\n]*[.\n]\s*|Is there anything else (?:I can|you['’]d like me to)[^?\n]*\?\s*)$/gim, '');

  // 6. Clean excess newlines
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

  return sanitized.trim();
}

/**
 * Live test a regex script against sample text.
 */
export function testRegexScript(
  script: Partial<RegexScript>,
  sampleText: string,
  ctx: MacroContext = { charName: 'Seraphina', userName: 'Traveler' }
): { result: string; matchesCount: number; error?: string } {
  if (!script.findRegex) {
    return { result: sampleText, matchesCount: 0, error: 'Empty regex pattern' };
  }

  try {
    let patternStr = script.findRegex;
    if (ctx.charName) {
      patternStr = patternStr.replace(/\{\{char\}\}/gi, ctx.charName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
    if (ctx.userName) {
      patternStr = patternStr.replace(/\{\{user\}\}/gi, ctx.userName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }

    const rx = compileRegex(patternStr, script.flags || 'g');
    if (!rx) {
      return { result: sampleText, matchesCount: 0, error: 'Invalid regular expression' };
    }

    const matches = sampleText.match(rx);
    const matchesCount = matches ? matches.length : 0;
    const result = performReplacement(sampleText, rx, script.replaceString || '', ctx);

    return { result, matchesCount };
  } catch (err: any) {
    return { result: sampleText, matchesCount: 0, error: err?.message || 'Regex execution failed' };
  }
}

/**
 * SillyTavern JSON Regex Export Format Interface
 */
export interface SillyTavernRegexEntry {
  id?: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings?: string[];
  placement?: number[]; // [1, 2] -> 1: User input, 2: AI output, etc.
  disabled?: boolean;
}

/**
 * Exports scripts to SillyTavern compatible JSON.
 */
export function exportToSillyTavernJson(scripts: RegexScript[]): string {
  const stFormat: SillyTavernRegexEntry[] = scripts.map((s) => ({
    id: s.id,
    scriptName: s.name,
    findRegex: s.findRegex,
    replaceString: s.replaceString,
    trimStrings: s.trimStrings || [],
    placement: s.scope === 'both' ? [1, 2] : s.scope === 'prompt' ? [1] : [2],
    disabled: !s.enabled,
  }));
  return JSON.stringify(stFormat, null, 2);
}

/**
 * Imports scripts from JSON (handles both SillyTavern and native formats).
 */
export function importFromRegexJson(jsonString: string): { scripts: RegexScript[]; error?: string } {
  try {
    const parsed = JSON.parse(jsonString);
    if (!Array.isArray(parsed)) {
      return { scripts: [], error: 'JSON content must be an array of regex scripts' };
    }

    const imported: RegexScript[] = [];

    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      if (!item || typeof item !== 'object') continue;

      // SillyTavern format
      if ('findRegex' in item && ('scriptName' in item || 'name' in item)) {
        const name = String(item.scriptName || item.name || `Custom Rule ${i + 1}`);
        const findRegex = String(item.findRegex || '');
        const replaceString = String(item.replaceString ?? '');
        const disabled = Boolean(item.disabled ?? !item.enabled);
        const placement = Array.isArray(item.placement) ? item.placement : [];
        let scope: RegexScope = 'both';
        if (placement.includes(1) && !placement.includes(2)) scope = 'prompt';
        else if (placement.includes(2) && !placement.includes(1)) scope = 'display';

        imported.push({
          id: item.id ? String(item.id) : `custom-regex-${Date.now()}-${i}`,
          name,
          description: item.description ? String(item.description) : 'Imported custom regex rule',
          findRegex,
          replaceString,
          flags: item.flags || 'g',
          trimStrings: Array.isArray(item.trimStrings) ? item.trimStrings.map(String) : [],
          scope: item.scope || scope,
          target: item.target || 'all',
          enabled: !disabled,
          isPreset: false,
          category: item.category || 'custom',
        });
      }
    }

    return { scripts: imported };
  } catch (err: any) {
    return { scripts: [], error: err?.message || 'Failed to parse JSON file' };
  }
}
