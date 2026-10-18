import type { Context, Next } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';

import { config } from '../config';
import { findApiKeyByHash, touchApiKey, type ApiKeyRow } from '../db/api-keys';
import { hashApiKey, matchIpAllowlist, safeEqualHex } from '../services/api-keys';

const TOUCH_INTERVAL_MS = 60_000;
const lastTouch = new Map<string, number>();

interface ApiKeyContext {
  id: string;
  name: string;
  prefix: string;
}

function extractKey(c: Context): string | undefined {
  const header = c.req.header('authorization');
  if (header) {
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (match?.[1]) return match[1].trim();
  }
  const apiKey = c.req.header('x-api-key');
  return apiKey?.trim() || undefined;
}

function clientIp(c: Context): string | undefined {
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

function markUsed(row: ApiKeyRow): void {
  const now = Date.now();
  const previous = lastTouch.get(row.id) ?? 0;
  if (now - previous < TOUCH_INTERVAL_MS) return;
  lastTouch.set(row.id, now);
  touchApiKey(row.id);
}

export async function requireApiKey(c: Context, next: Next): Promise<Response | void> {
  const key = extractKey(c);
  if (!key) return c.json({ ok: false, error: 'unauthorized' }, 401);

  const keyHash = hashApiKey(key);
  const row = findApiKeyByHash(keyHash);
  if (!row || !safeEqualHex(row.key_hash, keyHash)) {
    return c.json({ ok: false, error: 'unauthorized' }, 401);
  }

  if (row.enabled !== 1) {
    return c.json({ ok: false, error: 'api_key_disabled' }, 401);
  }

  if (!matchIpAllowlist(clientIp(c), row.allowed_ips)) {
    return c.json({ ok: false, error: 'ip_not_allowed' }, 403);
  }

  markUsed(row);
  c.set('apiKey', { id: row.id, name: row.name, prefix: row.prefix } satisfies ApiKeyContext);
  await next();
}
