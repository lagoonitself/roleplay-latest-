import type { NextRequest } from 'next/server';

/**
 * Lightweight fixed-window rate limiter for the LLM-proxy routes. In-memory and
 * dependency-free by design: it exists to stop casual abuse of the server's
 * provider key, not to be a distributed quota system. State is bounded so a
 * flood of distinct keys cannot grow memory without limit.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const MAX_KEYS = 5000;

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) {
      for (const [k, b] of buckets) {
        if (b.resetAt <= now) buckets.delete(k);
      }
      if (buckets.size >= MAX_KEYS) {
        // Evict oldest entries (Map keys in insertion order) rather than clearing all buckets
        const toEvict = Math.ceil(MAX_KEYS * 0.2);
        let evicted = 0;
        for (const k of buckets.keys()) {
          buckets.delete(k);
          evicted++;
          if (evicted >= toEvict || buckets.size < MAX_KEYS) break;
        }
      }
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/** Keys buckets per user when signed in, per client IP otherwise. */
export function rateLimitKey(req: NextRequest, userId?: string | null): string {
  if (userId) return `u:${userId}`;
  // Deploy target is Vercel: prefer the platform-set header (x-real-ip),
  // or the last (right-most) trusted hop as appended by Vercel / edge proxies.
  const realIp = req.headers.get('x-real-ip')?.trim();
  let ip = realIp;
  if (!ip) {
    const forwarded = req.headers.get('x-forwarded-for');
    if (forwarded) {
      const hops = forwarded.split(',').map((h) => h.trim()).filter(Boolean);
      if (hops.length > 0) {
        ip = hops[hops.length - 1];
      }
    }
  }
  ip = (ip || 'unknown').trim();
  return `ip:${ip.slice(0, 64)}`;
}
