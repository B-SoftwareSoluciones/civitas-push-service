# Civitas Access · Push

Servidor mínimo de notificaciones push vía [Expo](https://expo.dev) con un panel web para enviarlas. Guarda los dispositivos (Device ID + Expo Token) en SQLite y expone una ruta simple para enviar un mensaje a un dispositivo.

## Características

- Guarda/actualiza dispositivos (`deviceId` + `token`) de forma automática.
- Ruta `POST /v1/notify` que recibe **token de Expo, device id y mensaje** y envía el push.
- **API keys** para servicios externos: se crean, se revocan y se eliminan desde el panel o la CLI. No caducan.
- Todas las rutas `/v1/*` exigen API key (`Authorization: Bearer` o `X-API-Key`).
- API keys con **allowlist de IPs/CIDR** opcional.
- Panel web con login (usuario + contraseña) para enviar notificaciones y gestionar API keys.
- Persistencia en SQLite con `node:sqlite` (sin dependencias nativas).
- Cabeceras de seguridad (CSP, `X-Frame-Options`, `HSTS` en producción, etc.).
- Sin cron, sin scraping: solo push.

## Requisitos

- Node.js **24 o superior** (necesario para `node:sqlite`).

## Instalación

```bash
npm install
cp .env.example .env
```

Edita `.env` con tus credenciales:

| Variable | Descripción | Ejemplo |
| --- | --- | --- |
| `PORT` | Puerto HTTP del servidor. | `8790` |
| `DATABASE_PATH` | Ruta del archivo SQLite (relativa al proyecto). | `./data/push.sqlite` |
| `EXPO_ACCESS_TOKEN` | Token de acceso de Expo (Enhanced Push Security). Opcional en desarrollo. | |
| `ADMIN_USER` | Usuario del panel web. | `admin` |
| `ADMIN_PASSWORD` | Contraseña del panel web. **Obligatoria**: mínimo 12 caracteres y no puede ser un valor por defecto (si no, el servidor no arranca). | `una-clave-fuerte` |
| `SESSION_SECRET` | Secreto para firmar la cookie de sesión. | cadena aleatoria larga |
| `API_KEY_PEPPER` | Secreto con el que se calcula el hash de las API keys. **Cambiarlo invalida todas las claves.** | cadena aleatoria larga |
| `TRUST_PROXY` | Confiar en `X-Forwarded-For`/`X-Real-IP` para resolver la IP del cliente (true tras un reverse proxy). | `false` |
| `CORS_ORIGIN` | Origen permitido para la API. Vacío = no se emiten cabeceras CORS (recomendado para móvil). | `https://panel.example.com` |
| `LOGIN_RATE_LIMIT_MAX` | Intentos de login por IP en 5 minutos. | `10` |
| `API_RATE_LIMIT_MAX` | Peticiones por IP a `/v1/*` por minuto. | `120` |

> Si no defines `SESSION_SECRET` ni `API_KEY_PEPPER`, el servidor los genera y los
> guarda en `data/runtime.env` (dentro del volumen de datos) y los reutiliza en los
> siguientes arranques. Así las API keys y las sesiones **no se invalidan al reiniciar**.

## Uso

```bash
npm run dev     # desarrollo con recarga automática (tsx watch)
npm start       # producción
```

- API: `http://localhost:8790`
- Panel web: `http://localhost:8790/login`

Al arrancar, la base de datos se crea automáticamente en la ruta `DATABASE_PATH`.

## API

Todas las rutas `/v1/*` requieren una **API key**. Envíala en la cabecera
`X-API-Key: <clave>` o `Authorization: Bearer <clave>`. Sin clave válida la API
responde `401 { "ok": false, "error": "unauthorized" }`.

```bash
export CIVITAS_API_KEY="cva_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### `GET /health`

Público (sin API key).

```bash
curl http://localhost:8790/health
# { "ok": true, "time": "..." }
```

### `POST /v1/devices`

Registra o actualiza un dispositivo. Se puede llamar tantas veces como haga falta.

```bash
curl -X POST http://localhost:8790/v1/devices \
  -H "X-API-Key: $CIVITAS_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "deviceId": "device-123",
    "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    "platform": "android"
  }'
# { "ok": true }
```

### `POST /v1/notify`

**Ruta principal.** Recibe `deviceId`, `token` y `message` (más `title` y `url` opcionales), guarda el dispositivo y envía el push. Si el dispositivo ya existe, actualiza su token.

```bash
curl -X POST http://localhost:8790/v1/notify \
  -H "X-API-Key: $CIVITAS_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "deviceId": "device-123",
    "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    "title": "Nuevo capítulo",
    "message": "Ya está disponible el capítulo 42.",
    "url": "/visitas/123"
  }'
# { "ok": true, "sent": 1 }
```

Respuestas:

- `200 { "ok": true, "sent": 1 }` — enviado.
- `400 { "ok": false, "error": "invalid_expo_token" }` — el token no tiene formato de Expo.
- `502 { "ok": false, "error": "push_failed" }` — Expo rechazó el envío.
- `400 { "ok": false, "error": "invalid_body", "details": ... }` — payload inválido.

### `POST /v1/devices/sync`

Ruta de compatibilidad con la app Civitas Access (solo registra el dispositivo; ignora las suscripciones).

```bash
curl -X POST http://localhost:8790/v1/devices/sync \
  -H "X-API-Key: $CIVITAS_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "deviceId": "device-123",
    "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]",
    "platform": "android",
    "items": []
  }'
# { "ok": true }
```

### `DELETE /v1/devices/:id`

Elimina un dispositivo.

```bash
curl -X DELETE http://localhost:8790/v1/devices/device-123 \
  -H "X-API-Key: $CIVITAS_API_KEY"
```

## API keys

Las API keys son la credencial de los servicios externos. **No caducan**; se
revocan (deshabilitan) o se eliminan cuando ya no se usan. El servidor solo guarda
un **hash** (HMAC-SHA256) de cada clave: la clave en claro se muestra **una única
vez**, al crearla.

### Gestión desde el panel

Con la sesión iniciada, en la sección **API Keys** del panel puedes:

- Crear una clave con un nombre y, opcionalmente, una lista de **IPs permitidas**
  (valores exactos o CIDR separados por comas, p. ej. `10.0.0.0/8, 1.2.3.4`).
- Copiar la clave (solo se muestra al crearla).
- Revocar/activar o eliminar la clave.

### Endpoints del panel (requieren sesión)

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/api/keys` | Lista las claves (nunca devuelve la clave en claro). |
| `POST` | `/api/keys` | Crea una clave; devuelve `{ key }` una sola vez. |
| `PATCH` | `/api/keys/:id` | Cambia `enabled` y/o `allowedIps`. |
| `DELETE` | `/api/keys/:id` | Elimina la clave. |

### CLI

```bash
# Crear (imprime la clave una vez)
npm run api-key:create -- --name "App móvil" --ips "10.0.0.0/8, 1.2.3.4"

# Listar
npm run api-key:list

# Eliminar por id
npm run api-key:revoke -- <id>
```

## Panel web

1. Abre `http://localhost:8790/login`.
2. Ingresa con `ADMIN_USER` / `ADMIN_PASSWORD`.
3. En el panel puedes:
   - Escribir **Device ID**, **Expo Token**, **Título** (opcional), **URL** (opcional) y **Mensaje**.
   - Ver la lista de **dispositivos registrados**; al hacer clic en uno se autocompletan sus datos.
   - Enviar la notificación con el botón **Enviar notificación**.
   - Gestionar las **API keys** (crear, copiar una vez, revocar, eliminar).

La sesión se guarda en una cookie HttpOnly firmada con `SESSION_SECRET` (duración 7 días; `Secure` en producción).

## Persistencia

Los datos viven en `DATABASE_PATH` (por defecto `./data/push.sqlite`).

Tabla `devices`:

| Columna | Tipo | Descripción |
| --- | --- | --- |
| `id` | TEXT PK | Device ID. |
| `expo_token` | TEXT | Token de Expo. |
| `platform` | TEXT | Plataforma (`android`, `ios`, `unknown`...). |
| `enabled` | INTEGER | `1` activo. |
| `created_at` | TEXT | Alta (ISO). |
| `updated_at` | TEXT | Última actualización (ISO). |
| `last_seen_at` | TEXT | Último contacto (ISO). |

Tabla `api_keys`:

| Columna | Tipo | Descripción |
| --- | --- | --- |
| `id` | TEXT PK | Identificador de la clave. |
| `name` | TEXT | Nombre descriptivo. |
| `prefix` | TEXT | Prefijo visible (p. ej. `cva_ab12cd34`). |
| `key_hash` | TEXT UNIQUE | HMAC-SHA256 de la clave completa. |
| `enabled` | INTEGER | `1` activa, `0` revocada. |
| `allowed_ips` | TEXT | IPs/CIDR permitidos (vacío = cualquiera). |
| `created_at` | TEXT | Alta (ISO). |
| `last_used_at` | TEXT / NULL | último uso (ISO). |

Los secretos generados automáticamente se guardan en `data/runtime.env` (mismo volumen).

## Docker

```bash
docker compose up --build
```

El servicio escucha en `:8790` y persiste la base de datos en `./data` (montado como volumen).
**Necesitas un `.env` con `ADMIN_PASSWORD`** (mínimo 12 caracteres): los secretos ya **no** van en
`compose.yml`. Si no defines `SESSION_SECRET`/`API_KEY_PEPPER`, se generan y persisten en
`./data/runtime.env`; las API keys y las sesiones sobreviven a los reinicios.
El contenedor corre como usuario sin privilegios; ajusta `CIVITAS_UID`/`CIVITAS_GID` a tu UID/GID
local para que pueda escribir en `./data`.

## Seguridad

- **API keys obligatorias en `/v1/*`**: sin clave válida no hay acceso a la API externa.
  Las claves se guardan hasheadas (HMAC-SHA256) y se verifican en tiempo constante.
- **Sin caducidad**: las claves no expiran; revócalas o elimínalas cuando dejen de usarse.
- **Allowlist de IPs/CIDR** por clave (opcional) para restringir su origen.
- **Cabeceras de seguridad**: CSP, `X-Frame-Options`, `X-Content-Type-Options`,
  `Referrer-Policy`, `Permissions-Policy` y `HSTS` en producción.
- **Superficies separadas**: `/v1/*` solo con API key; el panel (`/`, `/api/*`, `/doc`, `/ui`)
  solo con sesión.
- **Rate limiting**: límite de intentos de login por IP y de peticiones a `/v1/*` (responde `429`).
- **CSRF**: las mutaciones del panel validan `Origin`/`Sec-Fetch-Site`; respuestas autenticadas con
  `Cache-Control: no-store`.
- **Contenedor sin privilegios**: la imagen corre como usuario no-root.
- Si expones el servicio detrás de un reverse proxy, activa `TRUST_PROXY=true` para que la
  IP del cliente se lea de `X-Forwarded-For`/`X-Real-IP` (necesario para la allowlist y el rate limit).
- Cambia `ADMIN_PASSWORD` antes de exponer el servicio y configura `EXPO_ACCESS_TOKEN` si usas
  Enhanced Push Security.
