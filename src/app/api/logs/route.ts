import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Developer LLM logs — server-persisted half of the logging feature.
 * Local guests rely on localStorage (see lib/logs/llm-log-store); this route
 * serves the Supabase `llm_logs` rows for signed-in users.
 *
 * GET /api/logs?chatId=<uuid>&limit=50  → newest-first rows (own rows only via RLS)
 * DELETE /api/logs?chatId=<uuid>        → delete own rows (optionally scoped to a chat)
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user?.id) {
      return NextResponse.json({ logs: [], authenticated: false }, { status: 200 });
    }
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get('chatId');
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 50));

    let query = supabase
      .from('llm_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (chatId) query = query.eq('chat_id', chatId);

    const { data, error } = await query;
    if (error) {
      // Table missing (migration not applied yet) — not fatal.
      if (error.code === '42P01') return NextResponse.json({ logs: [], authenticated: true });
      throw error;
    }
    return NextResponse.json({ logs: data ?? [], authenticated: true });
  } catch (e) {
    console.error('API /api/logs GET error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load logs' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user?.id) {
      return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const chatId = searchParams.get('chatId');
    let query = supabase.from('llm_logs').delete().eq('user_id', authData.user.id);
    if (chatId) query = query.eq('chat_id', chatId);
    const { error } = await query;
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('API /api/logs DELETE error:', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to delete logs' }, { status: 500 });
  }
}
