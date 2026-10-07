import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';

import { config } from '../config';
import { listDevices } from '../db/repository';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionValue,
  hasValidSession,
  requireApiAuth,
  requireWebAuth,
} from '../middleware/session';
import { dashboardPage } from '../web/dashboard';
import { loginPage } from '../web/login';

export const webRoutes = new Hono();

webRoutes.get('/login', (c) => {
  if (hasValidSession(c)) return c.redirect('/');
  return c.html(loginPage());
});

webRoutes.post('/login', async (c) => {
  const body = await c.req.parseBody();
  const user = String(body.user ?? '');
  const password = String(body.password ?? '');

  if (user !== config.adminUser || password !== config.adminPassword) {
    return c.html(loginPage('Usuario o contraseña incorrectos.'), 401);
  }

  setCookie(c, SESSION_COOKIE, createSessionValue(), {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: SESSION_MAX_AGE,
    secure: false,
  });
  return c.redirect('/');
});

webRoutes.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.redirect('/login');
});

webRoutes.get('/api/devices', requireApiAuth, (c) => {
  const devices = listDevices().map((device) => ({
    deviceId: device.id,
    token: device.expo_token,
    platform: device.platform,
    enabled: device.enabled === 1,
    lastSeenAt: device.last_seen_at,
  }));
  return c.json({ ok: true, count: devices.length, devices });
});

webRoutes.get('/', requireWebAuth, (c) => c.html(dashboardPage(config.adminUser)));
