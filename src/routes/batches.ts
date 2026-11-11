import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import { batchSchema, pageSchema, runBatch } from '../services/batches';
import { queue } from '../queue/runtime';
import { publicJob } from '../queue/store';
import { ProblemError, problemContent, validationHook } from '../problem';
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
  method: 'post', path: '/', tags: ['Batches'], summary: 'Encolar un lote de hasta 1000 dispositivos', security,
  request: { headers: z.object({ 'idempotency-key': z.string().min(1).max(128).optional() }), body: { ...jsonContent(batchSchema), required: true } },
  responses: {
    202: { ...jsonContent(successSchema), description: 'Lote persistido completamente' },
    400: { ...problemContent, description: 'Lote inválido' },
    401: { ...problemContent, description: 'API key ausente, inválida o deshabilitada' },
    409: { ...problemContent, description: 'Conflicto de idempotencia' },
    503: { ...problemContent, description: 'Cola sin capacidad para el lote completo' },
  },
}), (c) => {
  const result = runBatch(c.req.valid('json'), c.get('apiKey').id, c.req.header('idempotency-key'));
  c.header('Location', '/v1/batches/' + result.batch.id);
  return c.json(result, 202);
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
