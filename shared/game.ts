/**
 * La patrulla: una barra abajo de la pantalla donde el chat entero va de aventura. Cada persona
 * que escribe sale como un héroe, los héroes pegan solos a los enemigos que llegan por la derecha,
 * ganan experiencia (cada uno la suya) y oro (de todos), y con el oro se compran mejoras.
 *
 * Aquí están los tipos, la configuración, el mundo guardado y todas las fórmulas, sin red ni
 * base de datos. Lo usan el servidor (worker/index.ts), el panel y el overlay de OBS.
 *
 * El juego solo avanza con el overlay abierto: cuando no hay directo el mundo está parado.
 */

export type Platform = 'twitch' | 'youtube' | 'kick'
export const PLATFORMS: Platform[] = ['twitch', 'youtube', 'kick']
export const PLATFORM_NAME: Record<Platform, string> = { twitch: 'Twitch', youtube: 'YouTube', kick: 'Kick' }
export type ReaderStatus = 'off' | 'connecting' | 'ok' | 'error'

/* ---------------------------------------------------------------- configuración */

export interface Config {
  enabled: Record<Platform, boolean>
  /** Canal de Twitch, canal de YouTube (@canal, enlace o id) y canal de Kick. */
  channels: Record<Platform, string>
  /** Si se sabe, el número del chat de Kick (por si Kick no deja buscarlo solo). */
  kickChatroom: string
  /** Alto de la barra y separación del borde de abajo, en píxeles de la escena de 1920×1080. */
  barHeight: number
  barBottom: number
  /** Paisaje pintado detrás de la patrulla; si no, solo el suelo y lo demás transparente. */
  scenery: boolean
  /** Modo discreto (para el Just Chatting): sin sonido y con menos avisos. */
  quiet: boolean
  sound: boolean
  volume: number
  /** Cuántos héroes caben a la vez en la barra; el resto espera en la taberna. */
  maxHeroes: number
  /**
   * Minutos sin escribir hasta que el héroe se va a la taberna (y deja de pegar). Hablar no da golpes:
   * solo hace falta estar activo, así no se premia llenar el chat.
   */
  idleMin: number
  /** Vida de los enemigos, en %: 100 es lo normal. */
  difficulty: number
  /** Oleadas que hay que superar para pasar a la zona siguiente. */
  wavesPerZone: number
  /** Subs, regalos, bits y Super Chats lanzan eventos (frenesí, meteoritos, lluvia de oro, bendición). */
  events: boolean
  /** Nombres que no juegan (bots y quien se quiera sacar), separados por comas. */
  ignore: string
}

export const DEFAULT_IGNORE = 'nightbot, streamelements, streamlabs, moobot, fossabot, wizebot, botrix, botrixoficial, kickbot, sery_bot, soundalerts, blerp, kofistreambot, pokemoncommunitygame, commanderroot'

export function defaultConfig(): Config {
  return {
    enabled: { twitch: true, youtube: false, kick: false },
    channels: { twitch: '', youtube: '', kick: '' },
    kickChatroom: '',
    barHeight: 120,
    barBottom: 0,
    scenery: true,
    quiet: false,
    sound: true,
    volume: 60,
    maxHeroes: 30,
    idleMin: 10,
    difficulty: 100,
    wavesPerZone: 10,
    events: true,
    ignore: DEFAULT_IGNORE,
  }
}

const clamp = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback
}
const num = (v: unknown, fallback = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const obj = (v: unknown) => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

function perPlatform<T>(raw: unknown, base: Record<Platform, T>, pick: (v: unknown, b: T) => T): Record<Platform, T> {
  const o = obj(raw)
  return { twitch: pick(o.twitch, base.twitch), youtube: pick(o.youtube, base.youtube), kick: pick(o.kick, base.kick) }
}

/** Mezcla lo que llega con la configuración actual: lo que no venga o no valga se queda como estaba. */
export function sanitizeConfig(raw: unknown, base: Config = defaultConfig()): Config {
  const o = obj(raw)
  return {
    enabled: perPlatform(o.enabled, base.enabled, (v, b) => bool(v, b)),
    channels: perPlatform(o.channels, base.channels, (v, b) => (typeof v === 'string' ? str(v, 200) : b)),
    kickChatroom: typeof o.kickChatroom === 'string' ? str(o.kickChatroom, 20).replace(/\D/g, '') : base.kickChatroom,
    barHeight: clamp(o.barHeight, 90, 200, base.barHeight),
    barBottom: clamp(o.barBottom, 0, 600, base.barBottom),
    scenery: bool(o.scenery, base.scenery),
    quiet: bool(o.quiet, base.quiet),
    sound: bool(o.sound, base.sound),
    volume: clamp(o.volume, 0, 100, base.volume),
    maxHeroes: clamp(o.maxHeroes, 5, 60, base.maxHeroes),
    idleMin: clamp(o.idleMin, 1, 60, base.idleMin),
    difficulty: clamp(o.difficulty, 25, 400, base.difficulty),
    wavesPerZone: clamp(o.wavesPerZone, 2, 40, base.wavesPerZone),
    events: bool(o.events, base.events),
    ignore: typeof o.ignore === 'string' ? str(o.ignore, 2000) : base.ignore,
  }
}

export function parseConfig(text: string | null | undefined): Config {
  try { return sanitizeConfig(JSON.parse(text ?? '{}')) } catch { return defaultConfig() }
}

/** Los nombres de la lista de ignorados, en minúsculas y sin @. */
export function ignoredNames(config: Pick<Config, 'ignore'>): Set<string> {
  return new Set(config.ignore.split(/[\s,;]+/).map(n => n.replace(/^@/, '').toLowerCase()).filter(Boolean))
}

/* ---------------------------------------------------------------- mejoras del grupo */

export type UpgradeId = 'forge' | 'banner' | 'armor' | 'campfire'
export const UPGRADE_IDS: UpgradeId[] = ['forge', 'banner', 'armor', 'campfire']

export interface Upgrade { id: UpgradeId; name: string; effect: string; base: number; growth: number; max: number }

export const UPGRADES: Record<UpgradeId, Upgrade> = {
  forge: { id: 'forge', name: 'Herrería', effect: '+15 % de daño', base: 100, growth: 1.75, max: 99 },
  banner: { id: 'banner', name: 'Estandarte', effect: '+20 % de oro', base: 80, growth: 1.7, max: 99 },
  armor: { id: 'armor', name: 'Armería', effect: '+20 % de vida', base: 120, growth: 1.75, max: 99 },
  campfire: { id: 'campfire', name: 'Hoguera', effect: 'los KO duran un 15 % menos', base: 90, growth: 1.9, max: 8 },
}

export const upgradeCost = (id: UpgradeId, level: number) => Math.round(UPGRADES[id].base * UPGRADES[id].growth ** level)

/* ---------------------------------------------------------------- fórmulas */

/** Cada cuánto pega solo un héroe, en segundos. */
export const HERO_SWING = 1.2
/** El frenesí multiplica el daño de todos. */
export const FRENZY_MULT = 2
export const FRENZY_SEC = 20
export const FRENZY_MAX_SEC = 90
/** Segundos que se queda KO un héroe sin mejoras de la hoguera. */
export const KO_SEC = 15
/** Cada cuánto pega un enemigo, en segundos. */
export const ENEMY_SWING = 2
/** Sin actividad este tiempo, el siguiente directo es otro día. */
export const NEW_DAY_MS = 3 * 3600_000

export const heroDamage = (level: number, forge: number) => 4 * 1.1 ** (level - 1) * 1.15 ** forge
export const heroMaxHp = (level: number, armor: number) => Math.round(40 * 1.1 ** (level - 1) * 1.2 ** armor)
/** Experiencia para pasar del nivel `level` al siguiente. */
export const xpNeed = (level: number) => Math.round(60 * 1.45 ** (level - 1))
export const koSeconds = (campfire: number) => KO_SEC * 0.85 ** campfire

/**
 * Vida de un enemigo. Crece con la zona y con la oleada, y con la gente que hay jugando (pero menos
 * que el daño que aportan): con mucho chat se va más rápido, con poco no se atasca.
 */
export const enemyHp = (zone: number, wave: number, heroes: number, difficulty: number) =>
  Math.round(70 * 1.17 ** zone * (1 + 0.04 * wave) * Math.max(1, heroes) ** 0.7 * (difficulty / 100))
export const enemyAttack = (zone: number, difficulty: number) => 6 * 1.2 ** zone * Math.sqrt(difficulty / 100)
export const enemiesInWave = (wave: number) => 10 + Math.floor(wave / 2)
export const killXp = (zone: number) => 1.8 * 1.3 ** zone
export const killGold = (zone: number, banner: number) => Math.round(2 * 1.25 ** zone * 1.2 ** banner)
export const waveGold = (zone: number, banner: number) => Math.round(15 * 1.25 ** zone * 1.2 ** banner)

/* ---------------------------------------------------------------- eventos (subs, regalos, bits, Super Chats) */

export type EventKind = 'frenzy' | 'meteor' | 'goldrain' | 'blessing'
export const EVENT_KINDS: EventKind[] = ['frenzy', 'meteor', 'goldrain', 'blessing']
export const EVENTS: Record<EventKind, { name: string; effect: string }> = {
  frenzy: { name: 'Frenesí', effect: 'doble de daño para todos un rato' },
  meteor: { name: 'Lluvia de meteoritos', effect: 'cae sobre los enemigos que haya delante' },
  goldrain: { name: 'Lluvia de oro', effect: 'oro para el grupo (como varias oleadas)' },
  blessing: { name: 'Bendición', effect: 'experiencia para todos, cura y levanta a los KO' },
}
/** Un regalo de tantas subs (o más) lanza todos los eventos a la vez. */
export const BIG_GIFT = 5

/* ---------------------------------------------------------------- zonas */

export interface Theme {
  name: string
  /** Cielo (arriba, abajo), montañas del fondo, cosas del medio, suelo (claro, oscuro), tierra. */
  sky: [string, string]
  far: string
  mid: string
  ground: [string, string]
  dirt: string
  prop: 'tree' | 'pine' | 'rock' | 'reed' | 'cactus' | 'snow' | 'lava' | 'pillar'
  enemies: { kind: EnemyKind; tint: string }[]
}

export type EnemyKind = 'slime' | 'bat' | 'mushroom' | 'goblin' | 'skeleton'

export const THEMES: Theme[] = [
  { name: 'Pradera', sky: ['#7ec8f2', '#c9ecff'], far: '#8fcf7a', mid: '#4f9e48', ground: ['#5cb85c', '#3f8f3f'], dirt: '#8a5a3c', prop: 'tree',
    enemies: [{ kind: 'slime', tint: '#5fd35f' }, { kind: 'mushroom', tint: '#e8453c' }] },
  { name: 'Bosque', sky: ['#4f8f86', '#9dd1b8'], far: '#2f6b4f', mid: '#1f4f38', ground: ['#3f8a4a', '#2b6435'], dirt: '#5e3d28', prop: 'pine',
    enemies: [{ kind: 'bat', tint: '#8e5bd6' }, { kind: 'mushroom', tint: '#3d7fe0' }, { kind: 'slime', tint: '#3fb7c9' }] },
  { name: 'Cueva', sky: ['#1b1d2a', '#343849'], far: '#2a2d3d', mid: '#454a5e', ground: ['#5b5f70', '#41444f'], dirt: '#2c2c35', prop: 'rock',
    enemies: [{ kind: 'bat', tint: '#c94f6d' }, { kind: 'skeleton', tint: '#e8e2cf' }] },
  { name: 'Pantano', sky: ['#5d6b4a', '#a3ad7c'], far: '#4d5a37', mid: '#36412a', ground: ['#5f7340', '#46572f'], dirt: '#3d3524', prop: 'reed',
    enemies: [{ kind: 'slime', tint: '#9b59b6' }, { kind: 'goblin', tint: '#7fb24a' }] },
  { name: 'Desierto', sky: ['#f2b06a', '#fde2b0'], far: '#e3a86b', mid: '#c98b4f', ground: ['#edc982', '#d4ab62'], dirt: '#a8794a', prop: 'cactus',
    enemies: [{ kind: 'goblin', tint: '#c9a35b' }, { kind: 'skeleton', tint: '#f3e9cf' }] },
  { name: 'Montaña helada', sky: ['#9fc4e8', '#e6f3ff'], far: '#c9dcef', mid: '#8fb0cf', ground: ['#f2f7fc', '#c8d8ea'], dirt: '#7d93ad', prop: 'snow',
    enemies: [{ kind: 'slime', tint: '#8fd8ff' }, { kind: 'goblin', tint: '#6f8fd8' }] },
  { name: 'Volcán', sky: ['#3a1414', '#8a2d1c'], far: '#4a1f1a', mid: '#2b1210', ground: ['#5a3a34', '#3d2622'], dirt: '#241413', prop: 'lava',
    enemies: [{ kind: 'slime', tint: '#ff7a1f' }, { kind: 'bat', tint: '#ff4a3d' }] },
  { name: 'Castillo oscuro', sky: ['#24183a', '#4c3a70'], far: '#33284d', mid: '#4a3d66', ground: ['#5d5470', '#433c54'], dirt: '#2a2536', prop: 'pillar',
    enemies: [{ kind: 'skeleton', tint: '#d9d2ff' }, { kind: 'goblin', tint: '#5e7a52' }] },
]

const ROMAN = ['', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X']
export const themeOf = (zone: number) => THEMES[((zone % THEMES.length) + THEMES.length) % THEMES.length]!
export function zoneName(zone: number) {
  const round = Math.floor(zone / THEMES.length)
  return `${themeOf(zone).name}${round ? ` ${ROMAN[round] ?? round + 1}` : ''}`
}
export const stageLabel = (zone: number, wave: number) => `${zone + 1}-${wave + 1}`

/* ---------------------------------------------------------------- el mundo guardado */

export interface TopEntry { k: string; name: string; dmg: number }

export interface Session {
  /** Qué día es (el número que se ve en la barra). */
  day: number
  startedAt: number
  /** Última vez que había alguien jugando. */
  lastAt: number
  heroes: number
  kills: number
  waves: number
  /** Quién ha hecho más daño hoy (los 20 primeros). */
  top: TopEntry[]
}

export interface Summary { day: number; mvp: TopEntry | null; heroes: number; kills: number; waves: number }

export interface World {
  /** Sube al reiniciar o restaurar una copia: lo que guarde un overlay de antes ya no vale. */
  epoch: number
  zone: number
  wave: number
  gold: number
  upgrades: Record<UpgradeId, number>
  /** La zona más lejana a la que se ha llegado. */
  best: number
  totals: { kills: number; waves: number; gold: number }
  session: Session
  yesterday: Summary | null
  /** La última orden del panel que ha hecho el overlay. */
  opSeen: number
}

export function initialWorld(now = Date.now(), epoch = 1): World {
  return {
    epoch,
    zone: 0,
    wave: 0,
    gold: 0,
    upgrades: { forge: 0, banner: 0, armor: 0, campfire: 0 },
    best: 0,
    totals: { kills: 0, waves: 0, gold: 0 },
    session: { day: 1, startedAt: now, lastAt: 0, heroes: 0, kills: 0, waves: 0, top: [] },
    yesterday: null,
    opSeen: 0,
  }
}

const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = num(v, NaN)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.floor(n))) : fallback
}

function sanitizeTop(raw: unknown): TopEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 20).flatMap(e => {
    const o = obj(e)
    const k = str(o.k, 80)
    return k ? [{ k, name: str(o.name, 40) || 'Héroe', dmg: Math.max(0, num(o.dmg)) }] : []
  })
}

function sanitizeSummary(raw: unknown): Summary | null {
  if (!raw || typeof raw !== 'object') return null
  const o = obj(raw)
  const mvp = sanitizeTop([o.mvp])[0] ?? null
  return { day: int(o.day, 1, 1e6, 1), mvp, heroes: int(o.heroes, 0, 1e7, 0), kills: int(o.kills, 0, 1e9, 0), waves: int(o.waves, 0, 1e7, 0) }
}

/** El mundo que llega del overlay o de una copia de seguridad, comprobado. */
export function sanitizeWorld(raw: unknown, base: World = initialWorld()): World {
  const o = obj(raw)
  const up = obj(o.upgrades)
  const totals = obj(o.totals)
  const s = obj(o.session)
  const zone = int(o.zone, 0, 9999, base.zone)
  return {
    epoch: int(o.epoch, 1, 1e9, base.epoch),
    zone,
    wave: int(o.wave, 0, 999, base.wave),
    gold: Math.max(0, Math.min(1e15, Math.floor(num(o.gold, base.gold)))),
    upgrades: {
      forge: int(up.forge, 0, UPGRADES.forge.max, base.upgrades.forge),
      banner: int(up.banner, 0, UPGRADES.banner.max, base.upgrades.banner),
      armor: int(up.armor, 0, UPGRADES.armor.max, base.upgrades.armor),
      campfire: int(up.campfire, 0, UPGRADES.campfire.max, base.upgrades.campfire),
    },
    best: Math.max(zone, int(o.best, 0, 9999, base.best)),
    totals: {
      kills: int(totals.kills, 0, 1e12, base.totals.kills),
      waves: int(totals.waves, 0, 1e9, base.totals.waves),
      gold: Math.max(0, Math.floor(num(totals.gold, base.totals.gold))),
    },
    session: {
      day: int(s.day, 1, 1e6, base.session.day),
      startedAt: Math.max(0, num(s.startedAt, base.session.startedAt)),
      lastAt: Math.max(0, num(s.lastAt, base.session.lastAt)),
      heroes: int(s.heroes, 0, 1e7, base.session.heroes),
      kills: int(s.kills, 0, 1e9, base.session.kills),
      waves: int(s.waves, 0, 1e7, base.session.waves),
      top: s.top === undefined ? base.session.top : sanitizeTop(s.top),
    },
    yesterday: o.yesterday === undefined ? base.yesterday : sanitizeSummary(o.yesterday),
    opSeen: int(o.opSeen, 0, 1e12, base.opSeen),
  }
}

export function parseWorld(text: string | null | undefined): World {
  try { return sanitizeWorld(JSON.parse(text ?? '{}')) } catch { return initialWorld() }
}

/**
 * Al abrir el overlay: si hace rato (NEW_DAY_MS) que no juega nadie, empieza otro día y lo de hoy
 * pasa a ser «ayer». Si el día anterior no jugó nadie, no cuenta como día.
 */
export function maybeNewDay(world: World, now: number, force = false): boolean {
  const s = world.session
  const stale = !s.lastAt || now - s.lastAt > NEW_DAY_MS
  if (!force && !stale) return false
  if (s.heroes > 0) {
    world.yesterday = { day: s.day, mvp: s.top[0] ?? null, heroes: s.heroes, kills: s.kills, waves: s.waves }
    world.session = { day: s.day + 1, startedAt: now, lastAt: 0, heroes: 0, kills: 0, waves: 0, top: [] }
    return true
  }
  world.session = { ...s, startedAt: now, lastAt: 0, kills: 0, waves: 0, top: [] }
  return false
}

/* ---------------------------------------------------------------- héroes guardados */

/** Un héroe tal como se guarda: uno por persona y plataforma (k = «t:<id>», «y:<id>» o «k:<id>»). */
export interface HeroRecord {
  k: string
  p: Platform
  name: string
  level: number
  xp: number
  /** Daño hecho en total: lo que lleva aportado. */
  dmg: number
  kills: number
  first: number
  last: number
}

export const HERO_KEY = /^[tyk]:[\w.@-]{1,70}$/

export function sanitizeHero(raw: unknown): HeroRecord | null {
  const o = obj(raw)
  const k = str(o.k, 80)
  if (!HERO_KEY.test(k)) return null
  const p = o.p === 'youtube' || o.p === 'kick' ? o.p : 'twitch'
  return {
    k,
    p,
    name: str(o.name, 40) || 'Héroe',
    level: int(o.level, 1, 999, 1),
    xp: Math.max(0, num(o.xp)),
    dmg: Math.max(0, num(o.dmg)),
    kills: int(o.kills, 0, 1e9, 0),
    first: Math.max(0, num(o.first)),
    last: Math.max(0, num(o.last)),
  }
}

/** Lo que se ve del héroe según su nivel: casco, capa, armadura dorada, aura. */
export const heroTier = (level: number) => (level >= 35 ? 4 : level >= 20 ? 3 : level >= 10 ? 2 : level >= 5 ? 1 : 0)

/* ---------------------------------------------------------------- comandos del chat */

export type Command = { type: 'me' }

/** El voto de la tienda: un mensaje que es solo el número de la mejora («2» o «!2»). Devuelve su índice (0 a 3). */
export function parseVote(text: string): number | null {
  const m = text.trim().match(/^!?([1-9])$/)
  const n = m ? Number(m[1]) : 0
  return n >= 1 && n <= UPGRADE_IDS.length ? n - 1 : null
}

/** Cuánto dura la votación de la tienda después de cada oleada. */
export const SHOP_SEC = 15

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function parseCommand(text: string): Command | null {
  const m = fold(text.trim()).match(/^!(\S+)\s*(.*)$/)
  if (!m) return null
  const word = m[1]!
  if (['yo', 'nivel', 'stats', 'heroe', 'me'].includes(word)) return { type: 'me' }
  return null
}

/* ---------------------------------------------------------------- órdenes del panel */

/** Lo que el panel le pide al overlay (pruebas). El overlay las recoge al mirar la configuración. */
export type SupportKind = 'sub' | 'gift' | 'bits' | 'superchat'
export const SUPPORT_KINDS: SupportKind[] = ['sub', 'gift', 'bits', 'superchat']

export type PanelOp =
  /** Bots: `n` héroes de prueba de nivel `level` (0 = al azar entre 1 y 9) que se quedan `minutes` minutos. No se guardan. */
  | { type: 'fake'; n: number; level: number; minutes: number; p: Platform }
  /** Un espectador falso escribe en el chat (también vale un comando: !yo, !tienda, !comprar 1). Si no existe, se crea. */
  | { type: 'say'; name: string; text: string; p: Platform }
  /** Una sub, un regalo (de `n` subs), bits o un Super Chat de alguien. */
  | { type: 'support'; kind: SupportKind; n: number; name: string }
  | { type: 'gold'; n: number }
  | { type: 'event'; kind: EventKind | 'all' }
  /** Salta a la zona `zone` (empezando en 0), a su primera oleada. */
  | { type: 'zone'; zone: number }
  /** Da la oleada por superada. */
  | { type: 'wave' }
  /** Deja KO a todos los héroes que estén en la barra. */
  | { type: 'ko' }
  /** Quita todos los bots. */
  | { type: 'clearBots' }
  | { type: 'newDay' }

export interface QueuedOp { id: number; at: number; op: PanelOp }

const platformOf = (v: unknown): Platform => (v === 'youtube' || v === 'kick' ? v : 'twitch')

export function sanitizeOp(raw: unknown): PanelOp | null {
  const o = obj(raw)
  switch (o.type) {
    case 'fake': return { type: 'fake', n: clamp(o.n, 1, 30, 5), level: clamp(o.level, 0, 99, 0), minutes: clamp(o.minutes, 1, 600, 3), p: platformOf(o.p) }
    case 'say': {
      const name = str(o.name, 40)
      const text = str(o.text, 200)
      return name && text ? { type: 'say', name, text, p: platformOf(o.p) } : null
    }
    case 'support': return {
      type: 'support',
      kind: SUPPORT_KINDS.includes(o.kind as SupportKind) ? (o.kind as SupportKind) : 'sub',
      n: clamp(o.n, 1, 9999, 1),
      name: str(o.name, 40) || 'Prueba',
    }
    case 'gold': return { type: 'gold', n: clamp(o.n, 1, 1e9, 100) }
    case 'event': return { type: 'event', kind: o.kind === 'all' || EVENT_KINDS.includes(o.kind as EventKind) ? (o.kind as EventKind | 'all') : 'frenzy' }
    case 'zone': return { type: 'zone', zone: clamp(o.zone, 0, 9999, 0) }
    case 'wave': return { type: 'wave' }
    case 'ko': return { type: 'ko' }
    case 'clearBots': return { type: 'clearBots' }
    case 'newDay': return { type: 'newDay' }
    default: return null
  }
}

/** Las órdenes que esperan: como mucho 30 y de los últimos 10 minutos. */
export const OP_TTL_MS = 10 * 60_000

export function parseOps(text: string | null | undefined, now: number): QueuedOp[] {
  try {
    const list = JSON.parse(text ?? '[]') as QueuedOp[]
    return Array.isArray(list) ? list.filter(q => q && typeof q.id === 'number' && now - q.at < OP_TTL_MS).slice(-30) : []
  } catch {
    return []
  }
}

/* ---------------------------------------------------------------- estado de los chats */

export interface Readers { twitch: ReaderStatus; youtube: ReaderStatus; kick: ReaderStatus; note: string }

export function sanitizeReaders(raw: unknown): Readers {
  const o = obj(raw)
  const st = (v: unknown): ReaderStatus => (v === 'connecting' || v === 'ok' || v === 'error' ? v : 'off')
  return { twitch: st(o.twitch), youtube: st(o.youtube), kick: st(o.kick), note: str(o.note, 300) }
}

/* ---------------------------------------------------------------- números */

/** 950 → «950», 1234 → «1,2K», 45600 → «45,6K», 1230000 → «1,23M». */
export function fmt(n: number): string {
  const v = Math.floor(n)
  if (Math.abs(v) < 1000) return String(v)
  const units = ['K', 'M', 'B', 'T', 'Qa', 'Qi']
  let x = v
  let i = -1
  while (Math.abs(x) >= 1000 && i < units.length - 1) { x /= 1000; i++ }
  const digits = Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2
  return `${x.toFixed(digits).replace(/\.?0+$/, '').replace('.', ',')}${units[i]}`
}
