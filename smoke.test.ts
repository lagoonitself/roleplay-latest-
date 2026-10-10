/* Temporary smoke test for the prompt + memory engine pure logic. */
import { substituteMacros, formatHistoryText, formatRoleplayText } from './src/lib/prompt/macros';
import { computeContextBudget, estimateTokens, truncateToTokensMiddle, MAX_HISTORY_TOKENS } from './src/lib/prompt/tokens';
import { shouldRunMemoryPass, cleanSummaryOutput } from './src/lib/memory/engine';
import { analyzeQuery, scoreMemory } from './src/lib/memory/vectors';
import { buildSystemPrompt } from './src/lib/prompt/system-prompt';
import { joinContinuation } from './src/lib/prompt/macros';
import { sanitizeModelOutput } from './src/lib/formatter/regex-engine';
import { assemblePrompt } from './src/lib/prompt/assembler';
import type { Memory, Message, Character } from './src/lib/supabase/types';

let failures = 0;
const check = (name: string, cond: boolean, detail?: string) => {
  if (cond) console.log(`  ok   ${name}`);
  else {
    failures++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

console.log('macros');
{
  const ctx = { charName: 'Seraphine', userName: 'Ava' };
  check('names expand', substituteMacros('{{char}} waves at {{user}}.', ctx) === 'Seraphine waves at Ava.');
  check('possessives expand', substituteMacros("{{char}}'s hand", ctx) === "Seraphine's hand");
  check('dollar-safe names', substituteMacros('{{char}}', { charName: "M$&ria" }) === 'M$&ria');
  check('random picks a choice', ['a', 'b', 'c'].includes(substituteMacros('{{random::a::b::c}}', ctx)));
  check('random comma syntax', ['a', 'b'].includes(substituteMacros('{{random:a,b}}', ctx)));
  const roll = Number(substituteMacros('{{roll 1d20}}', ctx));
  check('roll in range', roll >= 1 && roll <= 20, String(roll));
  const roll2 = Number(substituteMacros('{{roll::2d6+3}}', ctx));
  check('roll modifier', roll2 >= 5 && roll2 <= 15, String(roll2));
  const p1 = substituteMacros('{{pick::red::green::blue}} hat', ctx);
  const p2 = substituteMacros('{{pick::red::green::blue}} hat', ctx);
  check('pick is stable', p1 === p2 && /red|green|blue/.test(p1), `${p1} vs ${p2}`);
  check('comments stripped', substituteMacros('hi{{//ignore me}} there', ctx) === 'hi there');
  check('newline macro', substituteMacros('a{{newline}}b', ctx) === 'a\nb');
  check('isodate', /\d{4}-\d{2}-\d{2}/.test(substituteMacros('{{isodate}}', ctx)));
  check('datetimeformat', /\d{4}/.test(substituteMacros('{{datetimeformat YYYY}}', ctx)));
  check('history keeps volatile macros', formatHistoryText('I rolled {{roll 1d20}} at {{time}}', ctx).includes('{{roll 1d20}}'));
  check('history still expands names', formatHistoryText('{{char}} nods', ctx) === 'Seraphine nods');
  check('live text expands volatile', formatRoleplayText('{{char}} rolled {{roll 1d20}}', ctx).startsWith('Seraphine rolled '));
}

console.log('budget');
{
  const big = computeContextBudget({ model: 'deepseek-v4.1-flash', maxResponseTokens: 1200, prefixTokens: 6000, requestedRecallTokens: 2000 });
  check('history capped on big windows', big.historyBudget === MAX_HISTORY_TOKENS, String(big.historyBudget));
  check('recall gets what it asked for', big.recallBudget === 2000, String(big.recallBudget));
  const tiny = computeContextBudget({ model: 'unknown-mini-model-8k', maxResponseTokens: 800, prefixTokens: 4000, requestedRecallTokens: 3000 });
  check('min history respected', tiny.historyBudget >= 1200, String(tiny.historyBudget));
  check('tiny window still leaves recall room', tiny.recallBudget > 0, String(tiny.recallBudget));
  const mid = truncateToTokensMiddle('A'.repeat(400) + '\n\nSTORY: head\n\nKEY FACTS: tail-important', 40);
  check('middle truncation keeps tail', mid.includes('tail-important'), mid);
}

console.log('recall');
{
  const profile = analyzeQuery('Seraphine handed the signet ring back to Marcus at the docks.');
  check('extracts names', profile.names.includes('Seraphine') && profile.names.includes('Marcus'), JSON.stringify(profile.names));
  const mk = (content: string, entities: string[], importance: number, days: number): Memory => ({
    id: `m-${content.slice(0, 6)}`,
    chat_id: 'c',
    user_id: 'u',
    content,
    kind: 'fact',
    entities,
    importance,
    embedding: null,
    pinned: false,
    source_message_ids: [],
    superseded_by: null,
    access_count: 0,
    last_accessed_at: null,
    created_at: new Date(Date.now() - days * 86_400_000).toISOString(),
    updated_at: new Date().toISOString(),
  });
  const relevant = mk('Seraphine gave Marcus the signet ring at the docks.', ['Seraphine', 'Marcus', 'signet ring'], 8, 100);
  const noise = mk('Ava prefers tea over coffee in the mornings.', ['Ava'], 5, 100);
  const sRel = scoreMemory(relevant, profile);
  const sNoise = scoreMemory(noise, profile);
  check('relevant outranks noise', sRel > sNoise, `${sRel} vs ${sNoise}`);
  check('noise below threshold', sNoise < 0.25, String(sNoise));
}

console.log('memory pass trigger');
{
  const msgs = (n: number): Message[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `msg-${i}`,
      chat_id: 'c',
      user_id: 'u',
      parent_id: null,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message number ${i} with a little story text`,
      reasoning: null,
      status: 'done',
      meta: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })) as Message[];

  const early = shouldRunMemoryPass({ history: msgs(3), hasSummary: true });
  check('no run below interval', !early.run, early.reason);
  const interval = shouldRunMemoryPass({ history: msgs(12), hasSummary: true, cursorMessageId: 'msg-1' });
  check('runs at interval', interval.run && interval.delta.length === 10, `${interval.reason} delta=${interval.delta.length}`);
  const noSummary = shouldRunMemoryPass({ history: msgs(7), hasSummary: false });
  check('runs when no summary yet', noSummary.run, noSummary.reason);
  const pressure = shouldRunMemoryPass({
    history: msgs(200),
    hasSummary: true,
    cursorMessageId: 'msg-150',
    historyTokenBudget: 100,
  });
  check('runs under context pressure', pressure.run, pressure.reason);
  check('summary cleanup', cleanSummaryOutput('[Summary: the party left town]') === 'the party left town');
}

console.log('system prompt + assembly');
{
  const sp = buildSystemPrompt({ charName: 'Seraphine', userName: 'Ava', contentRating: 'explicit', pov: '2nd', tense: 'present', verbosity: 'medium' });
  check('priority block present', sp.includes('<priority>'));
  check('content hard limit present', sp.includes('under 18'));
  check('verbosity guide present', sp.includes('150–350 words'));

  const character = {
    id: 'char-1',
    user_id: 'u',
    name: 'Seraphine',
    tagline: 'cartographer',
    description: 'A cartographer with a debt. {{char}} never smiles first.',
    personality: 'Guarded, dry wit.',
    scenario: 'A rain-soaked harbour town.',
    first_message: '*{{char}} looks up.* "You again."',
    alternate_greetings: [],
    example_dialogue: '<START>\n{{user}}: hi\n{{char}}: "Hm."',
    speech_style: 'Terse.',
    system_prompt: '',
    post_history_instructions: 'Keep it slow.',
    tags: [],
    content_rating: 'mature',
    behavior: { pov: '2nd', tense: 'present', verbosity: 'medium' },
    generation: {},
    accent_color: null,
    avatar_url: null,
    created_at: '',
    updated_at: '',
  } as unknown as Character;

  const history: Message[] = Array.from({ length: 30 }, (_, i) => ({
    id: `m${i}`,
    chat_id: 'c',
    user_id: 'u',
    parent_id: null,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: i % 2 === 0 ? `turn ${i} — I check the map and say something with {{random::red::blue}} in it.` : `reply ${i} *Seraphine nods* "Noted."`,
    reasoning: null,
    status: 'done',
    meta: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })) as Message[];

  const messages = assemblePrompt({
    character,
    persona: { id: 'p', user_id: 'u', name: 'Ava', avatar_url: null, description: 'A spy with a broken compass.', is_default: false, created_at: '', updated_at: '' },
    history,
    summary: { id: 's', chat_id: 'c', user_id: 'u', level: 'chunk', content: 'STORY: they met.\nNOW: the docks.\nRELATIONSHIP: wary.\nOPEN THREADS: the ring.\nKEY FACTS: Seraphine is a cartographer.', message_ids: [], last_message_id: null, token_estimate: 10, user_edited: false, superseded: false, created_at: '', updated_at: '' },
    authorsNote: 'Focus on subtext.',
    latestUserMessage: 'I hand her the ring.',
  });

  const joined = messages.map((m) => m.content).join('\n---\n');
  check('system prefix first', messages[0].role === 'system' && messages[0].content.includes('<character'));
  check('summary injected', joined.includes('[Summary:'));
  check('author note injected', joined.includes("[Author's note: Focus on subtext.]"));
  check('post-history reminder last', joined.trimEnd().endsWith('</character_reminder>'));
  check('no volatile re-roll in history', joined.includes('{{random::red::blue}}'));
  check('example chat marker', joined.includes('[Example Chat]'));
  check('macros expanded in character', joined.includes('Seraphine never smiles first'));
  const roles = messages.map((m) => m.role);
  check('no stray empty messages', messages.every((m) => m.content.trim().length > 0));
  check('ends on user turn', roles[roles.length - 1] === 'user');
  console.log(`  info roles: ${roles.join(',')}`);

  // ── prompt wiring ──
  check('no enhance-definitions lore invention', !joined.includes('add to the character'));
  check('no reasoning block when thinking is off', !messages[0].content.includes('<reasoning>'));
  const withThinking = buildSystemPrompt({ charName: 'S', userName: 'A', thinking: true });
  check('reasoning block when thinking is on', withThinking.includes('<reasoning>'));
  check('repetition hint names recent openings', joined.includes('Your recent replies opened with'));
  check('latest message not label-prefixed', !joined.includes("Ava's message:"));

  const carded = assemblePrompt({
    character: { ...character, system_prompt: '{{original}} Never break the fourth wall.' } as Character,
    history: [],
    latestUserMessage: 'hello',
    stylePreset: 'Write with {{char}} in mind, slowly.',
  });
  const prefix = carded[0].content;
  check('card system prompt emitted as creator_directives', /<creator_directives>[\s\S]*Never break the fourth wall/.test(prefix));
  check('{{original}} splices the main prompt', prefix.includes("Write Seraphine's next reply"));
  check('preset layered as style_direction', prefix.includes('<style_direction>\nWrite with Seraphine in mind, slowly.'));
  check('preset never replaces the card', prefix.includes('<creator_directives>') && prefix.includes('<style_direction>'));

  const longExamples = ['<START>', '{{user}}: one', '{{char}}: "' + 'a'.repeat(1800) + '"', '<START>', '{{user}}: two', '{{char}}: "' + 'b'.repeat(4000) + '"'].join('\n');
  const ex = assemblePrompt({ character: { ...character, example_dialogue: longExamples } as Character, history: [], latestUserMessage: 'hi' })[0].content;
  check('examples kept as whole exchanges', ex.includes('a'.repeat(1800)) && !ex.includes('bbbb'));

  // ── continue ──
  const cont = assemblePrompt({ character, history: history.slice(0, 10), latestUserMessage: '', mode: 'continue' });
  const contLast = cont[cont.length - 1];
  const contPrev = cont[cont.length - 2];
  check('continue ends on an OOC nudge', contLast.role === 'user' && contLast.content.includes('<ooc_note>') && contLast.content.includes('exactly where it stops'));
  check('continue keeps the reply being extended', contPrev.role === 'assistant' && contPrev.content.includes('reply 9'));
  check('continue sends no fake user line', !cont.some((m) => m.content.includes('[Continue your last message')));

  // ── impersonate ──
  const imp = assemblePrompt({ character, persona: { id: 'p', user_id: 'u', name: 'Ava', avatar_url: null, description: '', is_default: false, created_at: '', updated_at: '' }, history: history.slice(0, 10), latestUserMessage: '', mode: 'impersonate' });
  const impLast = imp[imp.length - 1].content;
  check('impersonate asks for the user turn', impLast.includes("write Ava's next turn instead of Seraphine's"));
  check('impersonate omits the character reminder', !impLast.includes('<character_reminder>'));
}

console.log('continue joining + output cleanup');
{
  check('joins words with a space', joinContinuation('She turned', 'away.') === 'She turned away.');
  check('no space before punctuation', joinContinuation('She turned', ', then left.') === 'She turned, then left.');
  check('keeps existing whitespace', joinContinuation('She turned.', '\n\n*Rain.*') === 'She turned.\n\n*Rain.*');
  check('prose "Of course," survives', sanitizeModelOutput('*She sighs.*\nOf course, she knew.') === '*She sighs.*\nOf course, she knew.');
  check('assistant preamble stripped', sanitizeModelOutput("Sure! Here's the next part:\n*She sighs.*") === '*She sighs.*');
  check('speaker tag stripped', sanitizeModelOutput('Seraphine: "Hm."', 'Seraphine') === '"Hm."');
}

console.log('memory trigger cost guard');
{
  const longChat: Message[] = Array.from({ length: 200 }, (_, i) => ({
    id: `x${i}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: 'A fairly long line of story text that keeps the transcript well past the history window. '.repeat(3),
  })) as Message[];
  const quiet = shouldRunMemoryPass({ history: longChat, hasSummary: true, cursorMessageId: 'x196', historyTokenBudget: 16000 });
  check('long summarised chat does not re-run every turn', !quiet.run, quiet.reason);
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
