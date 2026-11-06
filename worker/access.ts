/**
 * Sesión compartida de herramientas.averroeshosting.com.
 *
 * Este archivo se copia tal cual en cada herramienta (teatro, sorteos…): todas
 * usan la misma base de datos D1 y la misma cookie, que vale para todo
 * averroeshosting.com. Si cambias algo aquí, cópialo también en las demás.
 */

export const SESSION_COOKIE = 'herramientas_sesion'
export const HOME_URL = 'https://herramientas.averroeshosting.com'

export type Tool = 'sorteos' | 'teatro' | 'bingo' | 'analiticas' | 'tareas' | 'retos' | 'patrulla'

export type SessionUser = {
  id: string
  username: string
  name: string
  avatar: string
}

export type Access = {
  user: SessionUser
  admin: boolean
  tools: Tool[]
}

const ALL_TOOLS: Tool[] = ['sorteos', 'teatro', 'bingo', 'analiticas', 'tareas', 'retos', 'patrulla']

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function discordAvatar(id: string, hash: string | null): string {
  if (hash) return `https://cdn.discordapp.com/avatars/${id}/${hash}.png?size=128`
  const index = Number((BigInt(id) >> 22n) % 6n)
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`
}

type UserRow = { id: string; username: string; name: string | null; avatar: string | null; is_admin: number }

/** Quién está detrás de la petición y a qué tiene acceso; null si no hay sesión válida. */
export async function readAccess(request: Request, db: D1Database): Promise<Access | null> {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token) return null
  const row = await db
    .prepare(`SELECT u.id, u.username, u.name, u.avatar, u.is_admin
              FROM sessions s JOIN users u ON u.id = s.user_id
              WHERE s.token_hash = ? AND s.expires_at > ?`)
    .bind(await sha256(token), Date.now())
    .first<UserRow>()
  if (!row) return null

  const admin = row.is_admin === 1
  let tools = ALL_TOOLS
  if (!admin) {
    const { results } = await db.prepare('SELECT tool FROM permissions WHERE user_id = ?').bind(row.id).all<{ tool: Tool }>()
    tools = results.map(r => r.tool).filter(t => ALL_TOOLS.includes(t))
  }
  return {
    user: { id: row.id, username: row.username, name: row.name || row.username, avatar: discordAvatar(row.id, row.avatar) },
    admin,
    tools,
  }
}

/** Enlace para iniciar sesión y volver a `back` después. */
export function loginUrl(back: string): string {
  return `${HOME_URL}/auth/login?next=${encodeURIComponent(back)}`
}
