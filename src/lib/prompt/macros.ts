/**
 * Advanced Roleplay Macro Substitution & Text Sanitization Engine
 * Handles {{char}}, {{user}}, case variants, possessives, and fixes common UTF-8 mojibake.
 */

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
    .replace(/â€"/g, '–')
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
 * Replaces all character and user macros with their actual roleplay names.
 * Supports:
 * - {{char}}, {{Char}}, {{CHAR}}, {{char}}'s
 * - {{user}}, {{User}}, {{USER}}, {{user}}'s
 * - <BOT>, <CHAR>, {{bot}}, {{char_name}}
 * - <USER>, {{persona}}, {{user_name}}
 */
export function substituteMacros(
  text: string,
  charName: string = 'Character',
  userName: string = 'User'
): string {
  if (!text) return '';

  const safeChar = (charName || 'Character').trim();
  const safeUser = (userName || 'User').trim();

  // 1. Possessive macros first (e.g. {{char}}'s or {{user}}'s)
  let result = text
    .replace(/\{\{\s*char\s*\}\}['’]s/gi, `${safeChar}'s`)
    .replace(/\{\{\s*user\s*\}\}['’]s/gi, `${safeUser}'s`)
    .replace(/<BOT>['’]s/gi, `${safeChar}'s`)
    .replace(/<USER>['’]s/gi, `${safeUser}'s`)
    .replace(/<CHAR>['’]s/gi, `${safeChar}'s`);

  // 2. Character macros with casing awareness
  result = result
    .replace(/\{\{\s*CHAR\s*\}\}/g, safeChar.toUpperCase())
    .replace(/\{\{\s*Char\s*\}\}/g, safeChar)
    .replace(/\{\{\s*char\s*\}\}/gi, safeChar)
    .replace(/\{\{\s*bot\s*\}\}/gi, safeChar)
    .replace(/\{\{\s*char_name\s*\}\}/gi, safeChar)
    .replace(/<BOT>/gi, safeChar)
    .replace(/<CHAR>/gi, safeChar);

  // 3. User / Persona macros with casing awareness
  result = result
    .replace(/\{\{\s*USER\s*\}\}/g, safeUser.toUpperCase())
    .replace(/\{\{\s*User\s*\}\}/g, safeUser)
    .replace(/\{\{\s*user\s*\}\}/gi, safeUser)
    .replace(/\{\{\s*persona\s*\}\}/gi, safeUser)
    .replace(/\{\{\s*user_name\s*\}\}/gi, safeUser)
    .replace(/<USER>/gi, safeUser);

  return result;
}

/**
 * Complete pipeline for roleplay text:
 * 1. Repairs encoding / mojibake
 * 2. Replaces macros ({{char}}, {{user}}, etc.)
 */
export function formatRoleplayText(
  text: string,
  charName: string = 'Character',
  userName: string = 'User'
): string {
  if (!text) return '';
  const cleaned = repairMojibake(text);
  return substituteMacros(cleaned, charName, userName);
}
