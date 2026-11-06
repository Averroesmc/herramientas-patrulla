/**
 * patrulla.averroeshosting.com: la barra de héroes del chat.
 *
 *   /                          el panel (pide la sesión de herramientas, con acceso a «patrulla»)
 *   /o/<clave>                 el overlay de OBS (sin login: la clave larga hace de contraseña)
 *   /api/panel…                lo que usa el panel
 *   /api/overlay…?key=<clave>  lo que usa el overlay: el mundo, los héroes, guardar, y leer YouTube y Kick
 *
 * El juego corre en el overlay; aquí solo se guarda. Todo va en la base de datos D1 de herramientas:
 *   · patrulla: una fila por cuenta de Discord, con la configuración, el mundo (zona, oro, mejoras,
 *     el día…), las órdenes del panel para el overlay y quién está guardando.
 *   · patrulla_heroes: un héroe por persona del chat (nivel, experiencia, daño hecho…).
 * Las dos tablas se crean solas. Las fórmulas y los tipos están en shared/game.ts.
 */
import { discordAvatar, readAccess, type Access } from './access.ts'
import { gate } from './gate.ts'
import { cachedLiveVideo, pollChat, startChat, type ChatSession } from './youtube.ts'
import {
  defaultConfig, initialWorld, parseConfig, parseOps, parseWorld, sanitizeConfig, sanitizeHero, sanitizeOp, sanitizeReaders, sanitizeWorld,
  HERO_KEY, type Config, type HeroRecord, type QueuedOp, type Readers, type World,
} from '../shared/game.ts'

interface Env {
  ASSETS: Fetcher
  DB: D1Database
  /** La clave de la API de YouTube (la misma del teatro, el bingo y retos). Sin ella, YouTube se lee por el método de reserva. */
  YOUTUBE_API_KEY?: string
}

const json = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } })

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
/** Si otro overlay ha guardado hace menos de esto, este no puede: hay dos jugando a la vez. */
const WRITER_MS = 25_000

/* ---------------------------------------------------------------- base de datos */

let schema: Promise<unknown> | null = null
function ensureSchema(db: D1Database) {
  schema ??= db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS patrulla (
      user_id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE,
      config TEXT NOT NULL, config_v INTEGER NOT NULL DEFAULT 1,
      world TEXT NOT NULL, epoch INTEGER NOT NULL DEFAULT 1,
      ops TEXT NOT NULL DEFAULT '[]', op_seq INTEGER NOT NULL DEFAULT 0,
      writer TEXT, writer_at INTEGER NOT NULL DEFAULT 0, readers TEXT,
      updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS patrulla_heroes (
      owner TEXT NOT NULL, k TEXT NOT NULL, p TEXT NOT NULL, name TEXT NOT NULL,
      level INTEGER NOT NULL, xp REAL NOT NULL, dmg REAL NOT NULL, kills INTEGER NOT NULL,
      first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY (owner, k))`),
    db.prepare('CREATE INDEX IF NOT EXISTS patrulla_heroes_rank ON patrulla_heroes (owner, level DESC, xp DESC)'),
  ]).catch((error: unknown) => { schema = null; throw error })
  return schema
}

type Row = {
  user_id: string; key: string; config: string; config_v: number; world: string; epoch: number
  ops: string; op_seq: number; writer: string | null; writer_at: number; readers: string | null
}
type HeroRow = { k: string; p: string; name: string; level: number; xp: number; dmg: number; kills: number; first_at: number; last_at: number }

const heroOf = (r: HeroRow): HeroRecord =>
  sanitizeHero({ k: r.k, p: r.p, name: r.name, level: r.level, xp: r.xp, dmg: r.dmg, kills: r.kills, first: r.first_at, last: r.last_at })!

async function rowFor(db: D1Database, where: { userId: string } | { key: string }) {
  return 'userId' in where
    ? db.prepare('SELECT * FROM patrulla WHERE user_id = ?').bind(where.userId).first<Row>()
    : db.prepare('SELECT * FROM patrulla WHERE key = ?').bind(where.key).first<Row>()
}

/** La fila de la persona; la primera vez se crea con la configuración por defecto y un mundo nuevo. */
async function ensureRow(db: D1Database, userId: string) {
  const now = Date.now()
  await db.prepare('INSERT OR IGNORE INTO patrulla (user_id, key, config, world, epoch, updated_at) VALUES (?, ?, ?, ?, 1, ?)')
    .bind(userId, crypto.randomUUID(), JSON.stringify(defaultConfig()), JSON.stringify(initialWorld(now, 1)), now).run()
}

/** El mundo guardado, con la época de la fila (la que manda). */
function worldOf(row: Row): World {
  const world = parseWorld(row.world)
  world.epoch = row.epoch
  return world
}

const HERO_COLS = '(owner, k, p, name, level, xp, dmg, kills, first_at, last_at)'
const heroValues = (owner: string, h: HeroRecord) => [owner, h.k, h.p, h.name, h.level, h.xp, h.dmg, h.kills, h.first || h.last, h.last]

/** Escribe héroes de golpe, de 9 en 9 (D1 admite 100 valores por consulta). */
function insertHeroes(db: D1Database, owner: string, heroes: HeroRecord[]) {
  const out: D1PreparedStatement[] = []
  for (let i = 0; i < heroes.length; i += 9) {
    const chunk = heroes.slice(i, i + 9)
    out.push(db.prepare(`INSERT OR REPLACE INTO patrulla_heroes ${HERO_COLS} VALUES ${chunk.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`)
      .bind(...chunk.flatMap(h => heroValues(owner, h))))
  }
  return out
}

/* ---------------------------------------------------------------- panel */

type Owner = { id: string; name: string; avatar: string }

async function panelView(env: Env, row: Row, access: Access, owner: Owner) {
  const [top, count] = await Promise.all([
    env.DB.prepare('SELECT * FROM patrulla_heroes WHERE owner = ? ORDER BY level DESC, xp DESC, dmg DESC LIMIT 15').bind(owner.id).all<HeroRow>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM patrulla_heroes WHERE owner = ?').bind(owner.id).first<{ n: number }>(),
  ])
  const now = Date.now()
  return {
    user: access.user,
    admin: access.admin,
    /** De quién es esta patrulla: la propia, o la de otra persona si admin la está editando. */
    owner,
    other: owner.id !== access.user.id,
    key: row.key,
    config: parseConfig(row.config),
    world: worldOf(row),
    overlay: { at: row.writer_at, readers: sanitizeReaders(JSON.parse(row.readers ?? '{}')) as Readers },
    pendingOps: parseOps(row.ops, now).filter(q => q.id > parseWorld(row.world).opSeen).length,
    top: top.results.map(heroOf),
    heroCount: count?.n ?? 0,
    now,
    youtubeKey: !!env.YOUTUBE_API_KEY,
  }
}

function sameOrigin(request: Request) {
  return request.headers.get('Origin') === new URL(request.url).origin
}

async function panel(request: Request, env: Env, pathname: string) {
  const access = await readAccess(request, env.DB)
  if (!access) return json({ error: 'sin sesión' }, 401)
  if (!access.tools.includes('patrulla')) return json({ error: 'sin acceso' }, 403)
  if (request.method !== 'GET' && !sameOrigin(request)) return json({ error: 'origen no permitido' }, 403)

  // Admin puede abrir la patrulla de cualquier persona (?persona=<id de Discord>) para dejársela hecha.
  let owner: Owner = { id: access.user.id, name: access.user.name, avatar: access.user.avatar }
  const persona = new URL(request.url).searchParams.get('persona')
  if (persona && persona !== access.user.id) {
    if (!access.admin) return json({ error: 'solo admin' }, 403)
    const who = await env.DB.prepare('SELECT id, username, name, avatar FROM users WHERE id = ?').bind(persona)
      .first<{ id: string; username: string; name: string | null; avatar: string | null }>()
    if (!who) return json({ error: 'no existe esa persona' }, 404)
    owner = { id: who.id, name: who.name || who.username || 'Sin nombre', avatar: discordAvatar(who.id, who.avatar) }
  }
  await ensureRow(env.DB, owner.id)
  const db = env.DB
  const view = async () => json(await panelView(env, (await rowFor(db, { userId: owner.id }))!, access, owner))

  if (pathname === '/api/panel' && request.method === 'GET') return view()

  if (pathname === '/api/panel/config' && request.method === 'PUT') {
    const body = await request.json<{ config?: unknown }>().catch(() => ({ config: undefined }))
    const row = (await rowFor(db, { userId: owner.id }))!
    const config = sanitizeConfig(body.config, parseConfig(row.config))
    await db.prepare('UPDATE patrulla SET config = ?, config_v = config_v + 1, updated_at = ? WHERE user_id = ?')
      .bind(JSON.stringify(config), Date.now(), owner.id).run()
    return view()
  }

  // Órdenes para el overlay (pruebas, día nuevo): se apuntan y el overlay las recoge al mirar.
  if (pathname === '/api/panel/ops' && request.method === 'POST') {
    const body = await request.json<{ ops?: unknown }>().catch(() => ({ ops: undefined }))
    const ops = (Array.isArray(body.ops) ? body.ops.slice(0, 10) : []).map(sanitizeOp).filter(o => o !== null)
    for (let attempt = 0; attempt < 5 && ops.length; attempt++) {
      const row = (await rowFor(db, { userId: owner.id }))!
      const now = Date.now()
      const list = parseOps(row.ops, now)
      let seq = row.op_seq
      for (const op of ops) list.push({ id: ++seq, at: now, op })
      const res = await db.prepare('UPDATE patrulla SET ops = ?, op_seq = ? WHERE user_id = ? AND op_seq = ?')
        .bind(JSON.stringify(list.slice(-30)), seq, owner.id, row.op_seq).run()
      if (res.meta.changes === 1) break
    }
    return view()
  }

  // Empezar de cero: mundo nuevo y sin héroes. La época sube, así que lo que guarde un overlay abierto ya no vale.
  if (pathname === '/api/panel/reset' && request.method === 'POST') {
    const row = (await rowFor(db, { userId: owner.id }))!
    const epoch = row.epoch + 1
    const now = Date.now()
    await db.batch([
      db.prepare('UPDATE patrulla SET world = ?, epoch = ?, ops = ?, writer = NULL, writer_at = 0, updated_at = ? WHERE user_id = ?')
        .bind(JSON.stringify(initialWorld(now, epoch)), epoch, '[]', now, owner.id),
      db.prepare('DELETE FROM patrulla_heroes WHERE owner = ?').bind(owner.id),
    ])
    return view()
  }

  if (pathname === '/api/panel/backup' && request.method === 'GET') {
    const row = (await rowFor(db, { userId: owner.id }))!
    const heroes = await db.prepare('SELECT * FROM patrulla_heroes WHERE owner = ? ORDER BY level DESC, xp DESC').bind(owner.id).all<HeroRow>()
    const day = new Date().toISOString().slice(0, 10)
    return json({ kind: 'patrulla', version: 1, at: Date.now(), config: parseConfig(row.config), world: worldOf(row), heroes: heroes.results.map(heroOf) }, 200, {
      'Content-Disposition': `attachment; filename="patrulla-${day}.json"`,
    })
  }

  if (pathname === '/api/panel/restore' && request.method === 'POST') {
    const body = await request.json<{ kind?: string; world?: unknown; heroes?: unknown; config?: unknown }>().catch(() => null)
    if (!body || body.kind !== 'patrulla' || !body.world || !Array.isArray(body.heroes)) return json({ error: 'no es una copia de la patrulla' }, 400)
    const heroes = body.heroes.slice(0, 50_000).map(sanitizeHero).filter(h => h !== null)
    const row = (await rowFor(db, { userId: owner.id }))!
    const epoch = row.epoch + 1
    const world = sanitizeWorld(body.world, initialWorld(Date.now(), epoch))
    world.epoch = epoch
    world.opSeen = row.op_seq
    const config = body.config ? sanitizeConfig(body.config, parseConfig(row.config)) : parseConfig(row.config)
    await db.batch([
      db.prepare('UPDATE patrulla SET world = ?, epoch = ?, config = ?, config_v = config_v + 1, writer = NULL, writer_at = 0, updated_at = ? WHERE user_id = ?')
        .bind(JSON.stringify(world), epoch, JSON.stringify(config), Date.now(), owner.id),
      db.prepare('DELETE FROM patrulla_heroes WHERE owner = ?').bind(owner.id),
      ...insertHeroes(db, owner.id, heroes),
    ])
    return view()
  }

  if (pathname === '/api/panel/key' && request.method === 'POST') {
    await db.prepare('UPDATE patrulla SET key = ?, writer = NULL, writer_at = 0 WHERE user_id = ?').bind(crypto.randomUUID(), owner.id).run()
    return view()
  }
  return json({ error: 'no encontrado' }, 404)
}

/* ---------------------------------------------------------------- Kick (copiado de retos) */

const kickCache = new Map<string, { id: string | null; at: number }>()

/** El número del chat de un canal de Kick. Kick a veces no deja preguntarlo desde un servidor: entonces null. */
async function kickChatroom(slug: string): Promise<string | null> {
  const key = slug.toLowerCase()
  const hit = kickCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.id
  let id: string | null = null
  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(key)}`, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36' },
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) id = String((await res.json<{ chatroom?: { id?: number } }>()).chatroom?.id ?? '') || null
  } catch { /* sin respuesta */ }
  kickCache.set(key, { id, at: Date.now() })
  return id
}

/**
 * La clave del chat de Kick (Pusher). Kick la cambia de vez en cuando, así que se le pregunta la actual,
 * como hace su propia web, y se guarda 10 minutos. Si no contesta, la última conocida.
 */
const KICK_FALLBACK = { appKey: '34bf7a0ff419a2a775b9', cluster: 'us2' }
let kickKey: { appKey: string; cluster: string; at: number } | null = null

async function kickCredentials(fresh: boolean) {
  if (!fresh && kickKey && Date.now() - kickKey.at < 10 * 60_000) return kickKey
  try {
    const res = await fetch('https://web.kick.com/api/v1/realtime/connection', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client: { id: crypto.randomUUID(), type: 'web' }, capabilities: { accepted_providers: [{ provider: 'pusher' }] } }),
      signal: AbortSignal.timeout(8000),
    })
    if (res.ok) {
      const body = await res.json<{ data?: { connections?: { provider?: string; credentials?: { app_key?: string; cluster?: string } }[] } }>()
      const found = body.data?.connections?.find(c => c.provider === 'pusher' && c.credentials?.app_key && c.credentials.cluster)
      if (found && /^[\w-]{8,64}$/.test(found.credentials!.app_key!) && /^[a-z0-9-]{2,20}$/.test(found.credentials!.cluster!)) {
        kickKey = { appKey: found.credentials!.app_key!, cluster: found.credentials!.cluster!, at: Date.now() }
        return kickKey
      }
    }
  } catch { /* sin respuesta: la última conocida */ }
  return kickKey ?? { ...KICK_FALLBACK, at: 0 }
}

/* ---------------------------------------------------------------- overlay */

async function overlay(request: Request, env: Env, pathname: string) {
  const url = new URL(request.url)
  const key = url.searchParams.get('key') ?? ''
  if (!KEY.test(key)) return json({ error: 'enlace no válido' }, 404)
  const db = env.DB
  const row = await rowFor(db, { key })
  if (!row) return json({ error: 'enlace no válido' }, 404)
  const now = Date.now()
  const config: Config = parseConfig(row.config)

  // Al arrancar: todo lo necesario para jugar.
  if (pathname === '/api/overlay' && request.method === 'GET') {
    return json({ config, cv: row.config_v, world: worldOf(row), ops: parseOps(row.ops, now), now })
  }

  // Cada pocos segundos: la configuración si ha cambiado, y las órdenes del panel.
  if (pathname === '/api/overlay/poll' && request.method === 'GET') {
    const cv = Number(url.searchParams.get('cv'))
    const ops: QueuedOp[] = parseOps(row.ops, now)
    return json({ cv: row.config_v, ...(cv === row.config_v ? {} : { config }), ops, epoch: row.epoch, now })
  }

  if (pathname === '/api/overlay/heroes' && request.method === 'POST') {
    const body = await request.json<{ keys?: unknown }>().catch(() => ({ keys: undefined }))
    const keys = (Array.isArray(body.keys) ? body.keys : []).filter((k): k is string => typeof k === 'string' && HERO_KEY.test(k)).slice(0, 100)
    const heroes: HeroRecord[] = []
    for (let i = 0; i < keys.length; i += 90) {
      const chunk = keys.slice(i, i + 90)
      const res = await db.prepare(`SELECT * FROM patrulla_heroes WHERE owner = ? AND k IN (${chunk.map(() => '?').join(', ')})`)
        .bind(row.user_id, ...chunk).all<HeroRow>()
      heroes.push(...res.results.map(heroOf))
    }
    return json({ heroes })
  }

  if (pathname === '/api/overlay/save' && request.method === 'POST') {
    const body = await request.json<{ writer?: unknown; world?: unknown; heroes?: unknown; readers?: unknown }>().catch(() => null)
    const writer = typeof body?.writer === 'string' ? body.writer.slice(0, 64) : ''
    if (!body || !writer || !body.world) return json({ error: 'faltan datos' }, 400)
    const incoming = sanitizeWorld(body.world, worldOf(row))
    // Se ha reiniciado o restaurado desde el panel: lo de este overlay es de antes.
    if (incoming.epoch !== row.epoch) return json({ error: 'stale' }, 409)
    // Otro overlay (otro navegador u ordenador) está jugando con este enlace.
    if (row.writer && row.writer !== writer && now - row.writer_at < WRITER_MS) return json({ error: 'busy' }, 409)
    const heroes = (Array.isArray(body.heroes) ? body.heroes.slice(0, 300) : []).map(sanitizeHero).filter(h => h !== null)
    const readers = sanitizeReaders(body.readers)
    // Los héroes solo se escriben si la época sigue siendo la misma (todo en la misma transacción).
    const upserts = heroes.map(h => db.prepare(`INSERT INTO patrulla_heroes ${HERO_COLS}
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM patrulla WHERE user_id = ? AND epoch = ?)
        ON CONFLICT (owner, k) DO UPDATE SET p = excluded.p, name = excluded.name, level = excluded.level, xp = excluded.xp,
          dmg = excluded.dmg, kills = excluded.kills, last_at = excluded.last_at`)
      .bind(...heroValues(row.user_id, h), row.user_id, row.epoch))
    const results = await db.batch([
      db.prepare('UPDATE patrulla SET world = ?, writer = ?, writer_at = ?, readers = ?, updated_at = ? WHERE user_id = ? AND epoch = ?')
        .bind(JSON.stringify(incoming), writer, now, JSON.stringify(readers), now, row.user_id, row.epoch),
      ...upserts,
    ])
    if (results[0]!.meta.changes !== 1) return json({ error: 'stale' }, 409)
    return json({ ok: true })
  }

  // Lo que necesita el overlay para leer YouTube y Kick.
  const channel = config.channels.youtube
  if (pathname === '/api/overlay/youtube' && request.method === 'GET') {
    const videoId = channel ? await cachedLiveVideo(channel).catch(() => null) : null
    return json({ key: env.YOUTUBE_API_KEY ?? null, channel, videoId })
  }
  if (pathname === '/api/overlay/youtube/start' && request.method === 'GET') {
    if (!channel) return json({ live: false })
    const session = await startChat(channel).catch(() => null)
    return json(session ? { live: true, session } : { live: false })
  }
  if (pathname === '/api/overlay/youtube/poll' && request.method === 'POST') {
    const body = await request.json<Partial<ChatSession> & { continuation?: string }>().catch((): Partial<ChatSession> & { continuation?: string } => ({}))
    if (typeof body.continuation !== 'string' || typeof body.clientVersion !== 'string') return json({ error: 'faltan datos' }, 400)
    const result = await pollChat({ clientVersion: body.clientVersion, visitorData: body.visitorData, apiKey: body.apiKey }, body.continuation)
    return json(result)
  }
  if (pathname === '/api/overlay/kick' && request.method === 'GET') {
    const slug = config.channels.kick.replace(/^https?:\/\/(www\.)?kick\.com\//i, '').replace(/[/?#].*$/, '').trim()
    if (!slug) return json({ slug: '', chatroomId: null })
    const { appKey, cluster } = await kickCredentials(url.searchParams.has('fresh'))
    return json({ slug, chatroomId: config.kickChatroom || (await kickChatroom(slug)), appKey, cluster })
  }
  return json({ error: 'no encontrado' }, 404)
}

/* ---------------------------------------------------------------- entrada */

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url)
    const { pathname } = url
    try {
      // El overlay de OBS: la misma página para todas las claves; la clave la lee el propio overlay.
      if (pathname.startsWith('/o/')) {
        return env.ASSETS.fetch(new Request(new URL('/overlay', url), request))
      }
      if (pathname.startsWith('/api/')) {
        await ensureSchema(env.DB)
        if (pathname === '/api/overlay' || pathname.startsWith('/api/overlay/')) return await overlay(request, env, pathname)
        if (pathname === '/api/panel' || pathname.startsWith('/api/panel/')) return await panel(request, env, pathname)
        return json({ error: 'no encontrado' }, 404)
      }
      // El panel: solo con sesión y acceso a «patrulla».
      if (pathname === '/' || pathname === '/index.html') {
        const blocked = await gate(request, env.DB, 'patrulla', 'Patrulla')
        if (blocked) return blocked
      }
      return env.ASSETS.fetch(request)
    } catch (error) {
      console.error(error)
      return json({ error: 'error interno' }, 500)
    }
  },
} satisfies ExportedHandler<Env>
