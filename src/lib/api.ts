/** Las llamadas del panel al servidor (worker/index.ts, /api/panel…). */
import type { Config, HeroRecord, PanelOp, Readers, World } from '../../shared/game'

export type User = { id: string; username: string; name: string; avatar: string }
export type PanelData = {
  user: User
  admin: boolean
  /** De quién es la patrulla (la propia o, para admin, la de otra persona). */
  owner: { id: string; name: string; avatar: string }
  other: boolean
  key: string
  config: Config
  world: World
  /** Última vez que el overlay guardó (0 si nunca) y cómo van sus chats. */
  overlay: { at: number; readers: Readers }
  /** Órdenes del panel que el overlay aún no ha hecho. */
  pendingOps: number
  top: HeroRecord[]
  heroCount: number
  now: number
  youtubeKey: boolean
}

/** Con ?persona=<id> admin abre la patrulla de otra persona. */
const persona = new URLSearchParams(location.search).get('persona')
export const withPersona = (path: string) => (persona ? `${path}?persona=${encodeURIComponent(persona)}` : path)

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

async function call(path: string, init?: RequestInit): Promise<PanelData> {
  const res = await fetch(withPersona(path), { credentials: 'same-origin', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const data = (await res.json().catch(() => ({}))) as PanelData & { error?: string }
  if (!res.ok) throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status)
  return data
}

export const fetchPanel = () => call('/api/panel')
export const saveConfig = (config: Partial<Config>) => call('/api/panel/config', { method: 'PUT', body: JSON.stringify({ config }) })
export const sendOps = (...ops: PanelOp[]) => call('/api/panel/ops', { method: 'POST', body: JSON.stringify({ ops }) })
export const resetWorld = () => call('/api/panel/reset', { method: 'POST' })
export const restoreBackup = (backup: unknown) => call('/api/panel/restore', { method: 'POST', body: JSON.stringify(backup) })
export const newKey = () => call('/api/panel/key', { method: 'POST' })
export const backupUrl = () => withPersona('/api/panel/backup')

/** El overlay está abierto si ha guardado hace poco (guarda cada 10 s). */
export const overlayOpen = (data: PanelData) => !!data.overlay.at && data.now - data.overlay.at < 40_000

export const overlayUrl = (key: string) => `${location.origin}/o/${key}`
export const HOME = 'https://herramientas.averroeshosting.com'
