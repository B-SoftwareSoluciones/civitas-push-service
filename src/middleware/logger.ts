import type { Context, Next } from 'hono';

const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

export function requestLogger() {
  return async (c: Context, next: Next) => {
    const start = Date.now();
    const method = c.req.method;
    const url = new URL(c.req.url);
    const path = (url.pathname + (url.search || '')).replace(
      /([?&](?:key|token)=)[^&]+/gi,
      '$1***',
    );

    await next();

    const status = c.res.status;
    const duration = Date.now() - start;
    const time = new Date().toLocaleTimeString('es-MX', { hour12: false });
    const color = status >= 500 ? RED : status >= 400 ? YELLOW : GREEN;

    console.log(
      `[${time}] ${method} ${path} -> ${color}${status}${RESET} (${duration}ms)`,
    );
  };
}
