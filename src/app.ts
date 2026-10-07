import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from '@hono/node-server/serve-static';

import { config } from './config';
import { requestLogger } from './middleware/logger';
import { devicesRoutes } from './routes/devices';
import { notifyRoutes } from './routes/notify';
import { webRoutes } from './routes/web';

export const app = new Hono();

app.use('*', requestLogger());

app.use('/assets/*', serveStatic({ root: './' }));

app.use('/v1/*', cors({ origin: config.corsOrigin }));

app.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.route('/v1/devices', devicesRoutes);
app.route('/v1/notify', notifyRoutes);
app.route('/', webRoutes);
