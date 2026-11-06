/**
 * Puerta de entrada para las herramientas que sirven su página desde un Worker
 * (sorteos, bingo). Si quien entra no ha iniciado sesión, o no tiene acceso a
 * esta herramienta, se le enseña un aviso en lugar de la página.
 *
 * Como access.ts, se copia tal cual en cada herramienta.
 */
import { HOME_URL, loginUrl, readAccess, type Access, type Tool } from './access.ts'

const escape = (text: string) => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const DISCORD_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1A19.9 19.9 0 0 0 6.2 21l1.3-2a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12 0l.5.4c-.6.4-1.3.7-2 1l1.3 2a19.8 19.8 0 0 0 6.1-3c.5-5.2-.9-9.7-3.6-13.7ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>'

/** El aviso, con los colores de las herramientas y su modo oscuro. */
export function gatePage(kind: 'login' | 'denied', toolName: string, back: string, name?: string): Response {
  const title = kind === 'login' ? 'Inicia sesión' : `${name ? `${escape(name)}, no` : 'No'} tienes acceso`
  const text = kind === 'login'
    ? `Para acceder a ${escape(toolName)} tienes que iniciar sesión con tu cuenta de Discord.`
    : `Tu cuenta no tiene acceso a ${escape(toolName)}. Pídeselo a quien lleva las herramientas.`
  const action = kind === 'login'
    ? `<a class="discord" href="${escape(loginUrl(back))}">${DISCORD_ICON}Entrar con Discord</a>`
    : `<a class="discord" href="${HOME_URL}">Ir a herramientas</a>`
  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escape(toolName)}</title>
<script>if (/(?:^|; )herramientas_tema=dark/.test(document.cookie)) document.documentElement.dataset.theme = 'dark'</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Nunito:wght@400..900&display=swap" rel="stylesheet">
<style>
  :root { --bg: oklch(97.6% .012 150); --card: oklch(98.6% .008 150); --fg: oklch(26% .045 155); --muted: oklch(42% .035 155); --border: oklch(91.5% .022 150); --sky: oklch(91% .055 230); --rose: oklch(92% .045 10); --mint: oklch(94% .045 160); color-scheme: light; }
  :root[data-theme="dark"] { --bg: oklch(17.5% .012 155); --card: oklch(20% .014 155); --fg: oklch(95% .01 150); --muted: oklch(80% .02 150); --border: oklch(30% .02 150); --sky: oklch(31% .06 230); --rose: oklch(31% .06 10); --mint: oklch(31% .05 160); color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: var(--bg); color: var(--fg); font-family: "Nunito", ui-rounded, system-ui, sans-serif; }
  .card { position: relative; overflow: hidden; isolation: isolate; width: min(100%, 560px); padding: 56px 48px; border: 1px solid var(--border); border-radius: 34px; background: var(--card); text-align: center; }
  .card::before, .card::after { content: ""; position: absolute; z-index: -1; border-radius: 50%; filter: blur(60px); }
  .card::before { width: 70%; height: 90%; right: -20%; top: -40%; background: radial-gradient(closest-side, var(--sky), transparent); }
  .card::after { width: 70%; height: 90%; left: -20%; bottom: -45%; background: radial-gradient(closest-side, var(--rose), transparent); }
  :root[data-theme="dark"] .card::before, :root[data-theme="dark"] .card::after { display: none; }
  .eyebrow { margin: 0 0 12px; font-size: 14px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: oklch(50% .13 145); }
  :root[data-theme="dark"] .eyebrow { color: oklch(78% .14 145); }
  h1 { margin: 0 0 12px; font-size: clamp(2rem, 6vw, 2.75rem); font-weight: 900; letter-spacing: -.035em; line-height: 1.05; }
  p { margin: 0 auto 32px; max-width: 26rem; color: var(--muted); font-size: 18px; font-weight: 600; line-height: 1.5; }
  .discord { display: inline-flex; align-items: center; justify-content: center; gap: 12px; min-height: 56px; padding: 0 32px; border-radius: 999px; background: linear-gradient(180deg, oklch(63% .19 275), oklch(50% .2 275)); color: white; font-size: 18px; font-weight: 900; text-decoration: none; box-shadow: 0 10px 26px oklch(50% .2 275 / .3), inset 0 1px 0 oklch(100% 0 0 / .3); }
  .discord:hover { filter: brightness(1.06); }
  .back { display: inline-block; margin-top: 20px; color: var(--muted); font-size: 14px; font-weight: 800; text-decoration: none; }
  .back:hover { color: var(--fg); }
</style>
</head>
<body>
<main class="card">
  <p class="eyebrow">${escape(toolName)}</p>
  <h1>${title}</h1>
  <p>${text}</p>
  ${action}
  ${kind === 'login' ? `<br><a class="back" href="${HOME_URL}">Volver a herramientas</a>` : ''}
</main>
</body>
</html>`
  return new Response(html, {
    status: kind === 'login' ? 401 : 403,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/**
 * null si puede pasar; si no, la respuesta que hay que dar: el aviso para quien
 * abre la página, o un error JSON para las peticiones de datos de esa página.
 */
export async function gate(request: Request, db: D1Database, tool: Tool, toolName: string): Promise<Response | null> {
  const access: Access | null = await readAccess(request, db)
  if (access?.tools.includes(tool)) return null

  const wantsPage = (request.headers.get('Accept') ?? '').includes('text/html') && request.method === 'GET'
  if (!wantsPage) {
    return new Response(JSON.stringify({ error: access ? 'sin acceso' : 'sin sesión' }), {
      status: access ? 403 : 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }
  return gatePage(access ? 'denied' : 'login', toolName, request.url, access?.user.name)
}
