# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Expo push-notification service (package `civitas-access`): authenticated HTTP API, durable SQLite job queue, an in-process worker, and a server-rendered admin dashboard. TypeScript run directly with `tsx` (no build step), Hono + `@hono/zod-openapi`, `node:sqlite` (requires Node >= 24). README.md (Spanish) is the detailed reference for the API contract, env vars, delivery guarantees and Docker; code comments and user-facing strings are also Spanish.

## Commands

```bash
npm run dev          # tsx watch src/index.ts (needs .env with ADMIN_PASSWORD >= 12 chars)
npm start            # tsx src/index.ts
npm run typecheck    # tsc --noEmit (covers src and tests; CI runs this then tests)
npm test             # node --import tsx --test tests/*.test.ts
node --import tsx --test tests/queue.test.ts                      # single file
node --import tsx --test --test-name-pattern="idempotency" tests/*.test.ts   # single test by name
npm run api-key:create -- --name "X" --ips "10.0.0.0/8"          # also api-key:list / api-key:revoke -- <id>
```

Tests never hit Expo: they use temp SQLite DBs and fake `PushTransport`s.

## Architecture

**Entry points.** `src/index.ts` asserts config, starts `PushWorker` against the real Expo transport, and serves `src/app.ts`. `src/app.ts` builds the `OpenAPIHono` app: global problem-details error/notFound handlers, logger, security headers, body limit (16 KiB; 1 MiB for `POST /v1/batches`), then mounts routes. `/v1/*` is guarded by `requireApiKey`; `/api/*` and `/doc`, `/ui` use the admin session cookie (`/api/*` mutations also check same-origin).

**Config & DB are import-time singletons.** `src/config.ts` reads `.env`, and any unset `SESSION_SECRET`/`API_KEY_PEPPER` are generated and persisted to `runtime.env` next to the SQLite file. `src/db/client.ts` opens the DB (WAL, `synchronous=FULL`) and creates the `devices`/`api_keys` tables; `src/queue/runtime.ts` exports the shared `QueueStore`. Because of this, **tests must set `process.env.DATABASE_PATH` (temp dir), `SESSION_SECRET`, `API_KEY_PEPPER`, `ADMIN_PASSWORD` *before* dynamically `await import('../src/...')`** — copy the header of `tests/api.test.ts`.

**Queue (`src/queue/`).** `store.ts` (`QueueStore`) owns the push_jobs/batches/worker-lease tables and all state transitions (queued → sending → awaiting_receipt → accepted | dead), idempotency (scoped per owner = API key id), capacity, priority ordering, and the persisted rate limiter. It signals expected failures by throwing `QueueError(code, status, retryAfterMs)`. `worker.ts` (`PushWorker`) takes a DB lease, sends due jobs in groups of ≤100 via a `PushTransport` (`services/expo-push.ts`), polls receipts, and retries with backoff. Multiple workers may share one DB; lost-lease results are discarded.

**Notify flow (`services/dispatch.ts`).** `runNotify` is the immediate path: normalize input (flat contract or Event Envelope → `services/notifications.ts`), build the Expo message, `queue.beginImmediate`, send directly, and fall back to a deferred queued job (`202`) when the rate limiter is busy or Expo returns 429/`MessageRateExceeded`. Batches (`services/batches.ts`, `routes/batches.ts`) are persisted atomically and processed only by the worker.

**Errors: Result pattern + RFC 9457.** Services return `Result<T>` (`src/result.ts`: `ok`/`fail`/`attempt`) instead of throwing expected errors; `attempt()` wraps store calls and converts only `QueueError` (other errors are bugs → 500). Routes translate `!result.ok` with `failureProblem(c, result.error)`. `src/problem.ts` holds the `CATALOG` of error codes (snake_case code → `/problems/kebab-case` type, title, detail), `problem()`, `ProblemError`, `validationHook` (Zod → `errors[].pointer` JSON Pointers) and the global handler. A new error code needs a `CATALOG` entry and, if documented, an entry in the route's `problemResponse(...)`. Unknown `Failure` codes are reported as `push_provider_error` with the code in `detail`.

**OpenAPI is code-first.** Routes are declared with `createRoute` (`routes/notify.ts`, `batches.ts`, `devices.ts`); per-use-case request/response examples live in `src/docs/notifications.ts` and are validated against the real Zod schemas by `tests/openapi.test.ts`, so changing a schema means updating those examples. `propertyId`/`residenceId` are strings, never numbers.

**Admin panel.** `routes/web.ts` serves JSON `/api/*` endpoints plus HTML pages; `src/web/*.ts` build pages as template strings (`layout.ts` has shared CSS and `escapeHtml`; `dashboard.ts` embeds its client-side JS inline in a `<script>`). Always `escapeHtml` interpolated values.

**Other files to keep in sync.** `postman_collection.json` (checked by `tests/postman.test.ts`) mirrors the API; README documents the contract in Spanish. `compose.yml` and `docker-compose.yml` are near-duplicates (the latter documents the auto-generated secrets) — change both when touching Docker config. `.env` and `data/` are gitignored.
