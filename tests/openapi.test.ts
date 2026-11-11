import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { z } from 'zod';

const folder = mkdtempSync(join(tmpdir(), 'push-openapi-'));
process.env.DATABASE_PATH = join(folder, 'test.sqlite');
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-characters';
process.env.API_KEY_PEPPER = 'test-api-pepper-at-least-32-characters';
process.env.ADMIN_PASSWORD = 'test-password-long-enough';
process.env.ADMIN_USER = 'admin';
process.env.TRUST_PROXY = 'false';
const { app, openApiConfig } = await import('../src/app');
const { db } = await import('../src/db/client');
const { createApiKey } = await import('../src/db/api-keys');
const { generateApiKey } = await import('../src/services/api-keys');
const { createSessionValue, SESSION_COOKIE } = await import('../src/middleware/session');
const { notifyRequestSchema } = await import('../src/services/notifications');
const { batchSchema } = await import('../src/services/batches');
const docs = await import('../src/docs/notifications');
const { jobSchema } = await import('../src/routes/notify');

const generated = generateApiKey();
createApiKey({ name: 'openapi', prefix: generated.prefix, keyHash: generated.keyHash });
const apiKey = generated.key;

const post = (path: string, body: unknown, idempotency?: string) => app.request(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-api-key': apiKey, ...(idempotency ? { 'idempotency-key': idempotency } : {}) },
  body: JSON.stringify(body),
});
const problemOf = async (response: Response, status: number) => {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type') ?? '', /^application\/problem\+json/);
  return z.object({
    type: z.string(), title: z.string(), status: z.number(), detail: z.string().optional(),
    errors: z.array(z.object({ detail: z.string(), pointer: z.string() })).optional(),
  }).parse(await response.json());
};

after(() => {
  db.close();
  rmSync(folder, { recursive: true });
});

const doc = app.getOpenAPIDocument(openApiConfig) as unknown as {
  tags: { name: string; description: string }[];
  paths: Record<string, Record<string, {
    description?: string;
    requestBody?: { content: Record<string, { examples?: Record<string, unknown> }> };
    responses: Record<string, { description: string; content?: Record<string, { examples?: Record<string, unknown> }> }>;
  }>>;
  components: { schemas: Record<string, { properties?: Record<string, { type?: string; description?: string }> }> };
};

test('every documented request example is accepted by the real schemas', () => {
  for (const [name, example] of Object.entries(docs.notifyRequestExamples)) {
    const parsed = notifyRequestSchema.safeParse(example.value);
    assert.equal(parsed.success, true, `notify example ${name}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`);
  }
  for (const [name, example] of Object.entries(docs.batchRequestExamples)) {
    const parsed = batchSchema.safeParse(example.value);
    assert.equal(parsed.success, true, `batch example ${name}: ${parsed.success ? '' : JSON.stringify(parsed.error.issues)}`);
  }
  for (const example of [...Object.values(docs.notifyAcceptedExample), ...Object.values(docs.notifyQueuedExample)]) {
    assert.equal(jobSchema.safeParse(example.value.job).success, true);
  }
  for (const example of Object.values(docs.jobStatusExamples)) {
    assert.equal(jobSchema.safeParse(example.value.job).success, true);
  }
});

test('POST /v1/notify documents one request example per notification use case', () => {
  const operation = doc.paths['/v1/notify']?.post;
  assert.ok(operation);
  assert.ok((operation.description ?? '').includes('Casos de uso'));
  const examples = Object.keys(operation.requestBody?.content['application/json']?.examples ?? {});
  for (const name of ['visitCreated', 'visitRegistered', 'visitEntry', 'visitExit', 'panic', 'announcement', 'generic', 'flatVisit']) {
    assert.ok(examples.includes(name), `missing example ${name}`);
  }
  const eventTypes = Object.values(docs.notifyRequestExamples).map((example) => (example.value as { type?: string }).type).filter(Boolean);
  assert.deepEqual(
    [...new Set(eventTypes)].sort(),
    ['announcement.published', 'notification.generic', 'panic.triggered', 'visit.created', 'visit.entry', 'visit.exit', 'visit.registered'],
  );
});

test('every notification operation documents its success and problem responses with examples', () => {
  const expected: Record<string, string[]> = {
    'post /v1/notify': ['200', '202', '400', '401', '403', '409', '413', '502', '503'],
    'get /v1/notify/{id}': ['200', '400', '401', '404'],
    'post /v1/batches': ['202', '400', '401', '409', '413', '503'],
  };
  for (const [key, statuses] of Object.entries(expected)) {
    const [method, path] = key.split(' ');
    const operation = doc.paths[path!]?.[method!];
    assert.ok(operation, key);
    assert.ok(operation.description && operation.description.length > 40, `${key} needs a description`);
    for (const status of statuses) {
      const response = operation.responses[status];
      assert.ok(response, `${key} ${status}`);
      assert.ok(response.description.length > 0, `${key} ${status} description`);
      const content = Object.values(response.content ?? {})[0];
      assert.ok(Object.keys(content?.examples ?? {}).length > 0, `${key} ${status} needs examples`);
    }
  }
  assert.ok(doc.paths['/v1/notify']?.post?.responses['400']?.content?.['application/problem+json']);
});

test('the tags describe notification use cases and propertyId is documented as a string', () => {
  assert.ok(doc.tags.find((tag) => tag.name === 'Notify')?.description);
  assert.ok(doc.tags.find((tag) => tag.name === 'Batches')?.description);
  const data = doc.components.schemas['NotifyData'];
  assert.equal(data?.properties?.propertyId?.type, 'string');
  assert.equal(data?.properties?.residenceId?.type, 'string');
  assert.ok(data?.properties?.propertyId?.description);
});

test('Zod rejects a numeric propertyId on notify, batches and the dashboard with a pointer', async () => {
  const flat = { deviceId: 'zod-device', token: 'ExponentPushToken[zod-test]', message: 'Hola', data: { propertyId: 456 } };
  const notify = await problemOf(await post('/v1/notify', flat, 'zod-notify'), 400);
  assert.equal(notify.type, '/problems/invalid-body');
  assert.ok(notify.errors?.some((issue) => issue.pointer === '#/data/propertyId'));

  const batch = await problemOf(await post('/v1/batches', {
    message: 'Hola', data: { propertyId: 456 }, devices: [{ deviceId: 'zod-b1', token: 'ExponentPushToken[zod-b1]' }],
  }, 'zod-batch'), 400);
  assert.ok(batch.errors?.some((issue) => issue.pointer === '#/data/propertyId'));

  const dashboard = await problemOf(await app.request('/api/notify', {
    method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${createSessionValue()}`, 'content-type': 'application/json' },
    body: JSON.stringify(flat),
  }), 400);
  assert.ok(dashboard.errors?.some((issue) => issue.pointer === '#/data/propertyId'));
});

test('batch accepts a string propertyId and merges per-device data', async () => {
  const response = await post('/v1/batches', {
    message: 'Hola', data: { type: 'visit_entry' },
    devices: [{ deviceId: 'zod-ok-1', token: 'ExponentPushToken[zod-ok-1]', data: { propertyId: '456', residenceId: '2' } }],
  }, 'zod-batch-ok');
  assert.equal(response.status, 202);
  const stored = db.prepare('SELECT payload FROM push_jobs WHERE device_id = ?').get('zod-ok-1') as { payload: string };
  const data = JSON.parse(stored.payload).data;
  assert.equal(data.propertyId, '456');
  assert.equal(data.residenceId, '2');
  assert.equal(data.type, 'visit_entry');
});

test('domain failures from the Result pipeline reach the client as problem details', async () => {
  const token = await problemOf(await post('/v1/notify', {
    deviceId: 'zod-device', token: 'not-an-expo-token', message: 'Hola',
  }, 'result-token'), 400);
  assert.equal(token.type, '/problems/invalid-expo-token');

  const tooLarge = await problemOf(await post('/v1/notify', {
    deviceId: 'zod-device', token: 'ExponentPushToken[zod-test]', message: 'm'.repeat(4000),
    data: { type: 'visit_entry', visitor: 'v'.repeat(256), propertyLabel: 'p'.repeat(256) },
  }, 'result-large'), 400);
  assert.equal(tooLarge.type, '/problems/payload-too-large');

  const batchToken = await problemOf(await post('/v1/batches', {
    message: 'Hola', devices: [{ deviceId: 'zod-bad', token: 'nope' }],
  }, 'result-batch-token'), 400);
  assert.equal(batchToken.type, '/problems/invalid-expo-token');

  const dashboardToken = await problemOf(await app.request('/api/notify', {
    method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${createSessionValue()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId: 'zod-device', token: 'nope', message: 'Hola' }),
  }), 400);
  assert.equal(dashboardToken.type, '/problems/invalid-expo-token');
});

test('a reused idempotency key with other content is a Result failure mapped to 409', async () => {
  const body = { message: 'Hola', devices: [{ deviceId: 'zod-idem', token: 'ExponentPushToken[zod-idem]' }] };
  assert.equal((await post('/v1/batches', body, 'result-idem')).status, 202);
  assert.equal((await problemOf(await post('/v1/batches', { ...body, message: 'otro' }, 'result-idem'), 409)).type, '/problems/idempotency-conflict');
});
