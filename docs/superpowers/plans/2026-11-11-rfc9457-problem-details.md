# RFC 9457 Problem Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todas las respuestas de error de `civitas-push-service` usan `application/problem+json` (RFC 9457), sin conservar `ok`, `error` ni `details`.

**Architecture:** Un módulo central `src/problem.ts` construye las respuestas y expone un manejador global (`app.onError`) que traduce `ProblemError`, `QueueError`, `HTTPException` y errores inesperados. Las rutas dejan de armar JSON de error: lanzan `ProblemError`/`QueueError` y el manejador responde. Los middlewares devuelven `problem(...)` directamente. El dashboard lee `res.ok` y `detail`/`title`.

**Tech Stack:** TypeScript (tsx), Hono 4, `@hono/zod-openapi` 0.19, Zod 3, `node:test` (`npm test`, `npm run typecheck`).

**Spec:** Diseño aprobado en el chat el 2026-11-11 (no hay documento de diseño aparte). Sus decisiones están copiadas en *Global Constraints*.

## Global Constraints

- Corte limpio: las respuestas de error NO contienen `ok`, `error` ni `details`. Nadie consume la API todavía.
- `Content-Type: application/problem+json` en toda respuesta de error. Campos: `type`, `title`, `status`, `detail`, `instance`; extensión `errors` solo en validación.
- `type` es una URI relativa `/problems/<slug>` donde `<slug>` es el código con `_` cambiado por `-` (ej. `invalid_body` → `/problems/invalid-body`). No se sirve contenido en esas URLs. Para errores genéricos sin semántica propia (HTTPException, 500) `type` es `about:blank` y `title` es la frase estándar del estado HTTP.
- `status` del cuerpo = código HTTP de la respuesta. `instance` = `c.req.path` (decisión del plan).
- `title` y `detail` en español, como el resto del servicio. Un 500 inesperado NUNCA expone el mensaje interno: `detail` fijo.
- `errors` es una lista de `{ detail: string, pointer: string }` donde `pointer` es un JSON Pointer en fragmento URI (`#/data/propertyId`; ruta vacía → `#`). Es el formato del ejemplo de la RFC.
- Para uniones de Zod, `errors` lista solo los problemas de la rama con MENOS issues (empate: la primera).
- Las respuestas exitosas (`{ ok: true, ... }`) no cambian. `/health` y `/ready` tampoco (decisión del plan: son reportes de estado, no errores de negocio).
- Códigos de `QueueError` fuera del catálogo (nombres de error de Expo, `expo_http_*`, `push_failed`) se responden con código `push_provider_error` y `detail` = el código original.
- `WWW-Authenticate: Bearer realm="civitas-access"` en los 401 de `requireApiKey`. `Retry-After` en 503 con `max(1, ceil((retryAfterMs || 60000) / 1000))` segundos.
- Catálogo de códigos (cada uno con `title` y `detail` en español, una frase): `invalid_body`, `invalid_query`, `invalid_param`, `invalid_header`, `invalid_idempotency_key`, `invalid_expo_token`, `payload_too_large`, `body_too_large`, `device_not_registered`, `idempotency_conflict`, `notification_in_progress`, `job_not_retryable`, `immediate_job_not_retryable`, `job_expired`, `queue_full`, `send_outcome_unknown`, `push_provider_error`, `unauthorized`, `api_key_disabled`, `ip_not_allowed`, `forbidden_origin`, `not_found`, `route_not_found`.
- Los headers puestos antes con `c.header(...)` (CORS, `Cache-Control`, `Location`) deben sobrevivir: construir la respuesta con `c.body(JSON.stringify(body), status, headers)`, no con `new Response`.
- `npm run typecheck` y `npm test` pasan al terminar cada tarea.

## Review Focus

- JSON malformado en `POST /v1/notify` (hoy lo lanza el validador como `HTTPException`): debe ser `400 application/problem+json`, no `text/plain`.
- Ruta inexistente (`GET /v1/nope`, `GET /nope`) y método no permitido: `404` problem+json, no el texto "404 Not Found".
- Error inesperado dentro de un handler: `500` problem+json sin filtrar el mensaje interno.
- Payload del usuario (envelope con `version: 0` y `propertyId: "238"`): `errors` debe señalar `#/version` y `#/data/propertyId`, no ser vacío ni mezclar errores de la rama equivocada de la unión.
- El dashboard debe mostrar el `detail` del servidor cuando falla un envío, un reintento o la creación de una API key.

---

### Task 1: Módulo `problem.ts` y su contrato

**Files:**
- Create: `src/problem.ts`
- Test: `tests/problem.test.ts`

**Interfaces:**
- Produces (todo exportado desde `src/problem.ts`):
  - `const PROBLEM_CONTENT_TYPE = 'application/problem+json'`
  - `type ProblemIssue = { detail: string; pointer: string }`
  - `class ProblemError extends Error { constructor(status: ContentfulStatusCode, code: string, options?: { detail?: string; errors?: ProblemIssue[] }) }` con campos públicos `status`, `code`, `options`.
  - `problem(c: Context, status: ContentfulStatusCode, code: string | null, options?: { detail?: string; errors?: ProblemIssue[]; headers?: Record<string, string> }): Response` — `code === null` produce `type: 'about:blank'`.
  - `zodProblemErrors(error: ZodError): ProblemIssue[]`
  - `validationHook(result: { success: boolean; target?: string; error?: ZodError }, c: Context): Response | void` — para `defaultHook` de `OpenAPIHono`. `target` `json`→`invalid_body`, `query`→`invalid_query`, `param`→`invalid_param`, `header`→`invalid_header`, otro→`invalid_body`. Estado 400.
  - `problemErrorHandler(error: Error, c: Context): Response` — para `app.onError`. `ProblemError` → su estado y código. `QueueError` → ver abajo. `HTTPException` → `problem(c, error.status, null, { detail: error.message })`. Cualquier otro → `console.error(error)` y `500` con `code = null`, `detail` fijo `'Error interno del servidor.'`.
  - `problemSchema` (zod-openapi, `.openapi('Problem')`) y `problemContent` (`{ content: { 'application/problem+json': { schema: problemSchema } } }`) para declarar respuestas en OpenAPI.
- Comportamiento de `QueueError` en el manejador: código del catálogo → ese código y `error.status`; fuera del catálogo → `push_provider_error` con `detail` = `error.code`; si el estado es 503 añade `Retry-After`.

- [ ] **Step 1: Escribir los tests fallidos en `tests/problem.test.ts`**

Usar una mini-app `new Hono()` con `app.onError(problemErrorHandler)` y rutas que lanzan cada tipo de error. Importar `QueueError` desde `../src/queue/store` (no abre la base de datos). Tests, con estas aserciones:
  - `problem()` con `('invalid_body', 400)`: `content-type` empieza por `application/problem+json`; cuerpo `type === '/problems/invalid-body'`, `status === 400`, `instance` igual al path de la petición, `title` no vacío, y NO existen `ok`, `error`, `details`.
  - `problem(c, 500, null)` → `type === 'about:blank'`, `title === 'Internal Server Error'`.
  - `zodProblemErrors` de `z.object({ version: z.number().min(1), data: z.object({ propertyId: z.number() }) })` con `{ version: 0, data: { propertyId: '238' } }` → pointers exactamente `['#/version', '#/data/propertyId']`.
  - `zodProblemErrors` de `z.union([envelopeLike, flatLike])` con una entrada que casi cumple `envelopeLike` (2 issues) y falla `flatLike` en 3 → solo los 2 pointers de la primera rama.
  - Ruta que lanza `new ProblemError(404, 'not_found')` → 404, `type === '/problems/not-found'`.
  - Ruta que lanza `new QueueError('queue_full', 503, 120_000)` → 503, `retry-after === '120'`, `type === '/problems/queue-full'`.
  - Ruta que lanza `new QueueError('MessageTooBig', 502)` → 502, `type === '/problems/push-provider-error'`, `detail === 'MessageTooBig'`.
  - Ruta que lanza `new Error('secreto interno')` → 500, y el texto del cuerpo NO contiene `secreto interno`.
  - Ruta con `new HTTPException(400, { message: 'Malformed JSON' })` → 400 problem+json con `type === 'about:blank'`.
  - Un `c.header('X-Test', '1')` hecho antes de lanzar `ProblemError` no se pierde cuando la respuesta la construye `problem()` desde un middleware que lo llama directamente.

- [ ] **Step 2: Ejecutar para ver que falla**

Run: `node --import tsx --test tests/problem.test.ts`
Expected: FAIL (`Cannot find module '../src/problem'`).

- [ ] **Step 3: Implementar `src/problem.ts` con las firmas de *Interfaces***

El catálogo es un `Record<string, { title: string; detail: string }>` con los códigos de *Global Constraints*. Construcción del slug: `code.replace(/_/g, '-')`. `title` para `code === null`: tabla mínima de frases estándar HTTP por estado (400, 401, 403, 404, 405, 409, 413, 500, 502, 503) con respaldo `'Error'`. `zodProblemErrors` recorre `error.issues`; para `invalid_union` elige `unionErrors` con menos issues y recurre; el `pointer` se arma con `'#/' + path.map(escape).join('/')` donde `escape` cambia `~`→`~0` y `/`→`~1`, o `'#'` si la ruta está vacía.

- [ ] **Step 4: Ejecutar para ver que pasa**

Run: `node --import tsx --test tests/problem.test.ts && npm run typecheck`
Expected: todos los tests PASS y typecheck sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/problem.ts tests/problem.test.ts docs/superpowers/plans/2026-11-11-rfc9457-problem-details.md
git commit -m "feat: add RFC 9457 problem details module"
```

---

### Task 2: Manejadores globales y middlewares

**Files:**
- Modify: `src/app.ts:25` (bodyLimit), añadir `app.onError(problemErrorHandler)` y `app.notFound(...)`
- Modify: `src/middleware/api-key.ts:36-50`
- Modify: `src/middleware/same-origin.ts:10-26`
- Modify: `src/middleware/session.ts:45`
- Test: `tests/api.test.ts` (añadir tests al final)

**Interfaces:**
- Consumes: `problem`, `problemErrorHandler` de la Task 1.
- Produces: ninguna firma nueva; cambia el formato de los errores 401/403/404/413/500 globales.

- [ ] **Step 1: Escribir los tests fallidos en `tests/api.test.ts`**

Test `'global errors are RFC 9457 problem details'` con un helper local `problemOf(response)` que verifica `content-type` `application/problem+json` y devuelve el cuerpo parseado con Zod (`type`, `title`, `status`, `instance` strings; `ok`/`error`/`details` ausentes). Aserciones:
  - `GET /v1/devices` sin clave → 401, `type === '/problems/unauthorized'`, header `www-authenticate` empieza por `Bearer`.
  - `GET /v1/devices` con clave deshabilitada (crear con `createApiKey` y luego `setApiKeyEnabled(id, false)`) → 401, `type === '/problems/api-key-disabled'`.
  - `GET /api/jobs` sin cookie → 401, `type === '/problems/unauthorized'`, sin `www-authenticate`.
  - `GET /v1/no-existe` con clave válida → 404, `type === '/problems/route-not-found'`.
  - `POST /v1/notify` con `data.oversized` de 20 000 caracteres (el caso de 413 ya existente) → 413, `type === '/problems/body-too-large'`.
  - `POST /api/keys` con `origin: 'https://evil.example'` y cookie válida → 403, `type === '/problems/forbidden-origin'`.
  - `POST /v1/notify` con cuerpo `{not json` → 400, `content-type` problem+json (cubre el JSON malformado de *Review Focus*).

- [ ] **Step 2: Ejecutar para ver que falla**

Run: `node --import tsx --test tests/api.test.ts`
Expected: los tests nuevos FAIL (formato antiguo `{ ok:false, error }`); los existentes siguen pasando.

- [ ] **Step 3: Implementar**

En `app.ts`: `onError` de `bodyLimit` devuelve `problem(context, 413, 'body_too_large')`; registrar `app.onError(problemErrorHandler)` y `app.notFound((c) => problem(c, 404, 'route_not_found'))`. En `api-key.ts` sustituir los cuatro `c.json({ ok:false, error })` por `problem(...)`; los 401 llevan `headers: { 'WWW-Authenticate': 'Bearer realm="civitas-access"' }`. En `same-origin.ts` y `session.ts` (`requireApiAuth`) igual, sin `WWW-Authenticate` en `session.ts`.

- [ ] **Step 4: Ejecutar para ver que pasa**

Run: `npm test && npm run typecheck`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/middleware tests/api.test.ts
git commit -m "feat: return problem details from global handlers and middleware"
```

---

### Task 3: Rutas `/v1`, OpenAPI y README

**Files:**
- Modify: `src/routes/notify.ts` (defaultHook, quitar `try/catch` del POST, `errorSchema` → `problemContent`, 404)
- Modify: `src/routes/batches.ts` (idem; 404 en dos rutas; quitar `try/catch`)
- Modify: `src/routes/devices.ts:39-49,159-165` (reemplazar `errorResponseSchema`; defaultHook)
- Modify: `README.md` (tabla de códigos cerca de la línea 167 y nueva subsección "Errores")
- Test: `tests/api.test.ts`

**Interfaces:**
- Consumes: `validationHook`, `ProblemError`, `problemContent` de la Task 1; `problemErrorHandler` ya registrado (Task 2) traduce los `QueueError` que dejan de capturarse.
- Produces: se elimina el export `errorSchema` de `notify.ts` (lo importaba `batches.ts`); no quedan importadores.

- [ ] **Step 1: Escribir los tests fallidos en `tests/api.test.ts`**

  - **Caso del usuario:** `POST /v1/notify` con el envelope de `visit.exit` con `version: 0` y `propertyId: "238"` → 400, `type === '/problems/invalid-body'`, y `errors` contiene exactamente los pointers `#/version` y `#/data/propertyId` (en cualquier orden).
  - `POST /v1/notify` con el mismo envelope corregido (`version: 1`, `propertyId: 238`, Expo mockeado como en los tests existentes) → 200 (las respuestas exitosas no cambian).
  - `GET /v1/batches?limit=abc` → 400, `type === '/problems/invalid-query'`.
  - `GET /v1/batches/<uuid-ajeno>` → 404, `type === '/problems/not-found'`; `GET /v1/batches/no-es-uuid` → 400, `type === '/problems/invalid-param'`.
  - Reutilizar una `Idempotency-Key` con otro contenido → 409, `type === '/problems/idempotency-conflict'`.
  - Token inválido (`'bad'`) → 400, `type === '/problems/invalid-expo-token'`; el test existente que lee `.error === 'payload_too_large'` (línea ~183) pasa a comprobar `type === '/problems/payload-too-large'`.
  - Cola llena → 503 con `retry-after` (si hay un test existente que llena la cola, ampliarlo; si no, omitir esta aserción y dejarla cubierta por la Task 1).
  - El documento `/doc` declara `application/problem+json` en la respuesta `400` de `/v1/notify`.
  - `POST /v1/devices` con cuerpo inválido → 400 `invalid-body` con `errors` no vacío.

- [ ] **Step 2: Ejecutar para ver que falla**

Run: `node --import tsx --test tests/api.test.ts`
Expected: los tests nuevos FAIL.

- [ ] **Step 3: Implementar**

Los tres routers usan `defaultHook: validationHook`. En `notify.ts` y `batches.ts` eliminar el `try/catch` de `QueueError` (el manejador global lo cubre; conservar el `Location` header). Los 404 pasan a `throw new ProblemError(404, 'not_found')`. En cada `createRoute`, sustituir `jsonContent(errorSchema)`/`errorResponseSchema` por `problemContent`, añadiendo `401`/`403` donde la ruta pasa por `requireApiKey` y no estaban declarados. Borrar `errorSchema` y `errorResponseSchema`. En el README, reemplazar la tabla de la línea ~167 por una que referencie los `type` y añadir un ejemplo de respuesta de error de validación con `errors`.

- [ ] **Step 4: Ejecutar para ver que pasa**

Run: `npm test && npm run typecheck`
Expected: todos PASS. Si tsc rechaza algún retorno de handler, ajustar el tipo del handler, no con `as never`.

- [ ] **Step 5: Commit**

```bash
git add src/routes README.md tests/api.test.ts
git commit -m "feat: problem details for /v1 routes and OpenAPI"
```

---

### Task 4: Rutas del dashboard (`/api/*`) y cliente web

**Files:**
- Modify: `src/routes/web.ts:121-217` (validaciones y 404, quitar `try/catch` de `QueueError`)
- Modify: `src/web/layout.ts:510` (añadir `window.__problemText` junto a `window.__setBadge`)
- Modify: `src/web/dashboard.ts:286-291` (reintento) y `:386-398` (envío)
- Modify: `src/web/api-keys.ts:115-120`
- Test: `tests/api.test.ts`, `tests/dashboard.test.ts`

**Interfaces:**
- Consumes: `ProblemError`, `zodProblemErrors` de la Task 1.
- Produces (cliente): `window.__problemText(body: { detail?: string; title?: string; errors?: { detail: string; pointer: string }[] }): string` — devuelve `detail`, o `title`, o `'desconocido'`; si hay `errors`, añade `' (' + pointer + ': ' + detail + ', ...)'` con los primeros 3. Se invoca al ocurrir el error, así que el orden de los `<script>` no importa.

- [ ] **Step 1: Escribir los tests fallidos**

En `tests/api.test.ts` (con cookie de sesión válida): `POST /api/notify` con `{}` → 400 `invalid-body` con `errors` no vacío; `POST /api/keys` con `null` → 400 `invalid-body`; `GET /api/batches?limit=abc` → 400 `invalid-query`; `GET /api/jobs/<uuid>` inexistente → 404 `not-found`; `PATCH /api/keys/inexistente` → 404 `not-found`; `POST /api/jobs/<id inexistente>/retry` → el `QueueError` correspondiente como problem+json (comprobar solo el content-type y el estado del `QueueError` real que lance `queue.retry`).
En `tests/dashboard.test.ts`: el HTML de `dashboardPage('admin')` contiene `__problemText` y ya no contiene `out.data.error` ni `result.error`; el script resultante sigue parseando con `new Script(...)`. Añadir un test que extraiga la función `__problemText` del HTML, la evalúe en un `vm` y verifique: `{ detail: 'X' }` → `'X'`; `{ title: 'T' }` → `'T'`; `{}` → `'desconocido'`; con `errors` de 5 elementos incluye exactamente 3 pointers.

- [ ] **Step 2: Ejecutar para ver que falla**

Run: `node --import tsx --test tests/api.test.ts tests/dashboard.test.ts`
Expected: los tests nuevos FAIL.

- [ ] **Step 3: Implementar**

En `web.ts`, cada `safeParse` fallido pasa a `throw new ProblemError(400, 'invalid_body' | 'invalid_query', { errors: zodProblemErrors(parsed.error) })`; los 404 a `throw new ProblemError(404, 'not_found')`; eliminar los `try/catch` de `QueueError` en `/api/notify` y `/api/jobs/:id/retry`. En el cliente: el reintento y el envío deciden por `res.ok` (ya no por `data.ok`) y muestran `window.__problemText(body)`; `api-keys.ts` igual. Las respuestas exitosas conservan `ok: true` y no se tocan.

- [ ] **Step 4: Verificación final de todo el cambio**

Run: `npm test && npm run typecheck`
Expected: todos PASS. Después `Grep` de `ok: false` y `error:` en `src/` no debe encontrar respuestas de error con el formato antiguo (solo `/ready`, que se conserva a propósito).

- [ ] **Step 5: Commit**

```bash
git add src/routes/web.ts src/web tests
git commit -m "feat: problem details for dashboard API and client"
```
