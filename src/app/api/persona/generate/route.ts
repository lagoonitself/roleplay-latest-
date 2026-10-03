import { NextRequest, NextResponse } from 'next/server';
import { jsonCompletion } from '@/lib/llm/client';
import { repairMojibake } from '@/lib/prompt/macros';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { idea, character, apiKey } = body;

    const charContext = character
      ? `### TARGET ROLEPLAY PARTNER INFORMATION:
- Partner Character Name: ${character.name || 'Unknown'}
- Tagline: ${character.tagline || 'None'}
- Scenario/Setting: ${character.scenario || 'Interactive roleplay'}
- Character Personality & Psychology: ${character.personality || 'Unknown'}
- Character Appearance & Background: ${character.description || 'Unknown'}`
      : 'No specific character context provided.';

    const userPrompt = `You are a world-class creative fiction and roleplay designer.
Your task is to generate a deeply compelling, original USER PERSONA (the character that the human user will be playing) to chat with the roleplay partner described below.

${charContext}

USER'S DESIRED CONCEPT / IDEA:
${idea?.trim() ? idea.trim() : 'Create an intriguing, natural counterpart with rich chemistry, history, or tension that fits the scenario perfectly.'}

CRITICAL RULES:
1. Provide a believable, distinct name (e.g. "Alexander Vance", "Marcus Reed", "Elena Rostova"). NEVER name the persona "User".
2. Detail their appearance, demeanor, psychology, flaws, and their unique emotional or narrative connection to the character.
3. Keep the backstory coherent with the setting and scenario.
4. Output MUST be valid JSON adhering strictly to this schema:
{
  "name": "Character's full name",
  "tagline": "One-line summary of their role and dynamic (e.g. Her estranged ex-husband, now a weary architect)",
  "description": "Multi-paragraph rich narrative background describing physical presence, clothing, personality, history with {{char}}, and internal motives.",
  "accent_color": "Hex color code for their UI badge and monogram (e.g. #3b82f6, #10b981, #f59e0b, #ec4899, #8b5cf6)"
}`;

    const prompt = [
      {
        role: 'system' as const,
        content:
          'You are an uncensored, literary roleplay co-creator. You generate rich, evocative character personas formatted as pure JSON.',
      },
      {
        role: 'user' as const,
        content: userPrompt,
      },
    ];

    const parsedPersona = await jsonCompletion<{
      name: string;
      tagline?: string;
      description: string;
      accent_color?: string;
    }>(prompt, {
      apiKey,
      max_tokens: 4096,
      temperature: 0.85,
    });

    if (!parsedPersona.name) {
      throw new Error('AI response did not include a valid persona name.');
    }

    return NextResponse.json({
      name: parsedPersona.name.trim(),
      tagline: parsedPersona.tagline ? repairMojibake(parsedPersona.tagline.trim()) : '',
      description: parsedPersona.description ? repairMojibake(parsedPersona.description.trim()) : '',
      accent_color: parsedPersona.accent_color || '#3b82f6',
    });
  } catch (error: any) {
    console.error('AI Persona Generation Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to generate persona with AI' },
      { status: 500 }
    );
  }
}
