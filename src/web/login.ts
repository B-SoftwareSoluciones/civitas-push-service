import { baseCss, escapeHtml, themeInitScript, themeToggleScript } from './layout';

export function loginPage(error?: string): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Iniciar sesión · Civitas Access</title>
  <link rel="icon" href="/assets/icon.png" />
  ${themeInitScript()}
  <style>
    ${baseCss}
    body { display: grid; place-items: center; padding: 1.5rem; }
    .card { width: 100%; max-width: 380px; padding: 2rem; }
    .top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      margin-bottom: 1.25rem;
    }
    .brand {
      font-size: 0.8rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .sub { margin: 0.35rem 0 1.5rem; font-size: 0.88rem; color: var(--muted); }
  </style>
</head>
<body>
  <form class="card" method="post" action="/login">
    <div class="top">
      <div class="brand"><img class="logo" src="/assets/icon.png" alt="Civitas Access" /> Civitas Access</div>
      <button type="button" id="theme-toggle" class="theme-toggle">Modo oscuro</button>
    </div>
    <h1>Panel de notificaciones</h1>
    <p class="sub">Inicia sesión para enviar notificaciones push.</p>
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
    <label>Usuario
      <input name="user" autocomplete="username" required autofocus />
    </label>
    <label>Contraseña
      <input type="password" name="password" autocomplete="current-password" required />
    </label>
    <button type="submit">Entrar</button>
  </form>
  ${themeToggleScript()}
</body>
</html>`;
}
