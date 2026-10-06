import { NextRequest } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

export async function getRequestUser(req: NextRequest): Promise<{ supabase: SupabaseClient; userId: string | null }> {
  const authHeader = req.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://sgnieclbmerpxlbadymm.supabase.co';
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (bearerToken) {
    const { createClient: createSupabaseJsClient } = await import('@supabase/supabase-js');
    const supabase = createSupabaseJsClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${bearerToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data } = await supabase.auth.getUser(bearerToken);
    return { supabase, userId: data?.user?.id ?? null };
  }

  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return { supabase, userId: data?.user?.id ?? null };
}
