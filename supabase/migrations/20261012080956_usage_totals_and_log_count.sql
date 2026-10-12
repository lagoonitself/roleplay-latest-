-- Usage totals aggregate + lightweight LLM log rows.
-- Apply with: supabase db push (or run in the Supabase SQL editor).
-- The app degrades gracefully while this migration is missing:
--   * /api/usage falls back to paging usage_events 1000 rows at a time,
--   * /api/logs serves rows without request_message_count.

-- ─── 1. get_usage_totals(): lifetime token totals in one round trip ───────────
-- SECURITY INVOKER plus an explicit auth.uid() filter: RLS on usage_events
-- applies exactly as it does for direct table reads — the function can only
-- ever see the caller's own rows.
--
-- Replaces the old 101-sequential-queries paging loop in src/app/api/usage.

create or replace function public.get_usage_totals()
returns table (input bigint, output bigint, turns bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(sum(e.prompt_tokens), 0)::bigint as input,
    coalesce(sum(e.completion_tokens), 0)::bigint as output,
    count(*)::bigint as turns
  from public.usage_events as e
  where e.user_id = auth.uid();
$$;

grant execute on function public.get_usage_totals() to authenticated;

-- ─── 2. llm_logs.request_message_count: prompt size without the prompt ───────
-- `request_messages` is the entire assembled prompt (tens of KB per row) and is
-- only ever shown when a log entry is expanded. This stored generated column
-- lets the logs list report "N messages" while omitting the payload; the
-- payload is then fetched per row (or when searching) on demand.

alter table public.llm_logs
  add column if not exists request_message_count integer
  generated always as (
    case
      when jsonb_typeof(request_messages) = 'array'
        then jsonb_array_length(request_messages)
      else 0
    end
  ) stored;
