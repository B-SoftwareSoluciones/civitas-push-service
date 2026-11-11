import type { Context, Next } from 'hono';

import { findApiKeyByHash, touchApiKey, type ApiKeyRow } from '../db/api-keys';
import { hashApiKey, matchIpAllowlist, safeEqualHex } from '../services/api-keys';
import { clientIp } from '../services/client-ip';
import { problem } from '../problem';

const CHALLENGE = { 'WWW-Authenticate': 'Bearer realm="civitas-access"' };
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

function markUsed(row: ApiKeyRow): void {
  const now = Date.now();
  const previous = lastTouch.get(row.id) ?? 0;
  if (now - previous < TOUCH_INTERVAL_MS) return;
  lastTouch.set(row.id, now);
  touchApiKey(row.id);
}

export async function requireApiKey(c: Context, next: Next): Promise<Response | void> {
  const key = extractKey(c);
  if (!key) return problem(c, 401, 'unauthorized', { headers: CHALLENGE });

  const keyHash = hashApiKey(key);
  const row = findApiKeyByHash(keyHash);
  if (!row || !safeEqualHex(row.key_hash, keyHash)) {
    return problem(c, 401, 'unauthorized', { headers: CHALLENGE });
  }

  if (row.enabled !== 1) {
    return problem(c, 401, 'api_key_disabled', { headers: CHALLENGE });
  }

  if (!matchIpAllowlist(clientIp(c), row.allowed_ips)) {
    return problem(c, 403, 'ip_not_allowed');
  }

  markUsed(row);
  c.set('apiKey', { id: row.id, name: row.name, prefix: row.prefix } satisfies ApiKeyContext);
  await next();
}
