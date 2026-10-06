import { NextRequest, NextResponse } from 'next/server';
import { jsonCompletion } from '@/lib/llm/client';
import {
  CHARACTER_GENERATOR_SYSTEM,
  buildCharacterGeneratorUser,
  normalizeGeneratedCharacter,
} from '@/lib/prompt/generators';

export const runtime = 'nodejs';

const MAX_IDEA_CHARS = 24000;

export async function POST(req: NextRequest) {
  try {
    const { idea, apiKey } = await req.json();
    if (typeof idea !== 'string' || !idea.trim()) {
      return NextResponse.json({ error: 'Please provide a character concept or idea' }, { status: 400 });
    }

    const messages = [
      { role: 'system' as const, content: CHARACTER_GENERATOR_SYSTEM },
      { role: 'user' as const, content: buildCharacterGeneratorUser(idea.slice(0, MAX_IDEA_CHARS)) },
    ];

    // Lower temperature keeps the card faithful to the user's idea (no invented bloat)
    // while leaving enough range for fresh character concepts.
    const raw = await jsonCompletion(messages, { apiKey, max_tokens: 8192, temperature: 0.75 });
    const character = normalizeGeneratedCharacter(raw);

    if (!character.name || !character.first_message) {
      throw new Error('The AI returned an incomplete character. Please try again.');
    }

    return NextResponse.json(character);
  } catch (error) {
    console.error('Character generation error:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to generate character' }, { status: 500 });
  }
}
