import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { runMemoryPass, shouldRunMemoryPass, MEMORY_KINDS, type MemoryKind } from '@/lib/memory/engine';
import { saveSummaryEdit } from '@/lib/memory/summarizer';
import { retrieveContextForChat } from '@/lib/memory/retriever';
import type { Memory, Message, Summary, ChatState, Character, Persona } from '@/lib/supabase/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cleanStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() && !/^(null|none)$/i.test(v.trim()) ? v.trim() : undefined;

/**
 * Memory API — everything the story remembers, in one place.
 *
 *   regenerate      run the automatic memory pass (summary + facts + scene state)
 *   save_summary    save a hand-edited summary (locks it against auto-overwrite)
 *   add_memory      writer-authored memory
 *   update_memory   edit / re-categorise / pin / unpin a memory
 *   delete_memory   forget a memory
 *   list            current memories, summary and scene state
 *
 * All actions work for signed-in users (persisted to Supabase) and for guests
 * (the caller persists the returned rows locally).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action || 'regenerate';
    const chatId: string = body.chatId || '';
    if (!chatId) {
      return NextResponse.json({ error: 'chatId is required' }, { status: 400 });
    }

    const authHeader = req.headers.get('authorization');
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    let supabase: SupabaseClient;
    let userId: string | undefined;

    if (bearerToken && supabaseUrl && supabaseAnonKey) {
      const { createClient: createSupabaseJsClient } = await import('@supabase/supabase-js');
      supabase = createSupabaseJsClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: `Bearer ${bearerToken}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: authData } = await supabase.auth.getUser(bearerToken);
      userId = authData?.user?.id;
    } else {
      supabase = await createClient();
      const { data: authData } = await supabase.auth.getUser();
      userId = authData?.user?.id;
    }

    const isDbBacked = !!(userId && UUID_REGEX.test(chatId) && UUID_REGEX.test(userId));
    const effectiveUserId = userId || body.userId || 'guest';

    // ── list ────────────────────────────────────────────────────────────────
    if (action === 'list') {
      const clientMemories: Memory[] = Array.isArray(body.memories) ? body.memories : [];
      const clientSummary: Summary | null = body.summary || null;
      const clientState: ChatState['state'] = body.state || {};

      let memories = clientMemories;
      let summary = clientSummary;
      let state = clientState;

      if (isDbBacked) {
        const [memRes, sumRes, stateRes] = await Promise.all([
          supabase.from('memories').select('*').eq('chat_id', chatId).is('superseded_by', null).order('created_at', { ascending: false }),
          supabase.from('summaries').select('*').eq('chat_id', chatId).eq('superseded', false).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('chat_state').select('*').eq('chat_id', chatId).maybeSingle(),
        ]);
        memories = (memRes.data as Memory[]) || clientMemories;
        summary = (sumRes.data as Summary) || clientSummary;
        state = (stateRes.data?.state as ChatState['state']) || clientState;
      }

      // Optional: what would be recalled and triggered for this moment — powers the
      // inspector's "recall" and "world info" tabs.
      let recalled: Array<{ content: string; score?: number; kind?: string }> = [];
      let lore: Array<{ id: string; title: string; keys: string[]; content: string }> = [];
      if (body.includeRecall && Array.isArray(body.history) && body.character) {
        try {
          const ctx = await retrieveContextForChat({
            chatId,
            character: body.character as Character,
            persona: (body.persona as Persona) || null,
            history: body.history as Message[],
            latestUserMessage: body.latestUserMessage || '',
            supabase,
            clientContext: {
              memories,
              summary,
              chatState: { state } as ChatState,
            },
          });
          recalled = (ctx.vectorMemories?.memories || []).map((m, i) => ({
            content: m.content,
            kind: m.kind,
            score: ctx.vectorMemories?.scores?.[i],
          }));
          lore = (ctx.triggeredLore || []).map((e) => ({
            id: e.id,
            title: e.title || '',
            keys: e.keys || [],
            content: e.content || '',
          }));
        } catch (err) {
          console.warn('memory/list: recall preview failed:', err);
        }
      }

      return NextResponse.json({ memories, summary, state, recalled, lore });
    }

    // ── save_summary ────────────────────────────────────────────────────────
    if (action === 'save_summary') {
      const content = cleanStr(body.content);
      if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 });
      const summary = await saveSummaryEdit({ chatId, userId: effectiveUserId, content });
      return NextResponse.json({ summary });
    }

    // ── memory CRUD ─────────────────────────────────────────────────────────
    if (action === 'add_memory' || action === 'update_memory' || action === 'delete_memory') {
      const content = cleanStr(body.content);
      const kind: MemoryKind = (MEMORY_KINDS as readonly string[]).includes(String(body.kind))
        ? (body.kind as MemoryKind)
        : 'fact';
      const importance = Math.min(10, Math.max(1, Math.round(Number(body.importance) || 7)));
      const pinned = body.pinned !== false;
      const entities = Array.isArray(body.entities) ? body.entities.map(String).slice(0, 8) : [];

      if (action === 'delete_memory') {
        const id = cleanStr(body.id);
        if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
        if (isDbBacked) await supabase.from('memories').delete().eq('id', id).eq('chat_id', chatId);
        return NextResponse.json({ deleted: id });
      }

      if (action === 'add_memory') {
        if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 });
        const row = {
          chat_id: chatId,
          user_id: effectiveUserId,
          content: content.slice(0, 600),
          kind,
          entities,
          importance,
          // Writer-authored memories are pinned by default: always in context,
          // never auto-rewritten or superseded by the memory pass.
          pinned,
          source_message_ids: [],
        };
        if (!isDbBacked) {
          return NextResponse.json({
            memory: {
              ...row,
              id: `mem-${Date.now()}`,
              embedding: null,
              superseded_by: null,
              access_count: 0,
              last_accessed_at: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            } as Memory,
          });
        }
        const { data, error } = await supabase.from('memories').insert(row).select('*').single();
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ memory: data });
      }

      // update_memory
      const id = cleanStr(body.id);
      if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (content) patch.content = content.slice(0, 600);
      if (body.kind) patch.kind = kind;
      if (body.importance !== undefined) patch.importance = importance;
      if (body.entities) patch.entities = entities;
      if (body.pinned !== undefined) patch.pinned = !!body.pinned;

      if (!isDbBacked) {
        return NextResponse.json({ memory: { id, ...patch } });
      }
      const { data, error } = await supabase.from('memories').update(patch).eq('id', id).eq('chat_id', chatId).select('*').single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ memory: data });
    }

    // ── save_settings ───────────────────────────────────────────────────────
    if (action === 'save_settings') {
      if (!isDbBacked) return NextResponse.json({ ok: true });
      const settings: Record<string, unknown> = {};
      if (body.summaryInterval !== undefined) {
        settings.memory_interval_messages = Math.min(30, Math.max(3, Math.round(Number(body.summaryInterval) || 10)));
      }
      if (body.summaryWords !== undefined) {
        settings.memory_summary_words = Math.min(500, Math.max(100, Math.round(Number(body.summaryWords) || 200)));
      }
      if (Object.keys(settings).length) {
        try {
          const { data: chatRow } = await supabase.from('chats').select('settings').eq('id', chatId).maybeSingle();
          const existing = (chatRow?.settings as Record<string, unknown>) || {};
          await supabase.from('chats').update({ settings: { ...existing, ...settings } }).eq('id', chatId);
        } catch (err) {
          console.warn('memory/save_settings failed:', err);
        }
      }
      return NextResponse.json({ ok: true, settings });
    }

    // ── regenerate ──────────────────────────────────────────────────────────
    const history: Message[] = Array.isArray(body.history) ? body.history : [];

    let memories: Memory[] = Array.isArray(body.memories) ? body.memories : [];
    let summary: Summary | null = body.summary || null;
    let currentState: ChatState['state'] = body.state || {};

    if (isDbBacked) {
      try {
        const [memRes, sumRes, stateRes] = await Promise.all([
          supabase.from('memories').select('*').eq('chat_id', chatId).is('superseded_by', null).order('created_at', { ascending: false }).limit(300),
          supabase.from('summaries').select('*').eq('chat_id', chatId).eq('superseded', false).order('created_at', { ascending: false }).limit(1).maybeSingle(),
          supabase.from('chat_state').select('*').eq('chat_id', chatId).maybeSingle(),
        ]);
        if (memRes.data?.length) memories = memRes.data as Memory[];
        if (sumRes.data) summary = sumRes.data as Summary;
        if (stateRes.data?.state) currentState = stateRes.data.state as ChatState['state'];
      } catch (err) {
        console.warn('memory/regenerate: context fetch failed:', err);
      }
    }

    let cursorId: string | null = body.cursorMessageId ?? null;
    if (!cursorId && isDbBacked) {
      try {
        const { data: chatRow } = await supabase.from('chats').select('memory_cursor_id').eq('id', chatId).maybeSingle();
        cursorId = (chatRow?.memory_cursor_id as string) || null;
      } catch {
        // fall back to the summary cursor below
      }
    }
    if (!cursorId && summary?.last_message_id) cursorId = summary.last_message_id;

    const frozen = !!body.frozen || !!summary?.user_edited;

    // Unless the caller forces it, respect the normal cadence.
    const force = body.force !== false;
    if (!force) {
      const trigger = shouldRunMemoryPass({
        history,
        cursorMessageId: cursorId,
        hasSummary: !!summary,
        intervalMessages: body.intervalMessages,
      });
      if (!trigger.run) {
        return NextResponse.json({ passRan: false, memories, summary, state: currentState });
      }
    }

    const charName = cleanStr(body.charName) || 'Character';
    const userName = cleanStr(body.userName) || 'User';

    const result = await runMemoryPass(
      {
        chatId,
        userId: effectiveUserId,
        charName,
        userName,
        history,
        cursorMessageId: cursorId,
        summary,
        memories,
        currentState,
        frozen,
        summaryWords: body.summaryWords,
        apiKey: body.apiKey,
      },
      { supabase, isDbBacked }
    );

    // Return the resulting memory bank in one round trip.
    let finalMemories = memories;
    if (isDbBacked) {
      try {
        const { data } = await supabase
          .from('memories')
          .select('*')
          .eq('chat_id', chatId)
          .is('superseded_by', null)
          .order('created_at', { ascending: false });
        if (data) finalMemories = data as Memory[];
      } catch {
        // merge locally as a fallback
      }
    }
    if (!isDbBacked) {
      const superseded = new Set(result.supersededMemoryIds);
      finalMemories = [
        ...result.newMemories,
        ...memories
          .filter((m) => !superseded.has(m.id))
          .map((m) => {
            const revision = result.revisions.find((r) => r.id === m.id);
            return revision ? { ...m, content: revision.content } : m;
          }),
      ];
    }

    return NextResponse.json({
      passRan: result.ran,
      memories: finalMemories,
      summary: result.summary,
      state: result.state || currentState,
      newMemoryIds: result.newMemories.map((m) => m.id),
      supersededMemoryIds: result.supersededMemoryIds,
    });
  } catch (error) {
    console.error('API /api/chat/memory error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
