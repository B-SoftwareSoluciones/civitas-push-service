import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = fileURLToPath(new URL('..', import.meta.url));
const envPath = resolve(projectDir, '.env');

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const databasePath = process.env.DATABASE_PATH
  ? resolve(projectDir, process.env.DATABASE_PATH)
  : resolve(projectDir, 'data/push.sqlite');

function resolveSessionSecret(): string {
  const provided = process.env.SESSION_SECRET?.trim();
  if (provided) return provided;
  console.warn('[config] SESSION_SECRET no definido; se generó uno temporal (las sesiones se perderán al reiniciar).');
  return randomBytes(32).toString('hex');
}

export const config = {
  port: Number(process.env.PORT ?? 8790),
  databasePath,
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
  adminUser: process.env.ADMIN_USER ?? 'admin',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  sessionSecret: resolveSessionSecret(),
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
};
