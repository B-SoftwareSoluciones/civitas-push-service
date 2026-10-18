import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = fileURLToPath(new URL('..', import.meta.url));
const envPath = resolve(projectDir, '.env');

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const databasePath = process.env.DATABASE_PATH
  ? resolve(projectDir, process.env.DATABASE_PATH)
  : resolve(projectDir, 'data/push.sqlite');

const dataDir = dirname(databasePath);
const runtimeEnvPath = resolve(dataDir, 'runtime.env');

function parseEnvFile(path: string): Record<string, string> {
  const values: Record<string, string> = {};
  let content: string;
  try {
    content = readFileSync(path, 'utf8');
  } catch {
    return values;
  }

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

const runtimeSecrets = parseEnvFile(runtimeEnvPath);
const generatedSecrets: string[] = [];

function ensureSecret(name: string): string {
  const fromEnv = process.env[name]?.trim();
  if (fromEnv) return fromEnv;

  const stored = runtimeSecrets[name]?.trim();
  if (stored) return stored;

  const generated = randomBytes(32).toString('hex');
  runtimeSecrets[name] = generated;
  generatedSecrets.push(name);
  return generated;
}

const sessionSecret = ensureSecret('SESSION_SECRET');
const apiKeyPepper = ensureSecret('API_KEY_PEPPER');

if (generatedSecrets.length > 0) {
  mkdirSync(dataDir, { recursive: true });
  const body = `${Object.entries(runtimeSecrets)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')}\n`;
  writeFileSync(runtimeEnvPath, body, { mode: 0o600 });
  try {
    chmodSync(runtimeEnvPath, 0o600);
  } catch {
    /* ignore */
  }
  console.warn(
    `[config] generados y persistidos (${generatedSecrets.join(', ')}) en ${runtimeEnvPath}; ` +
      'defínelos en .env para fijarlos explícitamente.',
  );
}

export const config = {
  port: Number(process.env.PORT ?? 8790),
  databasePath,
  expoAccessToken: process.env.EXPO_ACCESS_TOKEN || undefined,
  adminUser: process.env.ADMIN_USER ?? 'admin',
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  sessionSecret,
  apiKeyPepper,
  corsOrigin: process.env.CORS_ORIGIN ?? '*',
  trustProxy: /^(1|true|yes)$/i.test(process.env.TRUST_PROXY ?? ''),
  isProduction: process.env.NODE_ENV === 'production',
};
