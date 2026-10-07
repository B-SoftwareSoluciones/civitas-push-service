import { Hono } from 'hono';
import { z } from 'zod';

import { upsertDevice } from '../db/repository';
import { sendPush } from '../services/expo-push';

const notifySchema = z.object({
  deviceId: z.string().min(1).max(128),
  token: z.string().min(1).max(512),
  message: z.string().min(1).max(4000),
  title: z.string().min(1).max(256).optional(),
  url: z.string().max(2048).optional(),
});

export const notifyRoutes = new Hono();

notifyRoutes.post('/', async (c) => {
  const parsed = notifySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', details: parsed.error.flatten() }, 400);
  }

  const { deviceId, token, message, title, url } = parsed.data;

  upsertDevice({ id: deviceId, token });

  const result = await sendPush([{ deviceId, token }], {
    title: title ?? 'Notificación',
    body: message,
    data: url ? { url } : undefined,
  });

  if (result.invalidTokens.length > 0) {
    return c.json({ ok: false, error: 'invalid_expo_token', sent: result.sent }, 400);
  }

  if (result.sent === 0) {
    return c.json({ ok: false, error: 'push_failed', sent: 0 }, 502);
  }

  return c.json({ ok: true, sent: result.sent });
});
