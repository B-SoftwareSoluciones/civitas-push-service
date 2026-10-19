import type { Context, Next } from 'hono';

export async function noStore(c: Context, next: Next): Promise<void> {
  await next();
  c.header('Cache-Control', 'no-store');
}
