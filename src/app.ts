import { OpenAPIHono } from '@hono/zod-openapi';
import { cors } from 'hono/cors';
import { swaggerUI } from '@hono/swagger-ui';
import { serveStatic } from '@hono/node-server/serve-static';

import { config } from './config';
import { requireApiKey } from './middleware/api-key';
import { requestLogger } from './middleware/logger';
import { rateLimit } from './middleware/rate-limit';
import { requireSameOrigin } from './middleware/same-origin';
import { securityHeaders } from './middleware/security-headers';
import { requireApiAuth, requireWebAuth } from './middleware/session';
import { devicesRoutes } from './routes/devices';
import { notifyRoutes } from './routes/notify';
import { webRoutes } from './routes/web';

export const app = new OpenAPIHono();

app.use('*', requestLogger());
app.use('*', securityHeaders);

app.use('/assets/*', serveStatic({ root: './' }));

app.use('/v1/*', rateLimit({ name: 'v1', windowMs: 60_000, max: config.apiRateLimitMax }));
if (config.corsOrigin) {
  app.use('/v1/*', cors({ origin: config.corsOrigin }));
}
app.use('/v1/*', requireApiKey);

app.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString() }));

app.route('/v1/devices', devicesRoutes);
app.route('/v1/notify', notifyRoutes);

app.use('/api/*', requireSameOrigin);
app.use('/api/*', requireApiAuth);
app.route('/', webRoutes);

app.use('/doc', requireWebAuth);
app.use('/ui', requireWebAuth);

app.openAPIRegistry.registerComponent('securitySchemes', 'ApiKeyAuth', {
  type: 'apiKey',
  in: 'header',
  name: 'X-API-Key',
  description: 'También se acepta `Authorization: Bearer <api-key>`.',
});

app.doc('/doc', {
  openapi: '3.0.0',
  info: {
    title: 'Civitas Access API',
    version: '1.0.0',
    description:
      'API de registro de dispositivos y envío de notificaciones push (Expo). Todas las rutas /v1 requieren una API key.',
  },
});

app.get('/ui', swaggerUI({ url: '/doc' }));
