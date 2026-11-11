import { z } from '@hono/zod-openapi';
import { notifySchema, buildMessage, validateIdempotency } from './notifications';
import { queue } from '../queue/runtime';
import { attempt, type Result } from '../result';
import type { ExpoPushMessage } from 'expo-server-sdk';

export const batchSchema = notifySchema.omit({ deviceId: true, token: true, saveDevice: true }).extend({
  name: z.string().trim().min(1).max(128).optional(),
  devices: z.array(notifySchema.pick({ deviceId: true, token: true, data: true }).strict()).min(1).max(1000),
}).strict().superRefine((batch, context) => {
  const ids = new Set<string>();
  const tokens = new Set<string>();
  batch.devices.forEach((device, index) => {
    if (ids.has(device.deviceId) || tokens.has(device.token)) context.addIssue({
      code: z.ZodIssueCode.custom, path: ['devices', index], message: 'Duplicate device or token',
    });
    ids.add(device.deviceId);
    tokens.add(device.token);
  });
}).openapi('BatchRequest');

export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export function runBatch(input: z.infer<typeof batchSchema>, owner: string, key?: string): Result<{ batch: ReturnType<typeof queue.enqueueBatch> }> {
  const validKey = validateIdempotency(key);
  if (!validKey.ok) return validKey;
  const entries: { deviceId: string; message: ExpoPushMessage }[] = [];
  for (const device of input.devices) {
    const built = buildMessage({ ...input, ...device, data: { ...input.data, ...device.data } });
    if (!built.ok) return built;
    entries.push({ deviceId: device.deviceId, message: built.value });
  }
  return attempt(() => ({ batch: queue.enqueueBatch(owner, entries, input.name ?? 'Lote de notificaciones', key) }));
}
