-- Audit fixes (2026-10-12) — idempotent where practical.
--
-- 1. RLS hardening: child rows must sit under a chat/lorebook the caller owns,
--    not merely carry their own user_id (otherwise rows can be attached to
--    someone else's chat / a chat can point at someone else's character).
-- 2. llm_logs.kind check widened to the kinds the app actually logs.
-- 3. Non-negative token/ledger CHECKs (NOT VALID so historical rows can't
--    break the migration).
-- 4. Counter integrity: message_count / chat_count / last_message_at are now
--    recomputed (not incremented) on insert AND delete — the old triggers
--    double-counted when the app set message_count explicitly and never
--    decremented on delete.
-- 5. Signup robustness: handle_new_user no longer aborts auth.users inserts
--    when email and name metadata are both missing.
-- 6. Indexes for the queries the app runs + anon lock-down for future tables.

-- ───────────────────────────── 1. RLS hardening ─────────────────────────────
-- messages / memories / summaries / chat_state may only be attached to a chat
-- the caller owns. (user_id = auth.uid() alone let a caller insert rows into a
-- foreign chat_id; those rows were invisible to the victim but corrupted stats
-- and polluted the chat's row space.)

drop policy if exists "own rows" on public.messages;
create policy "own rows" on public.messages for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.chats c
      where c.id = chat_id and c.user_id = (select auth.uid())
    )
  );

drop policy if exists "own rows" on public.memories;
create policy "own rows" on public.memories for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.chats c
      where c.id = chat_id and c.user_id = (select auth.uid())
    )
  );

drop policy if exists "own rows" on public.summaries;
create policy "own rows" on public.summaries for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.chats c
      where c.id = chat_id and c.user_id = (select auth.uid())
    )
  );

drop policy if exists "own rows" on public.chat_state;
create policy "own rows" on public.chat_state for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.chats c
      where c.id = chat_id and c.user_id = (select auth.uid())
    )
  );

-- lorebook entries must sit under an owned lorebook.
drop policy if exists "own rows" on public.lorebook_entries;
create policy "own rows" on public.lorebook_entries for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.lorebooks l
      where l.id = lorebook_id and l.user_id = (select auth.uid())
    )
  );

-- character↔lorebook links must reference an owned character AND lorebook.
drop policy if exists "own rows" on public.character_lorebooks;
create policy "own rows" on public.character_lorebooks for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.characters ch
      where ch.id = character_id and ch.user_id = (select auth.uid())
    )
    and exists (
      select 1 from public.lorebooks l
      where l.id = lorebook_id and l.user_id = (select auth.uid())
    )
  );

-- chats may only point at the caller's own character / persona (both nullable
-- for duo chats). character_id / persona_id are client-supplied in places.
drop policy if exists "own rows" on public.chats;
create policy "own rows" on public.chats for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      character_id is null
      or exists (
        select 1 from public.characters ch
        where ch.id = character_id and ch.user_id = (select auth.uid())
      )
    )
    and (
      persona_id is null
      or exists (
        select 1 from public.personas p
        where p.id = persona_id and p.user_id = (select auth.uid())
      )
    )
  );

-- ───────────────────── 2. llm_logs.kind aligned with the app ─────────────────────
-- src/app/api/chat/route.ts logs kind = 'continue' | 'impersonate' (and
-- src/lib/logs/llm-log-store accepts them); the old check rejected those rows
-- and the turns were silently never persisted.

alter table public.llm_logs drop constraint if exists llm_logs_kind_check;
alter table public.llm_logs
  add constraint llm_logs_kind_check
  check (kind in ('chat', 'swipe', 'regen', 'continue', 'impersonate'));

-- ───────────────────── 3. Ledger non-negativity ─────────────────────
-- NOT VALID: enforce for new rows without failing on historical data.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'usage_events_tokens_nonneg'
      and conrelid = 'public.usage_events'::regclass
  ) then
    alter table public.usage_events
      add constraint usage_events_tokens_nonneg
      check (prompt_tokens >= 0 and completion_tokens >= 0 and cached_tokens >= 0 and cost_usd >= 0)
      not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'llm_logs_tokens_nonneg'
      and conrelid = 'public.llm_logs'::regclass
  ) then
    alter table public.llm_logs
      add constraint llm_logs_tokens_nonneg
      check (prompt_tokens >= 0 and completion_tokens >= 0 and cached_tokens >= 0 and latency_ms >= 0)
      not valid;
  end if;
end $$;

-- ───────────────────── 4. Counter integrity ─────────────────────
-- Recompute instead of increment: the app sets message_count explicitly in
-- several flows (e.g. local-chat migration), so the old +1-per-message trigger
-- double-counted, and deletes never decremented anything.

create or replace function private.on_message_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.chats
     set message_count = (select count(*) from public.messages where chat_id = new.chat_id),
         last_message_at = now()
   where id = new.chat_id;
  update public.characters c
     set last_chatted_at = now()
    from public.chats ch
   where ch.id = new.chat_id and c.id = ch.character_id;
  return new;
end $$;

create or replace function private.on_message_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.chats
     set message_count = (select count(*) from public.messages where chat_id = old.chat_id)
   where id = old.chat_id;
  return old;
end $$;

drop trigger if exists messages_after_delete on public.messages;
create trigger messages_after_delete
  after delete on public.messages
  for each row execute function private.on_message_delete();

create or replace function private.on_chat_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.character_id is not null then
    update public.characters
       set chat_count = (select count(*) from public.chats where character_id = new.character_id)
     where id = new.character_id;
  end if;
  return new;
end $$;

create or replace function private.on_chat_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.character_id is not null then
    update public.characters
       set chat_count = (select count(*) from public.chats where character_id = old.character_id)
     where id = old.character_id;
  end if;
  return old;
end $$;

drop trigger if exists chats_after_delete on public.chats;
create trigger chats_after_delete
  after delete on public.chats
  for each row execute function private.on_chat_delete();

-- ───────────────────── 5. Signup robustness ─────────────────────
-- personas.name is NOT NULL; the old fallback chain (metadata name → email
-- local-part) yielded NULL when a user is created without email or name
-- metadata, which raised and rolled back the entire auth.users insert.
-- Persona seeding is now failure-isolated so it can never abort a signup.

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'User'
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  begin
    insert into public.personas (user_id, name, description, is_default)
    values (
      new.id,
      coalesce(
        new.raw_user_meta_data ->> 'given_name',
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'User'
      ),
      '',
      true
    );
  exception when others then
    null; -- never abort user creation because of persona seeding
  end;
  return new;
end $$;

-- ───────────────────── 6. Indexes + anon lock-down ─────────────────────
-- memories are listed per chat ordered newest-first (memory/vectors.ts,
-- api/chat/memory) and usage totals paginate by (user_id, id) (api/usage).

create index if not exists memories_chat_created_idx
  on public.memories (chat_id, created_at desc);
create index if not exists usage_events_user_id_idx
  on public.usage_events (user_id, id);

-- The app never uses the anon role (guests are localStorage-only); make sure
-- tables created by later migrations also start anon-free.
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
