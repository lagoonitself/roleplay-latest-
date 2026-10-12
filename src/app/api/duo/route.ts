import { NextRequest, NextResponse, after } from 'next/server';
import { getRequestUser } from '@/lib/duo/auth';
import { claimTurn, executeClaimedTurn, loadOwnedAgent, mergeDuo } from '@/lib/duo/engine';
import { LlmError } from '@/lib/llm/client';
import { readJsonBody } from '@/lib/api/request';
import { rateLimit, rateLimitKey } from '@/lib/api/rate-limit';
import {
  DUO_CONTINUE_TURNS,
  DUO_DEFAULT_DELAY_MS,
  DUO_DEFAULT_MAX_TURNS,
  DUO_MAX_DELAY_MS,
  DUO_MAX_TURNS_CAP,
  type DuoAgentRef,
  type DuoSession,
  type DuoSide,
} from '@/lib/duo/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function llmKey(req: NextRequest): string | undefined {
  const key = req.headers.get('x-llm-key')?.trim();
  return key || undefined;
}

/**
 * Origin for the self-calling turn chain. The request's own origin is derived
 * from host headers, which a caller can spoof — prefer configured deployment
 * URLs so credentials (authorization, x-llm-key) are never POSTed off-host.
 */
function selfOrigin(req: NextRequest): string {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  try {
    const url = new URL(configured);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin;
  } catch {
    // fall through to the request origin
  }
  return req.nextUrl.origin;
}

function kick(origin: string, chatId: string, runId: string, auth: string | null, key?: string) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) headers.authorization = auth;
  if (key) headers['x-llm-key'] = key;
  return fetch(`${origin}/api/duo`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ action: 'step', chatId, runId }),
    // Never follow a redirect that could bounce the auth headers elsewhere.
    redirect: 'error',
  }).catch((err) => {
    console.error('duo chain failed', err);
  });
}

function isRef(value: unknown): value is DuoAgentRef {
  if (!value || typeof value !== 'object') return false;
  const ref = value as DuoAgentRef;
  return (
    (ref.kind === 'character' || ref.kind === 'persona') &&
    typeof ref.id === 'string' &&
    ref.id.length > 0 &&
    ref.id.length <= 200
  );
}

export async function POST(req: NextRequest) {
  try {
    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: parsedBody.status });
    }
    const body = (parsedBody.body ?? {}) as Record<string, any>;
    const { supabase, userId } = await getRequestUser(req);
    if (!userId) {
      return NextResponse.json({ error: 'Sign in to run a scene.' }, { status: 401 });
    }

    // Steps chain rapidly during a run, so the ceiling is generous — but a scene
    // is still an LLM proxy and must not be hammerable without a user session.
    const limit = rateLimit(`duo:${rateLimitKey(req, userId)}`, 120, 60_000);
    if (!limit.ok) {
      return NextResponse.json(
        { error: 'Too many scene requests. Please wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

    const action = body?.action;
    const origin = selfOrigin(req);
    const auth = req.headers.get('authorization');
    const key = llmKey(req);

    if (action === 'start') {
      const a = body?.agents?.a;
      const b = body?.agents?.b;
      if (!isRef(a) || !isRef(b)) {
        return NextResponse.json({ error: 'Pick two people to start.' }, { status: 400 });
      }
      if (a.kind === b.kind && a.id === b.id) {
        return NextResponse.json({ error: 'Pick two different people.' }, { status: 400 });
      }

      const [agentA, agentB] = await Promise.all([
        loadOwnedAgent(supabase, userId, a),
        loadOwnedAgent(supabase, userId, b),
      ]);
      if (!agentA || !agentB) {
        return NextResponse.json({ error: 'One of those people could not be loaded.' }, { status: 404 });
      }

      const firstSpeaker: DuoSide = body?.firstSpeaker === 'b' ? 'b' : 'a';
      const maxTurns = Math.min(
        DUO_MAX_TURNS_CAP,
        Math.max(2, Math.floor(Number(body?.maxTurns) || DUO_DEFAULT_MAX_TURNS))
      );
      const turnDelayMs = Math.min(
        DUO_MAX_DELAY_MS,
        Math.max(0, Math.floor(Number(body?.turnDelayMs) || DUO_DEFAULT_DELAY_MS))
      );
      const seed = typeof body?.seed === 'string' ? body.seed.trim().slice(0, 2000) : '';
      const runId = crypto.randomUUID();
      const duo: DuoSession = {
        agents: { a, b },
        faces: {
          a: { kind: agentA.kind, id: agentA.id, name: agentA.name, avatar_url: agentA.avatar_url },
          b: { kind: agentB.kind, id: agentB.id, name: agentB.name, avatar_url: agentB.avatar_url },
        },
        seed,
        secrets: { a: '', b: '' },
        status: 'running',
        turn: 0,
        maxTurns,
        turnDelayMs,
        nextSpeaker: firstSpeaker,
        runId,
        busyUntil: null,
        lastError: null,
      };

      let chat: { id: string } | null = null;
      let insertError: { message?: string } | null = null;
      const baseRow: Record<string, unknown> = {
        user_id: userId,
        character_id: null,
        persona_id: null,
        title: `${agentA.name} & ${agentB.name}`,
        authors_note: seed,
        settings: { duo },
      };
      // Prefer the indexed mode column; fall back for DBs where the
      // migration has not been applied yet.
      const attempts = [{ ...baseRow, mode: 'duo' }, baseRow];
      for (const row of attempts) {
        const { data, error } = await supabase.from('chats').insert(row).select('id').single();
        if (!error && data) {
          chat = data as { id: string };
          insertError = null;
          break;
        }
        insertError = error;
        if (error && !/mode/i.test(error.message || '')) break;
      }

      if (!chat) {
        console.error('duo start insert failed', insertError);
        return NextResponse.json({ error: 'Could not start the scene.' }, { status: 500 });
      }

      after(() => kick(origin, chat.id, runId, auth, key));
      return NextResponse.json({ chatId: chat.id });
    }

    const chatId = typeof body?.chatId === 'string' ? body.chatId : '';
    if (!chatId || !UUID_REGEX.test(chatId)) {
      return NextResponse.json({ error: 'Missing scene.' }, { status: 400 });
    }

    if (action === 'control') {
      const control = body?.control;
      if (control !== 'pause' && control !== 'resume' && control !== 'stop' && control !== 'continue') {
        return NextResponse.json({ error: 'Unknown control.' }, { status: 400 });
      }

      const next = await mergeDuo(supabase, chatId, userId, (current) => {
        if (control === 'pause') {
          return { ...current, status: 'paused', busyUntil: null };
        }
        if (control === 'stop') {
          return { ...current, status: 'stopped', busyUntil: null };
        }
        const runId = crypto.randomUUID();
        const maxTurns =
          control === 'continue'
            ? Math.min(DUO_MAX_TURNS_CAP, Math.max(current.maxTurns, current.turn + DUO_CONTINUE_TURNS))
            : current.maxTurns;
        if (current.turn >= maxTurns) {
          return { ...current, status: 'done', busyUntil: null, lastError: null };
        }
        return { ...current, status: 'running', runId, maxTurns, busyUntil: null, lastError: null };
      });

      if (!next) {
        return NextResponse.json({ error: 'Scene not found.' }, { status: 404 });
      }
      if (next.status === 'running') {
        after(() => kick(origin, chatId, next.runId, auth, key));
      }
      return NextResponse.json({ duo: next });
    }

    if (action === 'direct') {
      const clean = (v: unknown) =>
        typeof v === 'string' ? v.trim().slice(0, 2000) : undefined;
      const seed = clean(body?.seed);
      const secretA = clean(body?.secrets?.a);
      const secretB = clean(body?.secrets?.b);
      if (seed === undefined && secretA === undefined && secretB === undefined) {
        return NextResponse.json({ error: 'Nothing to direct.' }, { status: 400 });
      }

      const next = await mergeDuo(supabase, chatId, userId, (current) => ({
        ...current,
        ...(seed !== undefined ? { seed } : {}),
        secrets: {
          a: secretA !== undefined ? secretA : current.secrets.a,
          b: secretB !== undefined ? secretB : current.secrets.b,
        },
      }));
      if (!next) {
        return NextResponse.json({ error: 'Scene not found.' }, { status: 404 });
      }
      if (seed !== undefined) {
        await supabase.from('chats').update({ authors_note: seed }).eq('id', chatId).eq('user_id', userId);
      }
      return NextResponse.json({ duo: next });
    }

    if (action === 'step') {
      const runId = typeof body?.runId === 'string' ? body.runId.slice(0, 200) : '';
      const claimed = await claimTurn(supabase, chatId, userId, runId);
      if (!claimed) {
        return NextResponse.json({ skipped: true });
      }
      after(async () => {
        try {
          const result = await executeClaimedTurn({ supabase, userId, chatId, runId, apiKey: key });
          if (result.chain) await kick(origin, chatId, runId, auth, key);
        } catch (err) {
          console.error('duo turn failed', err);
          await mergeDuo(supabase, chatId, userId, (current) =>
            current.runId === runId
              ? {
                  ...current,
                  status: 'error',
                  busyUntil: null,
                  // Only provider-written messages reach the UI; internal errors stay in logs.
                  lastError:
                    err instanceof LlmError
                      ? err.message.slice(0, 240)
                      : 'The scene stopped unexpectedly.',
                }
              : current
          );
        }
      });
      return NextResponse.json({ accepted: true });
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('duo route error', err);
    // Never echo internals back to the caller.
    return NextResponse.json({ error: 'Something went wrong.' }, { status: 500 });
  }
}
