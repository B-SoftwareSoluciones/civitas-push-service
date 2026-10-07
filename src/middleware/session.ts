import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Context, Next } from 'hono';
import { getCookie } from 'hono/cookie';

import { config } from '../config';

export const SESSION_COOKIE = 'ms_session';
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function sign(value: string): string {
  return createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

export function createSessionValue(): string {
  const exp = Date.now() + SESSION_MAX_AGE * 1000;
  return `${exp}.${sign(String(exp))}`;
}

export function isValidSession(raw: string | undefined): boolean {
  if (!raw) return false;
  const dot = raw.indexOf('.');
  if (dot <= 0) return false;

  const expPart = raw.slice(0, dot);
  const signature = raw.slice(dot + 1);
  const exp = Number(expPart);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;

  const expected = sign(expPart);
  const provided = Buffer.from(signature);
  const computed = Buffer.from(expected);
  return provided.length === computed.length && timingSafeEqual(provided, computed);
}

export function hasValidSession(c: Context): boolean {
  return isValidSession(getCookie(c, SESSION_COOKIE));
}

export async function requireWebAuth(c: Context, next: Next): Promise<Response | void> {
  if (!hasValidSession(c)) return c.redirect('/login');
  await next();
}

export async function requireApiAuth(c: Context, next: Next): Promise<Response | void> {
  if (!hasValidSession(c)) return c.json({ error: 'unauthorized' }, 401);
  await next();
}
