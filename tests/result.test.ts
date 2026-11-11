import { test } from 'node:test';
import assert from 'node:assert/strict';

import { attempt, fail, isFailure, ok, unwrapOr, type Result } from '../src/result';
import { QueueError } from '../src/queue/store';
import {
  buildMessage,
  notifyRequestSchema,
  notifySchema,
  validateIdempotency,
} from '../src/services/notifications';

const base = { deviceId: 'result-device', token: 'ExponentPushToken[result-test]', message: 'Hola' };

test('ok and fail build the two Result variants', () => {
  assert.deepEqual(ok(5), { ok: true, value: 5 });
  assert.deepEqual(fail('queue_full', 503, 1000), { ok: false, error: { code: 'queue_full', status: 503, retryAfterMs: 1000 } });
  assert.deepEqual(fail('invalid_expo_token', 400), { ok: false, error: { code: 'invalid_expo_token', status: 400, retryAfterMs: 0 } });
});

test('attempt turns a thrown QueueError into a failure and keeps its metadata', () => {
  const success: Result<number> = attempt(() => 7);
  assert.deepEqual(success, ok(7));
  const failure = attempt(() => { throw new QueueError('queue_full', 503, 2500); });
  assert.deepEqual(failure, fail('queue_full', 503, 2500));
  assert.equal(isFailure(failure), true);
});

test('attempt does not swallow programming errors', () => {
  assert.throws(() => attempt(() => { throw new TypeError('bug'); }), TypeError);
});

test('unwrapOr returns the value or the fallback', () => {
  assert.equal(unwrapOr(ok('a'), 'b'), 'a');
  assert.equal(unwrapOr(fail('x', 400), 'b'), 'b');
});

test('validateIdempotency returns a Result instead of throwing', () => {
  assert.deepEqual(validateIdempotency(undefined), ok(undefined));
  assert.deepEqual(validateIdempotency('abc'), ok(undefined));
  assert.deepEqual(validateIdempotency('   '), fail('invalid_idempotency_key', 400));
  assert.deepEqual(validateIdempotency('x'.repeat(129)), fail('invalid_idempotency_key', 400));
});

test('buildMessage reports invalid tokens and oversized payloads as failures', () => {
  assert.deepEqual(buildMessage({ ...base, token: 'not-a-token' }), fail('invalid_expo_token', 400));
  assert.deepEqual(buildMessage({ ...base, message: 'x'.repeat(4000), data: { type: 'visit_entry', visitor: 'y'.repeat(256) } }), fail('payload_too_large', 400));
  const built = buildMessage(base);
  assert.equal(built.ok, true);
  assert.equal(built.ok && built.value.body, 'Hola');
});

test('propertyId is a string just like residenceId', () => {
  const accepted = notifySchema.safeParse({ ...base, data: { propertyId: '456', residenceId: '2' } });
  assert.equal(accepted.success, true);
  assert.equal(accepted.success && accepted.data.data?.propertyId, '456');
  assert.equal(notifySchema.safeParse({ ...base, data: { propertyId: 456 } }).success, false);
  assert.equal(notifySchema.safeParse({ ...base, data: { propertyId: 'p'.repeat(129) } }).success, false);
  assert.equal(notifyRequestSchema.safeParse({ ...base, data: { propertyId: 456 } }).success, false);
});
