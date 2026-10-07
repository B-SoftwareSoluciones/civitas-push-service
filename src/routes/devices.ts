import { Hono } from 'hono';
import { z } from 'zod';

import { deleteDevice, listDevices, upsertDevice } from '../db/repository';

const deviceSchema = z.object({
  deviceId: z.string().min(1).max(128),
  token: z.string().min(1).max(512),
  platform: z.string().min(1).max(32).optional(),
});

const syncSchema = deviceSchema.extend({
  items: z.array(z.unknown()).optional(),
});

export const devicesRoutes = new Hono();

devicesRoutes.get('/', (c) => {
  const devices = listDevices().map((device) => ({
    deviceId: device.id,
    token: device.expo_token,
    platform: device.platform,
    enabled: device.enabled === 1,
    createdAt: device.created_at,
    lastSeenAt: device.last_seen_at,
  }));
  return c.json({ ok: true, count: devices.length, devices });
});

devicesRoutes.post('/', async (c) => {
  const parsed = deviceSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', details: parsed.error.flatten() }, 400);
  }

  upsertDevice({
    id: parsed.data.deviceId,
    token: parsed.data.token,
    platform: parsed.data.platform,
  });
  return c.json({ ok: true });
});

devicesRoutes.post('/sync', async (c) => {
  const parsed = syncSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'invalid_body', details: parsed.error.flatten() }, 400);
  }

  upsertDevice({
    id: parsed.data.deviceId,
    token: parsed.data.token,
    platform: parsed.data.platform,
  });
  return c.json({ ok: true });
});

devicesRoutes.delete('/:id', (c) => {
  deleteDevice(c.req.param('id'));
  return c.json({ ok: true });
});
