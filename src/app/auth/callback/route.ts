import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * `next` must be a root-relative path on this deployment. Anything with a
 * scheme or a protocol-relative '//…' (or its backslash obfuscation '\…')
 * falls back to '/' so the OAuth callback can never bounce a session to a
 * third-party origin.
 */
function safeNextPath(raw: string | null): string {
  if (!raw) return '/';
  const cleaned = raw.replace(/[\r\n\0]/g, '').replace(/\\/g, '/');
  if (!cleaned.startsWith('/') || cleaned.startsWith('//')) return '/';
  return cleaned;
}

/**
 * `x-forwarded-host` is only trusted when it matches the host we were reached
 * on (or the configured site URL) — otherwise a spoofed header would turn the
 * callback into an open redirect.
 */
function resolveRedirectOrigin(request: Request, origin: string): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (!forwardedHost) return origin;

  const allowed = new Set<string>();
  const host = request.headers.get('host');
  if (host) allowed.add(host.toLowerCase());
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) {
    try {
      allowed.add(new URL(siteUrl).host.toLowerCase());
    } catch {
      // ignore malformed site URL
    }
  }

  if (allowed.has(forwardedHost.toLowerCase())) {
    return `https://${forwardedHost}`;
  }
  return origin;
}

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // if 'next' is in the query params, use it as the redirect URL
  const next = safeNextPath(searchParams.get('next'));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const redirect = NextResponse.redirect(`${resolveRedirectOrigin(request, origin)}${next}`);
      // This response carries Set-Cookie for the new session — never cacheable.
      redirect.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
      return redirect;
    }
  }

  // return the user to an error page or home with an error parameter
  return NextResponse.redirect(`${origin}/?auth_error=oauth_failed`);
}
