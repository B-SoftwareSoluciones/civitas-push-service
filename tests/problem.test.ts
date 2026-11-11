import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import { QueueError } from '../src/queue/store';
import { ProblemError, problem, problemErrorHandler, zodProblemErrors } from '../src/problem';

const app = new Hono();
app.onError(problemErrorHandler);
app.use('/with-header', async (c, next) => {
  c.header('X-Test', '1');
  await next();
});
app.get('/direct', (c) => problem(c, 400, 'invalid_body'));
app.get('/generic', (c) => problem(c, 500, null));
app.get('/with-header', (c) => problem(c, 400, 'invalid_body'));
app.get('/problem-error', () => { throw new ProblemError(404, 'not_found'); });
app.get('/queue-full', () => { throw new QueueError('queue_full', 503, 120_000); });
app.get('/provider', () => { throw new QueueError('MessageTooBig', 502); });
app.get('/boom', () => { throw new Error('secreto interno'); });
app.get('/http', () => { throw new HTTPException(400, { message: 'Malformed JSON' }); });

const get = (path: string) => app.request(path);
const body = async (response: Response) => await response.json() as Record<string, unknown>;

test('problem() answers application/problem+json with the RFC 9457 members and nothing else', async () => {
  const response = await get('/direct');
  assert.equal(response.status, 400);
  assert.ok(response.headers.get('content-type')?.startsWith('application/problem+json'));
  const json = await body(response);
  assert.equal(json.type, '/problems/invalid-body');
  assert.equal(json.status, 400);
  assert.equal(json.instance, '/direct');
  assert.ok(typeof json.title === 'string' && json.title.length > 0);
  for (const legacy of ['ok', 'error', 'details']) assert.equal(legacy in json, false, legacy);
});

test('problem() with a null code uses about:blank and the standard HTTP phrase', async () => {
  const json = await body(await get('/generic'));
  assert.equal(json.type, 'about:blank');
  assert.equal(json.title, 'Internal Server Error');
});

test('problem() keeps headers set earlier with c.header', async () => {
  assert.equal((await get('/with-header')).headers.get('x-test'), '1');
});

test('zodProblemErrors points at every failing nested field', () => {
  const schema = z.object({ version: z.number().min(1), data: z.object({ propertyId: z.number() }) });
  const result = schema.safeParse({ version: 0, data: { propertyId: '238' } });
  assert.equal(result.success, false);
  assert.deepEqual(zodProblemErrors(result.error!).map((issue) => issue.pointer), ['#/version', '#/data/propertyId']);
});

test('zodProblemErrors reports only the closest branch of a union', () => {
  const envelopeLike = z.object({ version: z.number().min(1), source: z.string(), data: z.object({ propertyId: z.number() }) });
  const flatLike = z.object({ deviceId: z.string(), token: z.string(), message: z.string() });
  const result = z.union([envelopeLike, flatLike]).safeParse({ version: 0, source: 'x', data: { propertyId: '238' } });
  assert.equal(result.success, false);
  assert.deepEqual(zodProblemErrors(result.error!).map((issue) => issue.pointer).sort(), ['#/data/propertyId', '#/version']);
});

test('zodProblemErrors escapes JSON Pointer tokens and uses # for the root', () => {
  const nested = z.object({ 'a/b~c': z.string() }).safeParse({});
  assert.deepEqual(zodProblemErrors(nested.error!).map((issue) => issue.pointer), ['#/a~1b~0c']);
  const root = z.string().safeParse(1);
  assert.deepEqual(zodProblemErrors(root.error!).map((issue) => issue.pointer), ['#']);
});

test('problemErrorHandler maps ProblemError to its status and code', async () => {
  const response = await get('/problem-error');
  assert.equal(response.status, 404);
  assert.equal((await body(response)).type, '/problems/not-found');
});

test('problemErrorHandler maps QueueError and adds Retry-After on 503', async () => {
  const response = await get('/queue-full');
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('retry-after'), '120');
  assert.equal((await body(response)).type, '/problems/queue-full');
});

test('problemErrorHandler folds unknown provider codes into push-provider-error', async () => {
  const response = await get('/provider');
  assert.equal(response.status, 502);
  const json = await body(response);
  assert.equal(json.type, '/problems/push-provider-error');
  assert.equal(json.detail, 'MessageTooBig');
});

test('problemErrorHandler hides the message of unexpected errors', async (context) => {
  context.mock.method(console, 'error', () => {});
  const response = await get('/boom');
  assert.equal(response.status, 500);
  assert.equal((await response.text()).includes('secreto interno'), false);
});

test('problemErrorHandler turns HTTPException into about:blank problem details', async () => {
  const response = await get('/http');
  assert.equal(response.status, 400);
  assert.ok(response.headers.get('content-type')?.startsWith('application/problem+json'));
  assert.equal((await body(response)).type, 'about:blank');
});

test('zodProblemErrors prefers the union branch that matched deeper into the input', () => {
  const recipient = { deviceId: z.string(), token: z.string(), message: z.string() };
  const envelopeLike = z.object({ version: z.number().min(1), notification: z.object(recipient) });
  const flatLike = z.object(recipient);
  const result = z.union([envelopeLike, flatLike]).safeParse({ version: 0, notification: { device: 'a', expoToken: 'b', body: 'c' } });
  assert.equal(result.success, false);
  assert.deepEqual(
    zodProblemErrors(result.error!).map((issue) => issue.pointer).sort(),
    ['#/notification/deviceId', '#/notification/message', '#/notification/token', '#/version'],
  );
});
