import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { queue } from '../queue/runtime';
import { publicJob } from '../queue/store';
import { ProblemError, problemContent, validationHook } from '../problem';
import { notifyRequestSchema } from '../services/notifications';
import { runNotify } from '../services/dispatch';

export const jobSchema = z.object({
  id: z.string(), deviceId: z.string(), status: z.enum(['queued', 'sending', 'awaiting_receipt', 'accepted', 'dead']),
  attempts: z.number(), error: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
  batchId: z.string().nullable(), deliveryMode: z.enum(['queued', 'immediate']),
  priority: z.enum(['default', 'normal', 'high']),
});
const successSchema = z.object({ ok: z.literal(true), job: jobSchema });
export const jsonContent = <T extends z.ZodTypeAny>(schema: T) => ({ content: { 'application/json': { schema } } });

export const notifyRoutes = new OpenAPIHono<{ Variables: { apiKey: { id: string } } }>({
  defaultHook: validationHook,
});

notifyRoutes.openapi(createRoute({
  method: 'post', path: '/', tags: ['Notify'], summary: 'Enviar un evento o notificación individual; la encola si no hay capacidad',
  security: [{ ApiKeyAuth: [] }],
  request: {
    headers: z.object({ 'idempotency-key': z.string().min(1).max(128).optional() }),
    body: { ...jsonContent(notifyRequestSchema), required: true },
  },
  responses: {
    200: { ...jsonContent(z.object({ ok: z.literal(true), sent: z.literal(1), ticketId: z.string(), job: jobSchema })), description: 'Expo aceptó el mensaje durante esta petición' },
    202: { ...jsonContent(z.object({ ok: z.literal(true), sent: z.literal(0), job: jobSchema })), description: 'Sin capacidad inmediata; notificación persistida en la cola' },
    400: { ...problemContent, description: 'Solicitud inválida' },
    401: { ...problemContent, description: 'API key ausente, inválida o deshabilitada' },
    403: { ...problemContent, description: 'IP no permitida' },
    409: { ...problemContent, description: 'Clave de idempotencia reutilizada con otro contenido' },
    502: { ...problemContent, description: 'Expo rechazó el envío o su resultado es incierto' },
    503: { ...problemContent, description: 'Cola llena' },
  },
}), async (c) => {
  const result = await runNotify(c.req.valid('json'), (c.get('apiKey') as { id: string }).id, c.req.header('idempotency-key'));
  c.header('Location', '/v1/notify/' + result.job.id);
  if (result.sent === 0) return c.json(result, 202);
  return c.json(result, 200);
});

notifyRoutes.openapi(createRoute({
  method: 'get', path: '/{id}', tags: ['Notify'], summary: 'Consultar estado de notificación',
  security: [{ ApiKeyAuth: [] }], request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: { ...jsonContent(successSchema), description: 'Estado actual' },
    400: { ...problemContent, description: 'Identificador inválido' },
    401: { ...problemContent, description: 'API key ausente, inválida o deshabilitada' },
    404: { ...problemContent, description: 'No encontrada' },
  },
}), (c) => {
  const job = queue.get(c.req.valid('param').id);
  if (!job || job.owner !== (c.get('apiKey') as { id: string }).id) throw new ProblemError(404, 'not_found');
  c.header('Cache-Control', 'no-store');
  return c.json({ ok: true as const, job: publicJob(job) }, 200);
});
