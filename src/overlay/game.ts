/**
 * El juego en sí: héroes, enemigos, oleadas, oro y experiencia. Corre en el overlay de OBS (solo
 * en la fuente que lee el chat) y no toca la pantalla: cada fotograma da un RenderState y una lista
 * de efectos (Fx) que dibuja view.ts. Así las demás fuentes de OBS pueden mostrar lo mismo.
 *
 * Las fórmulas están en shared/game.ts.
 */
import {
  BIG_GIFT, ENEMY_SWING, EVENTS, EVENT_KINDS, FRENZY_MAX_SEC, FRENZY_MULT, FRENZY_SEC, HERO_SWING,
  UPGRADES, UPGRADE_IDS, enemiesInWave, enemyAttack, enemyHp, heroDamage, heroMaxHp, ignoredNames, killGold, killXp,
  koSeconds, maybeNewDay, parseCommand, parseVote, SHOP_SEC, stageLabel, themeOf, upgradeCost, waveGold, xpNeed, fmt,
  type Config, type EnemyKind, type EventKind, type HeroRecord, type PanelOp, type Platform, type Summary, type UpgradeId, type World,
} from '../../shared/game'

/* ---------------------------------------------------------------- geometría de la barra */

/** La puerta de la taberna, por donde entran y salen los héroes. */
export const DOOR_X = 118
/** Hasta dónde llega el héroe de delante. */
export const FRONT_X = 1180
/** Donde se para el enemigo que pelea, y la distancia entre los que esperan detrás. */
export const ENEMY_X = FRONT_X + 52
export const ENEMY_GAP = 66
/** Por donde aparecen los enemigos (a la izquierda del marcador). */
export const SPAWN_X = 1585
const PARTY_MIN_X = 210
const HERO_SPEED = 190
const ENEMY_SPEED = 120
const WALK_SEC = 6
const SPAWN_SEC = 1.6
const MAX_ENEMIES = 4

/* ---------------------------------------------------------------- lo que se dibuja */

export type Fx =
  | { t: 'hit'; k: string; e: number; dmg: number; crit: boolean }
  | { t: 'hurt'; k: string; dmg: number }
  | { t: 'ko'; k: string }
  | { t: 'up'; k: string }
  | { t: 'kill'; e: number; gold: number }
  | { t: 'level'; k: string; name: string; level: number }
  | { t: 'wave'; gold: number; stage: string }
  | { t: 'zone'; zone: number }
  | { t: 'join'; k: string }
  | { t: 'me'; k: string; text: string }
  | { t: 'buy'; name: string; level: number; by: string }
  | { t: 'noVote' }
  | { t: 'support'; title: string; text: string }
  | { t: 'event'; kind: EventKind; power: number; hits: { e: number; dmg: number }[]; gold: number }
  | { t: 'day'; day: number; zone: number; wave: number; yesterday: Summary | null }

export interface ShopItem { n: number; name: string; effect: string; level: number; cost: number; can: boolean; votes: number }
/** La tienda abierta, con los votos de cada mejora y los segundos que quedan. */
export interface ShopView { items: ShopItem[]; left: number; total: number }

export interface HeroView {
  k: string; name: string; p: Platform | 'demo'; level: number; x: number; row: number
  hp: number; maxHp: number; ko: boolean; leaving: boolean; seed: number; target: boolean
  /** Ha escrito hace poco (se resalta su nombre). */
  spoke: boolean
}
export interface EnemyView { id: number; kind: EnemyKind; tint: string; x: number; hp: number; maxHp: number }

export interface RenderState {
  zone: number; wave: number; wavesPerZone: number; gold: number; day: number
  phase: 'wait' | 'walk' | 'fight'
  waveKills: number; waveTotal: number
  /** Héroes de hoy que están en la taberna (sin escribir hace rato o porque no caben). */
  tavern: number
  /** La tienda abierta (se vota después de cada oleada), o null. */
  shop: ShopView | null
  frenzy: number
  heroes: HeroView[]
  enemies: EnemyView[]
}

/* ---------------------------------------------------------------- piezas */

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 }

class Hero {
  rec: HeroRecord
  loaded: boolean
  dirty = false
  readonly demo: boolean
  /** Lo ganado antes de saber su nivel guardado (la base de datos tarda un momento). */
  pending = { xp: 0, dmg: 0, kills: 0 }
  hp: number
  x = DOOR_X
  row: number
  ko = 0
  cd: number
  lastSpoke: number
  lastCmd = 0
  onField = false
  leaving = false
  joinedAt: number
  readonly seed: number
  /** Para los de prueba: hasta cuándo siguen hablando solos. */
  demoUntil = 0

  constructor(rec: HeroRecord, loaded: boolean, demo: boolean, now: number) {
    this.rec = rec
    this.loaded = loaded
    this.demo = demo
    this.seed = hash(rec.k)
    this.row = this.seed % 2
    this.hp = 1
    this.cd = Math.random() * HERO_SWING
    this.lastSpoke = now
    this.joinedAt = now
  }
}

interface Enemy { id: number; kind: EnemyKind; tint: string; hp: number; maxHp: number; atk: number; x: number; cd: number }

export interface SupportIn { name: string; k?: string; kind: 'sub' | 'gift' | 'bits' | 'superchat'; n: number; amount?: string }
export interface LineIn { k: string; p: Platform; name: string; text: string }

const DEMO_NAMES = ['Ana_Prueba', 'Caballero_Test', 'Lucía', 'Pancho_99', 'MagaDePrueba', 'ElDelFondo', 'Rocío', 'xX_Demo_Xx', 'Toni', 'GatitoFeroz', 'Marta_Fan', 'Paco', 'NovaStar', 'Bea', 'Kiko', 'DuendeVerde', 'Sara', 'Lobo_Solitario', 'Iván', 'Pixelito']

/* ---------------------------------------------------------------- el juego */

export class Game {
  world: World
  config: Config
  private ignored: Set<string>
  private heroes = new Map<string, Hero>()
  private enemies: Enemy[] = []
  private fx: Fx[] = []
  private phase: RenderState['phase'] = 'walk'
  private walkLeft = 3
  private spawnLeft = 0
  private waveTotal = 0
  private waveSpawned = 0
  private waveKills = 0
  private frenzy = 0
  private nextEnemy = 1
  private nextDemo = 1
  private fieldTimer = 0
  private dayShown = false
  /** La tienda abierta: hasta cuándo y quién ha votado qué. */
  private shop: { until: number; votes: Map<string, number> } | null = null
  /** Daño de hoy por persona, para el MVP. */
  private today = new Map<string, { name: string; dmg: number }>()
  /** Héroes que hay que pedir a la base de datos. */
  readonly toLoad = new Set<string>()
  private readonly preview: boolean
  now = 0

  constructor(world: World, config: Config, now: number, opts: { preview?: boolean } = {}) {
    this.world = world
    this.config = config
    this.ignored = ignoredNames(config)
    this.preview = !!opts.preview
    this.now = now
    if (maybeNewDay(world, now)) this.dayShown = false
    for (const t of world.session.top) this.today.set(t.k, { name: t.name, dmg: t.dmg })
  }

  setConfig(config: Config) {
    this.config = config
    this.ignored = ignoredNames(config)
  }

  /** Cambia el mundo entero (tras reiniciar o restaurar una copia desde el panel). */
  replaceWorld(world: World) {
    this.world = world
    this.today.clear()
    for (const t of world.session.top) this.today.set(t.k, { name: t.name, dmg: t.dmg })
    for (const [k, h] of this.heroes) if (!h.demo) { this.heroes.delete(k) }
    this.enemies = []
    this.phase = 'walk'
    this.walkLeft = 2
    this.dayShown = false
  }

  /* ------------------------------------------------------------ entradas */

  isIgnored(name: string) { return this.ignored.has(name.replace(/^@/, '').toLowerCase()) }

  /**
   * Un mensaje del chat: el héroe aparece (o vuelve de la taberna) y se pone el primero de la fila.
   * Hablar no da golpes: los héroes pegan solos mientras su dueño esté activo (ha escrito en los últimos
   * idleMin minutos). Si es un comando (!yo, !tienda, !comprar), lo hace.
   */
  line(l: LineIn) {
    if (this.isIgnored(l.name)) return
    this.command(this.touch(l.k, l.p, l.name), l.text)
  }

  /** Si el mensaje es un comando (!yo, !tienda, !comprar), lo hace. */
  private command(hero: Hero, text: string) {
    const vote = parseVote(text)
    if (vote !== null) { this.vote(hero, vote); return }
    const cmd = parseCommand(text)
    if (!cmd || this.now - hero.lastCmd < 1500) return
    hero.lastCmd = this.now
    if (cmd.type === 'me') this.fx.push({ t: 'me', k: hero.rec.k, text: this.describe(hero) })
  }

  /**
   * Una sub, un regalo, bits o un Super Chat: un evento al azar (con regalos grandes, todos), más
   * fuerte cuanto más grande el apoyo, y experiencia extra para quien lo manda si está jugando.
   */
  support(s: SupportIn) {
    const n = Math.max(1, Math.min(s.n, 9999))
    if (s.kind === 'bits' && n < 100) return
    const title = s.kind === 'sub' ? `¡${s.name} se suscribe!` : s.kind === 'gift' ? `¡${s.name} regala ${n} ${n === 1 ? 'sub' : 'subs'}!`
      : s.kind === 'bits' ? `¡${s.name} manda ${n} bits!` : `¡Super Chat de ${s.name}${s.amount ? ` (${s.amount})` : ''}!`
    const power = s.kind === 'bits' ? Math.min(5, Math.max(1, Math.floor(n / 100))) : s.kind === 'gift' ? Math.min(5, n) : s.kind === 'superchat' ? 3 : 1
    const hero = s.k ? this.heroes.get(s.k) : undefined
    if (hero && hero.loaded) for (let i = 0; i < Math.min(3, power); i++) this.addXp(hero, xpNeed(hero.rec.level) * 0.5)
    if (!this.config.events) { this.fx.push({ t: 'support', title, text: '¡Gracias!' }); return }
    const kinds: EventKind[] = s.kind === 'gift' && n >= BIG_GIFT ? EVENT_KINDS : [EVENT_KINDS[Math.floor(Math.random() * EVENT_KINDS.length)]!]
    this.fx.push({ t: 'support', title, text: kinds.length > 1 ? '¡SUPEREVENTO! Todos los eventos a la vez' : `${EVENTS[kinds[0]!].name}: ${EVENTS[kinds[0]!].effect}` })
    for (const kind of kinds) this.event(kind, power)
  }

  /** Lanza un evento. `power` (1 a 5) lo hace más fuerte. */
  event(kind: EventKind, power: number) {
    const w = this.world
    const out = { t: 'event' as const, kind, power, hits: [] as { e: number; dmg: number }[], gold: 0 }
    // Va antes que los enemigos que mate, para que la pantalla sepa dónde estaban.
    this.fx.push(out)
    switch (kind) {
      case 'frenzy':
        this.frenzy = Math.min(FRENZY_MAX_SEC, this.frenzy + FRENZY_SEC * power)
        break
      case 'meteor': {
        // Cada meteorito quita un buen trozo de la vida de cada enemigo que haya en pantalla.
        for (const e of this.enemies.slice()) {
          const dmg = Math.ceil(e.maxHp * Math.min(1, 0.45 * power))
          out.hits.push({ e: e.id, dmg })
          e.hp -= dmg
          if (e.hp <= 0) this.kill(e, null)
        }
        break
      }
      case 'goldrain': {
        const gold = waveGold(w.zone, w.upgrades.banner) * (1 + power)
        w.gold += gold
        w.totals.gold += gold
        out.gold = gold
        break
      }
      case 'blessing':
        for (const h of this.heroes.values()) {
          if (!h.onField || h.leaving) continue
          if (h.ko) { h.ko = 0; this.fx.push({ t: 'up', k: h.rec.k }) }
          h.hp = this.maxHp(h)
          this.addXp(h, xpNeed(h.loaded ? h.rec.level : 1) * 0.15 * power)
        }
        break
    }
  }

  op(op: PanelOp) {
    switch (op.type) {
      case 'fake': for (let i = 0; i < op.n; i++) this.addDemo(op.minutes * 60_000, { level: op.level, p: op.p }); break
      case 'say': {
        const name = op.name.replace(/^@/, '')
        let hero = [...this.heroes.values()].find(h => h.demo && h.rec.name.toLowerCase() === name.toLowerCase())
        hero ??= this.addDemo(10 * 60_000, { name, p: op.p })
        hero.lastSpoke = this.now
        hero.demoUntil = Math.max(hero.demoUntil, this.now + 10 * 60_000)
        this.fieldTimer = 0
        this.command(hero, op.text)
        break
      }
      case 'support': this.support({ name: op.name, kind: op.kind, n: op.n }); break
      case 'zone': {
        const w = this.world
        w.zone = op.zone
        w.wave = 0
        w.best = Math.max(w.best, w.zone)
        this.enemies = []
        this.phase = 'walk'
        this.walkLeft = 1
        this.waveTotal = 0
        this.waveSpawned = 0
        this.fx.push({ t: 'zone', zone: w.zone })
        break
      }
      case 'wave':
        if (this.phase === 'fight' && this.waveTotal) {
          for (const e of this.enemies.slice()) this.kill(e, null)
          this.waveSpawned = this.waveTotal
        } else this.walkLeft = 0
        break
      case 'ko':
        for (const h of this.field()) if (!h.ko) { h.hp = 0; h.ko = koSeconds(this.world.upgrades.campfire); this.fx.push({ t: 'ko', k: h.rec.k }) }
        break
      case 'clearBots':
        for (const [k, h] of this.heroes) if (h.demo) this.heroes.delete(k)
        break
      case 'gold': this.world.gold += op.n; break
      case 'event':
        if (op.kind === 'all') this.support({ name: 'Prueba', kind: 'gift', n: BIG_GIFT })
        else { this.fx.push({ t: 'support', title: '¡Evento de prueba!', text: `${EVENTS[op.kind].name}: ${EVENTS[op.kind].effect}` }); this.event(op.kind, 1) }
        break
      case 'newDay':
        maybeNewDay(this.world, this.now, true)
        this.today.clear()
        this.dayShown = false
        for (const h of this.heroes.values()) if (!h.demo && h.onField && h.loaded) this.countToday(h, false)
        this.showDay()
        break
    }
  }

  /** Héroes de prueba (botón del panel y vista previa): no se guardan. */
  addDemo(ms: number, opts: { level?: number; p?: Platform; name?: string } = {}): Hero {
    const n = this.nextDemo++
    const name = opts.name ?? DEMO_NAMES[(n - 1) % DEMO_NAMES.length]! + (n > DEMO_NAMES.length ? String(Math.ceil(n / DEMO_NAMES.length)) : '')
    const level = opts.level ? opts.level : 1 + Math.floor(Math.random() * 9)
    const rec: HeroRecord = { k: `demo:${n}`, p: opts.p ?? 'twitch', name: name.slice(0, 40), level, xp: 0, dmg: 0, kills: 0, first: this.now, last: this.now }
    const hero = new Hero(rec, true, true, this.now)
    hero.hp = heroMaxHp(rec.level, this.world.upgrades.armor)
    hero.demoUntil = this.now + ms
    this.heroes.set(rec.k, hero)
    return hero
  }

  /** Lo que llega de la base de datos: el nivel y lo aportado de cada uno. */
  loaded(records: HeroRecord[], asked: string[]) {
    const found = new Map(records.map(r => [r.k, r]))
    for (const k of asked) {
      const hero = this.heroes.get(k)
      if (!hero || hero.loaded) continue
      const stored = found.get(k)
      // Si ya jugó hoy (antes de recargar el overlay), no se cuenta otra vez.
      const seenToday = !!stored && stored.last >= this.world.session.startedAt
      if (stored) hero.rec = { ...stored, name: hero.rec.name, p: hero.rec.p }
      hero.loaded = true
      const { xp, dmg, kills } = hero.pending
      hero.pending = { xp: 0, dmg: 0, kills: 0 }
      hero.rec.dmg += dmg
      hero.rec.kills += kills
      hero.hp = heroMaxHp(hero.rec.level, this.world.upgrades.armor)
      this.countToday(hero, seenToday)
      if (xp) this.addXp(hero, xp)
      hero.dirty = true
    }
  }

  /* ------------------------------------------------------------ guardar */

  /** Lo que hay que guardar: el mundo y los héroes que han cambiado. */
  collect(): { world: World; heroes: HeroRecord[] } {
    this.world.session.top = [...this.today.entries()]
      .map(([k, v]) => ({ k, name: v.name, dmg: Math.round(v.dmg) }))
      .sort((a, b) => b.dmg - a.dmg)
      .slice(0, 20)
    const heroes: HeroRecord[] = []
    for (const h of this.heroes.values()) {
      if (h.demo || !h.loaded || !h.dirty) continue
      h.dirty = false
      heroes.push({ ...h.rec, xp: Math.round(h.rec.xp * 100) / 100, dmg: Math.round(h.rec.dmg) })
    }
    return { world: structuredClone(this.world), heroes }
  }

  /** Si no se pudo guardar, se vuelven a marcar para la próxima vez. */
  unsaved(heroes: HeroRecord[]) { for (const r of heroes) { const h = this.heroes.get(r.k); if (h) h.dirty = true } }

  drain(): Fx[] { const out = this.fx; this.fx = []; return out }

  /* ------------------------------------------------------------ cada fotograma */

  step(dtMs: number, now: number) {
    this.now = now
    const dt = Math.min(0.1, Math.max(0, dtMs / 1000))
    this.fieldTimer -= dt
    if (this.fieldTimer <= 0) { this.fieldTimer = 0.5; this.arrange() }
    if (this.frenzy > 0) this.frenzy = Math.max(0, this.frenzy - dt)
    if (this.shop && now >= this.shop.until) this.closeShop()

    const field = this.field()
    if (field.some(h => !h.demo)) this.world.session.lastAt = now

    // Los héroes van a su sitio (los que se van, a la puerta de la taberna).
    // Delante, quien ha hablado el último.
    const order = field.slice().sort((a, b) => b.lastSpoke - a.lastSpoke)
    const spacing = Math.min(46, (FRONT_X - PARTY_MIN_X) / Math.max(1, order.length - 1))
    const targets = new Map<Hero, number>()
    order.forEach((h, i) => targets.set(h, FRONT_X - i * spacing))
    for (const h of this.heroes.values()) {
      if (!h.onField) continue
      const target = h.leaving ? DOOR_X : targets.get(h) ?? h.x
      const d = target - h.x
      h.x += Math.sign(d) * Math.min(Math.abs(d), HERO_SPEED * dt)
      if (h.leaving && Math.abs(h.x - DOOR_X) < 1) { h.onField = false; h.leaving = false }
      if (h.ko > 0) {
        h.ko -= dt
        if (h.ko <= 0) { h.ko = 0; h.hp = this.maxHp(h); this.fx.push({ t: 'up', k: h.rec.k }) }
      }
    }

    if (!field.length) { this.phase = 'wait'; return }
    if (this.phase === 'wait') this.phase = this.enemies.length || this.waveSpawned < this.waveTotal ? 'fight' : 'walk'

    if (this.phase === 'walk') {
      this.walkLeft -= dt
      if (this.walkLeft <= 0) this.startWave()
      this.regen(field, null, dt)
      return
    }

    // Llegan los enemigos.
    this.spawnLeft -= dt
    if (this.waveSpawned < this.waveTotal && this.enemies.length < MAX_ENEMIES && this.spawnLeft <= 0) this.spawn(field.length)
    this.enemies.forEach((e, i) => {
      const target = ENEMY_X + i * ENEMY_GAP
      if (e.x > target) e.x = Math.max(target, e.x - ENEMY_SPEED * dt)
    })

    const front = this.enemies[0]
    const engaged = front && front.x <= ENEMY_X + 1 ? front : null
    let victim: Hero | null = null
    if (engaged) {
      const ready = field.filter(h => !h.ko && h.x > FRONT_X - 260).sort((a, b) => b.x - a.x)
      victim = ready[0] ?? null
      // Pegan los héroes que ya están en su sitio.
      for (const h of field) {
        if (h.ko || Math.abs(h.x - (targets.get(h) ?? h.x)) > 30) continue
        h.cd -= dt
        if (h.cd > 0) continue
        h.cd = HERO_SWING * (0.9 + Math.random() * 0.25)
        this.hit(h, engaged, this.damage(h))
        if (!this.enemies.includes(engaged)) break
      }
      // Y pega el enemigo al héroe de delante.
      if (this.enemies.includes(engaged) && victim) {
        engaged.cd -= dt
        if (engaged.cd <= 0) {
          engaged.cd = ENEMY_SWING
          victim.hp -= engaged.atk
          this.fx.push({ t: 'hurt', k: victim.rec.k, dmg: Math.round(engaged.atk) })
          if (victim.hp <= 0) { victim.hp = 0; victim.ko = koSeconds(this.world.upgrades.campfire); this.fx.push({ t: 'ko', k: victim.rec.k }) }
        }
      }
    }
    this.regen(field, victim, dt)

    if (this.waveSpawned >= this.waveTotal && !this.enemies.length) this.endWave()
  }

  render(): RenderState {
    const heroes: HeroView[] = []
    const front = this.enemies[0]
    const engaged = !!front && front.x <= ENEMY_X + 1
    let victim = ''
    if (engaged) {
      let best = -1
      for (const h of this.heroes.values()) if (h.onField && !h.leaving && !h.ko && h.x > FRONT_X - 260 && h.x > best) { best = h.x; victim = h.rec.k }
    }
    for (const h of this.heroes.values()) {
      if (!h.onField) continue
      heroes.push({
        k: h.rec.k, name: h.rec.name, p: h.demo ? 'demo' : h.rec.p, level: h.rec.level, x: h.x, row: h.row,
        hp: h.hp, maxHp: this.maxHp(h), ko: h.ko > 0, leaving: h.leaving, seed: h.seed, target: h.rec.k === victim, spoke: this.now - h.lastSpoke < 6000,
      })
    }
    let tavern = 0
    for (const h of this.heroes.values()) if (!h.onField && !h.demo) tavern++
    return {
      zone: this.world.zone, wave: this.world.wave, wavesPerZone: this.config.wavesPerZone, gold: this.world.gold,
      day: this.world.session.day, phase: this.phase, waveKills: this.waveKills, waveTotal: this.waveTotal || enemiesInWave(this.world.wave),
      tavern, shop: this.shopView(), frenzy: this.frenzy, heroes,
      enemies: this.enemies.map(e => ({ id: e.id, kind: e.kind, tint: e.tint, x: e.x, hp: e.hp, maxHp: e.maxHp })),
    }
  }

  /* ------------------------------------------------------------ por dentro */

  private touch(k: string, p: Platform, name: string): Hero {
    let hero = this.heroes.get(k)
    if (!hero) {
      const rec: HeroRecord = { k, p, name, level: 1, xp: 0, dmg: 0, kills: 0, first: this.now, last: this.now }
      hero = new Hero(rec, this.preview, false, this.now)
      hero.hp = heroMaxHp(1, this.world.upgrades.armor)
      this.heroes.set(k, hero)
      if (!this.preview) this.toLoad.add(k)
    }
    hero.rec.name = name.slice(0, 40)
    hero.lastSpoke = this.now
    if (!hero.onField || hero.leaving) this.fieldTimer = 0
    return hero
  }

  /** Apunta al héroe en los de hoy (para el resumen del día). */
  private countToday(hero: Hero, seenToday: boolean) {
    if (hero.demo) return
    if (!this.today.has(hero.rec.k)) {
      this.today.set(hero.rec.k, { name: hero.rec.name, dmg: 0 })
      if (!seenToday) this.world.session.heroes++
    }
    hero.rec.last = this.now
    hero.dirty = true
  }

  /** Quién está en la barra: los que han escrito hace poco, los más recientes primero. */
  private arrange() {
    const idleMs = this.config.idleMin * 60_000
    const active: Hero[] = []
    for (const h of this.heroes.values()) {
      if (h.demo && h.demoUntil > this.now) {
        if (this.now - h.lastSpoke > 15_000 + (h.seed % 20_000)) h.lastSpoke = this.now
      }
      if (this.now - h.lastSpoke < idleMs && !(h.demo && h.demoUntil <= this.now)) active.push(h)
      else if (h.demo && !h.onField) this.heroes.delete(h.rec.k)
    }
    active.sort((a, b) => b.lastSpoke - a.lastSpoke)
    const keep = new Set(active.slice(0, this.config.maxHeroes))
    let joined = false
    for (const h of this.heroes.values()) {
      const should = keep.has(h)
      if (should && (!h.onField || h.leaving)) {
        if (!h.onField) { h.x = DOOR_X; h.joinedAt = this.now; this.fx.push({ t: 'join', k: h.rec.k }) }
        h.onField = true
        h.leaving = false
        if (!h.demo) joined = true
      } else if (!should && h.onField && !h.leaving) {
        h.leaving = true
      }
      h.rec.last = h.demo ? h.rec.last : Math.max(h.rec.last, h.onField ? this.now : h.rec.last)
    }
    if (joined && !this.dayShown) this.showDay()
  }

  private showDay() {
    this.dayShown = true
    const w = this.world
    this.fx.push({ t: 'day', day: w.session.day, zone: w.zone, wave: w.wave, yesterday: w.yesterday })
  }

  private field() {
    const out: Hero[] = []
    for (const h of this.heroes.values()) if (h.onField && !h.leaving) out.push(h)
    return out
  }

  private maxHp(h: Hero) { return heroMaxHp(h.rec.level, this.world.upgrades.armor) }
  private damage(h: Hero) { return heroDamage(h.rec.level, this.world.upgrades.forge) * (this.frenzy > 0 ? FRENZY_MULT : 1) }

  private regen(field: Hero[], victim: Hero | null, dt: number) {
    for (const h of field) {
      if (h.ko || h === victim) continue
      const max = this.maxHp(h)
      if (h.hp < max) h.hp = Math.min(max, h.hp + max * 0.03 * dt)
    }
  }

  private hit(hero: Hero, enemy: Enemy, dmg: number) {
    const dealt = Math.min(dmg, enemy.hp)
    enemy.hp -= dmg
    this.fx.push({ t: 'hit', k: hero.rec.k, e: enemy.id, dmg: Math.max(1, Math.round(dmg)), crit: false })
    if (!hero.demo) {
      if (hero.loaded) { hero.rec.dmg += dealt; hero.dirty = true } else hero.pending.dmg += dealt
      const t = this.today.get(hero.rec.k)
      if (t) { t.dmg += dealt; t.name = hero.rec.name } else this.today.set(hero.rec.k, { name: hero.rec.name, dmg: dealt })
    }
    if (enemy.hp <= 0) this.kill(enemy, hero)
  }

  private kill(enemy: Enemy, by: Hero | null) {
    this.enemies = this.enemies.filter(e => e !== enemy)
    this.waveKills++
    const w = this.world
    const gold = killGold(w.zone, w.upgrades.banner)
    w.gold += gold
    w.totals.gold += gold
    w.totals.kills++
    w.session.kills++
    this.fx.push({ t: 'kill', e: enemy.id, gold })
    if (by && !by.demo) { if (by.loaded) by.rec.kills++; else by.pending.kills++ }
    const xp = killXp(w.zone)
    for (const h of this.field()) if (!h.ko) this.addXp(h, xp)
  }

  private addXp(h: Hero, xp: number) {
    if (h.demo) return
    if (!h.loaded) { h.pending.xp += xp; return }
    h.rec.xp += xp
    h.dirty = true
    while (h.rec.xp >= xpNeed(h.rec.level)) {
      h.rec.xp -= xpNeed(h.rec.level)
      h.rec.level++
      h.hp = this.maxHp(h)
      this.fx.push({ t: 'level', k: h.rec.k, name: h.rec.name, level: h.rec.level })
    }
  }

  private startWave() {
    this.phase = 'fight'
    this.waveTotal = enemiesInWave(this.world.wave)
    this.waveSpawned = 0
    this.waveKills = 0
    this.spawnLeft = 0
  }

  private spawn(heroes: number) {
    const w = this.world
    const kinds = themeOf(w.zone).enemies
    const pick = kinds[Math.floor(Math.random() * kinds.length)]!
    const hp = enemyHp(w.zone, w.wave, heroes, this.config.difficulty)
    this.enemies.push({
      id: this.nextEnemy++, kind: pick.kind, tint: pick.tint, hp, maxHp: hp,
      atk: enemyAttack(w.zone, this.config.difficulty), x: SPAWN_X, cd: ENEMY_SWING * 0.6,
    })
    this.waveSpawned++
    this.spawnLeft = SPAWN_SEC
  }

  private endWave() {
    const w = this.world
    const gold = waveGold(w.zone, w.upgrades.banner)
    w.gold += gold
    w.totals.gold += gold
    w.totals.waves++
    w.session.waves++
    this.fx.push({ t: 'wave', gold, stage: stageLabel(w.zone, w.wave) })
    this.openShop()
    w.wave++
    if (w.wave >= this.config.wavesPerZone) {
      w.wave = 0
      w.zone++
      w.best = Math.max(w.best, w.zone)
      this.fx.push({ t: 'zone', zone: w.zone })
    }
    this.phase = 'walk'
    this.walkLeft = WALK_SEC
    this.waveTotal = 0
    this.waveSpawned = 0
  }

  private shopItems(): ShopItem[] {
    return UPGRADE_IDS.map((id, i) => {
      const level = this.world.upgrades[id]
      const max = level >= UPGRADES[id].max
      const cost = upgradeCost(id, level)
      return { n: i + 1, name: UPGRADES[id].name, effect: UPGRADES[id].effect, level, cost: max ? 0 : cost, can: !max && this.world.gold >= cost, votes: 0 }
    })
  }

  private shopView(): ShopView | null {
    const shop = this.shop
    if (!shop) return null
    const items = this.shopItems()
    for (const i of shop.votes.values()) if (items[i]) items[i]!.votes++
    return { items, left: Math.max(0, (shop.until - this.now) / 1000), total: SHOP_SEC }
  }

  /** Después de cada oleada: si hay algo que se pueda pagar, sale la tienda y el chat vota. */
  private openShop() {
    if (this.shop || !this.shopItems().some(i => i.can)) return
    this.shop = { until: this.now + SHOP_SEC * 1000, votes: new Map() }
  }

  /** Un voto de la tienda (el último de cada persona vale). Solo se puede votar lo que se puede pagar. */
  private vote(hero: Hero, index: number) {
    if (!this.shop || !this.shopItems()[index]?.can) return
    this.shop.votes.set(hero.rec.k, index)
  }

  /** Se acaba la votación: se compra la más votada (si hay empate, al azar entre las empatadas). */
  closeShop() {
    const shop = this.shop
    this.shop = null
    if (!shop) return
    const items = this.shopItems()
    const count = items.map(() => 0)
    for (const i of shop.votes.values()) if (items[i]?.can) count[i]!++
    const best = Math.max(0, ...count)
    if (!best) { this.fx.push({ t: 'noVote' }); return }
    const tied = count.flatMap((c, i) => (c === best ? [i] : []))
    const pick = tied[Math.floor(Math.random() * tied.length)]!
    this.buy(UPGRADE_IDS[pick]!, `${best} ${best === 1 ? 'voto' : 'votos'}`)
  }

  private buy(id: UpgradeId, by: string) {
    const level = this.world.upgrades[id]
    if (level >= UPGRADES[id].max) return
    const cost = upgradeCost(id, level)
    if (this.world.gold < cost) return
    this.world.gold -= cost
    this.world.upgrades[id] = level + 1
    if (id === 'armor') for (const h of this.heroes.values()) if (!h.ko) h.hp = this.maxHp(h)
    this.fx.push({ t: 'buy', name: UPGRADES[id].name, level: level + 1, by })
  }

  private describe(h: Hero) {
    if (!h.loaded) return 'Cargando…'
    const need = xpNeed(h.rec.level)
    return `Nv ${h.rec.level} · ${Math.floor((h.rec.xp / need) * 100)} % · ${fmt(h.rec.dmg)} de daño`
  }
}
