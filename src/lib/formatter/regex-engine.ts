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
    findRegex: '/(?:“([^”\\n]+)”|"([^"\\n]+)"|「([^」\\n]+)」|«([^»\\n]+)»)/g',
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
    description: 'Refines narrative action blocks in single asterisks (*...*) with soft, expressive italics. Leaves **bold** to Markdown.',
    findRegex: '/(?<!\\*)\\*(?!\\*)([^*\\n]+)(?<!\\*)\\*(?!\\*)/g',
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
  {
    id: 'visual-spoiler-tag',
    name: 'Spoiler Blur Tag (||secret||)',
    description: 'Blurs secret or spoiler text until clicked with frosted reveal.',
    findRegex: '/\\|\\|([^|\\n]+)\\|\\|/g',
    replaceString: '[[rp-spoiler]]$1[[/rp-spoiler]]',
    scope: 'display',
    target: 'all',
    enabled: true,
    isPreset: true,
    category: 'visual',
  },
];

/** Hostile cards / imported scripts can ship megabyte-long patterns. */
const MAX_PATTERN_LENGTH = 2000;
/** A repetition count above this is treated as unbounded (nesting multiplies blow up). */
const REPETITION_SOFT_CAP = 10_000;
/** User scripts never run against inputs larger than this (guards polynomial blowups). */
export const MAX_REGEX_INPUT_LENGTH = 500_000;

/**
 * Splits a `/pattern/flags` or bare `pattern` string into its parts.
 */
function splitPattern(patternStr: string, defaultFlags: string): { pattern: string; flags: string } {
  const trimmed = patternStr.trim();
  if (trimmed.startsWith('/') && trimmed.lastIndexOf('/') > 0) {
    const lastSlash = trimmed.lastIndexOf('/');
    return {
      pattern: trimmed.slice(1, lastSlash),
      flags: trimmed.slice(lastSlash + 1) || defaultFlags,
    };
  }
  return { pattern: trimmed, flags: defaultFlags };
}

// ── ReDoS guard ────────────────────────────────────────────────────────────────
//
// User-supplied patterns (regex scripts, lorebook /regex/ keys) are compiled and
// executed in the tab and in API routes. A pattern like /(a+)+$/ hangs the thread
// for minutes on a 30-character input. There is no way to time out a RegExp in JS,
// so the defense is structural: reject patterns whose repetition structure can
// backtrack catastrophically — an unbounded repetition wrapped around another
// unbounded repetition, an empty-matching loop body, a backreference inside an
// unbounded loop, or an ambiguous alternation inside an unbounded loop.

type PatternNode =
  | { type: 'atom'; empty: boolean; backref: boolean; first: string | null }
  | { type: 'concat'; items: PatternNode[] }
  | { type: 'alt'; options: PatternNode[] }
  | { type: 'group'; body: PatternNode }
  | { type: 'rep'; body: PatternNode; min: number; max: number };

function parsePatternAst(pattern: string): PatternNode {
  let i = 0;

  const peek = () => pattern[i];
  const eof = () => i >= pattern.length;

  function parseAlternation(): PatternNode {
    const options: PatternNode[] = [parseConcat()];
    while (peek() === '|') {
      i++;
      options.push(parseConcat());
    }
    return options.length === 1 ? options[0] : { type: 'alt', options };
  }

  function parseConcat(): PatternNode {
    const items: PatternNode[] = [];
    while (!eof() && peek() !== '|' && peek() !== ')') {
      items.push(parseRepeated());
    }
    return items.length === 1 ? items[0] : { type: 'concat', items };
  }

  function parseRepeated(): PatternNode {
    let node = parseAtom();
    while (!eof()) {
      let min = 0;
      let max = 0;
      const ch = peek();
      if (ch === '*') {
        min = 0;
        max = Infinity;
        i++;
      } else if (ch === '+') {
        min = 1;
        max = Infinity;
        i++;
      } else if (ch === '?') {
        min = 0;
        max = 1;
        i++;
      } else if (ch === '{') {
        const close = pattern.indexOf('}', i);
        const body = close === -1 ? '' : pattern.slice(i + 1, close);
        const m = /^(\d+)(,(\d*)?)?$/.exec(body);
        if (!m) break; // literal '{'
        min = parseInt(m[1], 10);
        max = m[2] === undefined ? min : m[3] === undefined || m[3] === '' ? Infinity : parseInt(m[3], 10);
        i = close + 1;
      } else {
        break;
      }
      if (peek() === '?') i++; // lazy quantifier
      node = { type: 'rep', body: node, min, max };
    }
    return node;
  }

  function parseAtom(): PatternNode {
    const ch = pattern[i];
    if (ch === '\\') {
      i += 2;
      const escaped = pattern[i - 1];
      const backref = escaped >= '1' && escaped <= '9';
      return { type: 'atom', empty: backref, backref, first: backref ? null : escaped === undefined ? null : escaped };
    }
    if (ch === '[') {
      i++;
      if (pattern[i] === '^') i++;
      if (pattern[i] === ']') i++; // a ']' right after '[' or '[^' is a literal
      while (i < pattern.length && pattern[i] !== ']') {
        if (pattern[i] === '\\') i++;
        i++;
      }
      i++; // consume closing ']'
      return { type: 'atom', empty: false, backref: false, first: null };
    }
    if (ch === '(') {
      i++;
      // Skip over prefix like "?:", "?<name>", "?=", "?!", "?<=", "?<!"
      if (pattern[i] === '?') {
        i++;
        if (pattern[i] === '<') {
          i++;
          while (i < pattern.length && pattern[i] !== '>' && pattern[i] !== '=') {
            if (pattern[i] === '!') break;
            i++;
          }
          if (pattern[i] === '>' || pattern[i] === '=' || pattern[i] === '!') i++;
        } else if (pattern[i] === '=' || pattern[i] === '!') {
          i++;
        }
      }
      const body = parseAlternation();
      if (pattern[i] === ')') i++;
      return { type: 'group', body };
    }
    i++;
    return {
      type: 'atom',
      empty: false,
      backref: false,
      first: ch === '.' ? null : ch === '^' || ch === '$' ? '' : ch,
    };
  }

  const ast = parseAlternation();
  return ast;
}

function canMatchEmpty(node: PatternNode): boolean {
  switch (node.type) {
    case 'atom':
      return node.empty;
    case 'concat':
      return node.items.every(canMatchEmpty);
    case 'alt':
      return node.options.some(canMatchEmpty);
    case 'group':
      return canMatchEmpty(node.body);
    case 'rep':
      return node.min === 0 || canMatchEmpty(node.body);
  }
}

/**
 * True when the subtree contains a repetition that can match the same input at
 * more than one non-trivial length (unbounded, or bounded but flexible like
 * {1,3}) — the raw material for exponential backtracking when nested.
 */
function hasFlexibleRep(node: PatternNode): boolean {
  const isFlexible = (r: { min: number; max: number }) =>
    !Number.isFinite(r.max) || r.max > REPETITION_SOFT_CAP || (r.min !== r.max && r.max > 1);
  switch (node.type) {
    case 'atom':
      return false;
    case 'concat':
      return node.items.some(hasFlexibleRep);
    case 'alt':
      return node.options.some(hasFlexibleRep);
    case 'group':
      return hasFlexibleRep(node.body);
    case 'rep':
      return isFlexible(node) || hasFlexibleRep(node.body);
  }
}

function hasBackref(node: PatternNode): boolean {
  switch (node.type) {
    case 'atom':
      return node.backref;
    case 'concat':
      return node.items.some(hasBackref);
    case 'alt':
      return node.options.some(hasBackref);
    case 'group':
      return hasBackref(node.body);
    case 'rep':
      return hasBackref(node.body);
  }
}

function firstSet(node: PatternNode): { chars: Set<string> | null } {
  // null = "any character" (classes, dot, backrefs, lookarounds)
  switch (node.type) {
    case 'atom':
      return { chars: node.first === null ? null : new Set(node.first === '' ? [] : [node.first]) };
    case 'group':
      return firstSet(node.body);
    case 'rep':
      return firstSet(node.body);
    case 'alt': {
      let chars: Set<string> | null = new Set();
      for (const opt of node.options) {
        const s = firstSet(opt);
        if (s.chars === null) return { chars: null };
        for (const c of s.chars) chars.add(c);
      }
      return { chars };
    }
    case 'concat': {
      for (const item of node.items) {
        const s = firstSet(item);
        if (s.chars && s.chars.size === 0 && canMatchEmpty(item)) continue;
        return s;
      }
      return { chars: new Set() };
    }
  }
}

function unwrapGroups(node: PatternNode): PatternNode {
  let n = node;
  while (n.type === 'group') n = n.body;
  return n;
}

function findAlternations(node: PatternNode, out: PatternNode[][] = []): PatternNode[][] {
  switch (node.type) {
    case 'alt':
      out.push(node.options);
      for (const opt of node.options) findAlternations(opt, out);
      break;
    case 'group':
      findAlternations(node.body, out);
      break;
    case 'concat':
      for (const item of node.items) findAlternations(item, out);
      break;
    case 'rep':
      findAlternations(node.body, out);
      break;
    case 'atom':
      break;
  }
  return out;
}

function ambiguousAlternation(body: PatternNode): boolean {
  for (const options of findAlternations(unwrapGroups(body))) {
    if (options.length < 2) continue;
    const sets = options.map((o) => firstSet(o).chars);
    for (let a = 0; a < sets.length; a++) {
      for (let b = a + 1; b < sets.length; b++) {
        const sa = sets[a];
        const sb = sets[b];
        if (sa === null || sb === null) return true;
        for (const c of sa) {
          if (sb.has(c)) return true;
        }
      }
    }
  }
  return false;
}

function containsDangerousRepetition(node: PatternNode): boolean {
  switch (node.type) {
    case 'atom':
      return false;
    case 'concat':
      return node.items.some(containsDangerousRepetition);
    case 'alt':
      return node.options.some(containsDangerousRepetition);
    case 'group':
      return containsDangerousRepetition(node.body);
    case 'rep': {
      const unbounded = !Number.isFinite(node.max) || node.max > REPETITION_SOFT_CAP;
      if (
        unbounded &&
        (canMatchEmpty(node.body) || hasFlexibleRep(node.body) || hasBackref(node.body) || ambiguousAlternation(node.body))
      ) {
        return true;
      }
      return containsDangerousRepetition(node.body);
    }
  }
}

/** ReDoS screen for an already-extracted pattern source (no `/pattern/flags` handling). */
function isSafePatternSource(pattern: string): boolean {
  if (pattern.length > MAX_PATTERN_LENGTH) return false;
  try {
    return !containsDangerousRepetition(parsePatternAst(pattern));
  } catch {
    return true;
  }
}

/**
 * Heuristic ReDoS screen. Returns false for patterns whose repetition structure can
 * backtrack catastrophically ((a+)+, (a|a)*, (a*)*, backrefs in loops, …).
 * Unknown/anomalous patterns are allowed through — the RegExp constructor remains
 * the syntax guard — but everything the analyzer understands is screened.
 */
export function isSafeRegexPattern(patternStr: string): boolean {
  if (!patternStr || typeof patternStr !== 'string') return false;
  if (patternStr.length > MAX_PATTERN_LENGTH) return false;
  return isSafePatternSource(splitPattern(patternStr, 'g').pattern);
}

/**
 * Safely compiles a regex pattern string that may be in `/pattern/flags` format or just `pattern`.
 * Returns null for syntactically invalid patterns and for patterns rejected by the
 * ReDoS screen (a bad pattern must never take down the tab).
 */
export function compileRegex(patternStr: string, defaultFlags = 'g'): RegExp | null {
  if (!patternStr) return null;
  try {
    const { pattern, flags } = splitPattern(patternStr, defaultFlags);
    if (!isSafePatternSource(pattern)) {
      console.warn(`[RegexEngine] Rejected regex pattern (catastrophic backtracking risk): "${patternStr}"`);
      return null;
    }
    return new RegExp(pattern, flags);
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

  // Function replacements insert user-authored names literally: a `$` in a
  // character name would otherwise be read as `$&` / `$'` / `$1` and corrupt text.
  let res = text
    // Possessive macros
    .replace(/\{\{\s*char\s*\}\}['’]s/gi, () => `${safeChar}'s`)
    .replace(/\{\{\s*user\s*\}\}['’]s/gi, () => `${safeUser}'s`)
    // Character names
    .replace(/\{\{\s*CHAR\s*\}\}/g, () => safeChar.toUpperCase())
    .replace(/\{\{\s*Char\s*\}\}/g, () => safeChar)
    .replace(/\{\{\s*char\s*\}\}/gi, () => safeChar)
    .replace(/\{\{\s*bot\s*\}\}/gi, () => safeChar)
    .replace(/\{\{\s*char_name\s*\}\}/gi, () => safeChar)
    .replace(/\{\{\s*charIfNotGroup\s*\}\}/gi, () => safeChar)
    // User names
    .replace(/\{\{\s*USER\s*\}\}/g, () => safeUser.toUpperCase())
    .replace(/\{\{\s*User\s*\}\}/g, () => safeUser)
    .replace(/\{\{\s*user\s*\}\}/gi, () => safeUser)
    .replace(/\{\{\s*persona\s*\}\}/gi, () => safeUser)
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

  // This result is consumed as a replacement string by the caller, where the
  // author's own `$1` / `$2` capture references must keep working. So the names
  // are dollar-doubled here: `$$` survives this pass and collapses back to a
  // literal `$` on the next, while `$1` stays live for captures.
  const expandedReplacement = replaceStr
    .replace(/\{\{\s*char\s*\}\}/gi, () => safeChar.split('$').join('$$'))
    .replace(/\{\{\s*user\s*\}\}/gi, () => safeUser.split('$').join('$$'));

  // Shared/sticky regexes carry lastIndex state across calls — always start clean
  // so a previous match can never silently skip or repeat replacements.
  regex.lastIndex = 0;
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

  // Bound the work a hostile script can cause: never run regexes over absurd inputs.
  if (text.length > MAX_REGEX_INPUT_LENGTH) {
    console.warn(`[RegexEngine] Skipping regex scripts: input of ${text.length} chars exceeds the ${MAX_REGEX_INPUT_LENGTH} cap.`);
    return output;
  }

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
      patternStr = patternStr.replace(/\{\{char\}\}/gi, () => ctx.charName!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
    if (ctx.userName) {
      patternStr = patternStr.replace(/\{\{user\}\}/gi, () => ctx.userName!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
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
  // Only at the very start of the reply, and only when the opener is actually
  // assistant boilerplate: "Of course, she knew…" is prose and must survive.
  sanitized = sanitized.replace(/^\s*(?:Certainly|Sure|Of course|Understood|Alright)[!,.]\s*(?:Here(?:['’]s| is) (?:the |your )?(?:continuation|next part|response|reply|scene)[^:\n]*:\s*|I(?:['’]d| would) be happy to[^:\n]*:\s*)/i, '');
  sanitized = sanitized.replace(/^\s*(?:As an AI(?: language model)?|In this roleplay scenario)[^.\n]*[.\n]\s*/i, '');

  // 5. Strip canned sign-offs (end of the reply only)
  sanitized = sanitized.replace(/\s*(?:I hope (?:this|the) (?:response|continuation) (?:meets|pleases|helps)[^.\n]*\.?|Is there anything else (?:I can|you['’]d like me to)[^?\n]*\?)\s*$/i, '');

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
      patternStr = patternStr.replace(/\{\{char\}\}/gi, () => ctx.charName!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }
    if (ctx.userName) {
      patternStr = patternStr.replace(/\{\{user\}\}/gi, () => ctx.userName!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    }

    const rx = compileRegex(patternStr, script.flags || 'g');
    if (!rx) {
      const rejected = patternStr.length <= 2000 && !isSafeRegexPattern(patternStr);
      return {
        result: sampleText,
        matchesCount: 0,
        error: rejected
          ? 'Rejected: this pattern can backtrack catastrophically and hang the page'
          : 'Invalid regular expression',
      };
    }

    rx.lastIndex = 0;
    const matches = sampleText.match(rx);
    const matchesCount = matches ? matches.length : 0;
    const result = performReplacement(sampleText, rx, script.replaceString || '', ctx);

    return { result, matchesCount };
  } catch (err) {
    return { result: sampleText, matchesCount: 0, error: err instanceof Error ? err.message : 'Regex execution failed' };
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
 * Validates and normalizes one untrusted script entry (imported JSON or persisted
 * state). Returns null for entries that are not usable objects. Never trusts types.
 */
export function sanitizeRegexScriptEntry(item: unknown, index = 0): RegexScript | null {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const raw = item as Record<string, unknown>;

  const findRegex = typeof raw.findRegex === 'string' ? raw.findRegex.slice(0, 10_000) : '';
  if (!findRegex.trim()) return null;

  const flagsRaw = typeof raw.flags === 'string' ? raw.flags : 'g';
  const flags = /^[gimsuy]{0,6}$/.test(flagsRaw) ? flagsRaw || 'g' : 'g';

  const scope: RegexScope =
    raw.scope === 'prompt' || raw.scope === 'display' || raw.scope === 'both'
      ? raw.scope
      : Array.isArray(raw.placement)
      ? ((raw.placement as unknown[]).includes(1) && !(raw.placement as unknown[]).includes(2)
          ? 'prompt'
          : (raw.placement as unknown[]).includes(2) && !(raw.placement as unknown[]).includes(1)
          ? 'display'
          : 'both')
      : 'both';
  const target: RegexTarget =
    raw.target === 'assistant' || raw.target === 'user' || raw.target === 'all' ? raw.target : 'all';
  const category: RegexCategory =
    raw.category === 'dialogue' || raw.category === 'sanitizer' || raw.category === 'macro' || raw.category === 'visual' || raw.category === 'custom'
      ? raw.category
      : 'custom';

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.slice(0, 200) : `custom-regex-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    name: (typeof raw.name === 'string' || typeof raw.scriptName === 'string'
      ? String(raw.name || raw.scriptName)
      : `Custom Rule ${index + 1}`
    ).slice(0, 200),
    description: (typeof raw.description === 'string' ? raw.description : 'Imported custom regex rule').slice(0, 500),
    findRegex,
    replaceString: typeof raw.replaceString === 'string' ? raw.replaceString.slice(0, 10_000) : '',
    flags,
    trimStrings: Array.isArray(raw.trimStrings) ? raw.trimStrings.map(String).slice(0, 50) : [],
    scope,
    target,
    enabled: raw.enabled === undefined ? !raw.disabled : Boolean(raw.enabled),
    isPreset: Boolean(raw.isPreset),
    category,
  };
}

/**
 * Imports scripts from JSON (handles both SillyTavern and native formats).
 */
export function importFromRegexJson(jsonString: string): { scripts: RegexScript[]; error?: string } {
  try {
    if (typeof jsonString !== 'string' || jsonString.length > 2_000_000) {
      return { scripts: [], error: 'Import file is too large (2 MB limit)' };
    }
    const parsed = JSON.parse(jsonString);
    if (!Array.isArray(parsed)) {
      return { scripts: [], error: 'JSON content must be an array of regex scripts' };
    }
    if (parsed.length > 500) {
      return { scripts: [], error: 'Too many scripts in one import (500 limit)' };
    }

    const imported: RegexScript[] = [];

    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i];
      if (!item || typeof item !== 'object') continue;

      // SillyTavern format
      if ('findRegex' in item && ('scriptName' in item || 'name' in item)) {
        const sanitized = sanitizeRegexScriptEntry(item, i);
        if (sanitized) imported.push(sanitized);
      }
    }

    return { scripts: imported };
  } catch (err) {
    return { scripts: [], error: err instanceof Error ? err.message : 'Failed to parse JSON file' };
  }
}
