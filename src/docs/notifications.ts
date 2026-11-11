/**
 * Documentación OpenAPI de los casos de uso de notificaciones.
 * Los ejemplos de petición se validan contra los esquemas reales en tests/openapi.test.ts,
 * así que no pueden desfasarse del contrato.
 */

const device = { deviceId: 'device-123', token: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' };
const source = 'civitas.access.visits';

const visitData = (status: 'pending' | 'inside' | 'outside') => ({
  visitId: 'VIS-0001',
  status,
  visitor: 'Juan Pérez',
  propertyLabel: 'Casa 4',
  propertyId: '456',
  residenceId: '2',
});

const visitEnvelope = (type: string, id: string, status: 'pending' | 'inside' | 'outside', title: string, message: string) => ({
  id,
  type,
  version: 1,
  occurredAt: '2026-11-11T14:32:00-06:00',
  source,
  data: visitData(status),
  notification: { ...device, title, message, screen: 'VisitStatus', priority: 'high', saveDevice: false },
});

export const notifyDescription = `
Envía **una** notificación push a **un** dispositivo. Si hay capacidad inmediata, Expo la acepta durante la petición (**200**); si no, se persiste en la cola y se entrega después (**202**). Consulta el avance con \`GET /v1/notify/{id}\`.

El cuerpo admite dos formatos (se detecta solo):

* **Envelope de evento** (recomendado): \`id\`, \`type\`, \`version\`, \`occurredAt\`, \`source\`, \`data\` y \`notification\`. El \`id\` del evento se usa como clave de idempotencia si no envías el encabezado \`Idempotency-Key\`.
* **Formato plano** (compatibilidad): \`deviceId\`, \`token\`, \`message\` y \`data\` al mismo nivel.

### Casos de uso

| Caso de uso | \`type\` del evento | Pantalla destino | Valores por defecto |
|---|---|---|---|
| Visita creada | \`visit.created\` (\`visit_created\`) | \`VisitStatus\` | — |
| Visita registrada | \`visit.registered\` (\`visit_registered\`) | \`VisitStatus\` | — |
| Entrada de visita | \`visit.entry\` (\`visit_entry\`) | \`VisitStatus\` | — |
| Salida de visita | \`visit.exit\` (\`visit_exit\`) | \`VisitStatus\` | — |
| Botón de pánico | \`panic\` / \`panic.triggered\` | \`SecurityDashboard\` | \`priority: high\`, \`sound: panic.wav\`, \`channelId: panic_alarm\`, \`interruptionLevel: time-sensitive\` |
| Anuncio | \`announcement.published\` / \`announcement.generic\` | \`Announcements\` | \`data.title\` y \`data.message\` se copian del título y mensaje |
| Notificación genérica | \`notification.generic\` | \`None\` (no abre pantalla) | — |
| Otro / sin tipo | cualquiera | \`Splash\` | — |

Un \`screen\` explícito siempre tiene prioridad sobre el resuelto por \`type\`.

### Identificadores
\`data.propertyId\` y \`data.residenceId\` son **cadenas** (máx. 128 caracteres). Un número en \`propertyId\` responde **400** con el puntero \`#/data/propertyId\`.

### Idempotencia
Reenviar la misma clave con el **mismo** contenido devuelve el resultado original. Con contenido distinto responde **409**.

### Límites
El mensaje serializado para Expo no puede superar **4096 bytes** (**400** \`payload_too_large\`). El cuerpo de la petición no puede superar 16 KB.
`.trim();

export const notifyRequestExamples = {
  visitCreated: {
    summary: 'Visita creada',
    description: 'Se pre-registró una visita. Estado `pending`; abre `VisitStatus`.',
    value: visitEnvelope('visit.created', 'evt_visit_created_01', 'pending', 'Visita registrada', 'Juan Pérez fue registrado en tu propiedad'),
  },
  visitRegistered: {
    summary: 'Visita registrada',
    description: 'La visita quedó registrada en caseta y espera tu autorización.',
    value: visitEnvelope('visit.registered', 'evt_visit_registered_01', 'pending', 'Tienes una visita', 'Juan Pérez está en la puerta'),
  },
  visitEntry: {
    summary: 'Entrada de visita',
    description: 'La visita ingresó. Estado `inside`.',
    value: visitEnvelope('visit.entry', 'evt_visit_entry_01', 'inside', 'Entrada registrada', 'Juan Pérez ingresó a tu propiedad'),
  },
  visitExit: {
    summary: 'Salida de visita',
    description: 'La visita salió. Estado `outside`.',
    value: visitEnvelope('visit.exit', 'evt_visit_exit_01', 'outside', 'Salida registrada', 'Juan Pérez salió de tu propiedad'),
  },
  panic: {
    summary: 'Botón de pánico',
    description:
      'Alerta de emergencia. Sin campos extra se aplican `priority: high`, sonido `panic.wav`, canal `panic_alarm` y nivel `time-sensitive`; abre `SecurityDashboard`.',
    value: {
      id: 'evt_panic_01',
      type: 'panic.triggered',
      version: 1,
      occurredAt: '2026-11-11T22:05:10-06:00',
      source: 'civitas.access.security',
      data: { propertyLabel: 'Casa 4', propertyId: '456', residenceId: '2' },
      notification: { ...device, title: '🚨 PÁNICO', message: 'Botón de pánico activado en Casa 4' },
    },
  },
  announcement: {
    summary: 'Anuncio de la administración',
    description: 'Abre `Announcements`. El título y el mensaje también viajan en `data` para que la app los muestre sin otra consulta.',
    value: {
      id: 'evt_announcement_01',
      type: 'announcement.published',
      version: 1,
      occurredAt: '2026-11-11T09:00:00-06:00',
      source: 'civitas.access.announcements',
      data: { announcementId: 'ANN-0001', category: 'general' },
      notification: { ...device, title: 'Anuncio de la administración', message: 'El área común estará cerrada el sábado.', screen: 'Announcements' },
    },
  },
  generic: {
    summary: 'Notificación genérica',
    description: 'Solo informa; no abre ninguna pantalla (`screen: None`).',
    value: {
      id: 'evt_generic_01',
      type: 'notification.generic',
      version: 1,
      occurredAt: '2026-11-11T12:00:00-06:00',
      source: 'civitas.access',
      notification: { ...device, title: 'Civitas Access', message: 'Tu solicitud fue recibida.' },
    },
  },
  flatVisit: {
    summary: 'Formato plano (compatibilidad)',
    description: 'Sin envelope. El `type` va dentro de `data`; `saveDevice: true` guarda el dispositivo para futuros lotes.',
    value: {
      ...device,
      title: 'Entrada registrada',
      message: 'Juan Pérez ingresó a tu propiedad',
      saveDevice: true,
      priority: 'high',
      data: { type: 'visit_entry', ...visitData('inside'), occurredAt: '2026-11-11T14:32:00-06:00' },
    },
  },
};

const jobExample = {
  id: '3f2b8c1e-7a44-4d0e-9b55-1c2d3e4f5a6b',
  deviceId: 'device-123',
  attempts: 1,
  error: null,
  createdAt: '2026-11-11T20:32:01.120Z',
  updatedAt: '2026-11-11T20:32:01.480Z',
  batchId: null,
  deliveryMode: 'immediate',
  priority: 'high',
};

export const notifyAcceptedExample = {
  immediate: {
    summary: 'Expo aceptó el mensaje',
    value: { ok: true, sent: 1, ticketId: '0192f7c2-5d1e-7a3b-8c4d-9e0f1a2b3c4d', job: { ...jobExample, status: 'awaiting_receipt' } },
  },
};

export const notifyQueuedExample = {
  queued: {
    summary: 'Encolada por falta de capacidad inmediata',
    value: { ok: true, sent: 0, job: { ...jobExample, status: 'queued', attempts: 0, deliveryMode: 'queued' } },
  },
};

export const jobStatusExamples = {
  awaitingReceipt: { summary: 'Esperando recibo de Expo', value: { ok: true, job: { ...jobExample, status: 'awaiting_receipt' } } },
  accepted: { summary: 'Entregada a Expo', value: { ok: true, job: { ...jobExample, status: 'accepted', updatedAt: '2026-11-11T20:33:10.000Z' } } },
  dead: { summary: 'Fallida', value: { ok: true, job: { ...jobExample, status: 'dead', error: 'DeviceNotRegistered' } } },
};

export const batchDescription = `
Encola **la misma notificación** para hasta **1000 dispositivos** en una sola operación atómica: o se persisten todos los trabajos (**202**) o ninguno (**503** si la cola no tiene capacidad para el lote completo).

* \`message\`, \`title\`, \`priority\`, \`sound\`, \`channelId\`, \`interruptionLevel\`, \`url\` y \`data\` son comunes a todo el lote.
* Cada elemento de \`devices\` aporta \`deviceId\`, \`token\` y, opcionalmente, su propio \`data\` (se combina con el común; el del dispositivo gana). Útil para \`propertyId\` y \`residenceId\` distintos por destinatario.
* No se permiten dispositivos ni tokens duplicados dentro del lote, ni campos desconocidos.
* Las reglas por tipo de evento (pánico, anuncio, visita) son las mismas que en \`POST /v1/notify\`: el \`data.type\` define la pantalla y los valores por defecto.
* \`Idempotency-Key\` repetido con el mismo contenido devuelve el mismo lote; con contenido distinto responde **409**.
* El cuerpo admite hasta **1 MB**. Consulta el avance con \`GET /v1/batches/{id}\` y el detalle por dispositivo con \`GET /v1/batches/{id}/jobs\`.
`.trim();

export const batchRequestExamples = {
  panicBatch: {
    summary: 'Pánico a todo el personal de seguridad',
    description: 'Se aplican los valores por defecto de pánico (sonido, canal, nivel de interrupción y prioridad alta).',
    value: {
      name: 'Pánico Casa 4',
      title: '🚨 PÁNICO',
      message: 'Botón de pánico activado en Casa 4',
      data: { type: 'panic', propertyId: '456', residenceId: '2' },
      devices: [
        { deviceId: 'guard-01', token: 'ExponentPushToken[guard-01-xxxxxxxxxxxx]' },
        { deviceId: 'guard-02', token: 'ExponentPushToken[guard-02-xxxxxxxxxxxx]' },
      ],
    },
  },
  announcementBatch: {
    summary: 'Anuncio a toda la comunidad',
    value: {
      name: 'Cierre de área común',
      title: 'Anuncio de la administración',
      message: 'El área común estará cerrada el sábado.',
      data: { type: 'announcement.published', announcementId: 'ANN-0001' },
      devices: [
        { deviceId: 'resident-01', token: 'ExponentPushToken[resident-01-xxxxxxx]' },
        { deviceId: 'resident-02', token: 'ExponentPushToken[resident-02-xxxxxxx]' },
      ],
    },
  },
  visitBatch: {
    summary: 'Visita con propiedad distinta por dispositivo',
    description: 'El `data` de cada dispositivo se combina con el común.',
    value: {
      name: 'Visita entrada VIS-0001',
      title: 'Entrada registrada',
      message: 'Juan Pérez ingresó',
      priority: 'high',
      data: { type: 'visit_entry', visitId: 'VIS-0001', status: 'inside', visitor: 'Juan Pérez' },
      devices: [
        { deviceId: 'resident-01', token: 'ExponentPushToken[resident-01-xxxxxxx]', data: { propertyId: '456', residenceId: '2' } },
        { deviceId: 'resident-02', token: 'ExponentPushToken[resident-02-xxxxxxx]', data: { propertyId: '457', residenceId: '3' } },
      ],
    },
  },
};

export const batchAcceptedExample = {
  queued: {
    summary: 'Lote persistido',
    value: {
      ok: true,
      batch: {
        id: '8a1d6c3e-2b7f-4e90-a1c5-3d4e5f6a7b8c',
        name: 'Pánico Casa 4',
        total: 2,
        status: 'queued',
        counts: { queued: 2, sending: 0, awaiting_receipt: 0, accepted: 0, dead: 0 },
        processed: 0,
        finished: 0,
        progress: 0,
        createdAt: '2026-11-11T20:32:01.120Z',
      },
    },
  },
};

export const openApiTags = [
  { name: 'Notify', description: 'Envío individual de notificaciones y eventos (visitas, pánico, anuncios y genéricas) y consulta de su estado.' },
  { name: 'Batches', description: 'Envío masivo de una misma notificación a hasta 1000 dispositivos, con seguimiento del progreso.' },
  { name: 'Devices', description: 'Registro de dispositivos y tokens de Expo.' },
];
