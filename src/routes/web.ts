import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';

import { config } from '../config';
import {
  createApiKey,
  deleteApiKey,
  getApiKey,
  listApiKeys,
  setApiKeyAllowedIps,
  setApiKeyEnabled,
  type ApiKeyRow,
} from '../db/api-keys';
import { listDevices } from '../db/repository';
import { noStore } from '../middleware/no-store';
import { rateLimit } from '../middleware/rate-limit';
import { requireSameOrigin } from '../middleware/same-origin';
import { SESSION_COOKIE, SESSION_MAX_AGE, createSessionValue, hasValidSession, requireWebAuth } from '../middleware/session';
import { generateApiKey } from '../services/api-keys';
import { notifySchema, runNotify } from '../routes/notify';
import { dashboardPage } from '../web/dashboard';
import { loginPage } from '../web/login';

export const webRoutes = new Hono();

webRoutes.use('*', noStore);

function safeEqual(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}

function serializeApiKey(row: ApiKeyRow) {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    enabled: row.enabled === 1,
    allowedIps: row.allowed_ips,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function normalizeAllowedIps(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean).join(',');
  }
  if (typeof value === 'string') {
    return value
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join(',');
  }
  return '';
}

webRoutes.get('/login', (c) => {
  if (hasValidSession(c)) return c.redirect('/');
  return c.html(loginPage());
});

webRoutes.post(
  '/login',
  requireSameOrigin,
  rateLimit({ name: 'login', windowMs: 5 * 60_000, max: config.loginRateLimitMax }),
  async (c) => {
    const body = await c.req.parseBody();
    const user = String(body.user ?? '');
    const password = String(body.password ?? '');

    if (!safeEqual(user, config.adminUser) || !safeEqual(password, config.adminPassword)) {
      return c.html(loginPage('Usuario o contraseña incorrectos.'), 401);
    }

    setCookie(c, SESSION_COOKIE, createSessionValue(), {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      maxAge: SESSION_MAX_AGE,
      secure: config.isProduction,
    });
    return c.redirect('/');
  },
);

webRoutes.post('/logout', requireSameOrigin, (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.redirect('/login');
});

webRoutes.get('/api/devices', (c) => {
  const devices = listDevices().map((device) => ({
    deviceId: device.id,
    token: device.expo_token,
    platform: device.platform,
    enabled: device.enabled === 1,
    lastSeenAt: device.last_seen_at,
  }));
  return c.json({ ok: true, count: devices.length, devices });
});

webRoutes.post('/api/notify', async (c) => {
  const parsed = notifySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ ok: false, error: 'invalid_body', sent: 0, details: parsed.error.flatten() }, 400);
  }

  const outcome = await runNotify(parsed.data);
  if (outcome.ok) return c.json({ ok: true as const, sent: outcome.sent }, 200);

  const status = outcome.error === 'invalid_expo_token' ? 400 : 502;
  return c.json({ ok: false as const, error: outcome.error, sent: outcome.sent }, status);
});

webRoutes.get('/api/keys', (c) => {
  const keys = listApiKeys().map(serializeApiKey);
  return c.json({ ok: true, count: keys.length, keys });
});

webRoutes.post('/api/keys', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const name = String(body.name ?? '').trim();
  if (!name || name.length > 128) {
    return c.json({ ok: false, error: 'invalid_name' }, 400);
  }

  const { key, prefix, keyHash } = generateApiKey();
  const row = createApiKey({
    name,
    prefix,
    keyHash,
    allowedIps: normalizeAllowedIps(body.allowedIps),
  });

  return c.json({ ok: true, key, apiKey: serializeApiKey(row) }, 201);
});

webRoutes.patch('/api/keys/:id', async (c) => {
  const id = c.req.param('id');
  const existing = getApiKey(id);
  if (!existing) return c.json({ ok: false, error: 'not_found' }, 404);

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  if (typeof body.enabled === 'boolean') {
    setApiKeyEnabled(id, body.enabled);
  }
  if (body.allowedIps !== undefined) {
    setApiKeyAllowedIps(id, normalizeAllowedIps(body.allowedIps));
  }

  return c.json({ ok: true, apiKey: serializeApiKey(getApiKey(id) as ApiKeyRow) });
});

webRoutes.delete('/api/keys/:id', (c) => {
  const id = c.req.param('id');
  if (!getApiKey(id)) return c.json({ ok: false, error: 'not_found' }, 404);
  deleteApiKey(id);
  return c.json({ ok: true });
});

webRoutes.get('/', requireWebAuth, (c) => c.html(dashboardPage(config.adminUser)));
