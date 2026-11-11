import { config } from '../config';
import { queue } from '../queue/runtime';
import { publicJob, QueueError } from '../queue/store';
import { attempt, fail, ok, type Result } from '../result';
import {
  buildMessage,
  normalizeNotifyInput,
  validateIdempotency,
  type NotifyRequestInput,
} from './notifications';
import { createExpoTransport, ExpoRequestError } from './expo-push';

const transport = createExpoTransport(config.expoAccessToken);

type PublicJob = ReturnType<typeof publicJob>;

/** `sent: 1` Expo aceptó el mensaje en esta petición; `sent: 0` quedó en la cola. */
export type NotifyOutcome =
  | { sent: 0; job: PublicJob }
  | { sent: 1; ticketId: string; job: PublicJob };

export async function runNotify(request: NotifyRequestInput, owner = 'admin', key?: string): Promise<Result<NotifyOutcome>> {
  const normalized = normalizeNotifyInput(request);
  const input = normalized.input;
  const idempotencyKey = key ?? normalized.idempotencyKey;
  const validKey = validateIdempotency(idempotencyKey);
  if (!validKey.ok) return validKey;
  const built = buildMessage(input);
  if (!built.ok) return built;
  const message = built.value;
  const saveDevice = input.saveDevice === true;
  if (saveDevice) queue.registerToken(input.token);
  const begun = attempt(() => queue.beginImmediate(owner, input.deviceId, message, idempotencyKey, Date.now(), saveDevice));
  if (!begun.ok) return begun;
  const { job, replayed } = begun.value;
  if (job.delivery_mode === 'queued' && (job.status === 'queued' || job.status === 'sending')) {
    return ok({ sent: 0, job: publicJob(job) });
  }
  if (replayed) {
    if (job.status === 'sending') return fail('notification_in_progress', 409);
    if (!job.ticket_id) return fail(job.error || 'push_failed', 502);
    return ok({ sent: 1, ticketId: job.ticket_id, job: publicJob(job) });
  }
  let cooldown = 0;
  try {
    const [ticket] = await transport.send([message]);
    if (!queue.ownsImmediate(job.id)) return fail('send_outcome_unknown', 502);
    if (!ticket || ticket.status !== 'ok') {
      const code = ticket?.details?.error || 'push_failed';
      if (code === 'MessageRateExceeded') {
        cooldown = 5000;
        return ok({ sent: 0, job: publicJob(queue.deferImmediate(job.id, code, cooldown)) });
      }
      queue.update(job.id, 'dead', code, Date.now());
      if (code === 'DeviceNotRegistered') queue.invalidate(job.token);
      return fail(code, 502);
    }
    queue.update(job.id, 'awaiting_receipt', null, Date.now() + 15 * 60_000, ticket.id);
    return ok({ sent: 1, ticketId: ticket.id, job: publicJob(queue.get(job.id)!) });
  } catch (error) {
    if (error instanceof QueueError) return fail(error.code, error.status, error.retryAfterMs);
    const code = error instanceof ExpoRequestError ? error.code : 'send_outcome_unknown';
    cooldown = error instanceof ExpoRequestError && error.retryable ? Math.max(5000, error.retryAfterMs) : 0;
    if (error instanceof ExpoRequestError && error.code === 'expo_http_429') {
      return ok({ sent: 0, job: publicJob(queue.deferImmediate(job.id, code, cooldown)) });
    }
    queue.update(job.id, 'dead', code, Date.now());
    return fail(code, 502, cooldown);
  } finally {
    queue.completeImmediate(job.id, config.pushRate, cooldown);
  }
}
