import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, rateLimitKey } from '@/lib/api/rate-limit';

export const runtime = 'nodejs';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Developer LLM logs — server-persisted half of the logging feature.
 * Local guests rely on localStorage (see lib/logs/llm-log-store); this route
 * serves the Supabase `llm_logs` rows for signed-in users.
 *
 * GET /api/logs?chatId=<uuid>&limit=50  → newest-first rows (own rows only)
 * GET /api/logs?includePrompts=1        → full rows including `request_messages` (capped at 50)
 * GET /api/logs?id=<row id>             → one full row (prompt included)
 * DELETE /api/logs?chatId=<uuid>        → delete own rows (optionally scoped to a chat)
 *
 * By default `request_messages` — the entire assembled prompt, tens of KB per
 * row — is NOT shipped. Rows carry `request_message_count` instead, and the
 * logs page fetches the prompt per entry when it is expanded (or when a search
 * needs to match prompt text).
 */
const LOG_COLUMNS =
  'id, created_at, chat_id, character_id, kind, model, params, user_message, output, reasoning, prompt_tokens, completion_tokens, cached_tokens, latency_ms';
const LOG_COLUMNS_WITH_COUNT = `${LOG_COLUMNS}, request_message_count`;
const LOG_COLUMNS_WITH_PROMPT = `${LOG_COLUMNS}, request_messages`;

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user?.id) {
      return NextResponse.json({ logs: [], authenticated: false }, { status: 200 });
    }

    const rl = rateLimit(`logs:${rateLimitKey(req, authData.user.id)}`, 60, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get('chatId');
    if (chatId && !UUID_REGEX.test(chatId)) {
      return NextResponse.json({ error: 'chatId must be a UUID' }, { status: 400 });
    }
    const requestedLimit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 50));
    const idParam = searchParams.get('id');
    const includePrompts =
      searchParams.get('includePrompts') === '1' || searchParams.get('includePrompts') === 'true';
    const limit = includePrompts ? Math.min(requestedLimit, 50) : requestedLimit;

    const rowId = idParam !== null && idParam !== '' ? Number(idParam) : null;
    if (rowId !== null && (!Number.isInteger(rowId) || rowId < 1)) {
      return NextResponse.json({ logs: [], authenticated: true });
    }
    const single = rowId !== null;

    // Logs contain full prompts and replies — always scoped to the caller.
    const buildQuery = (columns: string) => {
      let query = supabase
        .from('llm_logs')
        .select(columns)
        .eq('user_id', authData.user.id)
        .order('created_at', { ascending: false });
      if (single) query = query.eq('id', rowId as number).limit(1);
      else query = query.limit(limit);
      if (chatId) query = query.eq('chat_id', chatId);
      return query;
    };

    let { data, error } = await buildQuery(
      single || includePrompts ? LOG_COLUMNS_WITH_PROMPT : LOG_COLUMNS_WITH_COUNT
    );
    if (error && (error.code === 'PGRST204' || error.code === '42703') && !single && !includePrompts) {
      // `request_message_count` arrives with migration 20261012000001 — an
      // un-migrated database still serves the list, just without the count.
      ({ data, error } = await buildQuery(LOG_COLUMNS));
    }
    if (error) {
      // Table missing (migration not applied yet) — not fatal.
      if (error.code === '42P01') return NextResponse.json({ logs: [], authenticated: true });
      throw error;
    }
    const logs = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
      let requestMessageCount: number | null = null;
      if (Array.isArray(row.request_messages)) {
        requestMessageCount = row.request_messages.length > 0 ? row.request_messages.length : null;
      } else if (typeof row.request_message_count === 'number') {
        requestMessageCount = row.request_message_count > 0 ? row.request_message_count : null;
      }
      return {
        ...row,
        request_message_count: requestMessageCount,
      };
    });
    return NextResponse.json({ logs, authenticated: true });
  } catch (e) {
    console.error('API /api/logs GET error:', e);
    return NextResponse.json({ error: 'Failed to load logs' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user?.id) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }

    const rl = rateLimit(`logs-del:${rateLimitKey(req, authData.user.id)}`, 10, 60_000);
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } }
      );
    }

    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get('chatId');
    if (chatId && !UUID_REGEX.test(chatId)) {
      return NextResponse.json({ error: 'chatId must be a UUID' }, { status: 400 });
    }
    let query = supabase.from('llm_logs').delete().eq('user_id', authData.user.id);
    if (chatId) query = query.eq('chat_id', chatId);
    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('API /api/logs DELETE error:', e);
    return NextResponse.json({ error: 'Failed to delete logs' }, { status: 500 });
  }
}
