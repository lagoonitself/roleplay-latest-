import { NextRequest, NextResponse } from 'next/server';
import { CHATGPT_CLIENT_ID, CHATGPT_DEVICE_VERIFICATION_URL, CHATGPT_ISSUER, readChatgptClaims } from '@/lib/llm/chatgpt';

export const runtime = 'nodejs';

/**
 * "Sign in with ChatGPT" via the Codex CLI's device-code flow. The browser can't call
 * auth.openai.com directly (no CORS), so this route relays the three calls:
 *
 *   start   → get a one-time code the person enters at auth.openai.com/codex/device
 *   poll    → once approved, exchange the code for tokens
 *   refresh → swap a refresh token for a fresh access token
 *
 * Tokens are returned to the browser and never stored server-side.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === 'start') {
      const res = await fetch(`${CHATGPT_ISSUER}/api/accounts/deviceauth/usercode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: CHATGPT_CLIENT_ID }),
      });
      if (!res.ok) {
        return NextResponse.json(
          { error: res.status === 404 ? 'ChatGPT device sign-in is unavailable right now.' : `Couldn’t start ChatGPT sign-in (${res.status}).` },
          { status: 502 }
        );
      }
      const data = await res.json();
      return NextResponse.json({
        deviceAuthId: data.device_auth_id,
        userCode: data.user_code || data.usercode,
        interval: Math.max(2, Number(data.interval) || 5),
        verificationUrl: CHATGPT_DEVICE_VERIFICATION_URL,
      });
    }

    if (action === 'poll') {
      const deviceAuthId = String(body.deviceAuthId || '');
      const userCode = String(body.userCode || '');
      if (!deviceAuthId || !userCode) return NextResponse.json({ error: 'Missing device code.' }, { status: 400 });

      const res = await fetch(`${CHATGPT_ISSUER}/api/accounts/deviceauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
      });
      // 403/404 mean the person hasn't approved the code yet.
      if (res.status === 403 || res.status === 404) return NextResponse.json({ pending: true });
      if (!res.ok) return NextResponse.json({ error: `ChatGPT sign-in failed (${res.status}).` }, { status: 502 });

      const code = await res.json();
      const tokenRes = await fetch(`${CHATGPT_ISSUER}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CHATGPT_CLIENT_ID,
          code: code.authorization_code,
          redirect_uri: `${CHATGPT_ISSUER}/deviceauth/callback`,
          code_verifier: code.code_verifier,
        }),
      });
      if (!tokenRes.ok) return NextResponse.json({ error: `ChatGPT token exchange failed (${tokenRes.status}).` }, { status: 502 });
      return NextResponse.json(toAuth(await tokenRes.json()));
    }

    if (action === 'refresh') {
      const refreshToken = String(body.refreshToken || '');
      if (!refreshToken) return NextResponse.json({ error: 'Missing refresh token.' }, { status: 400 });

      const res = await fetch(`${CHATGPT_ISSUER}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: CHATGPT_CLIENT_ID, grant_type: 'refresh_token', refresh_token: refreshToken }),
      });
      if (!res.ok) {
        // 400/401 mean the refresh token was revoked or already used: the person must sign in again.
        return NextResponse.json({ error: 'Your ChatGPT sign-in has expired. Sign in again in Settings.', expired: res.status < 500 }, { status: 401 });
      }
      return NextResponse.json(toAuth(await res.json(), refreshToken));
    }

    return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  } catch (err) {
    console.error('chatgpt auth error', err);
    return NextResponse.json({ error: 'Couldn’t reach ChatGPT. Try again.' }, { status: 502 });
  }
}

function toAuth(tokens: { access_token: string; refresh_token?: string; id_token?: string; expires_in?: number }, previousRefreshToken = '') {
  const fromId = tokens.id_token ? readChatgptClaims(tokens.id_token) : null;
  const fromAccess = readChatgptClaims(tokens.access_token);
  const exp = fromAccess.exp || Math.floor(Date.now() / 1000) + (Number(tokens.expires_in) || 3600);
  return {
    accessToken: tokens.access_token,
    // The auth server may rotate the refresh token; keep the old one if it didn't.
    refreshToken: tokens.refresh_token || previousRefreshToken,
    expiresAt: exp * 1000,
    accountId: fromId?.accountId || fromAccess.accountId,
    email: fromId?.email || fromAccess.email,
    plan: fromId?.plan || fromAccess.plan,
  };
}
