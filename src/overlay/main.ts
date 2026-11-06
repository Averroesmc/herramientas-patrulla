/**
 * El overlay de OBS: patrulla.averroeshosting.com/o/<clave>. Fuente de navegador de 1920×1080;
 * la barra va abajo y el resto es transparente.
 *
 * Si el overlay está en varias fuentes de OBS, solo una juega: la que se queda el candado del
 * navegador. Esa lee el chat, mueve el juego, guarda cada 10 s y les va pasando lo que pasa a las
 * demás (BroadcastChannel), que solo lo dibujan. Si se cierra, otra coge el candado y sigue.
 *
 * Con ?preview=1 (la vista previa del panel) juegan unos héroes de prueba, sin chat, sin sonido y
 * sin guardar nada.
 */
import './overlay.css'
import { boot, HttpError, loadHeroes, poll, save, type Boot } from './api'
import { ChatReader } from './chat'
import { Game, type Fx, type LineIn, type RenderState, type SupportIn } from './game'
import { View } from './view'
import type { Config } from '../../shared/game'

const params = new URLSearchParams(location.search)
const key = location.pathname.split('/o/')[1]?.split('/')[0] ?? params.get('key') ?? ''
const preview = params.has('preview')
if (preview) document.body.classList.add('preview')

const stage = document.getElementById('stage')!
const fit = () => { stage.style.transform = `scale(${window.innerWidth / 1920})` }
addEventListener('resize', fit)
fit()

const writer = crypto.randomUUID()
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const quietConfig = (c: Config): Config => (preview ? { ...c, sound: false } : c)

function broken(text: string) {
  stage.innerHTML = `<p class="broken">${text}</p>`
}

async function first(): Promise<Boot | null> {
  for (;;) {
    try {
      return await boot(key)
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        broken('Este enlace del overlay ya no vale: cópialo otra vez desde el panel de la patrulla.')
        return null
      }
      await sleep(3000)
    }
  }
}

async function main() {
  await document.fonts?.load('16px "Pixelify Sans"').catch(() => undefined)
  const b = await first()
  if (!b) return
  let config = b.config
  let cv = b.cv
  const view = new View(stage, quietConfig(config))
  if (preview) return runPreview(view, b)

  let game: Game | null = null
  let mirror: { state: RenderState | null; fx: Fx[] } = { state: null, fx: [] }
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel(`patrulla-${key}`) : null
  channel?.addEventListener('message', ev => {
    const msg = ev.data as { type?: string; state?: RenderState; fx?: Fx[] }
    if (game || msg?.type !== 'frame' || !msg.state) return
    mirror.state = msg.state
    mirror.fx.push(...(msg.fx ?? []))
  })

  // Las que no juegan también miran la configuración (el alto de la barra, el modo discreto…).
  const follow = async () => {
    while (!game) {
      await sleep(4000)
      if (game) return
      try {
        const p = await poll(key, cv)
        if (p.config) { config = p.config; cv = p.cv; view.setConfig(quietConfig(config)) }
      } catch { /* se reintenta */ }
    }
  }
  void follow()

  let pendingFx: Fx[] = []
  let lastSent = 0
  // Cada fotograma: la que juega mueve el juego y lo reparte; las demás dibujan lo último que les ha llegado.
  let prev = performance.now()
  const realLoop = (t: number) => {
    const dt = t - prev
    prev = t
    if (game) {
      game.step(dt, Date.now())
      const state = game.render()
      const fx = game.drain()
      view.frame(state, fx, t)
      pendingFx.push(...fx)
      if (channel && t - lastSent > 100) { channel.postMessage({ type: 'frame', state, fx: pendingFx }); pendingFx = []; lastSent = t }
    } else if (mirror.state) {
      const fx = mirror.fx
      mirror.fx = []
      view.frame(mirror.state, fx, t)
    }
    requestAnimationFrame(realLoop)
  }
  requestAnimationFrame(realLoop)

  const lead = async () => {
    // Al coger el candado se empieza con lo último guardado (por si otra fuente estaba jugando).
    const fresh = (await first()) ?? b
    config = fresh.config
    cv = fresh.cv
    view.setConfig(config)
    const g = new Game(fresh.world, config, Date.now())
    for (const q of fresh.ops) if (q.id > g.world.opSeen) { if (Date.now() - q.at < 60_000) g.op(q.op); g.world.opSeen = q.id }
    game = g
    mirror = { state: null, fx: [] }

    const reader = new ChatReader(key, { line: l => game?.line(l), support: s => game?.support(s) })
    reader.start(config)
    // Para probar sin chat: con ?debug=1, desde la consola, patrulla.line({ k: 't:1', p: 'twitch', name: 'Ana', text: '!atacar' }).
    if (params.has('debug')) Object.assign(window, { patrulla: { line: (l: LineIn) => game?.line(l), support: (s: SupportIn) => game?.support(s), game: () => game } })

    // Quienes aparecen: su nivel guardado, en tandas.
    setInterval(async () => {
      const g = game
      if (!g || !g.toLoad.size) return
      const asked = [...g.toLoad].slice(0, 100)
      for (const k of asked) g.toLoad.delete(k)
      try {
        const { heroes } = await loadHeroes(key, asked)
        game?.loaded(heroes, asked)
      } catch {
        for (const k of asked) game?.toLoad.add(k)
      }
    }, 500)

    const reload = async () => {
      const again = await first()
      if (!again || !game) return
      config = again.config
      cv = again.cv
      game.setConfig(config)
      view.setConfig(config)
      game.replaceWorld(again.world)
      for (const q of again.ops) if (q.id > game.world.opSeen) game.world.opSeen = q.id
    }

    // La configuración y las órdenes del panel (pruebas, día nuevo…).
    setInterval(async () => {
      if (!game) return
      try {
        const p = await poll(key, cv)
        if (p.config) { config = p.config; cv = p.cv; game.setConfig(config); view.setConfig(config); reader.update(config) }
        if (p.epoch !== game.world.epoch) { await reload(); return }
        for (const q of p.ops) if (q.id > game.world.opSeen) { game.op(q.op); game.world.opSeen = q.id }
      } catch { /* se reintenta */ }
    }, 3000)

    let saving = false
    const store = async (keepalive = false) => {
      if (!game || (saving && !keepalive)) return
      saving = true
      const { world, heroes } = game.collect()
      try {
        await save(key, { writer, world, heroes, readers: reader.status, ...(keepalive ? { release: true } : {}) }, keepalive)
      } catch (error) {
        game?.unsaved(heroes)
        // Se ha reiniciado o restaurado desde el panel: se carga el mundo nuevo.
        if (error instanceof HttpError && error.code === 'stale') await reload()
        else if (error instanceof HttpError && error.code === 'busy') console.warn('[patrulla] Hay otro overlay jugando con este enlace (en otro navegador u ordenador): este no guarda.')
      } finally {
        saving = false
      }
    }
    setInterval(() => void store(), 10_000)
    addEventListener('pagehide', () => void store(true))
    addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void store(true) })
  }

  if (navigator.locks) navigator.locks.request(`patrulla-${key}`, () => new Promise<void>(() => { void lead() })).catch(() => void lead())
  else void lead()
}

/** La vista previa del panel: héroes de prueba, sin chat ni guardado. Se actualiza con la configuración. */
function runPreview(view: View, b: Boot) {
  let cv = b.cv
  const game = new Game(structuredClone(b.world), b.config, Date.now(), { preview: true })
  for (let i = 0; i < 7; i++) game.addDemo(Number.POSITIVE_INFINITY)
  let prev = performance.now()
  const loop = (t: number) => {
    game.step(t - prev, Date.now())
    prev = t
    view.frame(game.render(), game.drain(), t)
    requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  setInterval(async () => {
    try {
      const p = await poll(key, cv)
      if (p.config) { cv = p.cv; game.setConfig(p.config); view.setConfig(quietConfig(p.config)) }
    } catch { /* se reintenta */ }
  }, 2000)
}

void main()
