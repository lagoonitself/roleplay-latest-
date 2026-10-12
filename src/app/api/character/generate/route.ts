import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonCompletion, LlmError } from '@/lib/llm/client';
import { readJsonBody } from '@/lib/api/request';
import { rateLimit, rateLimitKey } from '@/lib/api/rate-limit';
import { apiKeyString, lenientString } from '@/lib/api/schemas';
import {
  CHARACTER_GENERATOR_SYSTEM,
  buildCharacterGeneratorUser,
  normalizeGeneratedCharacter,
} from '@/lib/prompt/generators';

export const runtime = 'nodejs';

const MAX_IDEA_CHARS = 24000;

const generateRequestSchema = z.object({
  idea: lenientString(MAX_IDEA_CHARS),
  apiKey: apiKeyString,
});

export async function POST(req: NextRequest) {
  try {
    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    }
    const parsed = generateRequestSchema.safeParse(parsedBody.body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Please provide a character concept or idea' }, { status: 400 });
    }
    const { idea, apiKey } = parsed.data;
    if (!idea.trim()) {
      return NextResponse.json({ error: 'Please provide a character concept or idea' }, { status: 400 });
    }

    // This is a paid completion — cap it per caller (per user or per IP).
    const limit = rateLimit(`char-gen:${rateLimitKey(req)}`, 10, 60_000);
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'Too many generations. Please wait a moment and try again.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

    const messages = [
      { role: 'system' as const, content: CHARACTER_GENERATOR_SYSTEM },
      { role: 'user' as const, content: buildCharacterGeneratorUser(idea.slice(0, MAX_IDEA_CHARS)) },
    ];

    // Lower temperature keeps the card faithful to the user's idea (no invented bloat)
    // while leaving enough range for fresh character concepts.
    // max_tokens is fixed server-side; callers cannot grow it.
    const raw = await jsonCompletion(messages, { apiKey, max_tokens: 8192, temperature: 0.75 });
    const character = normalizeGeneratedCharacter(raw);

    if (!character.name || !character.first_message) {
      return NextResponse.json(
        { error: 'The AI returned an incomplete character. Please try again.' },
        { status: 502 }
      );
    }

    return NextResponse.json(character);
  } catch (error) {
    console.error('Character generation error:', error);
    // Provider messages are written for people; anything else stays in the logs.
    const message =
      error instanceof LlmError
        ? error.message
        : 'Failed to generate character. Please try again.';
    return NextResponse.json({ error: message }, { status: error instanceof LlmError ? 502 : 500 });
  }
}
