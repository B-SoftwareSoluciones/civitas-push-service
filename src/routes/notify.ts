import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { queue } from '../queue/runtime';
import { publicJob } from '../queue/store';
import { ProblemError, failureProblem, problemResponse, validationHook } from '../problem';
import { notifyRequestSchema } from '../services/notifications';
import { runNotify } from '../services/dispatch';
import {
  jobStatusExamples,
  notifyAcceptedExample,
  notifyDescription,
  notifyQueuedExample,
  notifyRequestExamples,
} from '../docs/notifications';

export const jobSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Identificador del trabajo; úsalo en `GET /v1/notify/{id}`.' }),
  deviceId: z.string(),
  status: z.enum(['queued', 'sending', 'awaiting_receipt', 'accepted', 'dead']).openapi({
    description: '`queued` en cola, `sending` enviándose, `awaiting_receipt` aceptado por Expo a la espera del recibo, `accepted` entregado a Expo, `dead` fallido definitivamente.',
  }),
  attempts: z.number().int().openapi({ description: 'Intentos de envío realizados.' }),
  error: z.string().nullable().openapi({ description: 'Código del último error, o `null`.' }),
  createdAt: z.string().openapi({ description: 'Fecha ISO 8601 (UTC).' }),
  updatedAt: z.string().openapi({ description: 'Fecha ISO 8601 (UTC).' }),
  batchId: z.string().nullable().openapi({ description: 'Lote al que pertenece, o `null` si es un envío individual.' }),
  deliveryMode: z.enum(['queued', 'immediate']).openapi({ description: '`immediate` si se intentó durante la petición; `queued` si lo envía el worker.' }),
  priority: z.enum(['default', 'normal', 'high']),
}).openapi('Job');
const successSchema = z.object({ ok: z.literal(true), job: jobSchema });
const acceptedSchema = z.object({ ok: z.literal(true), sent: z.literal(1), ticketId: z.string(), job: jobSchema }).openapi('NotifyAccepted');
const queuedSchema = z.object({ ok: z.literal(true), sent: z.literal(0), job: jobSchema }).openapi('NotifyQueued');
export const jsonContent = <T extends z.ZodTypeAny>(schema: T, examples?: Record<string, { summary: string; description?: string; value: unknown }>) => ({
  content: { 'application/json': { schema, ...(examples ? { examples } : {}) } },
});

const authProblems = (instance: string) => [
  { code: 'unauthorized', status: 401, instance },
  { code: 'api_key_disabled', status: 401, instance },
];

export const notifyRoutes = new OpenAPIHono<{ Variables: { apiKey: { id: string } } }>({
  defaultHook: validationHook,
});

notifyRoutes.openapi(createRoute({
  method: 'post', path: '/', tags: ['Notify'], summary: 'Enviar un evento o notificación individual; la encola si no hay capacidad',
  description: notifyDescription,
  security: [{ ApiKeyAuth: [] }],
  request: {
    headers: z.object({
      'idempotency-key': z.string().min(1).max(128).optional().openapi({
        description: 'Clave de idempotencia (1–128 caracteres). Si se omite y el cuerpo es un envelope, se usa su `id`.',
        example: 'evt_visit_entry_01',
      }),
    }),
    body: { ...jsonContent(notifyRequestSchema, notifyRequestExamples), required: true },
  },
  responses: {
    200: { ...jsonContent(acceptedSchema, notifyAcceptedExample), description: 'Expo aceptó el mensaje durante esta petición. Incluye `Location` con el recurso de estado.' },
    202: { ...jsonContent(queuedSchema, notifyQueuedExample), description: 'Sin capacidad inmediata (o Expo pidió esperar); notificación persistida en la cola. Incluye `Location`.' },
    400: problemResponse('Solicitud inválida: esquema, token de Expo, clave de idempotencia o tamaño', [
      { code: 'invalid_body', status: 400, instance: '/v1/notify', errors: [{ detail: 'Expected string, received number', pointer: '#/data/propertyId' }] },
      { code: 'invalid_expo_token', status: 400, instance: '/v1/notify' },
      { code: 'invalid_idempotency_key', status: 400, instance: '/v1/notify' },
      { code: 'payload_too_large', status: 400, instance: '/v1/notify' },
      { code: 'device_not_registered', status: 400, instance: '/v1/notify' },
    ]),
    401: problemResponse('API key ausente, inválida o deshabilitada', authProblems('/v1/notify')),
    403: problemResponse('IP no permitida para esta API key', [{ code: 'ip_not_allowed', status: 403, instance: '/v1/notify' }]),
    409: problemResponse('Clave de idempotencia reutilizada con otro contenido, o petición original aún en curso', [
      { code: 'idempotency_conflict', status: 409, instance: '/v1/notify' },
      { code: 'notification_in_progress', status: 409, instance: '/v1/notify' },
    ]),
    413: problemResponse('Cuerpo mayor a 16 KB', [{ code: 'body_too_large', status: 413, instance: '/v1/notify' }]),
    502: problemResponse('Expo rechazó el envío o su resultado es incierto; reintenta con la misma clave de idempotencia', [
      { code: 'push_provider_error', status: 502, instance: '/v1/notify', detail: 'DeviceNotRegistered' },
      { code: 'send_outcome_unknown', status: 502, instance: '/v1/notify' },
    ]),
    503: problemResponse('Cola llena; respeta el encabezado `Retry-After`', [{ code: 'queue_full', status: 503, instance: '/v1/notify' }]),
  },
}), async (c) => {
  const result = await runNotify(c.req.valid('json'), (c.get('apiKey') as { id: string }).id, c.req.header('idempotency-key'));
  if (!result.ok) return failureProblem(c, result.error) as never;
  const outcome = result.value;
  c.header('Location', '/v1/notify/' + outcome.job.id);
  if (outcome.sent === 0) return c.json({ ok: true as const, ...outcome }, 202);
  return c.json({ ok: true as const, ...outcome }, 200);
});

notifyRoutes.openapi(createRoute({
  method: 'get', path: '/{id}', tags: ['Notify'], summary: 'Consultar estado de notificación',
  description: 'Devuelve el estado actual de una notificación enviada con `POST /v1/notify` (el `id` es `job.id`). Solo el dueño de la API key puede consultarla; las demás reciben **404**.',
  security: [{ ApiKeyAuth: [] }],
  request: { params: z.object({ id: z.string().uuid().openapi({ description: '`job.id` devuelto al enviar.', example: '3f2b8c1e-7a44-4d0e-9b55-1c2d3e4f5a6b' }) }) },
  responses: {
    200: { ...jsonContent(successSchema, jobStatusExamples), description: 'Estado actual' },
    400: problemResponse('Identificador inválido', [{ code: 'invalid_param', status: 400, instance: '/v1/notify/abc', errors: [{ detail: 'Invalid uuid', pointer: '#/id' }] }]),
    401: problemResponse('API key ausente, inválida o deshabilitada', authProblems('/v1/notify/3f2b8c1e-7a44-4d0e-9b55-1c2d3e4f5a6b')),
    404: problemResponse('No encontrada o de otra API key', [{ code: 'not_found', status: 404, instance: '/v1/notify/3f2b8c1e-7a44-4d0e-9b55-1c2d3e4f5a6b' }]),
  },
}), (c) => {
  const job = queue.get(c.req.valid('param').id);
  if (!job || job.owner !== (c.get('apiKey') as { id: string }).id) throw new ProblemError(404, 'not_found');
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true as const, job: publicJob(job) }, 200);
});
