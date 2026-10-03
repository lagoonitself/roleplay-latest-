export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Profile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  settings: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface Persona {
  id: string;
  user_id: string;
  name: string;
  avatar_url: string | null;
  description: string;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export interface Character {
  id: string;
  user_id: string;
  name: string;
  avatar_url: string | null;
  tagline: string;
  description: string;
  personality: string;
  scenario: string;
  first_message: string;
  alternate_greetings: string[];
  example_dialogue: string;
  speech_style: string;
  system_prompt: string;
  post_history_instructions: string;
  creator_notes: string;
  tags: string[];
  content_rating: 'sfw' | 'mature' | 'explicit';
  behavior: {
    pov?: '1st' | '2nd' | '3rd';
    tense?: 'present' | 'past';
    verbosity?: 'short' | 'medium' | 'long';
    temperature?: number;
    thinking_enabled?: boolean;
    frequency_penalty?: number;
    presence_penalty?: number;
    custom_state_fields?: Record<string, string>;
  };
  generation: Record<string, any>;
  accent_color: string | null;
  favorite: boolean;
  chat_count: number;
  last_chatted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Lorebook {
  id: string;
  user_id: string;
  name: string;
  description: string;
  scan_depth: number;
  token_budget: number;
  created_at: string;
  updated_at: string;
}

export interface LorebookEntry {
  id: string;
  lorebook_id: string;
  user_id: string;
  title: string;
  keys: string[];
  secondary_keys: string[];
  content: string;
  constant: boolean;
  enabled: boolean;
  priority: number;
  case_sensitive: boolean;
  created_at: string;
  updated_at: string;
}

export interface Chat {
  id: string;
  user_id: string;
  character_id: string;
  persona_id: string | null;
  title: string;
  leaf_id: string | null;
  memory_cursor_id: string | null;
  authors_note: string;
  settings: Record<string, any>;
  pinned: boolean;
  archived: boolean;
  message_count: number;
  last_message_at: string;
  created_at: string;
  updated_at: string;
  // joined relations
  character?: Character;
  persona?: Persona | null;
}

export interface Message {
  id: string;
  chat_id: string;
  user_id: string;
  parent_id: string | null;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning: string | null;
  status: 'streaming' | 'done' | 'error' | 'stopped';
  meta: {
    tokens_in?: number;
    tokens_out?: number;
    cached_tokens?: number;
    swipes?: string[]; // swipe variations
    active_swipe_index?: number;
    model?: string;
    persona_name?: string;
  };
  created_at: string;
  updated_at: string;
}

export interface Memory {
  id: string;
  chat_id: string;
  user_id: string;
  content: string;
  kind: 'fact' | 'event' | 'preference' | 'relationship' | 'promise' | 'secret' | 'trait';
  entities: string[];
  importance: number;
  embedding?: number[] | null;
  pinned: boolean;
  source_message_ids: string[];
  superseded_by: string | null;
  access_count: number;
  last_accessed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Summary {
  id: string;
  chat_id: string;
  user_id: string;
  level: 'chunk' | 'arc';
  content: string;
  message_ids: string[];
  last_message_id: string | null;
  token_estimate: number;
  user_edited: boolean;
  superseded: boolean;
  created_at: string;
  updated_at: string;
}

export interface ChatState {
  chat_id: string;
  user_id: string;
  state: {
    location?: string;
    time_of_day?: string;
    char_mood?: string;
    relationship_score?: number; // -100 to 100
    affection_level?: string;
    inventory?: string[];
    current_clothing?: string;
    active_events?: string[];
    custom?: Record<string, any>;
  };
  updated_at: string;
}
