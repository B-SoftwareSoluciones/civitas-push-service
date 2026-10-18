import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';

import { upsertDevice } from '../db/repository';
import { sendPush } from '../services/expo-push';

const notifyDataSchema = z
  .object({
    type: z.string().max(64).optional().openapi({ example: 'visit_registered' }),
    screen: z.string().max(64).optional().openapi({ example: 'AccessPass' }),
    visitId: z.string().max(128).optional().openapi({ example: 'VIS-0001' }),
    propertyId: z.number().int().optional().openapi({ example: 456 }),
    residenceId: z.number().int().optional().openapi({ example: 2 }),
  })
  .passthrough()
  .openapi('NotifyData');

export const notifySchema = z
  .object({
    deviceId: z.string().min(1).max(128).openapi({ example: 'device-123' }),
    token: z
      .string()
      .min(1)
      .max(512)
      .openapi({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' }),
    message: z.string().min(1).max(4000).openapi({ example: 'Tienes una visita en la puerta.' }),
    title: z.string().min(1).max(256).optional().openapi({ example: 'Civitas Access' }),
    url: z
      .string()
      .max(2048)
      .optional()
      .openapi({ example: 'app://visit/123', description: 'Deep link opcional. Si se omite, la app abre la pantalla de inicio (Home).' }),
    data: notifyDataSchema.optional().openapi({
      description: 'Datos para el enrutamiento interno de la app. Si falta `screen`, se asume "Home".',
    }),
    priority: z
      .enum(['default', 'normal', 'high'])
      .optional()
      .openapi({ example: 'high' }),
    channelId: z.string().max(64).optional().openapi({ example: 'panic' }),
  })
  .openapi('NotifyRequest');

export type NotifyInput = z.infer<typeof notifySchema>;

export type NotifyOutcome =
  | { ok: true; sent: number }
  | { ok: false; error: string; sent: number };

export async function runNotify(input: NotifyInput): Promise<NotifyOutcome> {
  const { deviceId, token, message, title, url, data, priority, channelId } = input;

  upsertDevice({ id: deviceId, token });

  const pushData: Record<string, unknown> = { ...(data ?? {}) };
  if (!pushData.screen) pushData.screen = 'Home';
  if (url) pushData.url = url;

  const result = await sendPush([{ deviceId, token }], {
    title: title ?? 'Notificación',
    body: message,
    data: pushData,
    priority,
    channelId,
  });

  if (result.error) return { ok: false, error: result.error, sent: result.sent };
  if (result.invalidTokens.length > 0) {
    return { ok: false, error: 'invalid_expo_token', sent: result.sent };
  }
  if (result.sent === 0) return { ok: false, error: 'push_failed', sent: 0 };

  return { ok: true, sent: result.sent };
}

const notifySuccessSchema = z
  .object({
    ok: z.literal(true),
    sent: z.number(),
  })
  .openapi('NotifySuccess');

const notifyErrorSchema = z
  .object({
    ok: z.literal(false),
    error: z.string(),
    sent: z.number(),
    details: z
      .object({
        formErrors: z.array(z.string()),
        fieldErrors: z.record(z.array(z.string())),
      })
      .optional(),
  })
  .openapi('NotifyError');

const jsonContent = <T extends z.ZodTypeAny>(schema: T) => ({
  content: { 'application/json': { schema } },
});

const notifyRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Notify'],
  summary: 'Enviar notificación push',
  description:
    'Registra el dispositivo y envía una notificación push a través de Expo. Requiere API key (`Authorization: Bearer <key>` o `X-API-Key`).',
  security: [{ ApiKeyAuth: [] }],
  request: {
    body: {
      ...jsonContent(notifySchema),
      required: true,
    },
  },
  responses: {
    200: {
      ...jsonContent(notifySuccessSchema),
      description: 'Notificación enviada',
    },
    400: {
      ...jsonContent(notifyErrorSchema),
      description: 'Cuerpo inválido o token de Expo inválido',
    },
    401: {
      ...jsonContent(notifyErrorSchema),
      description: 'API key ausente, inválida o deshabilitada',
    },
    502: {
      ...jsonContent(notifyErrorSchema),
      description: 'Fallo al enviar la notificación',
    },
  },
});

export const notifyRoutes = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      return c.json(
        { ok: false, error: 'invalid_body', sent: 0, details: result.error.flatten() },
        400,
      );
    }
  },
});

notifyRoutes.openapi(notifyRoute, async (c) => {
  const outcome = await runNotify(c.req.valid('json'));

  if (outcome.ok) {
    return c.json({ ok: true as const, sent: outcome.sent }, 200);
  }

  if (outcome.error === 'invalid_expo_token') {
    return c.json({ ok: false as const, error: outcome.error, sent: outcome.sent }, 400);
  }

  return c.json({ ok: false as const, error: outcome.error, sent: outcome.sent }, 502);
});
