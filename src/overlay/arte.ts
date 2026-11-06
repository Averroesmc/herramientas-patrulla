/**
 * Los héroes y enemigos dibujados (public/arte/sprites, hechos con scripts/preparar-sprites.py): tiras de poses
 * de celdas iguales. Aquí se cargan, se trocean y se recolorean:
 *   · cada héroe con sus colores (pelo, piel, túnica y pantalón salen de su nombre) y, según su nivel,
 *     casco, capa y armadura dorada;
 *   · cada enemigo con el tono de su zona.
 * Si una imagen no carga, se usa el dibujo hecho con código de sprites.ts.
 */
import type { EnemyKind } from '../../shared/game'

/** Cuántas poses tiene cada tira (el mismo número que en scripts/preparar-sprites.py). */
const SHEETS = { heroe: 4, slime: 2, murcielago: 2, seta: 2, goblin: 2, esqueleto: 2 } as const
type Sheet = keyof typeof SHEETS
const ENEMY_SHEET: Record<EnemyKind, Sheet> = { slime: 'slime', bat: 'murcielago', mushroom: 'seta', goblin: 'goblin', skeleton: 'esqueleto' }

/** Las poses de cada tira, ya troceadas (colores originales). */
const cells = new Map<Sheet, ImageData[]>()

export interface ArtSprite { frames: HTMLCanvasElement[]; white: HTMLCanvasElement[]; w: number; h: number }
export interface ArtHeroColors { hair: string; skin: string; tunic: string; pants: string; cape: string }

/** Carga las imágenes (como mucho 4 s: si tardan, el juego empieza con los dibujos de código). */
export function preloadArt(): Promise<void> {
  const one = (name: Sheet) => new Promise<void>(resolve => {
    const img = new Image()
    img.onload = () => {
      const n = SHEETS[name]
      const cw = Math.floor(img.naturalWidth / n)
      const cv = document.createElement('canvas')
      cv.width = cw
      cv.height = img.naturalHeight
      const ctx = cv.getContext('2d', { willReadFrequently: true })!
      const out: ImageData[] = []
      for (let i = 0; i < n; i++) {
        ctx.clearRect(0, 0, cw, cv.height)
        ctx.drawImage(img, -i * cw, 0)
        out.push(ctx.getImageData(0, 0, cw, cv.height))
      }
      cells.set(name, out)
      resolve()
    }
    img.onerror = () => resolve()
    img.src = `/arte/sprites/${name}.png`
  })
  const all = Promise.all((Object.keys(SHEETS) as Sheet[]).map(one)).then(() => undefined)
  return Promise.race([all, new Promise<void>(resolve => setTimeout(resolve, 4000))])
}

/* ---------------------------------------------------------------- color */

type HSL = [number, number, number]

function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [h * 60, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v] }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number) => {
    t = (t + 1) % 1
    return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p
  }
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)]
}

const hexHsl = (hex: string): HSL => rgbToHsl(parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16))
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const between = (v: number, lo: number, hi: number) => v >= lo && v <= hi

/** Recorre los píxeles visibles de una pose; `fn` devuelve el color nuevo (HSL) o null para dejarlo como está. */
function recolor(src: ImageData, fn: (h: number, s: number, l: number, fy: number) => HSL | null): ImageData {
  const out = new ImageData(new Uint8ClampedArray(src.data), src.width, src.height)
  const d = out.data
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const i = (y * src.width + x) * 4
      if (d[i + 3]! < 20) continue
      const [h, s, l] = rgbToHsl(d[i]!, d[i + 1]!, d[i + 2]!)
      if (l < 0.16) continue // el contorno oscuro no cambia
      const next = fn(h, s, l, y / src.height)
      if (!next) continue
      const [r, g, b] = hslToRgb(next[0], clamp(next[1], 0, 1), clamp(next[2], 0, 1))
      d[i] = r; d[i + 1] = g; d[i + 2] = b
    }
  }
  return out
}

/** Una pose, escalada a `scale` sin suavizar (píxeles nítidos), con su versión blanca para el destello de los golpes. */
function toFrames(poses: ImageData[], scale: number, under?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): ArtSprite {
  const w = Math.max(1, Math.round(poses[0]!.width * scale))
  const h = Math.max(1, Math.round(poses[0]!.height * scale))
  const frames: HTMLCanvasElement[] = []
  const white: HTMLCanvasElement[] = []
  for (const pose of poses) {
    const tmp = document.createElement('canvas')
    tmp.width = pose.width
    tmp.height = pose.height
    tmp.getContext('2d')!.putImageData(pose, 0, 0)
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    const ctx = cv.getContext('2d')!
    ctx.imageSmoothingEnabled = false
    under?.(ctx, w, h)
    ctx.drawImage(tmp, 0, 0, w, h)
    const wc = document.createElement('canvas')
    wc.width = w
    wc.height = h
    const wctx = wc.getContext('2d')!
    wctx.imageSmoothingEnabled = false
    wctx.drawImage(tmp, 0, 0, w, h)
    wctx.globalCompositeOperation = 'source-in'
    wctx.fillStyle = '#ffffff'
    wctx.fillRect(0, 0, w, h)
    frames.push(cv)
    white.push(wc)
  }
  return { frames, white, w, h }
}

/* ---------------------------------------------------------------- héroes */

/**
 * El héroe dibujado con sus colores. `tier`: 0 normal, 1 casco, 2 casco y capa, 3 armadura dorada, 4 con aura
 * (el aura la pone view.ts). `px` es el tamaño del píxel de la barra (3 normal): el dibujo se escala con él.
 * Las poses: 0 parado, 1 y 2 pasos, 3 ataque. null si la imagen no ha cargado.
 */
export function artHero(px: number, tier: number, c: ArtHeroColors): ArtSprite | null {
  const poses = cells.get('heroe')
  if (!poses) return null
  const [Hh, Hs, Hl] = hexHsl(c.hair)
  const [Sh, Ss, Sl] = hexHsl(c.skin)
  const [Th, Ts, Tl] = hexHsl(tier >= 3 ? '#f0c419' : c.tunic)
  const [Ph, Ps, Pl] = hexHsl(c.pants)
  const painted = poses.map(p => recolor(p, (h, s, l, fy) => {
    if (between(h, 200, 260) && s > 0.35) return [Th, s * Ts / 0.75, l * Tl / 0.5 + (tier >= 3 ? 0.08 : 0)] // túnica azul
    if (fy < 0.4 && between(h, 5, 45) && s > 0.35 && l < 0.55) { // pelo marrón (o casco)
      if (tier >= 3) return [46, 0.75, 0.35 + l * 0.8]
      if (tier >= 1) return [215, 0.1, 0.4 + l * 0.5]
      return [Hh, Hs, l * Hl / 0.32]
    }
    if (fy < 0.6 && between(h, 8, 45) && s > 0.3 && l >= 0.62) return [Sh, Ss, l * Sl / 0.82] // piel
    if (fy > 0.55 && fy < 0.86 && between(h, 30, 55) && s > 0.2 && l > 0.5) return [Ph, Ps, l * Pl / 0.62] // pantalón
    return null
  }))
  const scale = px / 3
  const cape = tier >= 2
    ? (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      // La capa cuelga por detrás (a la izquierda: el héroe mira a la derecha).
      const [ch, cs, cl] = hexHsl(tier >= 3 ? '#c0182f' : c.cape)
      const [r, g, b] = hslToRgb(ch, cs, cl)
      ctx.fillStyle = '#14121a'
      ctx.beginPath(); ctx.moveTo(w * 0.46, h * 0.38); ctx.lineTo(w * 0.1, h * 0.88); ctx.lineTo(w * 0.5, h * 0.9); ctx.closePath(); ctx.fill()
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.beginPath(); ctx.moveTo(w * 0.45, h * 0.42); ctx.lineTo(w * 0.15, h * 0.85); ctx.lineTo(w * 0.47, h * 0.86); ctx.closePath(); ctx.fill()
    }
    : undefined
  return toFrames(painted, scale, cape)
}

/* ---------------------------------------------------------------- enemigos */

/** Cada enemigo con el tono de su zona (`tint`); el esqueleto se queda hueso. null si la imagen no ha cargado. */
export function artEnemy(kind: EnemyKind, tint: string, px: number): ArtSprite | null {
  const poses = cells.get(ENEMY_SHEET[kind])
  if (!poses) return null
  const [Th, Ts] = hexHsl(tint)
  const body = (h: number, s: number): boolean => {
    switch (kind) {
      case 'slime': return between(h, 85, 160) && s > 0.4
      case 'bat': return between(h, 250, 330) && s > 0.25
      case 'mushroom': return (h <= 15 || h >= 345) && s > 0.6
      case 'goblin': return between(h, 70, 140) && s > 0.35
      default: return false
    }
  }
  const painted = kind === 'skeleton' ? poses : poses.map(p => recolor(p, (h, s, l) => (body(h, s) ? [Th, s * Math.min(1, Ts / 0.8), l] : null)))
  return toFrames(painted, px / 3)
}
