/**
 * Lo que se ve en OBS: la barra de abajo con el paisaje, la taberna, los héroes y los enemigos
 * (en un canvas, pixelado), y encima el marcador y los avisos (HTML, con el estilo de piedra de retos).
 *
 * Todo sale del RenderState y de los efectos (Fx) que da game.ts, así que funciona igual en la
 * fuente de OBS que juega y en las que solo la copian.
 */
import { coinIcon, enemySprite, heroSprite, mugIcon, shade, type HeroSprite } from './sprites'
import { DOOR_X, ENEMY_X, SPAWN_X, type Fx, type HeroView, type RenderState, type ShopView } from './game'
import { sfx, setSound } from './sfx'
import { THEMES, fmt, heroTier, stageLabel, themeOf, zoneName, type Config, type Theme } from '../../shared/game'

/** Los fondos dibujados (scripts/preparar-fondos.py) miden 120 px de alto, con 18 px de suelo bajo donde pisan los héroes. */
const ART_BAND = 120
const ART_GROUND = 18
/** Dónde está la puerta de la taberna dibujada, como fracción de su ancho. */
const TAVERN_DOOR_X = 0.46

/** Hueco del canvas por encima de la barra, para los números, los avisos de nivel y los bocadillos. */
const TOP = 130
const W = 1920
const HUD_W = 300
const FONT = '"Pixelify Sans", ui-monospace, monospace'
const NAME_COLOR: Record<HeroView['p'], string> = { twitch: '#d2b8ff', youtube: '#ffa3a3', kick: '#a6ff73', demo: '#d9d9e3' }

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

interface HeroAnim {
  shownX: number; prevX: number; sprite: HeroSprite; tier: number; dir: 1 | -1
  swing: number; melee: boolean; flash: number; pillar: number
  bubble: { text: string; until: number } | null
  koAt: number
}
interface EnemyAnim { shownX: number; flash: number; kb: number; last: { kind: RenderState['enemies'][number]['kind']; tint: string; x: number } }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; g: number }
interface Floater { x: number; y: number; text: string; color: string; size: number; life: number; max: number }
interface Shot { x0: number; y0: number; x1: number; y1: number; t: number; dur: number; color: string }
interface CoinFly { x0: number; y0: number; t: number; dur: number }
interface Meteor { x0: number; y0: number; x1: number; y1: number; t: number; dur: number; dmg: number }
interface Toast { kind: 'small' | 'big'; title: string; text?: string; ms: number; important: boolean }

export class View {
  private readonly root: HTMLElement
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private readonly hud: HTMLDivElement
  private readonly toastBox: HTMLDivElement
  private readonly shopBox: HTMLDivElement
  private shopKey = ''
  private readonly waiting: HTMLDivElement
  private config: Config
  private px = 3
  private H = 120
  private groundY = 0
  private art = new Map<number, HTMLImageElement | null>()
  private sprites = new Map<string, HTMLImageElement | null>()
  private heroes = new Map<string, HeroAnim>()
  private enemies = new Map<number, EnemyAnim>()
  private particles: Particle[] = []
  private floaters: Floater[] = []
  private shots: Shot[] = []
  private coins: CoinFly[] = []
  private meteors: Meteor[] = []
  private tint: { color: string; t: number } | null = null
  private crowdLevels = false
  private scroll = 0
  private state: RenderState | null = null
  private layers: { zone: number; far: HTMLCanvasElement; mid: HTMLCanvasElement; ground: HTMLCanvasElement } | null = null
  private fading: { layers: NonNullable<View['layers']>; t: number } | null = null
  private doorOpen = 0
  private toasts: Toast[] = []
  private toastUntil = 0
  private levelBatch: { name: string; level: number }[] = []
  private levelAt = 0
  private normalNumbers = 0
  private hudText = ''
  private goldPulse = 0
  private time = 0
  private last = 0
  private sounds = new Map<string, number>()
  private icons: { coin: HTMLCanvasElement; mug: HTMLCanvasElement } | null = null

  constructor(root: HTMLElement, config: Config) {
    this.root = root
    this.config = config
    this.canvas = document.createElement('canvas')
    this.canvas.id = 'bar'
    this.ctx = this.canvas.getContext('2d')!
    this.hud = document.createElement('div')
    this.hud.id = 'hud'
    this.hud.className = 'slab outline'
    this.toastBox = document.createElement('div')
    this.toastBox.id = 'toasts'
    this.shopBox = document.createElement('div')
    this.shopBox.id = 'shopbox'
    this.shopBox.className = 'slab outline hidden'
    this.waiting = document.createElement('div')
    this.waiting.id = 'waiting'
    this.waiting.className = 'outline hidden'
    this.waiting.textContent = '¡Escribe en el chat para unirte a la patrulla!'
    root.append(this.canvas, this.hud, this.waiting, this.shopBox, this.toastBox)
    this.setConfig(config)
  }

  setConfig(config: Config) {
    const sizeChanged = !this.state || config.barHeight !== this.H || config.scenery !== this.config.scenery
    this.config = config
    setSound(config.sound && !config.quiet, config.volume)
    this.H = config.barHeight
    this.px = this.H >= 105 ? 3 : 2
    this.groundY = TOP + this.H - Math.round((ART_GROUND * this.H) / ART_BAND)
    this.canvas.width = W
    this.canvas.height = TOP + this.H
    this.canvas.style.bottom = `${config.barBottom}px`
    const k = this.H / 120
    this.root.style.setProperty('--bar-h', `${this.H}px`)
    this.root.style.setProperty('--bar-b', `${config.barBottom}px`)
    this.root.style.setProperty('--k', String(k))
    this.root.classList.toggle('quiet', config.quiet)
    this.root.classList.toggle('bare', !config.scenery)
    if (sizeChanged) {
      this.layers = null
      this.fading = null
      this.heroes.clear()
      this.icons = { coin: coinIcon(this.px), mug: mugIcon(this.px) }
      this.hudText = ''
    }
  }

  /* ------------------------------------------------------------ cada fotograma */

  frame(state: RenderState, fx: Fx[], now: number) {
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0.016
    this.last = now
    this.time += dt
    this.state = state
    this.sync(state)
    // Si suben muchos de nivel a la vez, sin el texto encima de cada uno (sale el aviso de grupo).
    this.crowdLevels = fx.filter(f => f.t === 'level').length > 3
    for (const f of fx) this.effect(f, state)
    if (state.phase === 'walk' && state.heroes.some(h => !h.leaving)) this.scroll += 80 * dt
    this.update(dt)
    this.draw(state)
    this.drawHud(state)
    this.drawShop(state.shop)
    this.waiting.classList.toggle('hidden', state.heroes.length > 0)
    this.flushLevels(now)
    this.showToasts(now)
  }

  private sync(state: RenderState) {
    const seen = new Set<string>()
    for (const h of state.heroes) {
      seen.add(h.k)
      const tier = heroTier(h.level)
      let a = this.heroes.get(h.k)
      if (!a) {
        a = { shownX: h.x, prevX: h.x, sprite: heroSprite(h.seed, tier, this.px), tier, dir: 1, swing: 0, melee: true, flash: 0, pillar: 0, bubble: null, koAt: 0 }
        this.heroes.set(h.k, a)
      }
      if (a.tier !== tier) { a.tier = tier; a.sprite = heroSprite(h.seed, tier, this.px) }
    }
    for (const k of this.heroes.keys()) if (!seen.has(k)) this.heroes.delete(k)
    const ids = new Set(state.enemies.map(e => e.id))
    for (const e of state.enemies) {
      const a = this.enemies.get(e.id)
      if (!a) this.enemies.set(e.id, { shownX: e.x, flash: 0, kb: 0, last: { kind: e.kind, tint: e.tint, x: e.x } })
      else a.last = { kind: e.kind, tint: e.tint, x: e.x }
    }
    for (const id of this.enemies.keys()) if (!ids.has(id)) this.enemies.delete(id)
  }

  private heroY(h: HeroView) { return this.groundY - (h.row ? 5 : 0) }

  private enemyCenter(id: number): [number, number] | null {
    const a = this.enemies.get(id)
    if (!a) return null
    const s = enemySprite(a.last.kind, a.last.tint, this.px)
    const fly = a.last.kind === 'bat' ? this.flyOffset(id) : 0
    return [a.shownX + s.w / 2, this.groundY - s.h / 2 + fly]
  }

  private flyOffset(id: number) { return -22 - Math.sin(this.time * 4 + id) * 5 }

  private effect(f: Fx, state: RenderState) {
    const hero = 'k' in f ? state.heroes.find(h => h.k === f.k) : undefined
    const anim = 'k' in f ? this.heroes.get(f.k) : undefined
    switch (f.t) {
      case 'hit': {
        const target = this.enemyCenter(f.e)
        const e = this.enemies.get(f.e)
        if (anim && hero && target) {
          anim.swing = 0.22
          anim.melee = target[0] - anim.shownX < 150
          if (!anim.melee && this.shots.length < 40) {
            const hy = this.heroY(hero) - 9 * this.px
            this.shots.push({ x0: anim.shownX + 4 * this.px, y0: hy, x1: target[0], y1: target[1], t: 0, dur: 0.3, color: f.crit ? '#ffd23f' : '#fff6c9' })
          }
        }
        if (e) { e.flash = 0.09; e.kb = f.crit ? 10 : 3 }
        if (target) {
          if (f.crit) {
            this.float(target[0], target[1] - 30, `¡-${fmt(f.dmg)}!`, '#ffd23f', 30 * this.k)
            this.burst(target[0], target[1], '#ffd23f', 10, 160)
            this.play('crit', 60, () => sfx.crit())
          } else if (this.normalNumbers < 4 && !this.config.quiet) {
            this.normalNumbers++
            this.float(target[0] + (Math.random() - 0.5) * 80, target[1] - 20 - Math.random() * 24, `-${fmt(f.dmg)}`, '#ffffff', 17 * this.k)
          }
        }
        break
      }
      case 'hurt':
        if (anim && hero) {
          anim.flash = 0.12
          this.float(anim.shownX, this.heroY(hero) - 18 * this.px, `-${fmt(f.dmg)}`, '#ff6b6b', 17 * this.k)
          this.play('hurt', 250, () => sfx.hurt())
        }
        break
      case 'ko':
        if (anim && hero) { anim.koAt = this.time; this.burst(anim.shownX, this.heroY(hero) - 20, '#bbbbbb', 8, 90); this.play('ko', 400, () => sfx.ko()) }
        break
      case 'up':
        if (anim && hero) this.burst(anim.shownX, this.heroY(hero) - 24, '#9dff9d', 10, 110)
        break
      case 'kill': {
        const e = this.enemies.get(f.e)
        if (e) {
          const s = enemySprite(e.last.kind, e.last.tint, this.px)
          const cx = e.shownX + s.w / 2
          const cy = this.groundY - s.h / 2 + (e.last.kind === 'bat' ? this.flyOffset(f.e) : 0)
          this.burst(cx, cy, e.last.tint, 16, 200)
          this.burst(cx, cy, '#ffffff', 6, 120)
          this.coins.push({ x0: cx, y0: cy, t: 0, dur: 0.75 })
          this.enemies.delete(f.e)
        }
        this.play('kill', 120, () => sfx.coin())
        break
      }
      case 'level':
        if (anim && hero) {
          anim.pillar = 1
          if (!this.crowdLevels) this.float(anim.shownX, this.heroY(hero) - 26 * this.px, `¡NIVEL ${f.level}!`, '#ffe14d', 22 * this.k)
        }
        this.levelBatch.push({ name: f.name, level: f.level })
        if (!this.levelAt) this.levelAt = performance.now() + 700
        this.play('level', 900, () => sfx.level())
        break
      case 'wave':
        if (!this.config.quiet) this.toast({ kind: 'small', title: `Oleada ${f.stage} superada`, text: `+${fmt(f.gold)} de oro`, ms: 3200, important: false })
        this.play('wave', 500, () => sfx.wave())
        break
      case 'zone':
        this.toast({ kind: 'big', title: '¡NUEVA ZONA!', text: zoneName(f.zone), ms: 5500, important: true })
        this.play('zone', 500, () => sfx.zone())
        break
      case 'join':
        this.doorOpen = 0.6
        this.burst(DOOR_X, this.groundY - 4, '#d8c8a8', 6, 60)
        this.play('join', 350, () => sfx.join())
        break
      case 'me':
        if (anim) anim.bubble = { text: f.text, until: this.time + 6 }
        break
      case 'buy':
        this.toast({ kind: 'big', title: `¡${f.name} nivel ${f.level}!`, text: `Comprada por ${f.by}`, ms: 4500, important: true })
        this.play('buy', 300, () => sfx.buy())
        break
      case 'noVote':
        if (!this.config.quiet) this.toast({ kind: 'small', title: 'Nadie ha votado en la tienda', text: 'El oro se guarda para la próxima', ms: 3000, important: false })
        break
      case 'support':
        this.toast({ kind: 'big', title: f.title, text: f.text, ms: 5500, important: true })
        this.play('support', 300, () => sfx.frenzy())
        break
      case 'event':
        this.eventFx(f, state)
        break
      case 'day': {
        const y = f.yesterday
        const text = y
          ? `Ayer: ${y.heroes} ${y.heroes === 1 ? 'héroe' : 'héroes'} y ${y.waves} ${y.waves === 1 ? 'oleada' : 'oleadas'}${y.mvp ? ` · MVP: ${y.mvp.name} (${fmt(y.mvp.dmg)} de daño)` : ''}`
          : 'Empieza la aventura: escribe en el chat para unirte'
        this.toast({ kind: 'big', title: `DÍA ${f.day} · ${zoneName(f.zone)} ${stageLabel(f.zone, f.wave)}`, text, ms: 8000, important: true })
        this.play('day', 500, () => sfx.day())
        break
      }
    }
  }

  /** Lo que se ve de cada evento de las subs. */
  private eventFx(f: Extract<Fx, { t: 'event' }>, state: RenderState) {
    const P = this.px
    switch (f.kind) {
      case 'frenzy':
        this.tint = { color: '#ff6a1f', t: 0.8 }
        break
      case 'meteor':
        f.hits.forEach((h, i) => {
          const c = this.enemyCenter(h.e)
          if (!c) return
          for (let j = 0; j < Math.min(3, f.power); j++) {
            const x1 = c[0] + (j - 1) * 14
            this.meteors.push({ x0: x1 + 260 + Math.random() * 120, y0: -40 - i * 40 - j * 60, x1, y1: c[1], t: -(i * 0.15 + j * 0.2), dur: 0.55, dmg: j === 0 ? h.dmg : 0 })
          }
        })
        if (!f.hits.length) this.float(W / 2, TOP + this.H / 2, '¡No había enemigos!', '#ffb347', 22 * this.k)
        this.play('meteor', 300, () => sfx.meteor())
        break
      case 'goldrain':
        for (let i = 0; i < 26 + f.power * 6; i++) {
          const x = 220 + Math.random() * (W - HUD_W - 300)
          this.coins.push({ x0: x, y0: TOP - 40 - Math.random() * 120, t: -Math.random() * 1.2, dur: 1.1 })
        }
        this.float(W / 2, TOP + this.H * 0.45, `+${fmt(f.gold)} de oro`, '#ffe14d', 30 * this.k)
        this.play('goldrain', 300, () => sfx.goldrain())
        break
      case 'blessing':
        this.tint = { color: '#9dffb0', t: 0.6 }
        for (const h of state.heroes) {
          const a = this.heroes.get(h.k)
          if (!a) continue
          a.pillar = 1
          this.burst(a.shownX, this.heroY(h) - 8 * P, '#b6ffc4', 6, 120)
        }
        this.play('blessing', 300, () => sfx.level())
        break
    }
  }

  private get k() { return this.H / 120 }

  private play(name: string, gapMs: number, fn: () => void) {
    const now = performance.now()
    if (now - (this.sounds.get(name) ?? 0) < gapMs) return
    this.sounds.set(name, now)
    fn()
  }

  private float(x: number, y: number, text: string, color: string, size: number) {
    if (this.floaters.length > 40) this.floaters.shift()
    this.floaters.push({ x, y, text, color, size, life: 0, max: 1 })
  }

  private burst(x: number, y: number, color: string, n: number, speed: number) {
    for (let i = 0; i < n && this.particles.length < 260; i++) {
      const a = Math.random() * Math.PI * 2
      const v = speed * (0.4 + Math.random() * 0.8)
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.4, life: 0, max: 0.5 + Math.random() * 0.4, color, size: this.px * (1 + Math.round(Math.random())), g: 420 })
    }
  }

  private toast(t: Toast) {
    if (this.toasts.length >= 5) {
      const i = this.toasts.findIndex(x => !x.important)
      if (i >= 0) this.toasts.splice(i, 1)
      else if (!t.important) return
      else this.toasts.shift()
    }
    this.toasts.push(t)
  }

  private flushLevels(now: number) {
    if (!this.levelAt || now < this.levelAt) return
    const list = this.levelBatch
    this.levelBatch = []
    this.levelAt = 0
    if (!list.length) return
    if (list.length === 1) this.toast({ kind: 'small', title: `¡${list[0]!.name} sube a nivel ${list[0]!.level}!`, ms: 3500, important: !this.config.quiet })
    else this.toast({ kind: 'small', title: `¡${list.length} héroes suben de nivel!`, text: list.slice(0, 4).map(l => l.name).join(', ') + (list.length > 4 ? '…' : ''), ms: 3800, important: !this.config.quiet })
  }

  /** La tienda de después de cada oleada: las mejoras que se pueden pagar, los votos de cada una y el tiempo que queda. */
  private drawShop(shop: ShopView | null) {
    this.root.classList.toggle('shop-open', !!shop)
    if (!shop) { this.shopBox.classList.add('hidden'); this.shopKey = ''; return }
    const key = `${Math.ceil(shop.left)}|${shop.items.map(i => `${i.votes}${i.can ? 'y' : 'n'}${i.level}`).join(',')}`
    if (key === this.shopKey) return
    this.shopKey = key
    const total = shop.items.reduce((a, i) => a + i.votes, 0)
    this.shopBox.classList.remove('hidden')
    this.shopBox.innerHTML = `<div class="sh">TIENDA <span class="cmd">escribe 1-${shop.items.length} para votar</span><span class="left">${Math.ceil(shop.left)} s</span></div>
      <div class="timer slot"><i style="width:${Math.max(0, Math.min(100, (shop.left / shop.total) * 100))}%"></i></div>
      <div class="shop">${shop.items.map(i =>
        `<div class="item${i.can ? ' can' : ''}"><b>${i.n}</b><span>${esc(i.name)} <small>nv ${i.level}</small><em>${esc(i.effect)}</em></span><i>${i.cost ? fmt(i.cost) : 'MÁX'}</i><u style="width:${total ? Math.round((i.votes / total) * 100) : 0}%"></u><s>${i.votes ? `${i.votes} ${i.votes === 1 ? 'voto' : 'votos'}` : ''}</s></div>`).join('')}</div>`
  }

  private showToasts(now: number) {
    if (now < this.toastUntil) return
    const t = this.toasts.shift()
    if (!t) { if (this.toastBox.firstElementChild?.classList.contains('on')) this.toastBox.firstElementChild.classList.remove('on'); return }
    this.toastUntil = now + t.ms
    const el = document.createElement('div')
    el.className = `toast slab outline is-${t.kind}`
    el.innerHTML = `<div class="tt">${esc(t.title)}</div>${t.text ? `<div class="tx">${esc(t.text)}</div>` : ''}`
    const old = this.toastBox.firstElementChild
    if (old) { old.classList.remove('on'); setTimeout(() => old.remove(), 300) }
    this.toastBox.prepend(el)
    requestAnimationFrame(() => el.classList.add('on'))
    setTimeout(() => { if (el.isConnected && performance.now() >= this.toastUntil - 50) el.classList.remove('on') }, t.ms - 250)
  }

  /* ------------------------------------------------------------ física de los efectos */

  private update(dt: number) {
    this.normalNumbers = Math.max(0, this.normalNumbers - dt * 4)
    this.doorOpen = Math.max(0, this.doorOpen - dt)
    this.goldPulse = Math.max(0, this.goldPulse - dt * 3)
    for (const h of this.state?.heroes ?? []) {
      const a = this.heroes.get(h.k)
      if (!a) continue
      a.prevX = a.shownX
      a.shownX += (h.x - a.shownX) * Math.min(1, dt * 14)
      const moved = a.shownX - a.prevX
      if (Math.abs(moved) > 0.2) a.dir = moved < 0 ? -1 : 1
      else if (!h.leaving) a.dir = 1
      a.swing = Math.max(0, a.swing - dt)
      a.flash = Math.max(0, a.flash - dt)
      a.pillar = Math.max(0, a.pillar - dt * 1.2)
      if (a.bubble && a.bubble.until < this.time) a.bubble = null
    }
    for (const e of this.state?.enemies ?? []) {
      const a = this.enemies.get(e.id)
      if (!a) continue
      a.shownX += (e.x - a.shownX) * Math.min(1, dt * 12)
      a.flash = Math.max(0, a.flash - dt)
      a.kb = Math.max(0, a.kb - dt * 40)
    }
    for (const p of this.particles) { p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += p.g * dt; p.vx *= 0.98 }
    this.particles = this.particles.filter(p => p.life < p.max)
    for (const f of this.floaters) f.life += dt
    this.floaters = this.floaters.filter(f => f.life < f.max)
    for (const s of this.shots) s.t += dt
    this.shots = this.shots.filter(s => s.t < s.dur)
    for (const m of this.meteors) {
      const was = m.t
      m.t += dt
      if (was < m.dur && m.t >= m.dur) {
        this.burst(m.x1, m.y1, '#ff7a1f', 18, 260)
        this.burst(m.x1, m.y1, '#ffe14d', 10, 180)
        if (m.dmg) this.float(m.x1, m.y1 - 34, `¡-${fmt(m.dmg)}!`, '#ff9a3d', 30 * this.k)
        this.play('boom', 90, () => sfx.crit())
      }
    }
    this.meteors = this.meteors.filter(m => m.t < m.dur)
    if (this.tint) { this.tint.t -= dt; if (this.tint.t <= 0) this.tint = null }
    for (const c of this.coins) c.t += dt
    const arrived = this.coins.filter(c => c.t >= c.dur).length
    if (arrived) this.goldPulse = 1
    this.coins = this.coins.filter(c => c.t < c.dur)
    if (this.fading) { this.fading.t -= dt; if (this.fading.t <= 0) this.fading = null }
    // Humo de la chimenea.
    if (Math.random() < dt * 3 && this.particles.length < 260 && !this.sprite('taberna')) {
      const x0 = DOOR_X - 20 * this.px
      this.particles.push({ x: x0 + 30 * this.px, y: this.groundY - 30 * this.px, vx: 6 + Math.random() * 8, vy: -18 - Math.random() * 10, life: 0, max: 2.6, color: 'rgba(220,220,230,.55)', size: this.px * 2, g: -2 })
    }
  }

  /* ------------------------------------------------------------ dibujar */

  private draw(state: RenderState) {
    const ctx = this.ctx
    const px = this.px
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, W, TOP + this.H)

    // Paisaje (con fundido al cambiar de zona).
    if (!this.layers || this.layers.zone !== state.zone) {
      if (this.layers) this.fading = { layers: this.layers, t: 1.2 }
      this.layers = this.buildLayers(state.zone)
    }
    this.drawScenery(this.layers, 1)
    if (this.fading) this.drawScenery(this.fading.layers, this.fading.t / 1.2)

    this.drawTavern(state)

    // Enemigos y héroes, los de atrás primero.
    const order = state.heroes.slice().sort((a, b) => a.row - b.row || a.x - b.x)
    for (const e of state.enemies) this.drawEnemy(e.id)
    for (const h of order) this.drawHero(h, state)

    for (const s of this.shots) {
      const t = s.t / s.dur
      const x = s.x0 + (s.x1 - s.x0) * t
      const y = s.y0 + (s.y1 - s.y0) * t - Math.sin(t * Math.PI) * 26
      ctx.fillStyle = s.color
      ctx.fillRect(Math.round(x - px), Math.round(y - px), px * 2, px * 2)
      ctx.globalAlpha = 0.45
      ctx.fillRect(Math.round(x - px * 3), Math.round(y), px, px)
      ctx.globalAlpha = 1
    }
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, 1 - p.life / p.max)
      ctx.fillStyle = p.color
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size)
    }
    ctx.globalAlpha = 1
    const goldX = W - 12 - HUD_W + 28
    const goldY = TOP + this.H - 24 * this.k
    for (const m of this.meteors) {
      if (m.t < 0) continue
      const t = m.t / m.dur
      const x = m.x0 + (m.x1 - m.x0) * t
      const y = m.y0 + (m.y1 - m.y0) * t
      for (let i = 4; i >= 0; i--) {
        ctx.globalAlpha = i ? 0.5 - i * 0.08 : 1
        ctx.fillStyle = i ? '#ff7a1f' : '#fff2a8'
        const s = px * (i ? 3 : 4)
        ctx.fillRect(Math.round(x + i * 9 - s / 2), Math.round(y - i * 13 - s / 2), s, s)
      }
      ctx.globalAlpha = 1
    }
    for (const c of this.coins) {
      if (c.t < 0) continue
      const t = c.t / c.dur
      const e = t * t
      const x = c.x0 + (goldX - c.x0) * e
      const y = c.y0 + (goldY - c.y0) * e - Math.sin(t * Math.PI) * 70
      if (this.icons) ctx.drawImage(this.icons.coin, Math.round(x - 3 * px), Math.round(y - 3 * px))
    }

    if (this.tint) {
      ctx.globalAlpha = Math.min(0.35, this.tint.t * 0.5)
      ctx.fillStyle = this.tint.color
      ctx.fillRect(0, TOP, W, this.H)
      ctx.globalAlpha = 1
    }

    this.drawNames(order)
    this.drawBubbles(order)

    for (const f of this.floaters) {
      const t = f.life / f.max
      ctx.globalAlpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25
      this.text(f.text, f.x, f.y - t * 34, f.size, f.color, 'center')
    }
    ctx.globalAlpha = 1
  }

  private text(text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'left') {
    const ctx = this.ctx
    ctx.font = `700 ${Math.round(size)}px ${FONT}`
    ctx.textAlign = align
    ctx.textBaseline = 'alphabetic'
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(3, size / 5)
    ctx.strokeStyle = '#000'
    ctx.strokeText(text, Math.round(x), Math.round(y))
    ctx.fillStyle = color
    ctx.fillText(text, Math.round(x), Math.round(y))
  }

  /* ---------------- paisaje */

  private buildLayers(zone: number) {
    const theme = themeOf(zone)
    const px = this.px
    const h = this.H
    const mk = (w: number) => { const c = document.createElement('canvas'); c.width = w; c.height = TOP + h; return c }
    const far = mk(960)
    const mid = mk(640)
    const ground = mk(96)
    const top = TOP
    const g = this.groundY
    const fc = far.getContext('2d')!
    // Montañas o colinas lejanas: una curva periódica en escalones de píxel.
    for (let x = 0; x < 960; x += px) {
      const t = (x / 960) * Math.PI * 2
      const y = g - (h * 0.32 + Math.sin(t * 2) * h * 0.12 + Math.sin(t * 5 + 1.3) * h * 0.06)
      const yy = Math.round(y / px) * px
      fc.fillStyle = theme.far
      fc.fillRect(x, yy, px, g - yy)
      if (theme.prop === 'snow' && g - yy > h * 0.36) { fc.fillStyle = '#ffffff'; fc.fillRect(x, yy, px, px * 2) }
      if (theme.prop === 'rock') { // estalactitas
        const sy = top + Math.round((Math.max(0, Math.sin(t * 9) * h * 0.22) + h * 0.05) / px) * px
        fc.fillStyle = theme.mid
        fc.fillRect(x, top, px, sy - top)
      }
    }
    const mc = mid.getContext('2d')!
    const block = (x: number, y: number, w: number, hh: number, c: string) => { mc.fillStyle = c; mc.fillRect(x, y, w, hh) }
    const P = px
    const props = [40, 230, 420, 560]
    props.forEach((x0, i) => {
      const s = i % 2 ? 1 : 1.25
      switch (theme.prop) {
        case 'tree':
          block(x0 + 5 * P, g - 10 * P * s, 2 * P, 10 * P * s, '#6b4226')
          block(x0, g - 18 * P * s, 12 * P, 9 * P * s, theme.mid)
          block(x0 + 2 * P, g - 21 * P * s, 8 * P, 4 * P * s, theme.mid)
          block(x0 + 2 * P, g - 17 * P * s, 3 * P, 2 * P, shade(theme.mid, 0.25))
          break
        case 'pine':
          block(x0 + 5 * P, g - 6 * P, 2 * P, 6 * P, '#4a2e1a')
          for (let k = 0; k < 4; k++) block(x0 + k * P, g - (6 + (4 - k) * 4) * P * s, (12 - k * 2) * P, 4 * P * s, theme.mid)
          break
        case 'rock':
          block(x0, g - 5 * P, 14 * P, 5 * P, theme.mid)
          block(x0 + 3 * P, g - 8 * P, 8 * P, 3 * P, theme.mid)
          block(x0 + 4 * P, g - 8 * P, 3 * P, P, shade(theme.mid, 0.25))
          break
        case 'reed':
          for (let k = 0; k < 5; k++) { block(x0 + k * 3 * P, g - (8 + (k % 3) * 3) * P, P, (8 + (k % 3) * 3) * P, theme.mid); block(x0 + k * 3 * P - P / 2, g - (9 + (k % 3) * 3) * P, 2 * P, 2 * P, '#6b4a2a') }
          break
        case 'cactus':
          block(x0 + 4 * P, g - 16 * P * s, 3 * P, 16 * P * s, theme.mid)
          block(x0, g - 11 * P * s, 2 * P, 5 * P, theme.mid); block(x0, g - 7 * P * s, 4 * P, 2 * P, theme.mid)
          block(x0 + 8 * P, g - 13 * P * s, 2 * P, 5 * P, theme.mid); block(x0 + 6 * P, g - 9 * P * s, 4 * P, 2 * P, theme.mid)
          break
        case 'snow':
          block(x0 + 5 * P, g - 6 * P, 2 * P, 6 * P, '#5a4636')
          for (let k = 0; k < 4; k++) {
            block(x0 + k * P, g - (6 + (4 - k) * 4) * P * s, (12 - k * 2) * P, 4 * P * s, theme.mid)
            block(x0 + k * P, g - (6 + (4 - k) * 4) * P * s, (12 - k * 2) * P, P, '#ffffff')
          }
          break
        case 'lava':
          block(x0, g - 6 * P, 12 * P, 6 * P, theme.mid)
          block(x0 + 4 * P, g - 9 * P, 5 * P, 3 * P, theme.mid)
          block(x0 + 5 * P, g - 9 * P, 2 * P, 4 * P, '#ff7a1f')
          block(x0 + 2 * P, g - 3 * P, 3 * P, P, '#ffb347')
          break
        case 'pillar':
          block(x0 + 2 * P, g - 26 * P * s, 8 * P, 26 * P * s, theme.mid)
          block(x0, g - 28 * P * s, 12 * P, 3 * P, shade(theme.mid, 0.2))
          block(x0 + 3 * P, g - 22 * P * s, 2 * P, 16 * P, shade(theme.mid, -0.25))
          break
      }
    })
    const gc = ground.getContext('2d')!
    const gh = 6 * P
    gc.fillStyle = theme.dirt
    gc.fillRect(0, g, 96, gh)
    gc.fillStyle = theme.ground[0]
    gc.fillRect(0, g, 96, 2 * P)
    gc.fillStyle = theme.ground[1]
    gc.fillRect(0, g + 2 * P, 96, P)
    for (let x = 0; x < 96; x += 8 * P) { gc.fillRect(x + 2 * P, g + 3 * P, P, P); gc.fillStyle = shade(theme.dirt, -0.25); gc.fillRect(x + 5 * P, g + 4 * P, 2 * P, P); gc.fillStyle = theme.ground[1] }
    gc.fillStyle = theme.ground[0]
    for (let x = 0; x < 96; x += 6 * P) gc.fillRect(x + P, g - P, P, P)
    return { zone, far, mid, ground }
  }

  private drawScenery(layers: NonNullable<View['layers']>, alpha: number) {
    const ctx = this.ctx
    const theme: Theme = themeOf(layers.zone)
    ctx.globalAlpha = alpha
    const art = this.config.scenery ? this.zoneArt(layers.zone) : null
    if (art) {
      // Fondo dibujado (public/arte/fondos): una franja repetible con el suelo incluido, a la escala de la barra.
      const k = this.H / ART_BAND
      const w = Math.round(art.width * k)
      const off = -Math.round(this.scroll % w)
      for (let x = off; x < W; x += w) ctx.drawImage(art, x, TOP, w, this.H)
    } else if (this.config.scenery) {
      const grad = ctx.createLinearGradient(0, TOP, 0, this.groundY)
      grad.addColorStop(0, theme.sky[0])
      grad.addColorStop(1, theme.sky[1])
      ctx.fillStyle = grad
      ctx.fillRect(0, TOP, W, this.H)
      this.tile(layers.far, 0.15, 960)
      this.tile(layers.mid, 0.45, 640)
    } else {
      const grad = ctx.createLinearGradient(0, TOP + this.H * 0.25, 0, this.groundY)
      grad.addColorStop(0, 'rgba(0,0,0,0)')
      grad.addColorStop(1, 'rgba(0,0,0,.45)')
      ctx.fillStyle = grad
      ctx.fillRect(0, TOP, W, this.groundY - TOP)
    }
    if (!art) this.tile(layers.ground, 1, 96)
    if (this.config.scenery) {
      // Borde de arriba, como una barra de tareas de piedra.
      ctx.fillStyle = '#050507'
      ctx.fillRect(0, TOP - 4, W, 4)
      ctx.fillStyle = 'rgba(255,255,255,.18)'
      ctx.fillRect(0, TOP, W, 2)
    }
    ctx.globalAlpha = 1
  }

  /** El fondo dibujado de la zona, o null si aún no ha cargado o no existe (entonces se usa el paisaje hecho con código). */
  private zoneArt(zone: number): HTMLImageElement | null {
    const n = ((zone % THEMES.length) + THEMES.length) % THEMES.length + 1
    let img = this.art.get(n)
    if (!img) {
      img = new Image()
      img.src = `/arte/fondos/${n}.png`
      img.onerror = () => { this.art.set(n, null) }
      this.art.set(n, img)
    }
    return img && img.complete && img.naturalWidth > 0 ? img : null
  }

  private tile(img: HTMLCanvasElement, speed: number, w: number) {
    const off = -Math.round(((this.scroll * speed) % w) / this.px) * this.px
    for (let x = off; x < W; x += w) this.ctx.drawImage(img, x, 0)
  }

  /** Un sprite dibujado (public/arte/sprites), o null si aún no ha cargado o no existe (entonces se usa el dibujo hecho con código). */
  private sprite(name: string): HTMLImageElement | null {
    let img = this.sprites.get(name)
    if (img === undefined) {
      img = new Image()
      img.src = `/arte/sprites/${name}.png`
      img.onerror = () => { this.sprites.set(name, null) }
      this.sprites.set(name, img)
    }
    return img && img.complete && img.naturalWidth > 0 ? img : null
  }

  private drawTavern(state: RenderState) {
    const ctx = this.ctx
    const P = this.px
    const x0 = DOOR_X - 20 * P
    const g = this.groundY
    const art = this.sprite('taberna')
    if (art) {
      // La casa dibujada: la puerta (46 % del ancho) queda en DOOR_X, por donde entran y salen los héroes.
      const k = this.H / ART_BAND
      const w = Math.round(art.naturalWidth * k)
      const h = Math.round(art.naturalHeight * k)
      const x = Math.round(DOOR_X - w * TAVERN_DOOR_X)
      ctx.drawImage(art, x, g - h, w, h)
      if (this.doorOpen > 0) {
        ctx.globalAlpha = Math.min(1, this.doorOpen * 2.5) * 0.85
        ctx.fillStyle = '#ffcf6b'
        ctx.fillRect(Math.round(x + w * 0.352), Math.round(g - h + h * 0.56), Math.round(w * 0.233), Math.round(h * 0.38))
        ctx.globalAlpha = 1
      }
      if (state.tavern > 0 && this.icons) this.tavernCount(state.tavern, x + 6 * k, g - h + 10 * k)
      return
    }
    const r = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(x0 + x * P, g - y * P, w * P, h * P) }
    r(28, 33, 4, 8, '#5a5a66')
    r(27, 34, 6, 1, '#3a3a44')
    r(3, 3, 34, 3, '#6d6d78')
    r(3, 3, 34, 1, '#4b4b55')
    r(4, 18, 32, 15, '#8a5a32')
    for (let y = 16; y > 3; y -= 3) r(4, y, 32, 1, '#6e4524')
    r(1, 26, 38, 3, '#a8322d')
    r(3, 29, 34, 3, '#c23b33')
    r(7, 32, 26, 3, '#c23b33')
    r(11, 34, 18, 2, '#a8322d')
    r(15, 36, 10, 2, '#c23b33')
    r(1, 23, 38, 1, '#7a1f1b')
    const open = this.doorOpen > 0
    r(16, 14, 8, 11, '#3a2010')
    r(17, 13, 6, 10, open ? '#ffcf6b' : '#5e3618')
    if (!open) r(21, 8, 1, 1, '#f2c94c')
    const flick = 0.85 + Math.sin(this.time * 7) * 0.08 + Math.sin(this.time * 13) * 0.05
    ctx.globalAlpha = flick
    r(6, 15, 7, 6, '#ffd166')
    r(27, 15, 7, 6, '#ffd166')
    ctx.globalAlpha = 1
    r(9, 15, 1, 6, '#6e4524'); r(6, 12, 7, 1, '#6e4524')
    r(30, 15, 1, 6, '#6e4524'); r(27, 12, 7, 1, '#6e4524')
    if (state.tavern > 0 && this.icons) this.tavernCount(state.tavern, x0 + 6 * P, g - 46 * P)
  }

  /** El cartelito con la jarra y cuántos héroes esperan dentro de la taberna. */
  private tavernCount(n: number, bx: number, by: number) {
    if (!this.icons) return
    const ctx = this.ctx
    const label = `×${n}`
    ctx.font = `700 ${Math.round(18 * this.k)}px ${FONT}`
    const tw = ctx.measureText(label).width
    ctx.fillStyle = 'rgba(10,10,14,.82)'
    ctx.fillRect(bx - 4, by - 4, this.icons.mug.width + tw + 18, this.icons.mug.height + 8)
    ctx.drawImage(this.icons.mug, bx + 2, by)
    this.text(label, bx + this.icons.mug.width + 8, by + this.icons.mug.height - 2, 18 * this.k, '#ffe14d')
  }

  /* ---------------- héroes y enemigos */

  private drawHero(h: HeroView, state: RenderState) {
    const a = this.heroes.get(h.k)
    if (!a) return
    const ctx = this.ctx
    const P = this.px
    const s = a.sprite
    const feet = this.heroY(h)
    const moving = Math.abs(a.shownX - a.prevX) > 0.15 || (state.phase === 'walk' && !h.ko && !h.leaving)
    const x = Math.round(a.shownX)

    if (h.ko) {
      ctx.save()
      ctx.translate(x, feet)
      ctx.rotate(-Math.PI / 2 * (a.dir === 1 ? 1 : -1))
      ctx.globalAlpha = 0.75
      ctx.drawImage(s.frames[0]!, -s.w / 2 + (a.dir === 1 ? -s.h + s.w / 2 : 0), -s.w / 2 - P * 2, s.w, s.h)
      ctx.restore()
      ctx.globalAlpha = 1
      for (let i = 0; i < 3; i++) {
        const ang = this.time * 4 + (i * Math.PI * 2) / 3
        ctx.fillStyle = '#ffe14d'
        ctx.fillRect(Math.round(x + Math.cos(ang) * 6 * P), Math.round(feet - 6 * P + Math.sin(ang) * 2 * P), P, P)
      }
      return
    }

    if (a.pillar > 0) {
      ctx.globalAlpha = a.pillar * 0.6
      ctx.fillStyle = '#fff2a8'
      ctx.fillRect(x - s.w / 2 + 2 * P, TOP - 10, s.w - 4 * P, feet - TOP + 10)
      ctx.globalAlpha = 1
    }

    const frame = moving ? (Math.floor(this.time * 8 + (h.seed % 7)) % 2 ? 1 : 2) : 0
    const bob = moving && frame === 2 ? -P : 0
    const lunge = a.swing > 0 && a.melee ? Math.sin((1 - a.swing / 0.22) * Math.PI) * 4 * P : 0
    ctx.save()
    ctx.translate(x + lunge * a.dir, feet + bob)
    ctx.scale(a.dir, 1)
    // Frenesí (naranja) o aura de los de nivel 35 (dorada): un brillo con la forma del héroe.
    const glow = state.frenzy > 0 ? '#ff6a1f' : a.tier >= 4 ? '#ffe680' : ''
    if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = (state.frenzy > 0 ? 10 + Math.sin(this.time * 12) * 4 : 8 + Math.sin(this.time * 3) * 3) * this.k }
    ctx.drawImage(s.frames[frame]!, -s.w / 2, -s.h)
    ctx.shadowBlur = 0
    if (a.flash > 0) { ctx.globalAlpha = 0.8; ctx.drawImage(s.white[frame]!, -s.w / 2, -s.h); ctx.globalAlpha = 1 }
    // La espada, que gira al pegar.
    const hx = -s.w / 2 + s.hand[0] * P
    const hy = -s.h + s.hand[1] * P
    const swingT = a.swing > 0 ? 1 - a.swing / 0.22 : -1
    const angle = swingT >= 0 ? -2.0 + swingT * 2.7 : -0.9 + Math.sin(this.time * 2 + h.seed) * 0.05
    ctx.translate(hx, hy)
    ctx.rotate(angle)
    ctx.fillStyle = s.hilt
    ctx.fillRect(-P, -P * 1.5, P * 2, P)
    ctx.fillStyle = s.blade
    ctx.fillRect(-P / 2, -P * 8.5, P, P * 7)
    ctx.fillStyle = shade(s.blade, -0.35)
    ctx.fillRect(0, -P * 8.5, P / 2, P * 7)
    ctx.restore()

    if (h.hp < h.maxHp) {
      const bw = 10 * P
      const by = feet - s.h - 4 * P
      ctx.fillStyle = '#000'
      ctx.fillRect(x - bw / 2 - 1, by - 1, bw + 2, P + 2)
      ctx.fillStyle = h.hp / h.maxHp > 0.35 ? '#5ee37a' : '#ff5a5a'
      ctx.fillRect(x - bw / 2, by, Math.max(0, bw * (h.hp / h.maxHp)), P)
    }
  }

  private drawEnemy(id: number) {
    const a = this.enemies.get(id)
    const e = this.state?.enemies.find(x => x.id === id)
    if (!a || !e) return
    const ctx = this.ctx
    const P = this.px
    const s = enemySprite(e.kind, e.tint, P)
    const frame = Math.floor(this.time * 2.5 + id) % 2
    const fly = e.kind === 'bat' ? this.flyOffset(id) : 0
    const x = Math.round(a.shownX + a.kb)
    const y = Math.round(this.groundY - s.h + fly)
    // Al aparecer, se funde (sale de detrás del marcador).
    const fade = Math.min(1, Math.max(0, (SPAWN_X - a.shownX) / 60 + 0.15))
    ctx.globalAlpha = fade
    ctx.fillStyle = 'rgba(0,0,0,.3)'
    ctx.fillRect(x + P, this.groundY - P, s.w - 2 * P, P)
    ctx.drawImage(s.frames[frame]!, x, y)
    if (a.flash > 0) { ctx.globalAlpha = 0.85 * fade; ctx.drawImage(s.white[frame]!, x, y) }
    ctx.globalAlpha = 1
    if (e.hp < e.maxHp && a.shownX <= ENEMY_X + 300) {
      const bw = Math.max(s.w, 14 * P)
      const by = y - 3 * P
      ctx.fillStyle = '#000'
      ctx.fillRect(x + s.w / 2 - bw / 2 - 1, by - 1, bw + 2, P + 2)
      ctx.fillStyle = '#ff5a5a'
      ctx.fillRect(x + s.w / 2 - bw / 2, by, Math.max(0, bw * (e.hp / e.maxHp)), P)
    }
  }

  /** Los nombres: de delante hacia atrás, y solo los que no se pisan con otro. */
  private drawNames(order: HeroView[]) {
    const size = 15 * this.k
    const rects: [number, number, number][] = []
    const ctx = this.ctx
    ctx.font = `700 ${Math.round(size)}px ${FONT}`
    const list = order.slice().sort((a, b) => b.x - a.x)
    for (const h of list) {
      const a = this.heroes.get(h.k)
      if (!a || h.leaving) continue
      const w = ctx.measureText(h.name).width + 6
      const x = a.shownX
      const lift = h.ko ? 9 * this.px : 18 * this.px + (h.hp < h.maxHp ? 3 * this.px : 0)
      let y = this.heroY(h) - lift
      let ok = !rects.some(([rx, ry, rw]) => Math.abs(rx - x) < (rw + w) / 2 && Math.abs(ry - y) < size)
      if (!ok) {
        y -= size + 2
        ok = !rects.some(([rx, ry, rw]) => Math.abs(rx - x) < (rw + w) / 2 && Math.abs(ry - y) < size)
      }
      if (!ok) continue
      rects.push([x, y, w])
      this.text(h.name, x, y, size, NAME_COLOR[h.p], 'center')
    }
  }

  private drawBubbles(order: HeroView[]) {
    const ctx = this.ctx
    for (const h of order) {
      const a = this.heroes.get(h.k)
      if (!a?.bubble) continue
      const size = 17 * this.k
      ctx.font = `700 ${Math.round(size)}px ${FONT}`
      const w = ctx.measureText(a.bubble.text).width + 20
      const x = Math.min(W - HUD_W - w / 2 - 20, Math.max(w / 2 + 6, a.shownX))
      const y = this.heroY(h) - 30 * this.px
      ctx.fillStyle = '#050507'
      ctx.fillRect(x - w / 2 - 3, y - size - 9, w + 6, size + 18)
      ctx.fillStyle = '#2b2b31'
      ctx.fillRect(x - w / 2, y - size - 6, w, size + 12)
      ctx.fillStyle = '#2b2b31'
      ctx.fillRect(Math.round(a.shownX) - 3, y + 6, 6, 6)
      this.text(a.bubble.text, x, y + 2, size, '#ffe14d', 'center')
    }
  }

  /* ---------------- marcador */

  private drawHud(state: RenderState) {
    const frenzy = state.frenzy > 0 ? Math.ceil(state.frenzy) : 0
    const key = [state.zone, state.wave, state.wavesPerZone, Math.floor(state.gold), state.day, state.waveKills, state.waveTotal, frenzy, state.phase].join('|')
    this.hud.classList.toggle('pulse', this.goldPulse > 0.5)
    if (key === this.hudText) return
    const first = !this.hudText
    this.hudText = key
    if (first) {
      this.hud.innerHTML = `<div class="hz"><span class="zn"></span><span class="st"></span></div>
        <div class="hm slot"><i></i></div>
        <div class="hr"><span class="gold"><canvas class="coin"></canvas><b></b></span><span class="fr hidden"></span><span class="day"></span></div>`
      const c = this.hud.querySelector<HTMLCanvasElement>('canvas.coin')!
      const icon = coinIcon(3)
      c.width = icon.width; c.height = icon.height
      c.getContext('2d')!.drawImage(icon, 0, 0)
    }
    const q = <T extends HTMLElement>(s: string) => this.hud.querySelector(s) as T
    q('.zn').textContent = zoneName(state.zone).toUpperCase()
    q('.st').textContent = stageLabel(state.zone, state.wave)
    const total = state.waveTotal || 1
    const zoneProgress = (state.wave + (state.phase === 'fight' ? state.waveKills / total : 0)) / state.wavesPerZone
    q('.hm i').style.width = `${Math.min(100, zoneProgress * 100)}%`
    q('.gold b').textContent = fmt(state.gold)
    q('.day').textContent = `DÍA ${state.day}`
    const fr = q('.fr')
    fr.classList.toggle('hidden', !frenzy)
    fr.textContent = frenzy ? `FRENESÍ ${frenzy}s` : ''
  }
}
