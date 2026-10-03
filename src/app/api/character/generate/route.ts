import { NextRequest, NextResponse } from 'next/server';
import { jsonCompletion } from '@/lib/llm/client';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { idea, apiKey } = await req.json();
    if (!idea) {
      return NextResponse.json({ error: 'Please provide a character concept or idea' }, { status: 400 });
    }

    const prompt = [
      {
        role: 'system' as const,
        content: `You are a world-class roleplay character architect.
You will be provided with either:
A) An original character idea/prompt, OR
B) Copied text, description, personality, or opening message from Janitor AI, Character.ai, Chub, or another roleplay platform.

Your mission:
- If the input contains copied text from an existing character (e.g. from Janitor AI), faithfully extract and preserve their exact character traits, backstory, scenario, tags, and opening message into the structured fields. Do not lose their established personality.
- If the input is a short prompt or concept, flesh it out into a richly textured, multi-dimensional character sheet.
- Ensure the first_message is evocative, tactile, and preserves any formatting (actions in *italics*, dialogue in "quotes").

Output JSON matching this exact structure:
{
  "name": "Character Name",
  "tagline": "Evocative summary or tagline (under 15 words)",
  "description": "Physical appearance, style, and presence",
  "personality": "Psychological depth, personality traits, desires, behavioral quirks",
  "scenario": "Current situation, environment, and dynamic with {{user}}",
  "first_message": "Vivid opening message in *actions* and \\"speech\\", establishing the scene and inviting {{user}} to respond",
  "example_dialogue": "<START>\\n<USER>: \\"...\\"\\n<BOT>: *action* \\"dialogue\\"",
  "speech_style": "Tone, speech mannerisms, vocabulary",
  "tags": ["Tag1", "Tag2"],
  "content_rating": "sfw" | "mature" | "explicit",
  "accent_color": "#hexColor"
}`,
      },
      {
        role: 'user' as const,
        content: `Character concept: ${idea}`,
      },
    ];

    const generated = await jsonCompletion(prompt, { apiKey });
    return NextResponse.json(generated);
  } catch (error: any) {
    console.error('Character generation error:', error);
    return NextResponse.json({ error: error.message || 'Failed to generate character' }, { status: 500 });
  }
}
