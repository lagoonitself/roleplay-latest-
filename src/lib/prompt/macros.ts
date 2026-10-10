/**
 * Advanced Roleplay Macro Substitution & Text Sanitization Engine (SillyTavern Compatible)
 *
 * Supports:
 * - {{char}}, {{Char}}, {{CHAR}}, {{char}}'s, {{bot}}, {{char_name}}, <BOT>, <CHAR>
 * - {{user}}, {{User}}, {{USER}}, {{user}}'s, {{persona}}, {{user_name}}, <USER>
 * - {{charIfNotGroup}}
 * - {{description}}, {{personality}}, {{scenario}}, {{persona_description}}
 * - {{lastMessage}}, {{lastUserMessage}}, {{lastCharMessage}}   (volatile)
 * - {{time}}, {{date}}, {{weekday}}, {{isotime}}, {{isodate}},
 *   {{datetimeformat YYYY-MM-DD}}                                (volatile)
 * - {{random::a::b::c}} and {{random:a,b,c}}                     (volatile — re-rolls)
 * - {{pick::a::b::c}}            stable pick: same text always yields the same choice
 * - {{roll::1d20}}, {{roll 2d6+3}}                               (volatile)
 * - {{newline}}, {{trim}}, {{noop}}, {{//comment}}
 * - UTF-8 / Windows-1252 mojibake repair
 *
 * Volatile macros are deliberately NOT expanded in stored history (see `formatHistoryText`),
 * so a message that said "{{roll::1d20}}" doesn't silently change its roll on every turn.
 */

export interface MacroContext {
  charName?: string;
  userName?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  personaDescription?: string;
  lastMessage?: string;
  lastUserMessage?: string;
  lastCharMessage?: string;
}

/**
 * Repairs common UTF-8 / Windows-1252 mojibake artifacts from imported cards or bad encoding
 */
export function repairMojibake(text: string): string {
  if (!text) return '';

  return text
    // Em dash (—)
    .replace(/â\u0080\u0094/g, '—')
    .replace(/\u00e2\u0080\u0094/g, '—')
    .replace(/â€"/g, '—')
    .replace(/â\x00\x00/g, '—')
    // En dash (–)
    .replace(/â\u0080\u0093/g, '–')
    .replace(/\u00e2\u0080\u0093/g, '–')
    // Left & right double curly quotes (“ ”)
    .replace(/â\u0080\u009c/g, '“')
    .replace(/â\u0080\u009d/g, '”')
    .replace(/\u00e2\u0080\u009c/g, '“')
    .replace(/\u00e2\u0080\u009d/g, '”')
    .replace(/â€œ/g, '“')
    .replace(/â€/g, '”')
    // Left & right single curly quotes / apostrophes (‘ ’)
    .replace(/â\u0080\u0098/g, '‘')
    .replace(/â\u0080\u0099/g, '’')
    .replace(/\u00e2\u0080\u0098/g, '‘')
    .replace(/\u00e2\u0080\u0099/g, '’')
    .replace(/â€™/g, '’')
    .replace(/â€˜/g, '‘')
    // Ellipsis (…)
    .replace(/â\u0080\u00a6/g, '…')
    .replace(/\u00e2\u0080\u00a6/g, '…')
    .replace(/â€¦/g, '…')
    // Broken non-breaking spaces
    .replace(/â\u00a0/g, ' ')
    // Replace remaining isolated â followed by corrupted symbols or brackets
    .replace(/â[\u0000-\u001f\u007f-\u009f]+/g, '—')
    .replace(/\uFFFD/g, '');
}

/**
 * Evaluates dice roll expressions like 1d20, 2d6, 3d8+2
 */
function evaluateDiceRoll(rollStr: string): number {
  const match = rollStr.trim().match(/^(\d+)d(\d+)(?:([+-])(\d+))?$/i);
  if (!match) return 0;
  const count = parseInt(match[1], 10);
  const sides = parseInt(match[2], 10);
  const modifierSign = match[3];
  const modifierVal = match[4] ? parseInt(match[4], 10) : 0;

  let total = 0;
  for (let i = 0; i < count; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }

  if (modifierSign === '+') total += modifierVal;
  if (modifierSign === '-') total -= modifierVal;
  return total;
}

export interface MacroOptions {
  /**
   * When false, only deterministic macros are expanded (names, possessives, character
   * metadata). Volatile macros — {{time}}, {{date}}, {{random::…}}, {{roll::…}},
   * {{lastMessage}} — are left untouched.
   *
   * This matters for stored history: re-expanding {{random::a,b}} or {{roll::1d20}}
   * on every turn would silently rewrite the past with a new value, and re-expanding
   * {{time}} would rewrite the hour a past exchange happened.
   */
  volatile?: boolean;
}

/**
 * Replaces all character, user, time, random, and environment macros.
 * Conforms to SillyTavern's macro specifications.
 */
export function substituteMacros(
  text: string,
  charNameOrContext: string | MacroContext = 'Character',
  userFallbackName: string = 'User',
  options: MacroOptions = {}
): string {
  if (!text) return '';
  const volatile = options.volatile ?? true;

  const ctx: MacroContext = typeof charNameOrContext === 'string'
    ? { charName: charNameOrContext, userName: userFallbackName }
    : charNameOrContext;

  const safeChar = (ctx.charName || 'Character').trim();
  const safeUser = (ctx.userName || 'User').trim();
  const now = new Date();

  // NOTE ON REPLACEMENTS: `String.replace` parses its replacement string for
  // `$&`, `$'`, `` $` ``, `$$` and `$1`…`$n`. Every value below is user-authored
  // free text (character names, descriptions, pasted bios), so each is passed as
  // a function to be inserted literally — otherwise a single `$'` in a character
  // description silently injects the rest of the template into the output.

  // 1. Possessive macros first (e.g. {{char}}'s or {{user}}'s)
  let result = text
    .replace(/\{\{\s*char\s*\}\}['’]s/gi, () => `${safeChar}'s`)
    .replace(/\{\{\s*user\s*\}\}['’]s/gi, () => `${safeUser}'s`)
    .replace(/<BOT>['’]s/gi, () => `${safeChar}'s`)
    .replace(/<USER>['’]s/gi, () => `${safeUser}'s`)
    .replace(/<CHAR>['’]s/gi, () => `${safeChar}'s`);

  // 2. Character macros with casing awareness
  result = result
    .replace(/\{\{\s*CHAR\s*\}\}/g, () => safeChar.toUpperCase())
    .replace(/\{\{\s*Char\s*\}\}/g, () => safeChar)
    .replace(/\{\{\s*char\s*\}\}/gi, () => safeChar)
    .replace(/\{\{\s*bot\s*\}\}/gi, () => safeChar)
    .replace(/\{\{\s*char_name\s*\}\}/gi, () => safeChar)
    .replace(/\{\{\s*charIfNotGroup\s*\}\}/gi, () => safeChar)
    .replace(/<BOT>/gi, () => safeChar)
    .replace(/<CHAR>/gi, () => safeChar);

  // 3. User / Persona macros with casing awareness
  result = result
    .replace(/\{\{\s*USER\s*\}\}/g, () => safeUser.toUpperCase())
    .replace(/\{\{\s*User\s*\}\}/g, () => safeUser)
    .replace(/\{\{\s*user\s*\}\}/gi, () => safeUser)
    .replace(/\{\{\s*persona\s*\}\}/gi, () => safeUser)
    .replace(/\{\{\s*user_name\s*\}\}/gi, () => safeUser)
    .replace(/<USER>/gi, () => safeUser);

  // 4. Character & Persona metadata macros
  if (ctx.description !== undefined) {
    result = result.replace(/\{\{\s*description\s*\}\}/gi, () => ctx.description!);
  }
  if (ctx.personality !== undefined) {
    result = result.replace(/\{\{\s*personality\s*\}\}/gi, () => ctx.personality!);
  }
  if (ctx.scenario !== undefined) {
    result = result.replace(/\{\{\s*scenario\s*\}\}/gi, () => ctx.scenario!);
  }
  if (ctx.personaDescription !== undefined) {
    result = result.replace(/\{\{\s*persona_description\s*\}\}/gi, () => ctx.personaDescription!);
  }

  // 5–7. Volatile macros: message tracking, time, random, dice. Skipped for stored text.
  if (volatile) {
    // 5. Message tracking macros
    if (ctx.lastMessage !== undefined) {
      result = result.replace(/\{\{\s*lastMessage\s*\}\}/gi, () => ctx.lastMessage!);
    }
    if (ctx.lastUserMessage !== undefined) {
      result = result.replace(/\{\{\s*lastUserMessage\s*\}\}/gi, () => ctx.lastUserMessage!);
    }
    if (ctx.lastCharMessage !== undefined) {
      result = result.replace(/\{\{\s*lastCharMessage\s*\}\}/gi, () => ctx.lastCharMessage!);
    }

    // 6. Time and Date macros
    result = result
      .replace(/\{\{\s*time\s*\}\}/gi, now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))
      .replace(/\{\{\s*date\s*\}\}/gi, now.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }))
      .replace(/\{\{\s*weekday\s*\}\}/gi, now.toLocaleDateString([], { weekday: 'long' }))
      .replace(/\{\{\s*isodate\s*\}\}/gi, now.toISOString().split('T')[0]);

    // 7. Dynamic Random and Dice Roll macros
    // {{random::a::b::c}} or {{random:a,b,c}} — SillyTavern accepts both separators,
    // and the choice is re-rolled on every evaluation.
    result = result.replace(/\{\{\s*random(?:::|[:,]\s*)([^}]+)\}\}/gi, (_match, group: string) => {
      const choices = group.split(/::|,/).map((s) => s.trim()).filter(Boolean);
      if (!choices.length) return '';
      return choices[Math.floor(Math.random() * choices.length)];
    });

    // {{roll 1d20}}, {{roll::1d20}}, {{roll 2d6+3}}
    result = result.replace(/\{\{\s*roll(?:::|\s+)([0-9dD+-]+)\}\}/gi, (_match, rollExpression: string) => {
      return String(evaluateDiceRoll(rollExpression));
    });
  }

  // 8. {{pick::a::b::c}} — a *stable* random choice (SillyTavern semantics: same text and
  // position always yields the same pick, so stored history is never rewritten).
  let pickIndex = 0;
  result = result.replace(/\{\{\s*pick(?:::|[:,]\s*)([^}]+)\}\}/gi, (_match, group: string) => {
    const choices = group.split(/::|,/).map((s) => s.trim()).filter(Boolean);
    if (!choices.length) return '';
    const seed = hashString(`${text}|${pickIndex++}|${choices.join('|')}`);
    return choices[seed % choices.length];
  });

  // 9. {{datetimeformat YYYY}} / {{isotime}} / {{newline}} / {{noop}} / {{//comments}}
  result = result
    .replace(/\{\{\s*datetimeformat\s+([^}]+)\}\}/gi, (_match, fmt: string) => formatDateTime(now, fmt.trim()))
    .replace(/\{\{\s*isotime\s*\}\}/gi, now.toTimeString().slice(0, 5))
    .replace(/\{\{\s*newline\s*\}\}/gi, '\n')
    .replace(/\{\{\s*\/\/[^}]*\}\}/g, '')
    .replace(/\{\{\s*noop\s*\}\}/gi, '')
    .replace(/\{\{\s*trim\s*\}\}/gi, '');

  return result;
}

/** Small deterministic string hash, used to make {{pick::…}} stable. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const DATE_TOKENS: Array<[RegExp, (d: Date) => string]> = [
  [/YYYY/g, (d) => String(d.getFullYear())],
  [/MMMM/g, (d) => d.toLocaleDateString([], { month: 'long' })],
  [/MMM/g, (d) => d.toLocaleDateString([], { month: 'short' })],
  [/MM/g, (d) => String(d.getMonth() + 1).padStart(2, '0')],
  [/DD/g, (d) => String(d.getDate()).padStart(2, '0')],
  [/HH/g, (d) => String(d.getHours()).padStart(2, '0')],
  [/mm/g, (d) => String(d.getMinutes()).padStart(2, '0')],
];

function formatDateTime(date: Date, format: string): string {
  let out = format;
  for (const [pattern, render] of DATE_TOKENS) out = out.replace(pattern, render(date));
  return out;
}

/**
 * Complete pipeline for roleplay text:
 * 1. Repairs encoding / mojibake
 * 2. Replaces macros ({{char}}, {{user}}, time, dice, random, etc.)
 */
export function formatRoleplayText(
  text: string,
  charNameOrContext: string | MacroContext = 'Character',
  userFallbackName: string = 'User',
  options: MacroOptions = {}
): string {
  if (!text) return '';
  const cleaned = repairMojibake(text);
  return substituteMacros(cleaned, charNameOrContext, userFallbackName, options);
}

/**
 * Formatting for *stored* history (messages that already happened).
 * Repairs encoding and expands only deterministic macros, so the past is never
 * silently rewritten when a message is re-read on a later turn.
 */
export function formatHistoryText(
  text: string,
  charNameOrContext: string | MacroContext = 'Character',
  userFallbackName: string = 'User'
): string {
  return formatRoleplayText(text, charNameOrContext, userFallbackName, { volatile: false });
}

/**
 * Joins a "Continue" generation onto the reply it extends (SillyTavern's
 * continue postfix, made automatic): no separator when either side already has
 * whitespace or the addition opens with punctuation, otherwise a single space.
 */
export function joinContinuation(base: string, addition: string): string {
  if (!base) return addition;
  if (!addition) return base;
  if (/\s$/.test(base) || /^\s/.test(addition) || /^[,.;:!?…'’”)\]—-]/.test(addition)) {
    return base + addition;
  }
  return `${base} ${addition}`;
}
