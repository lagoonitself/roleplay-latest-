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

function toCount(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id;
    if (!userId) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }

    // Paginate in chunks so lifetime totals stay exact past 1000 rows.
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
    const message = err instanceof Error ? err.message : 'Failed to load usage';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
