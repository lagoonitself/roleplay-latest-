import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonCompletion, LlmError } from '@/lib/llm/client';
import { readJsonBody } from '@/lib/api/request';
import { rateLimit, rateLimitKey } from '@/lib/api/rate-limit';
import { apiKeyString, lenientString, partnerCharacterSchema } from '@/lib/api/schemas';
import {
  PERSONA_GENERATOR_SYSTEM,
  buildPersonaGeneratorUser,
  normalizeGeneratedPersona,
} from '@/lib/prompt/generators';

export const runtime = 'nodejs';

const generateRequestSchema = z.object({
  idea: lenientString(8000).optional(),
  character: partnerCharacterSchema.nullish(),
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
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { idea, character, apiKey } = parsed.data;

    // This is a paid completion — cap it per caller (per user or per IP).
    const limit = rateLimit(`persona-gen:${rateLimitKey(req)}`, 10, 60_000);
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'Too many generations. Please wait a moment and try again.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

    const messages = [
      { role: 'system' as const, content: PERSONA_GENERATOR_SYSTEM },
      {
        role: 'user' as const,
        content: buildPersonaGeneratorUser(idea ? idea.slice(0, 8000) : '', character),
      },
    ];

    // Lower temperature keeps the persona faithful to the player's request and the partner
    // character instead of drifting into generic, bloated descriptions.
    // max_tokens is fixed server-side; callers cannot grow it.
    const raw = await jsonCompletion(messages, { apiKey, max_tokens: 2048, temperature: 0.7 });
    const persona = normalizeGeneratedPersona(raw);

    if (!persona.name || /^user$/i.test(persona.name)) {
      return NextResponse.json(
        { error: 'AI response did not include a valid persona name. Please try again.' },
        { status: 502 }
      );
    }

    return NextResponse.json(persona);
  } catch (error) {
    console.error('AI Persona Generation Error:', error);
    // Provider messages are written for people; anything else stays in the logs.
    const message =
      error instanceof LlmError
        ? error.message
        : 'Failed to generate persona with AI. Please try again.';
    return NextResponse.json({ error: message }, { status: error instanceof LlmError ? 502 : 500 });
  }
}
