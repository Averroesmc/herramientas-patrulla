# Patrulla

`patrulla.averroeshosting.com`: la **barra de héroes del chat**. Una franja abajo de la pantalla, como una barra de tareas, donde el chat entero va de aventura. Cada persona que escribe sale como un héroe pixelado, los héroes pegan solos a los enemigos que llegan por la derecha, ganan experiencia (cada uno la suya) y oro (de todos), y con el oro se compran mejoras. **El progreso se guarda de un directo a otro**: al día siguiente se sigue donde se quedó.

Está pensada para la pantalla de inicio (unos 8 minutos) y el Just Chatting (unos 15), en modo discreto si se quiere. Sin directo el mundo está parado: el juego solo avanza con el overlay abierto.

- **Panel** (`/`): con la sesión de herramientas y acceso a «patrulla». Enlace para OBS con vista previa, cómo va la aventura (día, zona, oro, mejoras, MVP), los héroes con más nivel, la configuración, botones para probar y la copia de seguridad.
- **Overlay para OBS** (`/o/<clave>`): fuente de navegador de 1920 × 1080; la barra va abajo y lo demás es transparente. No pide login: la clave larga hace de contraseña. Si se cambia el enlace desde el panel, el anterior deja de funcionar.
- **Admin** puede abrir la patrulla de cualquier persona con `/?persona=<id de Discord>` (botón «Editar su patrulla» de la sección Personas de herramientas).

## Cómo se juega

- **Escribir cualquier cosa**: tu héroe sale de la taberna (a la izquierda) y se une. Tras unos minutos sin escribir vuelve a la taberna. Si no caben todos, esperan dentro; el cartel de la taberna dice cuántos hay.
- **Combate**: los héroes pegan solos; los de más nivel van delante. Los enemigos pegan al de delante y lo pueden dejar KO un rato.
- **Oleadas y zonas**: cada oleada superada da oro; cada 10 oleadas (configurable) se pasa a otra zona con otro paisaje y otros enemigos (pradera, bosque, cueva, pantano, desierto, montaña helada, volcán, castillo oscuro, y vuelta a empezar más difícil).
- **Comandos**: `!atacar` (golpe ×4, con espera), `!yo` (nivel y daño encima del héroe), `!tienda` y `!comprar 1-4` (mejoras del grupo: herrería, estandarte, armería, hoguera).
- **Subs, regalos, bits y Super Chats**: frenesí (doble de daño para todos un rato) y experiencia extra para quien los manda.
- **Días**: tras 3 horas sin que juegue nadie empieza otro día. Al aparecer el primer héroe sale el resumen: «Día 12 · Bosque 2-4 · MVP de ayer…».
- **Aspecto según el nivel**: casco desde el 5, capa desde el 10, armadura dorada desde el 20 y aura desde el 35.

Con 10 personas activas sale más o menos una zona por directo y 1 o 2 niveles por persona al principio (luego más despacio). Con poca gente se avanza menos, pero no se atasca: la vida de los enemigos crece con la gente que juega, aunque menos que el daño que aportan.

## Cómo funciona

- **El juego corre en el overlay** (`src/overlay/game.ts`), no en el servidor. Cada 10 s (y al cerrarse) guarda en el servidor el mundo y los héroes que han cambiado. Cuando alguien escribe por primera vez, el overlay pide su héroe guardado.
- **Varias fuentes de OBS**: solo una juega (la que se queda el candado del navegador); las demás dibujan lo mismo que les va pasando esa. Lo más sencillo es tener una sola fuente y ponerla en otras escenas con «Añadir fuente existente».
- **Dos navegadores a la vez** (por ejemplo, OBS en dos ordenadores con el mismo enlace): solo guarda el primero; el otro avisa en la consola.
- **Reiniciar o restaurar una copia** sube la «época» del mundo: lo que intente guardar un overlay que estaba abierto ya no vale, y el overlay carga solo el mundo nuevo.
- **Órdenes del panel** (héroes de prueba, oro, frenesí, día nuevo): se apuntan en el servidor y el overlay las recoge cada 3 s.
- **Los chats** los lee el propio overlay, igual que en retos: Twitch como invitado, YouTube con la API oficial si el Worker tiene `YOUTUBE_API_KEY` (si no, por el método de reserva) y Kick por su chat público, que no es oficial.
- **Dibujos y sonidos** hechos con código: sprites con mapas de letras (`src/overlay/sprites.ts`), paisaje por capas y sonidos de 8 bits con el sintetizador del navegador (`src/overlay/sfx.ts`). Los colores de cada héroe salen de su nombre.

Para probar sin chat: abre el overlay con `?debug=1` y, desde la consola del navegador, `patrulla.line({ k: 't:1', p: 'twitch', name: 'Ana', text: '!atacar' })` o `patrulla.support({ name: 'Ana', kind: 'sub', n: 1 })`.

### Código

| Dónde | Qué |
|---|---|
| `shared/game.ts` | Tipos, configuración, el mundo guardado, las fórmulas (vida, daño, experiencia, oro, precios), las zonas y los comandos. Lo usan el servidor, el panel y el overlay. |
| `src/overlay/game.ts` | El juego: héroes, enemigos, oleadas, combate, compras, días. No toca la pantalla. |
| `src/overlay/view.ts` | Lo que se ve: el canvas de la barra, el marcador y los avisos. |
| `src/overlay/main.ts` | Arranque, quién juega, copia a las demás fuentes, guardado y vista previa del panel. |
| `src/overlay/chat.ts`, `youtube-api.ts` | Lectura de los chats (copiado de retos). |
| `worker/index.ts` | El Worker: panel, overlay, guardado y copias. Tablas `patrulla` y `patrulla_heroes` (se crean solas). |
| `worker/access.ts`, `worker/gate.ts`, `worker/youtube.ts` | Copiados de herramientas-web y retos. |
| `src/App.tsx`, `src/components/` | El panel, con los componentes y estilos de herramientas. |

## Publicarlo

Todo en Cloudflare, como las demás herramientas.

1. **Workers y Pages → Crear → Importar un repositorio** → este repositorio.
   - Comando de compilación: `npm run build`
   - Implementar comando: `npx wrangler deploy`
   - Rama de producción: la rama donde esté el código.
2. La base de datos D1 `herramientas` ya está en `wrangler.toml` (el mismo ID que herramientas-web).
3. **Configuración → Variables y secretos** (opcional): `YOUTUBE_API_KEY` como secreto, la misma clave del teatro, el bingo y retos. En Google Cloud, añade `https://patrulla.averroeshosting.com/*` a los sitios permitidos de esa clave.
4. **Configuración → Dominios y rutas → Añadir → Dominio personalizado**: `patrulla.averroeshosting.com`.
5. En **herramientas** (herramientas-web) está la tarjeta de Patrulla y el permiso «patrulla» para dar acceso a cada persona.

## Probarlo en local

```bash
npm install
npm run dev
```

Se abre en `http://localhost:8787` con una base de datos local vacía. Como el login es el de herramientas, en local hay que crear a mano una sesión en la base de datos (ver `worker/access.ts`). El overlay (`/o/<clave>`) funciona sin sesión.
