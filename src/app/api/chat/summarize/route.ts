import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { summarizeChatIfNeeded } from '@/lib/memory/summarizer';
import type { Message, Summary } from '@/lib/supabase/types';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { chatId, charName, userName, history, promptWords, frozen, force } = body;

    if (!chatId) {
      return NextResponse.json({ error: 'chatId is required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData?.user?.id || 'guest';

    // 1. If content is supplied directly, this is a manual user edit/update of the summary
    if (body.action === 'save_edit' && typeof body.content === 'string') {
      const { data: activeSummary } = await supabase
        .from('summaries')
        .select('*')
        .eq('chat_id', chatId)
        .eq('superseded', false)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeSummary?.id) {
        await supabase
          .from('summaries')
          .update({ superseded: true })
          .eq('id', activeSummary.id);
      }

      const { data: newRow, error } = await supabase
        .from('summaries')
        .insert({
          chat_id: chatId,
          user_id: userId,
          level: 'chunk',
          content: body.content.trim(),
          user_edited: true,
          superseded: false,
        })
        .select()
        .single();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({ summary: newRow });
    }

    // 2. Fetch history if not provided in payload
    let chatHistory: Message[] = history || [];
    if (!chatHistory.length) {
      const { data: dbMessages } = await supabase
        .from('messages')
        .select('*')
        .eq('chat_id', chatId)
        .order('created_at', { ascending: true });
      if (dbMessages) chatHistory = dbMessages as Message[];
    }

    const summaryResult = await summarizeChatIfNeeded({
      chatId,
      userId,
      charName: charName || 'Character',
      userName: userName || 'User',
      history: chatHistory,
      promptWords: promptWords || 200,
      force: force ?? true,
      frozen: frozen ?? false,
    });

    return NextResponse.json({ summary: summaryResult });
  } catch (error: any) {
    console.error('Error in /api/chat/summarize:', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}
