import { makeCharacter } from '@/lib/cards/card-parser';
import type { Character, Persona } from '@/lib/supabase/types';
import type { AgentKind } from './types';

export interface LoadedAgent {
  kind: AgentKind;
  id: string;
  name: string;
  avatar_url: string | null;
  character: Character | null;
  persona: Persona | null;
}

const RATING_RANK = { sfw: 0, mature: 1, explicit: 2 } as const;

export function otherLabel(speakerName: string, otherName: string): string {
  if (speakerName.trim().toLowerCase() === otherName.trim().toLowerCase()) {
    return `${otherName} (the other)`;
  }
  return otherName;
}

export function agentAsCharacter(
  agent: LoadedAgent,
  opts: { scene: string; otherName: string; ratingFloor: Character['content_rating'] }
): Character {
  if (agent.character) {
    const rating =
      RATING_RANK[agent.character.content_rating] >= RATING_RANK[opts.ratingFloor]
        ? agent.character.content_rating
        : opts.ratingFloor;
    return {
      ...agent.character,
      content_rating: rating,
      scenario: agent.character.scenario?.trim() || opts.scene,
      // Assembler would otherwise inject this as a fake prior turn.
      first_message: '',
      behavior: {
        ...agent.character.behavior,
        thinking_enabled: false,
      },
    };
  }

  const persona = agent.persona;
  const description = persona?.description?.trim() || `${agent.name} is present in the scene.`;
  return makeCharacter({
    id: agent.id,
    user_id: persona?.user_id || 'duo',
    name: agent.name,
    avatar_url: agent.avatar_url,
    tagline: '',
    description,
    personality: description,
    scenario: opts.scene || `An ongoing exchange with ${opts.otherName}.`,
    first_message: '',
    speech_style: 'Specific, natural, and in character. Never narrate the other person.',
    content_rating: opts.ratingFloor === 'sfw' ? 'mature' : opts.ratingFloor,
    behavior: {
      pov: '2nd',
      tense: 'present',
      verbosity: 'medium',
      temperature: 1.05,
      thinking_enabled: false,
    },
    tags: ['Persona'],
  });
}

export function agentAsPersona(agent: LoadedAgent): Persona {
  if (agent.persona) return agent.persona;

  const character = agent.character;
  const parts = [
    character?.tagline,
    character?.description,
    character?.personality ? `Personality: ${character.personality}` : '',
    character?.scenario ? `Situation they know: ${character.scenario}` : '',
    character?.speech_style ? `Voice: ${character.speech_style}` : '',
  ].filter((part) => part && part.trim());

  return {
    id: agent.id,
    user_id: character?.user_id || 'duo',
    name: agent.name,
    avatar_url: agent.avatar_url,
    description: parts.join('\n\n') || `${agent.name} is the other person in this scene.`,
    is_default: false,
    created_at: character?.created_at || new Date().toISOString(),
    updated_at: character?.updated_at || new Date().toISOString(),
  };
}

export function ratingFloor(a: LoadedAgent, b: LoadedAgent): Character['content_rating'] {
  const left = a.character?.content_rating || 'mature';
  const right = b.character?.content_rating || 'mature';
  return RATING_RANK[left] >= RATING_RANK[right] ? left : right;
}
