import type { Context, Next } from 'hono';

import { clientIp } from '../services/client-ip';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let requests = 0;

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

export interface RateLimitOptions {
  name: string;
  windowMs: number;
  max: number;
}

export function rateLimit({ name, windowMs, max }: RateLimitOptions) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const now = Date.now();
    requests += 1;
    if (requests % 500 === 0) sweep(now);

    const ip = clientIp(c) ?? 'unknown';
    const key = `${name}:${ip}`;

    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      c.header('Retry-After', String(retryAfter));
      return c.json({ ok: false, error: 'rate_limited' }, 429);
    }

    await next();
  };
}
