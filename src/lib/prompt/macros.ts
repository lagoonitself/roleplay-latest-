/**
 * Advanced Roleplay Macro Substitution & Text Sanitization Engine (SillyTavern Compatible)
 * 
 * Supports:
 * - {{char}}, {{Char}}, {{CHAR}}, {{char}}'s, {{bot}}, {{char_name}}, <BOT>, <CHAR>
 * - {{user}}, {{User}}, {{USER}}, {{user}}'s, {{persona}}, {{user_name}}, <USER>
 * - {{charIfNotGroup}}
 * - {{description}}, {{personality}}, {{scenario}}, {{persona_description}}
 * - {{lastMessage}}, {{lastUserMessage}}, {{lastCharMessage}}
 * - {{time}}, {{date}}, {{weekday}}, {{isodate}}
 * - {{random::a,b,c}}
 * - {{roll::XdY}} (e.g. {{roll::1d20}}, {{roll::2d6+3}})
 * - {{trim}}
 * - UTF-8 / Windows-1252 mojibake repair
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

/**
 * Replaces all character, user, time, random, and environment macros.
 * Conforms to SillyTavern's macro specifications.
 */
export function substituteMacros(
  text: string,
  charNameOrContext: string | MacroContext = 'Character',
  userFallbackName: string = 'User'
): string {
  if (!text) return '';

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
  // {{random::a,b,c}} — function replacement inserts the choice literally
  result = result.replace(/\{\{\s*random::([^}]+)\}\}/gi, (_match, group: string) => {
    const choices = group.split(',').map((s) => s.trim()).filter(Boolean);
    if (!choices.length) return '';
    return choices[Math.floor(Math.random() * choices.length)];
  });

  // {{roll::XdY}} or {{roll::XdY+Z}}
  result = result.replace(/\{\{\s*roll::([0-9dD+-]+)\}\}/gi, (_match, rollExpression: string) => {
    return String(evaluateDiceRoll(rollExpression));
  });

  // {{trim}}
  result = result.replace(/\{\{\s*trim\s*\}\}/gi, '');

  return result;
}

/**
 * Complete pipeline for roleplay text:
 * 1. Repairs encoding / mojibake
 * 2. Replaces macros ({{char}}, {{user}}, time, dice, random, etc.)
 */
export function formatRoleplayText(
  text: string,
  charNameOrContext: string | MacroContext = 'Character',
  userFallbackName: string = 'User'
): string {
  if (!text) return '';
  const cleaned = repairMojibake(text);
  return substituteMacros(cleaned, charNameOrContext, userFallbackName);
}
