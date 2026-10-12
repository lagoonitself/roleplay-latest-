import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Feature 2 — Token Usage API.
 *
 * Strict display contract: raw token counts ONLY.
 * This endpoint NEVER returns model names or monetary costs,
 * even though `usage_events` stores them internally.
 */

export const runtime = 'nodejs';

interface UsageRow {
  prompt_tokens: number | null;
  completion_tokens: number | null;
}

interface GetUsageTotalsRpcResult {
  input: number | string;
  output: number | string;
  turns: number | string;
}

function isValidUsageTotalsRow(v: unknown): v is GetUsageTotalsRpcResult {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return (
    'input' in r &&
    'output' in r &&
    'turns' in r &&
    r.input !== null &&
    r.output !== null &&
    r.turns !== null &&
    !Number.isNaN(Number(r.input)) &&
    !Number.isNaN(Number(r.output)) &&
    !Number.isNaN(Number(r.turns))
  );
}

function toCount(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/** PGRST202 = PostgREST "function not found", 42883 = Postgres "function does not exist". */
function isMissingFunction(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as { code?: unknown }).code ?? '');
  const message = String((err as { message?: unknown }).message ?? '');
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    /could not find the function|function .*get_usage_totals.* (does not exist|not found)/i.test(message)
  );
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }

    // Preferred: lifetime totals in ONE aggregate query (SECURITY INVOKER,
    // RLS-respecting — see supabase/migrations/20261012080956_usage_totals_and_log_count.sql).
    const { data: rpcData, error: rpcError } = await supabase.rpc<string, GetUsageTotalsRpcResult[]>(
      'get_usage_totals'
    );
    if (!rpcError && rpcData) {
      const row = Array.isArray(rpcData) ? rpcData[0] : (rpcData as unknown);
      if (isValidUsageTotalsRow(row)) {
        const input = toCount(row.input);
        const output = toCount(row.output);
        const turns = toCount(row.turns);
        return NextResponse.json({ input, output, total: input + output, turns });
      }
      console.warn('API /api/usage: get_usage_totals returned unexpected shape, falling back to paging query:', row);
    } else if (rpcError) {
      if (!isMissingFunction(rpcError)) {
        console.warn('API /api/usage: get_usage_totals RPC failed for reason other than missing function, falling back to paging query:', rpcError);
      }
    }

    // Fallback: paginate in chunks so lifetime totals stay exact past 1000 rows.
    let input = 0;
    let output = 0;
    let turns = 0;
    let page = 0;
    const PAGE_SIZE = 1000;
    for (;;) {
      const { data, error } = await supabase
        .from('usage_events')
        .select('prompt_tokens,completion_tokens')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      const rows = (data as UsageRow[]) || [];
      for (const r of rows) {
        input += toCount(r.prompt_tokens);
        output += toCount(r.completion_tokens);
      }
      turns += rows.length;
      if (rows.length < PAGE_SIZE) break;
      page += 1;
      if (page > 100) break; // hard backstop: 100k turns
    }

    return NextResponse.json({ input, output, total: input + output, turns });
  } catch (err: unknown) {
    console.error('API /api/usage error:', err);
    return NextResponse.json({ error: 'Failed to load usage' }, { status: 500 });
  }
}
