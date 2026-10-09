export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const THEME_STORAGE_KEY = 'civitas-theme';

export const baseCss = `
  :root {
    color-scheme: light;
    --bg-start: #eff6ff;
    --bg-end: #ffffff;
    --card: #ffffff;
    --border: #dbeafe;
    --text: #1e3a8a;
    --muted: #475569;
    --primary: #1d4ed8;
    --primary-2: #1e3a8a;
    --ok: #059669;
    --err: #d32f2f;
    --input-bg: #ffffff;
    --input-border: #dbeafe;
    --focus-ring: rgba(29, 78, 216, 0.25);
    --shadow: rgba(30, 58, 138, 0.12);
    --glow: rgba(29, 78, 216, 0.12);
  }
  [data-theme="dark"] {
    color-scheme: dark;
    --bg-start: #0b0f1a;
    --bg-end: #131a2e;
    --card: rgba(22, 28, 48, 0.85);
    --border: rgba(255, 255, 255, 0.08);
    --text: #eef2ff;
    --muted: #9aa4c7;
    --primary: #3b82f6;
    --primary-2: #1d4ed8;
    --ok: #34d399;
    --err: #f87171;
    --input-bg: rgba(9, 12, 22, 0.65);
    --input-border: rgba(255, 255, 255, 0.08);
    --focus-ring: rgba(59, 130, 246, 0.3);
    --shadow: rgba(0, 0, 0, 0.45);
    --glow: rgba(29, 78, 216, 0.4);
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    color: var(--text);
    background:
      radial-gradient(900px 500px at 15% -10%, var(--glow), transparent 60%),
      linear-gradient(160deg, var(--bg-start), var(--bg-end));
    background-attachment: fixed;
    transition: background 0.2s ease, color 0.2s ease;
  }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 18px;
    box-shadow: 0 24px 60px var(--shadow);
    backdrop-filter: blur(14px);
  }
  h1 { font-size: 1.4rem; margin: 0 0 0.25rem; letter-spacing: -0.01em; }
  p { margin: 0; }
  .muted { color: var(--muted); }
  .small { font-size: 0.78rem; }
  label { display: block; font-size: 0.82rem; color: var(--muted); margin-bottom: 0.9rem; }
  input, textarea, select {
    width: 100%;
    margin-top: 0.35rem;
    padding: 0.7rem 0.85rem;
    font-size: 0.95rem;
    font-family: inherit;
    color: var(--text);
    background: var(--input-bg);
    border: 1px solid var(--input-border);
    border-radius: 11px;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  input::placeholder, textarea::placeholder { color: var(--muted); opacity: 0.7; }
  input:focus, textarea:focus, select:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 3px var(--focus-ring);
  }
  textarea { resize: vertical; min-height: 96px; }
  button {
    width: 100%;
    padding: 0.75rem 1rem;
    font-size: 0.95rem;
    font-weight: 600;
    color: #ffffff;
    background: linear-gradient(135deg, var(--primary-2), var(--primary));
    border: none;
    border-radius: 11px;
    cursor: pointer;
    transition: transform 0.08s, filter 0.15s;
  }
  button:hover { filter: brightness(1.08); }
  button:active { transform: translateY(1px); }
  button.ghost {
    width: auto;
    padding: 0.5rem 0.9rem;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
    font-weight: 500;
  }
  .brand { display: flex; align-items: center; gap: 0.6rem; font-weight: 700; }
  .logo {
    width: 34px;
    height: 34px;
    border-radius: 9px;
    object-fit: cover;
    box-shadow: 0 6px 16px var(--shadow);
  }
  .theme-toggle {
    width: auto;
    padding: 0.5rem 0.9rem;
    background: transparent;
    border: 1px solid var(--border);
    color: var(--muted);
    font-weight: 500;
    white-space: nowrap;
  }
  .error {
    margin-bottom: 1rem;
    padding: 0.6rem 0.8rem;
    font-size: 0.85rem;
    color: var(--err);
    background: color-mix(in srgb, var(--err) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--err) 35%, transparent);
    border-radius: 10px;
  }
  .toast {
    margin-top: 0.9rem;
    padding: 0.6rem 0.8rem;
    font-size: 0.85rem;
    border-radius: 10px;
    display: none;
  }
  .toast.show { display: block; }
  .toast.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); border: 1px solid color-mix(in srgb, var(--ok) 35%, transparent); }
  .toast.err { color: var(--err); background: color-mix(in srgb, var(--err) 12%, transparent); border: 1px solid color-mix(in srgb, var(--err) 35%, transparent); }
`;

export function themeInitScript(): string {
  return `<script>
    (function () {
      try {
        var stored = localStorage.getItem('${THEME_STORAGE_KEY}');
        var theme = stored === 'light' || stored === 'dark'
          ? stored
          : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        document.documentElement.setAttribute('data-theme', theme);
      } catch (e) {}
    })();
  </script>`;
}

export function themeToggleScript(): string {
  return `<script>
    (function () {
      var btn = document.getElementById('theme-toggle');
      if (!btn) return;

      function current() {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      }

      function label(theme) {
        var next = theme === 'dark' ? 'claro' : 'oscuro';
        btn.textContent = 'Modo ' + next;
        btn.setAttribute('aria-label', 'Cambiar a modo ' + next);
      }

      function apply(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem('${THEME_STORAGE_KEY}', theme); } catch (e) {}
        label(theme);
      }

      label(current());

      btn.addEventListener('click', function () {
        apply(current() === 'dark' ? 'light' : 'dark');
      });

      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (event) {
        var stored = null;
        try { stored = localStorage.getItem('${THEME_STORAGE_KEY}'); } catch (e) {}
        if (stored !== 'light' && stored !== 'dark') {
          apply(event.matches ? 'dark' : 'light');
        }
      });
    })();
  </script>`;
}
