import { apiKeysPanel, apiKeysScript } from './api-keys';
import {
  appShell,
  baseCss,
  shellCss,
  shellScript,
  themeInitScript,
  themeToggleScript,
} from './layout';

function notifyPanel(): string {
  return `        <section class="tab-panel" id="panel-notify" role="tabpanel" aria-label="Notificación">
          <div class="card panel">
            <h2>Enviar notificación</h2>
            <form id="notify-form">
              <fieldset class="fieldset">
                <legend>Destino</legend>
                <label>Device ID
                  <input id="deviceId" required placeholder="device-123" />
                </label>
                <label>Expo Token
                  <input id="token" required placeholder="ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]" />
                </label>
              </fieldset>

              <fieldset class="fieldset">
                <legend>Contenido</legend>
                <div class="row">
                  <label>Título <span class="muted small">(opcional)</span>
                    <input id="title" placeholder="Notificación" />
                  </label>
                  <label>URL <span class="muted small">(opcional · si se omite abre Home)</span>
                    <input id="url" placeholder="/visitas/..." />
                  </label>
                </div>
                <label>Mensaje
                  <textarea id="message" required placeholder="Escribe el cuerpo de la notificación..."></textarea>
                </label>
              </fieldset>

              <fieldset class="fieldset">
                <legend>Enrutamiento en la app</legend>
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
              </fieldset>

              <button type="submit">Enviar notificación</button>
              <div id="result" class="toast"></div>
            </form>
          </div>
        </section>`;
}

function devicesPanel(): string {
  return `        <section class="tab-panel" id="panel-devices" role="tabpanel" aria-label="Dispositivos" hidden>
          <div class="card panel">
            <h2>Dispositivos registrados</h2>
            <div class="toolbar">
              <input id="device-search" type="search" placeholder="Buscar por Device ID..." />
              <button type="button" class="ghost" id="devices-refresh" style="width:auto; white-space:nowrap;">Actualizar</button>
            </div>
            <p class="muted small" style="margin-bottom:0.9rem;">Haz clic en un dispositivo para autocompletar el formulario de notificación.</p>
            <div id="devices" class="devices">
              <p class="muted small empty">Cargando...</p>
            </div>
          </div>
        </section>`;
}

function dashboardScript(): string {
  return `<script>
    (function () {
      var form = document.getElementById('notify-form');
      var result = document.getElementById('result');
      var devicesEl = document.getElementById('devices');
      var searchEl = document.getElementById('device-search');
      var refreshEl = document.getElementById('devices-refresh');
      var allDevices = [];

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
        window.location.hash = '#/notify';
        document.getElementById('message').focus();
      }

      function renderDevices() {
        var query = (searchEl && searchEl.value || '').trim().toLowerCase();
        var list = query
          ? allDevices.filter(function (d) { return (d.deviceId || '').toLowerCase().indexOf(query) !== -1; })
          : allDevices;
        devicesEl.innerHTML = '';
        if (!list || list.length === 0) {
          devicesEl.appendChild(el('p', 'muted small empty',
            allDevices.length === 0 ? 'Aún no hay dispositivos registrados.' : 'Sin resultados para la búsqueda.'));
          return;
        }
        list.forEach(function (device) {
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
            if (!data) return;
            allDevices = data.devices || [];
            renderDevices();
            if (window.__setBadge) window.__setBadge('badge-devices', allDevices.length);
          })
          .catch(function () {
            devicesEl.innerHTML = '';
            devicesEl.appendChild(el('p', 'muted small empty', 'No se pudieron cargar los dispositivos.'));
          });
      }

      if (searchEl) searchEl.addEventListener('input', renderDevices);
      if (refreshEl) refreshEl.addEventListener('click', loadDevices);

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
  </script>`;
}

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
    ${shellCss}
  </style>
</head>
<body>
  ${appShell({
    user,
    content: [notifyPanel(), devicesPanel(), apiKeysPanel()].join('\n'),
  })}
  ${dashboardScript()}
  ${apiKeysScript()}
  ${shellScript()}
  ${themeToggleScript()}
</body>
</html>`;
}
