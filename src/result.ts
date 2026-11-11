import { QueueError } from './queue/store';

/** Error esperado del dominio. Se traduce a problem details en el borde HTTP (ver `failureProblem`). */
export type Failure = { code: string; status: QueueError['status']; retryAfterMs: number };

export type Result<T, E = Failure> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const fail = (code: string, status: Failure['status'], retryAfterMs = 0): Result<never, Failure> => ({
  ok: false,
  error: { code, status, retryAfterMs },
});

export const isFailure = <T, E>(result: Result<T, E>): result is { ok: false; error: E } => !result.ok;

export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T => (result.ok ? result.value : fallback);

/**
 * Frontera con el almacén de la cola, que lanza `QueueError` por contrato.
 * Solo captura errores esperados; cualquier otro (bug, fallo de SQLite) se propaga.
 */
export function attempt<T>(operation: () => T): Result<T> {
  try {
    return ok(operation());
  } catch (error) {
    if (error instanceof QueueError) return fail(error.code, error.status, error.retryAfterMs);
    throw error;
  }
}
