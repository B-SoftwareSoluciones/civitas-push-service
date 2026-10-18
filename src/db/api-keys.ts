import { randomUUID } from 'node:crypto';

import { db } from './client';

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  key_hash: string;
  enabled: number;
  allowed_ips: string;
  created_at: string;
  last_used_at: string | null;
}

const now = () => new Date().toISOString();

export function createApiKey(input: {
  name: string;
  prefix: string;
  keyHash: string;
  allowedIps?: string;
}): ApiKeyRow {
  const id = randomUUID();
  const timestamp = now();
  db.prepare(
    `INSERT INTO api_keys (id, name, prefix, key_hash, enabled, allowed_ips, created_at, last_used_at)
     VALUES (?, ?, ?, ?, 1, ?, ?, NULL)`,
  ).run(id, input.name, input.prefix, input.keyHash, input.allowedIps ?? '', timestamp);
  return getApiKey(id) as ApiKeyRow;
}

export function getApiKey(id: string): ApiKeyRow | undefined {
  return db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as unknown as
    | ApiKeyRow
    | undefined;
}

export function findApiKeyByHash(keyHash: string): ApiKeyRow | undefined {
  return db.prepare('SELECT * FROM api_keys WHERE key_hash = ?').get(keyHash) as unknown as
    | ApiKeyRow
    | undefined;
}

export function listApiKeys(): ApiKeyRow[] {
  return db
    .prepare('SELECT * FROM api_keys ORDER BY created_at DESC')
    .all() as unknown as ApiKeyRow[];
}

export function touchApiKey(id: string): void {
  db.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').run(now(), id);
}

export function setApiKeyEnabled(id: string, enabled: boolean): void {
  db.prepare('UPDATE api_keys SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);
}

export function setApiKeyAllowedIps(id: string, allowedIps: string): void {
  db.prepare('UPDATE api_keys SET allowed_ips = ? WHERE id = ?').run(allowedIps, id);
}

export function deleteApiKey(id: string): void {
  db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
}
