/**
 * SillyTavern-Compatible World Info (Lorebook) Engine
 *
 * Implements:
 * - Primary & secondary keyword matching (exact, substring, or /regex/flags)
 * - Selective logic: AND_ANY (0), NOT_ALL (1), NOT_ANY (2), AND_ALL (3)
 * - Whole word boundary matching (\b)
 * - Case sensitivity toggle
 * - Constant entries (always active)
 * - Multi-turn scan depth (scanning latest N messages)
 * - Global context scanning (char description, personality, scenario, user persona)
 * - Recursive scanning (activated entries can trigger further entries up to recursion limit)
 * - Delay until recursion
 * - Token budget enforcement with priority/order sorting
 * - Position routing: 'before_char' (worldInfoBefore), 'after_char' (worldInfoAfter), 'at_depth' (in-chat)
 */

import { estimateTokens } from '@/lib/prompt/tokens';
import type { LorebookEntry } from '@/lib/supabase/types';

export enum SelectiveLogic {
  AND_ANY = 0,
  NOT_ALL = 1,
  NOT_ANY = 2,
  AND_ALL = 3,
}

export interface WorldInfoScanEntry extends Partial<LorebookEntry> {
  id?: string;
  title?: string;
  keys: string[];
  secondary_keys?: string[];
  content: string;
  constant?: boolean;
  enabled?: boolean;
  priority?: number;
  insertion_order?: number;
  case_sensitive?: boolean;
  match_whole_words?: boolean;
  selective?: boolean;
  selective_logic?: number; // 0: AND_ANY, 1: NOT_ALL, 2: NOT_ANY, 3: AND_ALL
  position?: 'before_char' | 'after_char' | 'at_depth';
  depth?: number;
  order?: number;
  delay_until_recursion?: boolean;
}

export interface ScanContext {
  chatMessages: Array<{ role: string; content: string }>;
  scanDepth?: number;
  tokenBudget?: number;
  maxRecursionSteps?: number;
  globalScanData?: {
    charDescription?: string;
    charPersonality?: string;
    scenario?: string;
    personaDescription?: string;
    userMessage?: string;
  };
}

export interface ActivatedLore {
  worldInfoBefore: WorldInfoScanEntry[];
  worldInfoAfter: WorldInfoScanEntry[];
  inChatEntries: Array<WorldInfoScanEntry & { depth: number; order: number }>;
  allActivated: WorldInfoScanEntry[];
  totalTokens: number;
}

/**
 * Escapes regex special characters
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Checks if a pattern is a regex in /pattern/flags format
 */
function parseRegex(key: string): RegExp | null {
  const match = key.match(/^\/(.+)\/([gimsuy]*)$/);
  if (match) {
    try {
      return new RegExp(match[1], match[2]);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Checks if a specific key triggers on the given text
 */
function testKey(key: string, text: string, caseSensitive: boolean, matchWholeWords: boolean): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;

  // 1. Regex key format /pattern/flags
  const regex = parseRegex(trimmed);
  if (regex) {
    return regex.test(text);
  }

  // 2. Exact word / phrase match with whole-word or substring
  const flags = caseSensitive ? '' : 'i';
  const escaped = escapeRegex(trimmed);
  const pattern = matchWholeWords ? `\\b${escaped}\\b` : escaped;

  try {
    const re = new RegExp(pattern, flags);
    return re.test(text);
  } catch {
    // Fallback simple includes if regex compile fails
    const targetText = caseSensitive ? text : text.toLowerCase();
    const searchKey = caseSensitive ? trimmed : trimmed.toLowerCase();
    return targetText.includes(searchKey);
  }
}

/**
 * Tests primary & secondary keys according to selective logic:
 * - AND_ANY (0): at least 1 primary key AND at least 1 secondary key match.
 * - NOT_ALL (1): at least 1 primary key matches AND NOT ALL secondary keys match.
 * - NOT_ANY (2): at least 1 primary key matches AND NO secondary key matches (exclusion).
 * - AND_ALL (3): at least 1 primary key matches AND ALL secondary keys match.
 */
function isEntryTriggered(
  entry: WorldInfoScanEntry,
  text: string
): boolean {
  if (entry.constant) return true;
  if (!entry.keys || entry.keys.length === 0) return false;

  const caseSensitive = Boolean(entry.case_sensitive);
  const matchWholeWords = entry.match_whole_words !== false; // Default true in modern ST

  // Primary keys test: ANY primary key must match
  const primaryMatched = entry.keys.some((k) => testKey(k, text, caseSensitive, matchWholeWords));
  if (!primaryMatched) return false;

  // If no secondary keys or selective is disabled, primary match is sufficient
  const secondaries = (entry.secondary_keys || []).map((k) => k.trim()).filter(Boolean);
  if (secondaries.length === 0 || entry.selective === false) {
    return true;
  }

  const logic = entry.selective_logic ?? SelectiveLogic.AND_ANY;
  const secondaryMatches = secondaries.map((k) => testKey(k, text, caseSensitive, matchWholeWords));
  const matchedCount = secondaryMatches.filter(Boolean).length;

  switch (logic) {
    case SelectiveLogic.AND_ANY:
      return matchedCount > 0;
    case SelectiveLogic.NOT_ALL:
      return matchedCount < secondaries.length;
    case SelectiveLogic.NOT_ANY:
      return matchedCount === 0;
    case SelectiveLogic.AND_ALL:
      return matchedCount === secondaries.length;
    default:
      return matchedCount > 0;
  }
}

/**
 * Executes a full SillyTavern-compatible World Info scan across conversation and context.
 */
export function scanWorldInfo(
  entries: WorldInfoScanEntry[],
  context: ScanContext
): ActivatedLore {
  const {
    chatMessages,
    scanDepth = 4,
    tokenBudget = 1200,
    maxRecursionSteps = 2,
    globalScanData = {},
  } = context;

  const activeEntries = entries.filter((e) => e.enabled !== false);
  if (!activeEntries.length) {
    return {
      worldInfoBefore: [],
      worldInfoAfter: [],
      inChatEntries: [],
      allActivated: [],
      totalTokens: 0,
    };
  }

  // 1. Compile initial text buffer: recent chat messages up to scanDepth + global context
  const recentMessages = chatMessages.slice(-scanDepth).map((m) => m.content || '');
  const globalChunks = [
    globalScanData.userMessage || '',
    globalScanData.charDescription || '',
    globalScanData.charPersonality || '',
    globalScanData.scenario || '',
    globalScanData.personaDescription || '',
  ].filter(Boolean);

  let currentScanBuffer = [...recentMessages, ...globalChunks].join('\n\n');

  const activatedSet = new Map<string, WorldInfoScanEntry>();
  const entryKey = (e: WorldInfoScanEntry, idx: number) => e.id || `${e.title || 'entry'}-${idx}`;

  // 2. Initial Scan Pass
  let newlyActivatedThisCycle: WorldInfoScanEntry[] = [];
  for (let idx = 0; idx < activeEntries.length; idx++) {
    const entry = activeEntries[idx];
    const key = entryKey(entry, idx);

    // If entry is marked delay_until_recursion, skip initial pass
    if (entry.delay_until_recursion && !entry.constant) {
      continue;
    }

    if (isEntryTriggered(entry, currentScanBuffer)) {
      activatedSet.set(key, entry);
      newlyActivatedThisCycle.push(entry);
    }
  }

  // 3. Recursive Scanning Passes
  let recursionCount = 0;
  while (recursionCount < maxRecursionSteps && newlyActivatedThisCycle.length > 0) {
    recursionCount++;

    // Append newly activated entry contents into scan buffer
    const newContent = newlyActivatedThisCycle.map((e) => e.content || '').join('\n\n');
    currentScanBuffer += '\n\n' + newContent;
    newlyActivatedThisCycle = [];

    // Scan remaining unactivated entries
    for (let idx = 0; idx < activeEntries.length; idx++) {
      const entry = activeEntries[idx];
      const key = entryKey(entry, idx);

      if (activatedSet.has(key)) continue;

      if (isEntryTriggered(entry, currentScanBuffer)) {
        activatedSet.set(key, entry);
        newlyActivatedThisCycle.push(entry);
      }
    }
  }

  // 4. Sort activated entries by priority/insertion_order descending
  const sortedActivated = Array.from(activatedSet.values()).sort((a, b) => {
    const priorityA = a.priority ?? a.insertion_order ?? 100;
    const priorityB = b.priority ?? b.insertion_order ?? 100;
    return priorityB - priorityA;
  });

  // 5. Apply Token Budget
  let usedTokens = 0;
  const budgetedEntries: WorldInfoScanEntry[] = [];

  for (const entry of sortedActivated) {
    const content = entry.content || '';
    const cost = estimateTokens(content) + estimateTokens(entry.title || '') + 4;
    if (usedTokens + cost > tokenBudget && budgetedEntries.length > 0) {
      continue; // Skip if budget exceeded
    }
    budgetedEntries.push(entry);
    usedTokens += cost;
  }

  // 6. Partition into position buckets
  const worldInfoBefore: WorldInfoScanEntry[] = [];
  const worldInfoAfter: WorldInfoScanEntry[] = [];
  const inChatEntries: Array<WorldInfoScanEntry & { depth: number; order: number }> = [];

  for (const entry of budgetedEntries) {
    const pos = entry.position || 'before_char';
    if (pos === 'before_char') {
      worldInfoBefore.push(entry);
    } else if (pos === 'after_char') {
      worldInfoAfter.push(entry);
    } else if (pos === 'at_depth') {
      inChatEntries.push({
        ...entry,
        depth: typeof entry.depth === 'number' ? entry.depth : 4,
        order: typeof entry.order === 'number' ? entry.order : 100,
      });
    }
  }

  return {
    worldInfoBefore,
    worldInfoAfter,
    inChatEntries,
    allActivated: budgetedEntries,
    totalTokens: usedTokens,
  };
}
