import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { batchSchema, pageSchema, runBatch } from '../services/batches';
import { queue } from '../queue/runtime';
import { publicJob } from '../queue/store';
import { ProblemError, failureProblem, problemContent, problemResponse, validationHook } from '../problem';
import { batchAcceptedExample, batchDescription, batchRequestExamples } from '../docs/notifications';
import { jobSchema, jsonContent } from './notify';

const batchResponse = z.object({
  id: z.string().uuid(), name: z.string(), total: z.number(), status: z.string(),
  counts: z.object({ queued: z.number(), sending: z.number(), awaiting_receipt: z.number(), accepted: z.number(), dead: z.number() }),
  processed: z.number(), finished: z.number(), progress: z.number(), createdAt: z.string(),
});
const successSchema = z.object({ ok: z.literal(true), batch: batchResponse });
const params = z.object({ id: z.string().uuid() });
const security = [{ ApiKeyAuth: [] }];

export const batchesRoutes = new OpenAPIHono<{ Variables: { apiKey: { id: string } } }>({
  defaultHook: validationHook,
});

batchesRoutes.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  await next();
});

batchesRoutes.openapi(createRoute({
  method: 'post', path: '/', tags: ['Batches'], summary: 'Encolar un lote de hasta 1000 dispositivos', description: batchDescription, security,
  request: {
    headers: z.object({
      'idempotency-key': z.string().min(1).max(128).optional().openapi({
        description: 'Clave de idempotencia (1–128 caracteres) para reintentar el lote sin duplicarlo.',
        example: 'batch-panic-casa-4',
      }),
    }),
    body: { ...jsonContent(batchSchema, batchRequestExamples), required: true },
  },
  responses: {
    202: { ...jsonContent(successSchema, batchAcceptedExample), description: 'Lote persistido completamente. Incluye `Location` con el recurso del lote.' },
    400: problemResponse('Lote inválido: esquema, dispositivos duplicados, token de Expo, clave de idempotencia o tamaño', [
      { code: 'invalid_body', status: 400, instance: '/v1/batches', errors: [{ detail: 'Duplicate device or token', pointer: '#/devices/1' }] },
      { code: 'invalid_expo_token', status: 400, instance: '/v1/batches' },
      { code: 'invalid_idempotency_key', status: 400, instance: '/v1/batches' },
      { code: 'payload_too_large', status: 400, instance: '/v1/batches' },
      { code: 'device_not_registered', status: 400, instance: '/v1/batches' },
    ]),
    401: problemResponse('API key ausente, inválida o deshabilitada', [
      { code: 'unauthorized', status: 401, instance: '/v1/batches' },
      { code: 'api_key_disabled', status: 401, instance: '/v1/batches' },
    ]),
    409: problemResponse('Clave de idempotencia reutilizada con otro contenido', [{ code: 'idempotency_conflict', status: 409, instance: '/v1/batches' }]),
    413: problemResponse('Cuerpo mayor a 1 MB', [{ code: 'body_too_large', status: 413, instance: '/v1/batches' }]),
    503: problemResponse('Cola sin capacidad para el lote completo; respeta `Retry-After`', [{ code: 'queue_full', status: 503, instance: '/v1/batches' }]),
  },
}), (c) => {
  const result = runBatch(c.req.valid('json'), c.get('apiKey').id, c.req.header('idempotency-key'));
  if (!result.ok) return failureProblem(c, result.error) as never;
  c.header('Location', '/v1/batches/' + result.value.batch.id);
  return c.json({ ok: true as const, ...result.value }, 202);
});

batchesRoutes.openapi(createRoute({
  method: 'get', path: '/', tags: ['Batches'], summary: 'Listar mis lotes', security,
  request: { query: pageSchema }, responses: {
    200: { ...jsonContent(z.object({ ok: z.literal(true), batches: z.array(batchResponse), limit: z.number(), offset: z.number() })), description: 'Lotes de la API key actual' },
  },
}), (c) => {
  const { limit, offset } = c.req.valid('query');
  return c.json({ ok: true as const, batches: queue.batches(c.get('apiKey').id, limit, offset), limit, offset }, 200);
});

batchesRoutes.openapi(createRoute({
  method: 'get', path: '/{id}', tags: ['Batches'], summary: 'Consultar progreso del lote', security,
  request: { params }, responses: {
    200: { ...jsonContent(successSchema), description: 'Progreso y resultados agregados' },
    400: { ...problemContent, description: 'Parámetros inválidos' },
    404: { ...problemContent, description: 'Lote no encontrado' },
  },
}), (c) => {
  const batch = queue.batch(c.req.valid('param').id, c.get('apiKey').id);
  if (!batch) throw new ProblemError(404, 'not_found');
  return c.json({ ok: true as const, batch }, 200);
});

batchesRoutes.openapi(createRoute({
  method: 'get', path: '/{id}/jobs', tags: ['Batches'], summary: 'Consultar resultados por dispositivo', security,
  request: { params, query: pageSchema }, responses: {
    200: { ...jsonContent(z.object({ ok: z.literal(true), jobs: z.array(jobSchema), total: z.number(), limit: z.number(), offset: z.number() })), description: 'Página de dispositivos y estados' },
    400: { ...problemContent, description: 'Parámetros inválidos' },
    404: { ...problemContent, description: 'Lote no encontrado' },
  },
}), (c) => {
  const batch = queue.batch(c.req.valid('param').id, c.get('apiKey').id);
  if (!batch) throw new ProblemError(404, 'not_found');
  const { limit, offset } = c.req.valid('query');
  return c.json({ ok: true as const, jobs: queue.batchJobs(batch.id, limit, offset).map(publicJob), total: batch.total, limit, offset }, 200);
});
