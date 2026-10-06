import { NextRequest, NextResponse } from 'next/server';
import { jsonCompletion } from '@/lib/llm/client';
import {
  PERSONA_GENERATOR_SYSTEM,
  buildPersonaGeneratorUser,
  normalizeGeneratedPersona,
} from '@/lib/prompt/generators';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { idea, character, apiKey } = await req.json();

    const messages = [
      { role: 'system' as const, content: PERSONA_GENERATOR_SYSTEM },
      {
        role: 'user' as const,
        content: buildPersonaGeneratorUser(typeof idea === 'string' ? idea.slice(0, 8000) : '', character),
      },
    ];

    // Lower temperature keeps the persona faithful to the player's request and the partner
    // character instead of drifting into generic, bloated descriptions.
    const raw = await jsonCompletion(messages, { apiKey, max_tokens: 2048, temperature: 0.7 });
    const persona = normalizeGeneratedPersona(raw);

    if (!persona.name || /^user$/i.test(persona.name)) {
      throw new Error('AI response did not include a valid persona name. Please try again.');
    }

    return NextResponse.json(persona);
  } catch (error) {
    console.error('AI Persona Generation Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate persona with AI' },
      { status: 500 }
    );
  }
}
