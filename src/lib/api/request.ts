import type { NextRequest } from 'next/server';

/** Hard cap on JSON request bodies accepted by the API routes. */
export const MAX_JSON_BODY_BYTES = 8 * 1024 * 1024;

export type JsonBodyResult =
  | { ok: true; body: unknown }
  | { ok: false; status: number; error: string };

/**
 * Reads a JSON request body with a content-type check and a hard size cap, so a
 * caller cannot DoS a route with an unbounded payload. Parser internals are
 * never echoed back to the caller.
 */
export async function readJsonBody(
  req: NextRequest,
  maxBytes: number = MAX_JSON_BODY_BYTES
): Promise<JsonBodyResult> {
  const contentType = (req.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return { ok: false, status: 415, error: 'Expected an application/json request body' };
  }
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return { ok: false, status: 413, error: 'Request body is too large' };
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, status: 400, error: 'Could not read the request body' };
  }
  const byteLength =
    typeof Buffer !== 'undefined'
      ? Buffer.byteLength(text, 'utf8')
      : new TextEncoder().encode(text).byteLength;
  if (byteLength > maxBytes) {
    return { ok: false, status: 413, error: 'Request body is too large' };
  }
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: 'Request body is not valid JSON' };
  }
}
