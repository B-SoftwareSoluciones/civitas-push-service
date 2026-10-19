import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

import { config } from '../config';

export function clientIp(c: Context): string | undefined {
  if (config.trustProxy) {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) {
      const first = forwarded.split(',')[0]?.trim();
      if (first) return first;
    }
    const realIp = c.req.header('x-real-ip')?.trim();
    if (realIp) return realIp;
  }

  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}
