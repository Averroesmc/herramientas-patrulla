/** Las llamadas del overlay de OBS al servidor (worker/index.ts, /api/overlay…). */
import type { Config, HeroRecord, QueuedOp, Readers, World } from '../../shared/game'

export class HttpError extends Error {
  status: number
  code: string
  constructor(message: string, status: number, code: string) { super(message); this.status = status; this.code = code }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new HttpError(data.error ?? `HTTP ${res.status}`, res.status, data.error ?? '')
  return data
}

const q = (key: string, extra = '') => `?key=${encodeURIComponent(key)}${extra}`

export type Boot = { config: Config; cv: number; world: World; ops: QueuedOp[]; now: number }
export type Poll = { cv: number; config?: Config; ops: QueuedOp[]; epoch: number; now: number }

/** Todo lo necesario para empezar: configuración, mundo y órdenes del panel pendientes. */
export const boot = (key: string) => call<Boot>(`/api/overlay${q(key)}`)

/** Cada pocos segundos: la configuración (si ha cambiado) y las órdenes del panel. */
export const poll = (key: string, cv: number) => call<Poll>(`/api/overlay/poll${q(key, `&cv=${cv}`)}`)

/** El nivel y lo aportado de quienes acaban de aparecer. */
export const loadHeroes = (key: string, keys: string[]) =>
  call<{ heroes: HeroRecord[] }>(`/api/overlay/heroes${q(key)}`, { method: 'POST', body: JSON.stringify({ keys }) })

/** `release`: el overlay se cierra y deja guardar a otro enseguida (al recargar la fuente de OBS, por ejemplo). */
export type SaveBody = { writer: string; world: World; heroes: HeroRecord[]; readers: Readers; release?: boolean }

export const save = (key: string, body: SaveBody, keepalive = false) =>
  call<{ ok: true }>(`/api/overlay/save${q(key)}`, { method: 'POST', body: JSON.stringify(body), keepalive })

export const overlayApi = <T>(key: string, path: string, init?: RequestInit) => {
  const [route, extra] = path.split('?')
  return call<T>(`/api/overlay${route}${q(key, extra ? `&${extra}` : '')}`, init)
}
