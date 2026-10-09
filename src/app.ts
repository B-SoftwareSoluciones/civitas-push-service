import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { swaggerUI } from '@hono/swagger-ui';
import { serveStatic } from '@hono/node-server/serve-static';

import { config } from './config';
import { requestLogger } from './middleware/logger';
import { devicesRoutes } from './routes/devices';
import { notifyRoutes } from './routes/notify';
import { webRoutes } from './routes/web';

export const app = new OpenAPIHono();

app.use('*', requestLogger());

app.use('/assets/*', serveStatic({ root: './' }));

app.use('/v1/*', cors({ origin: config.corsOrigin }));

app.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.route('/v1/devices', devicesRoutes);
app.route('/v1/notify', notifyRoutes);
app.route('/', webRoutes);

app.doc('/doc', {
  openapi: '3.0.0',
  info: {
    title: 'Civitas Access API',
    version: '1.0.0',
    description: 'API de registro de dispositivos y envío de notificaciones push (Expo).',
  },
});

app.get('/ui', swaggerUI({ url: '/doc' }));
