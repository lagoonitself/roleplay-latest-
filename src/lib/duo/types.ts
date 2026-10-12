export type AgentKind = 'character' | 'persona';
export type DuoSide = 'a' | 'b';
export type DuoStatus = 'running' | 'paused' | 'stopped' | 'done' | 'error';

export interface DuoAgentRef {
  kind: AgentKind;
  id: string;
}

export interface DuoFace {
  kind: AgentKind;
  id: string;
  name: string;
  avatar_url: string | null;
}

export interface DuoSession {
  agents: { a: DuoAgentRef; b: DuoAgentRef };
  faces: { a: DuoFace; b: DuoFace };
  seed: string;
  /** Private per-side direction. secrets.a is only ever sent to A's model, never B's. */
  secrets: { a: string; b: string };
  status: DuoStatus;
  turn: number;
  maxTurns: number;
  turnDelayMs: number;
  nextSpeaker: DuoSide;
  runId: string;
  busyUntil: string | null;
  lastError: string | null;
}

export const DUO_DEFAULT_MAX_TURNS = 16;
export const DUO_MAX_TURNS_CAP = 60;
export const DUO_CONTINUE_TURNS = 12;
export const DUO_DEFAULT_DELAY_MS = 1200;
export const DUO_MAX_DELAY_MS = 6000;

export function otherSide(side: DuoSide): DuoSide {
  return side === 'a' ? 'b' : 'a';
}

export function parseDuo(settings: unknown): DuoSession | null {
  if (!settings || typeof settings !== 'object') return null;
  const duo = (settings as { duo?: unknown }).duo;
  if (!duo || typeof duo !== 'object') return null;
  const session = duo as Partial<DuoSession>;
  if (!session.agents?.a?.id || !session.agents?.b?.id) return null;
  if (!session.faces?.a?.name || !session.faces?.b?.name) return null;
  if (!session.runId || !session.status) return null;
  // Normalize so sessions created before secrets existed still load.
  const rawSecrets = session.secrets as { a?: unknown; b?: unknown } | undefined;
  // Clamp every numeric control value: a corrupted or hand-edited settings blob
  // must not be able to pin maxTurns to millions and keep the loop running.
  const turn = Number.isFinite(Number(session.turn)) ? Math.max(0, Math.floor(Number(session.turn))) : 0;
  const maxTurns = clampInt(session.maxTurns, 1, DUO_MAX_TURNS_CAP, DUO_DEFAULT_MAX_TURNS);
  const turnDelayMs = clampInt(session.turnDelayMs, 0, DUO_MAX_DELAY_MS, DUO_DEFAULT_DELAY_MS);
  return {
    ...session,
    turn,
    maxTurns: Math.max(maxTurns, turn),
    turnDelayMs,
    seed: typeof session.seed === 'string' ? session.seed : '',
    nextSpeaker: session.nextSpeaker === 'b' ? 'b' : 'a',
    status: (['running', 'paused', 'stopped', 'done', 'error'] as const).includes(session.status as DuoStatus)
      ? (session.status as DuoStatus)
      : 'error',
    secrets: {
      a: typeof rawSecrets?.a === 'string' ? rawSecrets.a : '',
      b: typeof rawSecrets?.b === 'string' ? rawSecrets.b : '',
    },
  } as DuoSession;
}

function clampInt(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

export function isDuoChat(chat: { mode?: string | null; settings?: unknown } | null | undefined): boolean {
  if (!chat) return false;
  return chat.mode === 'duo' || Boolean(parseDuo(chat.settings));
}
