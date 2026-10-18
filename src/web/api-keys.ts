export function apiKeysSection(): string {
  return `
      <section class="card panel">
        <h2>API Keys</h2>
        <p class="muted small" style="margin-bottom: 1rem;">
          Usa estas claves en el header <code>Authorization: Bearer &lt;key&gt;</code> o
          <code>X-API-Key</code> para consumir <code>/v1/*</code>. No caducan; revócalas o elimínalas
          cuando ya no las necesites.
        </p>
        <form id="key-form">
          <label>Nombre <span class="muted small">(obligatorio)</span>
            <input id="key-name" required placeholder="App móvil" />
          </label>
          <label>IPs permitidas <span class="muted small">(opcional · vacío = cualquiera)</span>
            <input id="key-ips" placeholder="1.2.3.4, 10.0.0.0/8" />
          </label>
          <button type="submit">Crear API key</button>
          <div id="key-result" class="toast"></div>
        </form>
        <div id="keys" class="devices" style="margin-top: 1rem;">
          <p class="muted small empty">Cargando...</p>
        </div>
      </section>`;
}

export function apiKeysScript(): string {
  return `<script>
    (function () {
      var form = document.getElementById('key-form');
      var result = document.getElementById('key-result');
      var keysEl = document.getElementById('keys');

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

      function button(label, className, onClick) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = className;
        btn.textContent = label;
        btn.addEventListener('click', onClick);
        return btn;
      }

      function renderKeys(keys) {
        keysEl.innerHTML = '';
        if (!keys || keys.length === 0) {
          keysEl.appendChild(el('p', 'muted small empty', 'Aún no hay API keys.'));
          return;
        }
        keys.forEach(function (key) {
          var row = el('div', 'device');
          row.appendChild(el('div', 'device-id', key.name + '  ·  ' + key.prefix + '…'));
          var when = key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : 'nunca';
          row.appendChild(el('div', 'muted small',
            (key.enabled ? 'activa' : 'revocada') + ' · IPs: ' + (key.allowedIps || 'cualquiera') + ' · usada: ' + when));

          var actions = el('div', 'key-actions');
          actions.appendChild(button(key.enabled ? 'Revocar' : 'Activar', 'ghost', function () {
            fetch('/api/keys/' + key.id, {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ enabled: !key.enabled })
            }).then(loadKeys);
          }));
          actions.appendChild(button('Eliminar', 'ghost danger', function () {
            if (!confirm('¿Eliminar la clave "' + key.name + '"?')) return;
            fetch('/api/keys/' + key.id, { method: 'DELETE' }).then(loadKeys);
          }));
          row.appendChild(actions);
          keysEl.appendChild(row);
        });
      }

      function loadKeys() {
        fetch('/api/keys')
          .then(function (res) {
            if (res.status === 401) { window.location.href = '/login'; return null; }
            return res.json();
          })
          .then(function (data) { if (data) renderKeys(data.keys); })
          .catch(function () {
            keysEl.innerHTML = '';
            keysEl.appendChild(el('p', 'muted small empty', 'No se pudieron cargar las API keys.'));
          });
      }

      form.addEventListener('submit', function (event) {
        event.preventDefault();
        var name = document.getElementById('key-name').value.trim();
        if (!name) return;
        var ips = document.getElementById('key-ips').value.trim();
        show('ok', 'Creando...');
        fetch('/api/keys', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: name, allowedIps: ips })
        })
          .then(function (res) { return res.json().then(function (data) { return { ok: res.ok, data: data }; }); })
          .then(function (out) {
            if (!out.ok || !out.data.ok) {
              show('err', 'Error: ' + (out.data.error || 'desconocido'));
              return;
            }
            document.getElementById('key-name').value = '';
            document.getElementById('key-ips').value = '';
            result.className = 'toast show ok';
            result.textContent = '';
            result.appendChild(document.createTextNode('Cópiala ahora, no se volverá a mostrar: '));
            var code = el('code', 'new-key', out.data.key);
            result.appendChild(code);
            result.appendChild(button('Copiar', 'ghost', function () {
              navigator.clipboard.writeText(out.data.key).then(function () { show('ok', 'Clave copiada.'); });
            }));
            loadKeys();
          })
          .catch(function () { show('err', 'No se pudo contactar al servidor.'); });
      });

      loadKeys();
    })();
  </script>`;
}
