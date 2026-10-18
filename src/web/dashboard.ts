import { apiKeysScript, apiKeysSection } from './api-keys';
import { baseCss, escapeHtml, themeInitScript, themeToggleScript } from './layout';

export function dashboardPage(user: string): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Panel · Civitas Access</title>
  <link rel="icon" href="/assets/icon.png" />
  ${themeInitScript()}
  <style>
    ${baseCss}
    body { padding: 1.5rem; }
    .wrap { max-width: 1080px; margin: 0 auto; }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    .who { display: flex; align-items: center; gap: 0.8rem; font-size: 0.85rem; color: var(--muted); }
    .grid { display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 1.25rem; }
    @media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }
    .panel { padding: 1.5rem; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.9rem; }
    @media (max-width: 560px) { .row { grid-template-columns: 1fr; } }
    .panel h2 { font-size: 1rem; margin: 0 0 1rem; }
    .devices { display: flex; flex-direction: column; gap: 0.6rem; max-height: 460px; overflow: auto; }
    .device {
      padding: 0.75rem 0.9rem;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: color-mix(in srgb, var(--primary) 4%, transparent);
      cursor: pointer;
      transition: border-color 0.15s, transform 0.08s;
    }
    .device:hover { border-color: var(--primary); }
    .device:active { transform: translateY(1px); }
    .device-id { font-weight: 600; font-size: 0.9rem; word-break: break-all; }
    .empty { padding: 1rem; text-align: center; }
    .key-actions { display: flex; gap: 0.5rem; margin-top: 0.6rem; }
    .key-actions button.ghost { width: auto; font-size: 0.78rem; padding: 0.35rem 0.7rem; }
    .key-actions button.danger { color: var(--err); border-color: color-mix(in srgb, var(--err) 40%, transparent); }
    .new-key {
      display: inline-block;
      margin: 0 0.5rem;
      padding: 0.15rem 0.4rem;
      font-size: 0.82rem;
      word-break: break-all;
      background: color-mix(in srgb, var(--primary) 10%, transparent);
      border: 1px solid var(--border);
      border-radius: 7px;
    }
    .mt { margin-top: 1.25rem; }
  </style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand"><img class="logo" src="/assets/icon.png" alt="Civitas Access" /> Civitas Access</div>
      <div class="who">
        <span>${escapeHtml(user)}</span>
        <button type="button" id="theme-toggle" class="theme-toggle">Modo oscuro</button>
        <form method="post" action="/logout">
          <button class="ghost" type="submit">Salir</button>
        </form>
      </div>
    </header>

    <div class="grid">
      <section class="card panel">
        <h2>Enviar notificación</h2>
        <form id="notify-form">
          <label>Device ID
            <input id="deviceId" required placeholder="device-123" />
          </label>
          <label>Expo Token
            <input id="token" required placeholder="ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" />
          </label>
          <div class="row">
            <label>Título <span class="muted small">(opcional)</span>
              <input id="title" placeholder="Notificación" />
            </label>
            <label>URL <span class="muted small">(opcional · si se omite abre Home)</span>
              <input id="url" placeholder="/visitas/..." />
            </label>
          </div>
          <div class="row">
            <label>Tipo <span class="muted small">(opcional)</span>
              <input id="type" placeholder="visit_registered" />
            </label>
            <label>Pantalla <span class="muted small">(opcional · Home por defecto)</span>
              <input id="screen" placeholder="Home" />
            </label>
          </div>
          <div class="row">
            <label>Visit ID <span class="muted small">(opcional)</span>
              <input id="visitId" placeholder="VIS-0001" />
            </label>
            <label>Property ID <span class="muted small">(opcional)</span>
              <input id="propertyId" type="number" placeholder="456" />
            </label>
          </div>
          <div class="row">
            <label>Residence ID <span class="muted small">(opcional)</span>
              <input id="residenceId" type="number" placeholder="2" />
            </label>
            <label>Prioridad <span class="muted small">(opcional)</span>
              <select id="priority">
                <option value="">Por defecto</option>
                <option value="default">default</option>
                <option value="normal">normal</option>
                <option value="high">high</option>
              </select>
            </label>
          </div>
          <label>Canal <span class="muted small">(opcional · p. ej. panic)</span>
            <input id="channelId" placeholder="default" />
          </label>
          <label>Mensaje
            <textarea id="message" required placeholder="Escribe el cuerpo de la notificación..."></textarea>
          </label>
          <button type="submit">Enviar notificación</button>
          <div id="result" class="toast"></div>
        </form>
      </section>

      <section class="card panel">
        <h2>Dispositivos registrados</h2>
        <div id="devices" class="devices">
          <p class="muted small empty">Cargando...</p>
        </div>
      </section>
    </div>

    <div class="mt">
${apiKeysSection()}
    </div>
  </div>

  <script>
    (function () {
      var form = document.getElementById('notify-form');
      var result = document.getElementById('result');
      var devicesEl = document.getElementById('devices');

      function show(kind, text) {
        result.className = 'toast show ' + kind;
        result.textContent = text;
      }

      function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
      }

      function fill(device) {
        document.getElementById('deviceId').value = device.deviceId;
        document.getElementById('token').value = device.token || '';
        document.getElementById('message').focus();
      }

      function renderDevices(devices) {
        devicesEl.innerHTML = '';
        if (!devices || devices.length === 0) {
          devicesEl.appendChild(el('p', 'muted small empty', 'Aún no hay dispositivos registrados.'));
          return;
        }
        devices.forEach(function (device) {
          var row = el('div', 'device');
          row.appendChild(el('div', 'device-id', device.deviceId));
          var when = device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString() : '';
          row.appendChild(el('div', 'muted small', (device.platform || 'unknown') + (when ? ' · ' + when : '')));
          row.addEventListener('click', function () { fill(device); });
          devicesEl.appendChild(row);
        });
      }

      function loadDevices() {
        fetch('/api/devices')
          .then(function (res) {
            if (res.status === 401) { window.location.href = '/login'; return null; }
            return res.json();
          })
          .then(function (data) {
            if (data) renderDevices(data.devices);
          })
          .catch(function () {
            devicesEl.innerHTML = '';
            devicesEl.appendChild(el('p', 'muted small empty', 'No se pudieron cargar los dispositivos.'));
          });
      }

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var payload = {
          deviceId: document.getElementById('deviceId').value.trim(),
          token: document.getElementById('token').value.trim(),
          message: document.getElementById('message').value.trim()
        };
        var title = document.getElementById('title').value.trim();
        var url = document.getElementById('url').value.trim();
        if (title) payload.title = title;
        if (url) payload.url = url;

        var data = {};
        var type = document.getElementById('type').value.trim();
        var screen = document.getElementById('screen').value.trim();
        var visitId = document.getElementById('visitId').value.trim();
        var propertyId = document.getElementById('propertyId').value.trim();
        var residenceId = document.getElementById('residenceId').value.trim();
        if (type) data.type = type;
        if (screen) data.screen = screen;
        if (visitId) data.visitId = visitId;
        if (propertyId) data.propertyId = Number(propertyId);
        if (residenceId) data.residenceId = Number(residenceId);
        if (Object.keys(data).length) payload.data = data;

        var priority = document.getElementById('priority').value;
        var channelId = document.getElementById('channelId').value.trim();
        if (priority) payload.priority = priority;
        if (channelId) payload.channelId = channelId;

        show('ok', 'Enviando...');
        fetch('/api/notify', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        })
          .then(function (res) {
            return res.json().then(function (data) { return { ok: res.ok, data: data }; });
          })
          .then(function (out) {
            if (out.ok && out.data.ok) {
              show('ok', 'Enviado a ' + out.data.sent + ' dispositivo(s).');
              loadDevices();
            } else {
              show('err', 'Error: ' + (out.data.error || 'desconocido'));
            }
          })
          .catch(function () {
            show('err', 'No se pudo contactar al servidor.');
          });
      });

      loadDevices();
    })();
  </script>
  ${apiKeysScript()}
  ${themeToggleScript()}
</body>
</html>`;
}
