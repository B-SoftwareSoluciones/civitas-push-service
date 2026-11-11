import { z } from '@hono/zod-openapi';

import { Expo, type ExpoPushMessage } from 'expo-server-sdk';
import { fail, ok, type Result } from '../result';

const notifyDataSchema = z
  .object({
    type: z.string().max(64).optional().openapi({ example: 'visit_entry' }),
    screen: z.string().max(64).optional().openapi({ example: 'VisitStatus' }),
    visitId: z.string().max(128).optional().openapi({ example: 'VIS-0001' }),
    status: z
      .enum(['pending', 'inside', 'outside'])
      .optional()
      .openapi({ example: 'inside', description: 'Estado de la visita en el momento del aviso.' }),
    visitor: z.string().max(256).optional().openapi({ example: 'Juan Pérez' }),
    propertyLabel: z.string().max(256).optional().openapi({ example: 'Casa 4' }),
    occurredAt: z.string().max(64).optional().openapi({ example: '2026-10-27T14:32:00-06:00' }),
    propertyId: z.string().max(128).optional().openapi({
      example: '456',
      description: 'Identificador de la propiedad. Es una cadena (igual que `residenceId`); no se aceptan números.',
    }),
    residenceId: z.string().max(128).optional().openapi({
      example: '2',
      description: 'Identificador de la residencia. Es una cadena.',
    }),
  })
  .passthrough()
  .openapi('NotifyData');

const VISIT_EVENT_TYPES = new Set([
  'visit_created',
  'visit_registered',
  'visit_entry',
  'visit_exit',
  'visit.created',
  'visit.registered',
  'visit.entry',
  'visit.exit',
]);

const PANIC_EVENT_TYPES = new Set(['panic', 'panic.triggered']);
const ANNOUNCEMENT_EVENT_TYPES = new Set(['announcement.generic', 'announcement.published']);

const EVENT_SCREENS: Record<string, string> = {
  'visit.created': 'VisitStatus',
  'visit.registered': 'VisitStatus',
  'visit.entry': 'VisitStatus',
  'visit.exit': 'VisitStatus',
  panic: 'SecurityDashboard',
  'panic.triggered': 'SecurityDashboard',
  'notification.generic': 'None',
  'announcement.generic': 'Announcements',
  'announcement.published': 'Announcements',
};

export const PANIC_SOUND = 'panic.wav';
export const PANIC_CHANNEL = 'panic_alarm';
export const PANIC_INTERRUPTION_LEVEL = 'time-sensitive' as const;
export const NO_SCREEN = 'None';
export const ANNOUNCEMENTS_SCREEN = 'Announcements';

const SOUND_NAME_PATTERN = /^[A-Za-z0-9_-]+\.(wav|caf|aiff)$/;

export function resolveScreen(data?: { type?: string; screen?: string }): string {
  if (data?.screen) return data.screen;
  if (data?.type) {
    const screen = EVENT_SCREENS[data.type];
    if (screen) return screen;
    if (VISIT_EVENT_TYPES.has(data.type)) return 'VisitStatus';
  }
  return 'Splash';
}

const deliveryFields = {
  deviceId: z.string().min(1).max(128).openapi({ example: 'device-123' }),
  token: z
    .string()
    .min(1)
    .max(512)
    .openapi({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' }),
  message: z.string().min(1).max(4000).openapi({ example: 'Tienes una visita en la puerta.' }),
  title: z.string().min(1).max(256).optional().openapi({ example: 'Civitas Access' }),
  saveDevice: z
    .boolean()
    .optional()
    .openapi({
      example: false,
      default: false,
      description: 'Guarda o actualiza el dispositivo y reactiva tokens retirados. Por defecto no se guarda.',
    }),
  url: z
    .string()
    .max(2048)
    .optional()
    .openapi({ example: 'app://visit/123', description: 'Deep link opcional. Si se omite, se usa `screen` (por defecto Splash).' }),
  priority: z
    .enum(['default', 'normal', 'high'])
    .optional()
    .openapi({ example: 'high', description: 'Prioridad de procesamiento en cola y de envío a Expo: high, normal, default. Sin valor se usa default.' }),
  channelId: z.string().max(64).optional().openapi({ example: PANIC_CHANNEL }),
  sound: z
    .string()
    .max(128)
    .regex(SOUND_NAME_PATTERN, 'invalid_sound')
    .optional()
    .openapi({
      example: PANIC_SOUND,
      description: 'Sonido personalizado incluido en la app (.wav, .caf o .aiff). Los eventos de pánico usan "panic.wav" por defecto.',
    }),
  interruptionLevel: z
    .enum(['active', 'time-sensitive', 'passive'])
    .optional()
    .openapi({
      example: PANIC_INTERRUPTION_LEVEL,
      description: 'Nivel de interrupción en iOS. Los eventos de pánico usan "time-sensitive" por defecto.',
    }),
};

export const notifySchema = z
  .object({
    ...deliveryFields,
    data: notifyDataSchema.optional().openapi({
      description: 'Datos para el enrutamiento interno de la app. Si falta `screen`, se resuelve por `type` o se asume "Splash".',
    }),
  })
  .openapi('NotifyRequest');

export const envelopeSchema = z
  .object({
    id: z.string().min(1).max(128).openapi({ example: 'evt_01J9Z8K4M2' }),
    type: z.string().min(1).max(64).openapi({ example: 'visit.entry' }),
    version: z.number().int().min(1).max(1000).default(1).openapi({ example: 1 }),
    occurredAt: z.string().min(1).max(64).openapi({ example: '2026-11-05T14:32:00-06:00' }),
    source: z.string().min(1).max(128).openapi({ example: 'civitas.access.visits' }),
    data: notifyDataSchema.optional().openapi({
      description: 'Carga del evento. Se aplana en `data` del push y se acompaña de `data.event`.',
    }),
    notification: z
      .object({
        ...deliveryFields,
        screen: z
          .string()
          .max(64)
          .optional()
          .openapi({ example: 'VisitStatus', description: 'Pantalla destino. Si falta, se resuelve por `type`.' }),
      })
      .openapi('EventNotification'),
  })
  .openapi('EventEnvelope');

export const notifyRequestSchema = z.union([envelopeSchema, notifySchema]);

export type EnvelopeInput = z.infer<typeof envelopeSchema>;

export type EventEnvelopeMeta = {
  id: string;
  type: string;
  version: number;
  occurredAt: string;
  source: string;
};

export type NotifyInput = z.infer<typeof notifySchema> & { event?: EventEnvelopeMeta };

export type NotifyRequestInput = NotifyInput | EnvelopeInput;

export function isEnvelopeInput(input: NotifyRequestInput): input is EnvelopeInput {
  return typeof input === 'object' && input !== null && 'notification' in input && 'source' in input && 'version' in input;
}

export function normalizeNotifyInput(input: NotifyRequestInput): { input: NotifyInput; idempotencyKey?: string } {
  if (!isEnvelopeInput(input)) return { input };
  const { screen, ...delivery } = input.notification;
  return {
    input: {
      ...delivery,
      data: {
        ...(input.data ?? {}),
        type: input.type,
        ...(screen ? { screen } : {}),
      },
      event: {
        id: input.id,
        type: input.type,
        version: input.version,
        occurredAt: input.occurredAt,
        source: input.source,
      },
    },
    idempotencyKey: input.id,
  };
}

export function validateIdempotency(key?: string): Result<void> {
  if (key !== undefined && (!key.trim() || key.length > 128)) return fail('invalid_idempotency_key', 400);
  return ok(undefined);
}

export function buildMessage(input: NotifyInput): Result<ExpoPushMessage> {
  if (!Expo.isExpoPushToken(input.token)) return fail('invalid_expo_token', 400);
  const isPanic = input.data?.type ? PANIC_EVENT_TYPES.has(input.data.type) : false;
  const isAnnouncement = input.data?.type ? ANNOUNCEMENT_EVENT_TYPES.has(input.data.type) : false;
  const data = {
    ...input.data,
    screen: resolveScreen(input.data),
    ...(isAnnouncement && input.title ? { title: input.title } : {}),
    ...(isAnnouncement ? { message: input.message } : {}),
    ...(input.url ? { url: input.url } : {}),
    ...(input.event ? { event: input.event } : {}),
  };
  const channelId = input.channelId ?? (isPanic ? PANIC_CHANNEL : undefined);
  const priority = input.priority ?? (isPanic ? 'high' : undefined);
  const interruptionLevel = input.interruptionLevel ?? (isPanic ? PANIC_INTERRUPTION_LEVEL : undefined);
  const message: ExpoPushMessage = {
    to: input.token, title: input.title ?? 'Notificación', body: input.message,
    sound: input.sound ?? (isPanic ? PANIC_SOUND : 'default'), data,
    ...(priority ? { priority } : {}),
    ...(channelId ? { channelId } : {}),
    ...(interruptionLevel ? { interruptionLevel } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(message), 'utf8') > 4096) return fail('payload_too_large', 400);
  return ok(message);
}
