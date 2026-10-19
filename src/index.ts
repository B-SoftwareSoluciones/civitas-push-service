import { serve } from '@hono/node-server';

import { app } from './app';
import { assertSecureConfig, config } from './config';

assertSecureConfig();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[Civitas Access] escuchando en http://localhost:${info.port}`);
  console.log(`[Civitas Access] panel web en http://localhost:${info.port}/login`);
  console.log(`[Civitas Access] base de datos: ${config.databasePath}`);
});
