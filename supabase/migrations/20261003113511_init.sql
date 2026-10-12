-- Cadenza — initial schema
-- Single-owner roleplay app. Every row is owned by auth.uid(); RLS everywhere.

create extension if not exists vector with schema extensions;
create schema if not exists private;

-- ───────────────────────────── helpers ─────────────────────────────
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ───────────────────────────── profiles ─────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  insert into public.personas (user_id, name, description, is_default)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'given_name', split_part(new.email, '@', 1)),
    '',
    true
  );
  return new;
end $$;

-- ───────────────────────────── personas ─────────────────────────────
create table public.personas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  avatar_url text,
  description text not null default '',
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index personas_user_idx on public.personas (user_id);

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ───────────────────────────── characters ─────────────────────────────
create table public.characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  avatar_url text,
  tagline text not null default '',
  description text not null default '',
  personality text not null default '',
  scenario text not null default '',
  first_message text not null default '',
  alternate_greetings text[] not null default '{}',
  example_dialogue text not null default '',
  speech_style text not null default '',
  system_prompt text not null default '',
  post_history_instructions text not null default '',
  creator_notes text not null default '',
  tags text[] not null default '{}',
  content_rating text not null default 'sfw' check (content_rating in ('sfw', 'mature', 'explicit')),
  behavior jsonb not null default '{}'::jsonb,
  generation jsonb not null default '{}'::jsonb,
  accent_color text,
  favorite boolean not null default false,
  chat_count integer not null default 0,
  last_chatted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index characters_user_idx on public.characters (user_id, updated_at desc);

-- ───────────────────────────── lorebooks ─────────────────────────────
create table public.lorebooks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  description text not null default '',
  scan_depth integer not null default 4,
  token_budget integer not null default 1200,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lorebooks_user_idx on public.lorebooks (user_id);

create table public.lorebook_entries (
  id uuid primary key default gen_random_uuid(),
  lorebook_id uuid not null references public.lorebooks (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null default '',
  keys text[] not null default '{}',
  secondary_keys text[] not null default '{}',
  content text not null default '',
  constant boolean not null default false,
  enabled boolean not null default true,
  priority integer not null default 100,
  case_sensitive boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lorebook_entries_book_idx on public.lorebook_entries (lorebook_id);
create index lorebook_entries_user_idx on public.lorebook_entries (user_id);

create table public.character_lorebooks (
  character_id uuid not null references public.characters (id) on delete cascade,
  lorebook_id uuid not null references public.lorebooks (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  primary key (character_id, lorebook_id)
);
create index character_lorebooks_book_idx on public.character_lorebooks (lorebook_id);
create index character_lorebooks_user_idx on public.character_lorebooks (user_id);

-- ───────────────────────────── chats & messages ─────────────────────────────
create table public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  character_id uuid not null references public.characters (id) on delete cascade,
  persona_id uuid references public.personas (id) on delete set null,
  title text not null default '',
  leaf_id uuid,
  memory_cursor_id uuid,
  authors_note text not null default '',
  settings jsonb not null default '{}'::jsonb,
  pinned boolean not null default false,
  archived boolean not null default false,
  message_count integer not null default 0,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index chats_user_recent_idx on public.chats (user_id, last_message_at desc);
create index chats_character_idx on public.chats (character_id);
create index chats_persona_idx on public.chats (persona_id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id uuid references public.messages (id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null default '',
  reasoning text,
  status text not null default 'done' check (status in ('streaming', 'done', 'error', 'stopped')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index messages_chat_idx on public.messages (chat_id, created_at);
create index messages_parent_idx on public.messages (parent_id);
create index messages_user_idx on public.messages (user_id);

alter table public.chats
  add constraint chats_leaf_fk foreign key (leaf_id) references public.messages (id) on delete set null,
  add constraint chats_cursor_fk foreign key (memory_cursor_id) references public.messages (id) on delete set null;
create index chats_leaf_idx on public.chats (leaf_id);
create index chats_cursor_idx on public.chats (memory_cursor_id);

-- keep chat + character activity stats fresh
create or replace function private.on_message_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.chats
     set message_count = message_count + 1,
         last_message_at = now()
   where id = new.chat_id;
  update public.characters c
     set last_chatted_at = now()
    from public.chats ch
   where ch.id = new.chat_id and c.id = ch.character_id;
  return new;
end $$;

create trigger messages_after_insert
  after insert on public.messages
  for each row execute function private.on_message_insert();

create or replace function private.on_chat_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.characters set chat_count = chat_count + 1 where id = new.character_id;
  return new;
end $$;

create trigger chats_after_insert
  after insert on public.chats
  for each row execute function private.on_chat_insert();

-- ───────────────────────────── memory ─────────────────────────────
create table public.memories (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content text not null,
  kind text not null default 'fact' check (kind in ('fact', 'event', 'preference', 'relationship', 'promise', 'secret', 'trait')),
  entities text[] not null default '{}',
  importance smallint not null default 5 check (importance between 1 and 10),
  embedding extensions.halfvec(384),
  pinned boolean not null default false,
  source_message_ids uuid[] not null default '{}',
  superseded_by uuid references public.memories (id) on delete set null,
  access_count integer not null default 0,
  last_accessed_at timestamptz,
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index memories_chat_idx on public.memories (chat_id);
create index memories_user_idx on public.memories (user_id);
create index memories_superseded_idx on public.memories (superseded_by);
create index memories_fts_idx on public.memories using gin (fts);
create index memories_embedding_idx on public.memories using hnsw (embedding extensions.halfvec_cosine_ops);

create table public.summaries (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  level text not null default 'chunk' check (level in ('chunk', 'arc')),
  content text not null,
  message_ids uuid[] not null default '{}',
  last_message_id uuid,
  token_estimate integer not null default 0,
  user_edited boolean not null default false,
  superseded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index summaries_chat_idx on public.summaries (chat_id, created_at);
create index summaries_user_idx on public.summaries (user_id);

create table public.chat_state (
  chat_id uuid primary key references public.chats (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index chat_state_user_idx on public.chat_state (user_id);

-- ───────────────────────────── usage ─────────────────────────────
create table public.usage_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  chat_id uuid references public.chats (id) on delete set null,
  kind text not null default 'chat',
  model text not null,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  cost_usd numeric(12, 6) not null default 0,
  peak boolean not null default false,
  created_at timestamptz not null default now()
);
create index usage_events_user_time_idx on public.usage_events (user_id, created_at desc);
create index usage_events_chat_idx on public.usage_events (chat_id);

-- ───────────────────────────── updated_at triggers ─────────────────────────────
create trigger t_profiles_updated before update on public.profiles for each row execute function private.touch_updated_at();
create trigger t_personas_updated before update on public.personas for each row execute function private.touch_updated_at();
create trigger t_characters_updated before update on public.characters for each row execute function private.touch_updated_at();
create trigger t_lorebooks_updated before update on public.lorebooks for each row execute function private.touch_updated_at();
create trigger t_lore_entries_updated before update on public.lorebook_entries for each row execute function private.touch_updated_at();
create trigger t_chats_updated before update on public.chats for each row execute function private.touch_updated_at();
create trigger t_messages_updated before update on public.messages for each row execute function private.touch_updated_at();
create trigger t_memories_updated before update on public.memories for each row execute function private.touch_updated_at();
create trigger t_summaries_updated before update on public.summaries for each row execute function private.touch_updated_at();
create trigger t_chat_state_updated before update on public.chat_state for each row execute function private.touch_updated_at();

-- ───────────────────────────── RLS ─────────────────────────────
alter table public.profiles enable row level security;
alter table public.personas enable row level security;
alter table public.characters enable row level security;
alter table public.lorebooks enable row level security;
alter table public.lorebook_entries enable row level security;
alter table public.character_lorebooks enable row level security;
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.memories enable row level security;
alter table public.summaries enable row level security;
alter table public.chat_state enable row level security;
alter table public.usage_events enable row level security;

create policy "own profile" on public.profiles for all to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "own rows" on public.personas for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.characters for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.lorebooks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.lorebook_entries for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.character_lorebooks for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.chats for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.messages for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.memories for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.summaries for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.chat_state for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own rows" on public.usage_events for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on all tables in schema public from anon;

-- ───────────────────────────── hybrid memory retrieval ─────────────────────────────
create or replace function public.match_memories(
  p_chat_id uuid,
  p_query_embedding extensions.halfvec(384),
  p_query_text text,
  p_match_count integer default 12
)
returns table (id uuid, content text, kind text, importance smallint, score double precision)
language sql stable security invoker
set search_path = public, extensions
as $$
  with q as (
    select case when coalesce(p_query_text, '') = '' then null
                else websearch_to_tsquery('english', p_query_text) end as tsq
  )
  select m.id, m.content, m.kind, m.importance,
    (case when p_query_embedding is null or m.embedding is null then 0
          else 1 - (m.embedding <=> p_query_embedding) end) * 0.55
    + (case when q.tsq is null then 0 else least(ts_rank_cd(m.fts, q.tsq) * 4, 1) end) * 0.20
    + (m.importance / 10.0) * 0.15
    + exp(-extract(epoch from (now() - coalesce(m.last_accessed_at, m.created_at))) / (86400.0 * 7)) * 0.10
    as score
  from public.memories m cross join q
  where m.chat_id = p_chat_id
    and m.superseded_by is null
    and m.pinned = false
  order by score desc
  limit p_match_count
$$;

create or replace function public.similar_memories(
  p_chat_id uuid,
  p_query_embedding extensions.halfvec(384),
  p_match_count integer default 8
)
returns table (id uuid, content text, similarity double precision)
language sql stable security invoker
set search_path = public, extensions
as $$
  select m.id, m.content, 1 - (m.embedding <=> p_query_embedding) as similarity
  from public.memories m
  where m.chat_id = p_chat_id and m.superseded_by is null and m.embedding is not null
  order by m.embedding <=> p_query_embedding
  limit p_match_count
$$;

grant execute on function public.match_memories(uuid, extensions.halfvec, text, integer) to authenticated;
grant execute on function public.similar_memories(uuid, extensions.halfvec, integer) to authenticated;
revoke execute on function public.match_memories(uuid, extensions.halfvec, text, integer) from anon, public;
revoke execute on function public.similar_memories(uuid, extensions.halfvec, integer) from anon, public;

-- ───────────────────────────── realtime ─────────────────────────────
alter publication supabase_realtime add table public.messages, public.chats;

-- ───────────────────────────── storage ─────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy "avatar upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatar read own folder" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatar update own folder" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatar delete own folder" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
