import type { Context, Next } from 'hono';

import { problem } from '../problem';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function requireSameOrigin(c: Context, next: Next): Promise<Response | void> {
  if (!MUTATING_METHODS.has(c.req.method)) return next();

  const site = c.req.header('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'same-site') {
    return problem(c, 403, 'forbidden_origin');
  }

  const origin = c.req.header('origin');
  if (origin === 'null') {
    if (site === 'same-origin') return next();
    return problem(c, 403, 'forbidden_origin');
  }
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return problem(c, 403, 'forbidden_origin');
    }
    if (originHost !== c.req.header('host')) {
      return problem(c, 403, 'forbidden_origin');
    }
  }

  await next();
}
