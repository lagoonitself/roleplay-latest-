-- Fix on_message_delete last_message_at recompute, get_usage_totals grants, and parent-ownership RLS.
-- Idempotent and safe to re-run.

-- ─── 1. Counter integrity: recompute last_message_at on message delete ─────────
-- audit_fixes header comment noted last_message_at is recomputed on delete,
-- but private.on_message_delete() only recomputed message_count.
-- Coalesce to chats.created_at if all messages are deleted (last_message_at is NOT NULL).

create or replace function private.on_message_delete()
returns trigger language plpgsql set search_path = '' as $$
begin
  update public.chats
     set message_count = (select count(*) from public.messages where chat_id = old.chat_id),
         last_message_at = coalesce(
           (select max(created_at) from public.messages where chat_id = old.chat_id),
           created_at
         )
   where id = old.chat_id;
  return old;
end $$;

-- ─── 2. Lock down get_usage_totals() execute privilege ─────────────────────────
-- Functions are executable by PUBLIC by default in PostgreSQL; revoke from anon and public.

revoke execute on function public.get_usage_totals() from public, anon;
grant execute on function public.get_usage_totals() to authenticated;

-- ─── 3. RLS hardening: parent-ownership with check for usage_events & llm_logs ─
-- Ensure caller owns the chat referenced by chat_id (allowing null chat_id).

drop policy if exists "own rows" on public.usage_events;
create policy "own rows" on public.usage_events for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      chat_id is null
      or exists (
        select 1 from public.chats c
        where c.id = chat_id and c.user_id = (select auth.uid())
      )
    )
  );

drop policy if exists "own rows" on public.llm_logs;
create policy "own rows" on public.llm_logs for all to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      chat_id is null
      or exists (
        select 1 from public.chats c
        where c.id = chat_id and c.user_id = (select auth.uid())
      )
    )
  );
