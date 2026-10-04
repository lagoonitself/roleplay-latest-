-- Developer LLM logs: full assembled prompt + raw output per turn.
-- Apply with: supabase db push (or run in the Supabase SQL editor).
-- The app degrades gracefully when this table is absent (localStorage still logs).

create table if not exists public.llm_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  chat_id uuid references public.chats (id) on delete set null,
  character_id uuid references public.characters (id) on delete set null,
  kind text not null default 'chat' check (kind in ('chat', 'swipe', 'regen')),
  model text not null default '',
  params jsonb not null default '{}'::jsonb,
  request_messages jsonb not null default '[]'::jsonb,
  user_message text not null default '',
  output text not null default '',
  reasoning text,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  latency_ms integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists llm_logs_user_time_idx on public.llm_logs (user_id, created_at desc);
create index if not exists llm_logs_chat_idx on public.llm_logs (chat_id, created_at desc);

alter table public.llm_logs enable row level security;

drop policy if exists "own rows" on public.llm_logs;
create policy "own rows" on public.llm_logs for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.llm_logs to authenticated;
grant usage, select on sequence public.llm_logs_id_seq to authenticated;
