import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ZodError, ZodIssue } from 'zod';

import { QueueError } from './queue/store';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';

export type ProblemIssue = { detail: string; pointer: string };

type ProblemOptions = { detail?: string; errors?: ProblemIssue[] };

const CATALOG: Record<string, { title: string; detail: string }> = {
  invalid_body: { title: 'Cuerpo de la solicitud inválido', detail: 'El cuerpo de la solicitud no cumple el esquema esperado.' },
  invalid_query: { title: 'Parámetros de consulta inválidos', detail: 'Los parámetros de consulta no cumplen el esquema esperado.' },
  invalid_param: { title: 'Parámetros de ruta inválidos', detail: 'Los parámetros de la ruta no cumplen el formato esperado.' },
  invalid_header: { title: 'Encabezados inválidos', detail: 'Uno o más encabezados de la solicitud no son válidos.' },
  invalid_idempotency_key: { title: 'Clave de idempotencia inválida', detail: 'La clave de idempotencia debe tener entre 1 y 128 caracteres.' },
  invalid_expo_token: { title: 'Token de Expo inválido', detail: 'El token no es un ExponentPushToken válido.' },
  payload_too_large: { title: 'Notificación demasiado grande', detail: 'La notificación supera el máximo de 4096 bytes permitido por Expo.' },
  body_too_large: { title: 'Cuerpo demasiado grande', detail: 'El cuerpo de la solicitud supera el tamaño máximo permitido.' },
  device_not_registered: { title: 'Dispositivo no registrado', detail: 'El token del dispositivo fue retirado; registre el dispositivo de nuevo.' },
  idempotency_conflict: { title: 'Conflicto de idempotencia', detail: 'La clave de idempotencia ya se usó con otro contenido.' },
  notification_in_progress: { title: 'Notificación en curso', detail: 'Una solicitud con la misma clave de idempotencia sigue en proceso.' },
  job_not_retryable: { title: 'Trabajo no reintentable', detail: 'Solo se pueden reintentar trabajos fallidos.' },
  immediate_job_not_retryable: { title: 'Envío inmediato no reintentable', detail: 'Los envíos inmediatos no se reintentan automáticamente.' },
  job_expired: { title: 'Trabajo expirado', detail: 'El trabajo superó su tiempo de vida y ya no puede reintentarse.' },
  queue_full: { title: 'Cola llena', detail: 'La cola no tiene capacidad; reintente después del intervalo indicado.' },
  send_outcome_unknown: { title: 'Resultado de envío incierto', detail: 'No se pudo confirmar si Expo aceptó el mensaje; reintente con la misma clave de idempotencia.' },
  push_provider_error: { title: 'Error del proveedor de notificaciones', detail: 'Expo rechazó el envío o no respondió correctamente.' },
  unauthorized: { title: 'No autorizado', detail: 'Falta una credencial válida.' },
  api_key_disabled: { title: 'API key deshabilitada', detail: 'La API key está deshabilitada.' },
  ip_not_allowed: { title: 'IP no permitida', detail: 'La IP de origen no está en la lista permitida de la API key.' },
  forbidden_origin: { title: 'Origen no permitido', detail: 'La solicitud proviene de un origen no permitido.' },
  not_found: { title: 'Recurso no encontrado', detail: 'El recurso solicitado no existe.' },
  route_not_found: { title: 'Ruta no encontrada', detail: 'La ruta solicitada no existe.' },
};

const STATUS_TITLES: Partial<Record<number, string>> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  409: 'Conflict',
  413: 'Payload Too Large',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

const VALIDATION_CODES: Record<string, string> = {
  json: 'invalid_body',
  query: 'invalid_query',
  param: 'invalid_param',
  header: 'invalid_header',
};

export class ProblemError extends Error {
  constructor(public status: ContentfulStatusCode, public code: string, public options: ProblemOptions = {}) {
    super(code);
  }
}

export function problem(
  c: Context,
  status: ContentfulStatusCode,
  code: string | null,
  options: ProblemOptions & { headers?: Record<string, string> } = {},
): Response {
  const entry = code ? CATALOG[code] : undefined;
  const body = {
    type: code ? `/problems/${code.replace(/_/g, '-')}` : 'about:blank',
    title: entry?.title ?? STATUS_TITLES[status] ?? 'Error',
    status,
    detail: options.detail ?? entry?.detail,
    instance: c.req.path,
    ...(options.errors?.length ? { errors: options.errors } : {}),
  };
  return c.body(JSON.stringify(body), status, { ...options.headers, 'Content-Type': PROBLEM_CONTENT_TYPE });
}

const depthOf = (error: ZodError) => Math.max(0, ...error.issues.map((issue) => issue.path.length));

function closestIssues(error: ZodError): ZodIssue[] {
  return error.issues.flatMap((issue) => {
    if (issue.code !== 'invalid_union' || issue.unionErrors.length === 0) return [issue];
    // The branch whose errors sit deepest matched the most of the input; ties go to the one with fewer errors.
    const closest = issue.unionErrors.reduce((best, current) => {
      const [currentDepth, bestDepth] = [depthOf(current), depthOf(best)];
      return currentDepth > bestDepth || (currentDepth === bestDepth && current.issues.length < best.issues.length) ? current : best;
    });
    return closestIssues(closest);
  });
}

function pointer(path: (string | number)[]): string {
  if (path.length === 0) return '#';
  return '#/' + path.map((token) => String(token).replace(/~/g, '~0').replace(/\//g, '~1')).join('/');
}

export function zodProblemErrors(error: ZodError): ProblemIssue[] {
  return closestIssues(error).map((issue) => ({ detail: issue.message, pointer: pointer(issue.path) }));
}

export function validationHook(result: { success: boolean; target?: string; error?: ZodError }, c: Context): Response | void {
  if (result.success || !result.error) return;
  const code = VALIDATION_CODES[result.target ?? ''] ?? 'invalid_body';
  return problem(c, 400, code, { errors: zodProblemErrors(result.error) });
}

export function problemErrorHandler(error: Error, c: Context): Response {
  if (error instanceof ProblemError) return problem(c, error.status, error.code, error.options);
  if (error instanceof QueueError) {
    const headers = error.status === 503
      ? { 'Retry-After': String(Math.max(1, Math.ceil((error.retryAfterMs || 60_000) / 1000))) }
      : undefined;
    if (error.code in CATALOG) return problem(c, error.status, error.code, { headers });
    return problem(c, error.status, 'push_provider_error', { detail: error.code, headers });
  }
  if (error instanceof HTTPException) return problem(c, error.status, null, { detail: error.message });
  console.error(error);
  return problem(c, 500, null, { detail: 'Error interno del servidor.' });
}

export const problemSchema = z
  .object({
    type: z.string().openapi({ example: '/problems/invalid-body' }),
    title: z.string().openapi({ example: 'Cuerpo de la solicitud inválido' }),
    status: z.number().int().openapi({ example: 400 }),
    detail: z.string().optional(),
    instance: z.string().optional().openapi({ example: '/v1/notify' }),
    errors: z
      .array(z.object({ detail: z.string(), pointer: z.string().openapi({ example: '#/data/propertyId' }) }))
      .optional(),
  })
  .openapi('Problem');

export const problemContent = { content: { [PROBLEM_CONTENT_TYPE]: { schema: problemSchema } } };
