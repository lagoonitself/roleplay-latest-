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
        content: `You are a world-class creative roleplay author who crafts deeply compelling, multi-dimensional roleplay characters.
Given a one-line concept, generate an evocative, complete character profile for an immersive fictional roleplay website.
Ensure the first_message is tactile, sensory, and sets an immediate hook that invites {{user}} to respond.
Use *italics* for actions and environment, and "quotes" for speech.

Output JSON matching this exact structure:
{
  "name": "Character Full Name",
  "tagline": "One punchy, evocative hook sentence (under 12 words)",
  "description": "Rich physical description, clothing, sensory presence (2-3 sentences)",
  "personality": "Psychological depth, traits, quirks, flaws, desires, moral compass",
  "scenario": "The starting setting, atmosphere, and initial dynamic between {{char}} and {{user}}",
  "first_message": "Vivid opening message in *actions* and \\"speech\\", establishing the scene and inviting {{user}}'s response",
  "example_dialogue": "<START>\\n<USER>: \\"...\\"\\n<BOT>: *action* \\"dialogue\\"",
  "speech_style": "Tone of voice, vocabulary, cadence, verbal tics",
  "tags": ["Genre", "Archetype", "Tropes", "Tone"],
  "content_rating": "sfw" | "mature",
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
