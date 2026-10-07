# Civitas Access · Push

Servidor mínimo de notificaciones push vía [Expo](https://expo.dev) con un panel web para enviarlas. Guarda los dispositivos (Device ID + Expo Token) en SQLite y expone una ruta simple para enviar un mensaje a un dispositivo.

## Características

- Guarda/actualiza dispositivos (`deviceId` + `token`) de forma automática.
- Ruta `POST /v1/notify` que recibe **token de Expo, device id y mensaje** y envía el push.
- Panel web con login (usuario + contraseña) para enviar notificaciones desde el navegador.
- Persistencia en SQLite con `node:sqlite` (sin dependencias nativas).
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
| `ADMIN_PASSWORD` | Contraseña del panel web. | `una-clave-fuerte` |
| `SESSION_SECRET` | Secreto para firmar la cookie de sesión. | cadena aleatoria larga |
| `CORS_ORIGIN` | Origen permitido para la API (`*` en desarrollo). | `*` |

## Uso

```bash
npm run dev     # desarrollo con recarga automática (tsx watch)
npm start       # producción
```

- API: `http://localhost:8790`
- Panel web: `http://localhost:8790/login`

Al arrancar, la base de datos se crea automáticamente en la ruta `DATABASE_PATH`.

## API

### `GET /health`

```bash
curl http://localhost:8790/health
# { "ok": true, "time": "..." }
```

### `POST /v1/devices`

Registra o actualiza un dispositivo. Se puede llamar tantas veces como haga falta.

```bash
curl -X POST http://localhost:8790/v1/devices \
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
curl -X DELETE http://localhost:8790/v1/devices/device-123
```

## Panel web

1. Abre `http://localhost:8790/login`.
2. Ingresa con `ADMIN_USER` / `ADMIN_PASSWORD`.
3. En el panel puedes:
   - Escribir **Device ID**, **Expo Token**, **Título** (opcional), **URL** (opcional) y **Mensaje**.
   - Ver la lista de **dispositivos registrados**; al hacer clic en uno se autocompletan sus datos.
   - Enviar la notificación con el botón **Enviar notificación**.

La sesión se guarda en una cookie HttpOnly firmada con `SESSION_SECRET` (duración 7 días).

## Persistencia

Los datos viven en `DATABASE_PATH` (por defecto `./data/push.sqlite`). Tabla `devices`:

| Columna | Tipo | Descripción |
| --- | --- | --- |
| `id` | TEXT PK | Device ID. |
| `expo_token` | TEXT | Token de Expo. |
| `platform` | TEXT | Plataforma (`android`, `ios`, `unknown`...). |
| `enabled` | INTEGER | `1` activo. |
| `created_at` | TEXT | Alta (ISO). |
| `updated_at` | TEXT | Última actualización (ISO). |
| `last_seen_at` | TEXT | Último contacto (ISO). |

## Docker

```bash
docker compose up --build
```

El servicio escucha en `:8790` y persiste la base de datos en `./data` (montado como volumen).

## Seguridad

- Cambia `ADMIN_PASSWORD` y `SESSION_SECRET` antes de exponer el servicio.
- Configura `EXPO_ACCESS_TOKEN` si usas Enhanced Push Security.
- La API `/v1/*` es pública por diseño (la usan las apps). Protégela con un reverse proxy o firewall si la expones a internet.
