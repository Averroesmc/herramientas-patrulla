/**
 * Los dibujos pixelados: héroes (12×16) y enemigos, hechos con código a partir de mapas de letras
 * (como las pociones de retos). Cada sprite se pinta una vez en un canvas pequeño y luego se copia.
 * Los colores de cada héroe salen de su nombre, así cada persona tiene siempre el mismo aspecto.
 */
import type { EnemyKind } from '../../shared/game'
import { artEnemy, artHero } from './arte'

type RGB = [number, number, number]
const hexRgb = (h: string): RGB => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)) as RGB
const toHex = (c: RGB) => `#${c.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
export const shade = (h: string, f: number) => {
  const c = hexRgb(h)
  return toHex((f < 0 ? c.map(v => v * (1 + f)) : c.map(v => v + (255 - v) * f)) as RGB)
}

/** Pinta un mapa de letras en un canvas de su tamaño × px. */
function paint(map: string[], colors: Record<string, string>, px: number, white = false): HTMLCanvasElement {
  const w = Math.max(...map.map(r => r.length))
  const cv = document.createElement('canvas')
  cv.width = w * px
  cv.height = map.length * px
  const ctx = cv.getContext('2d')!
  map.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = colors[row[x]!]
      if (!c) continue
      ctx.fillStyle = white ? '#ffffff' : c
      ctx.fillRect(x * px, y * px, px, px)
    }
  })
  return cv
}

/* ---------------------------------------------------------------- héroes */

// h pelo · s piel · e ojo · t/T túnica (luz/sombra) · b cinturón · p pantalón · f botas · m/M casco · c capa
const HERO_TOP = [
  '....hhhhh...',
  '...hhhhhhh..',
  '...hhssssh..',
  '...hsssess..',
  '....sssss...',
  '....tttt....',
  '...tttttt...',
  '..sTttttts..',
  '...Ttttt....',
  '...TTttt....',
  '...bbbbbb...',
]
const LEGS = {
  stand: ['...ppp.pp...', '...pp..pp...', '...pp..pp...', '..fff..fff..', '............'],
  walkA: ['...pppppp...', '..pp....pp..', '.pp......pp.', '.ff......ff.', '............'],
  walkB: ['....ppp.....', '....pp.p....', '....pp.pp...', '...fff.ff...', '............'],
}
const HELMET = ['....MMMMM...', '...MmmmmmM..', '...MmssssM..']
const CAPE_ROWS: Record<number, string> = { 6: '.cc', 7: 'cc', 8: 'ccc', 9: 'ccc', 10: 'ccc', 11: '.cc', 12: '.cc' }

const HAIR = ['#2b1d14', '#5a3418', '#8a5426', '#c98a3a', '#e8d06a', '#d8d8d8', '#b8352b', '#3b5bdb', '#8e44ad', '#18a589', '#f08cb3', '#141414']
const SKIN = ['#f6d5b4', '#eec39a', '#e0ac69', '#c68642', '#8d5524', '#ffdcb5']
const TUNIC = ['#d9433a', '#2f80ed', '#27ae60', '#f2994a', '#9b51e0', '#e84393', '#16a3b8', '#f2c94c', '#6c8ead', '#b5651d', '#7a4bd1', '#ea5455']
const PANTS = ['#3a3a52', '#4a3426', '#2d4a3a', '#2a2f45', '#503a5a']

/** Las piezas de un héroe: sus colores y su mano (donde se agarra la espada), en píxeles del dibujo. */
export interface HeroSprite { frames: HTMLCanvasElement[]; white: HTMLCanvasElement[]; w: number; h: number; hand: [number, number]; blade: string; hilt: string; /** Dibujado (la espada va en su dibujo y tiene pose de ataque, la 3). */ art?: boolean }

export const HERO_W = 12
export const HERO_H = 16

export function heroSprite(seed: number, tier: number, px: number): HeroSprite {
  const pick = <T,>(list: T[], salt: number) => list[Math.floor(seed / salt) % list.length]!
  const drawn = artHero(px, tier, { hair: pick(HAIR, 7), skin: pick(SKIN, 97), tunic: pick(TUNIC, 1), pants: pick(PANTS, 389), cape: shade(pick(TUNIC, 2593), -0.15) })
  if (drawn) return { ...drawn, hand: [0, 0], blade: '', hilt: '', art: true }
  const tunic = tier >= 3 ? '#f0c419' : pick(TUNIC, 1)
  const colors: Record<string, string> = {
    h: pick(HAIR, 7), s: pick(SKIN, 97), e: '#1a1a24',
    t: tunic, T: shade(tunic, -0.3),
    b: tier >= 3 ? '#8b1d1d' : '#5b3a1e', p: pick(PANTS, 389), f: '#2a1c14',
    m: tier >= 3 ? '#ffe680' : '#c3cad6', M: tier >= 3 ? '#c9952b' : '#7d8696',
    c: tier >= 3 ? '#c0182f' : shade(pick(TUNIC, 2593), -0.15),
  }
  const build = (legs: string[]) => {
    const rows = [...HERO_TOP, ...legs]
    if (tier >= 1) HELMET.forEach((r, i) => { rows[i] = r })
    if (tier >= 2) {
      for (const [y, cape] of Object.entries(CAPE_ROWS)) {
        const row = rows[Number(y)]!.split('')
        for (let i = 0; i < cape.length; i++) if (cape[i] === 'c' && row[i] === '.') row[i] = 'c'
        rows[Number(y)] = row.join('')
      }
    }
    return rows
  }
  const maps = [build(LEGS.stand), build(LEGS.walkA), build(LEGS.walkB)]
  return {
    frames: maps.map(m => paint(m, colors, px)),
    white: maps.map(m => paint(m, colors, px, true)),
    w: HERO_W * px,
    h: HERO_H * px,
    hand: [9.5, 7.5],
    blade: tier >= 3 ? '#fff4b8' : tier >= 1 ? '#e6edf5' : '#c9ced6',
    hilt: tier >= 3 ? '#c0182f' : '#d4a52a',
  }
}

/* ---------------------------------------------------------------- enemigos (miran a la izquierda) */

// o contorno · b cuerpo · l luz · d sombra · e ojo · p pupila · w blanco · m boca · k marrón · g gris
const ENEMIES: Record<EnemyKind, string[][]> = {
  slime: [[
    '..............',
    '.....oooo.....',
    '...oollbbo....',
    '..olllbbbbo...',
    '.olbbbbbbbbo..',
    '.obpebbpebbbo.',
    'obbeebbeebbbbo',
    'obbbbbbbbbbbbo',
    'obbbmmmbbbbbdo',
    '.obbbbbbbbbddo',
    '..oooooooooo..',
  ], [
    '..............',
    '..............',
    '....oooooo....',
    '..oollbbbbo...',
    '.olllbbbbbbo..',
    'obpebbpebbbbo.',
    'obeebbeebbbbbo',
    'obbbbbbbbbbbbo',
    'obbbmmmbbbbbdo',
    'obbbbbbbbbbddo',
    '.oooooooooooo.',
  ]],
  bat: [[
    'o..............o',
    'oo....o..o....oo',
    'obo..obooobo.obo',
    'obbo.obbbbbo.obbo',
    'obbbobpebpebobbbo',
    '.obbbbbbbbbbbbbo.',
    '..oobbmwwmbbboo..',
    '....oobbbbboo....',
    '......ooooo......',
  ], [
    '.................',
    '......o..o.......',
    '.....obooobo.....',
    '.....obbbbbo.....',
    '..oooobpebpeoooo.',
    '.obbbbbbbbbbbbbbo',
    'obbbbbmwwmbbbbbbo',
    'obbo.oobbbbboobbo',
    'oo.....ooooo...oo',
  ]],
  mushroom: [[
    '....oooooo....',
    '..oobbwbbboo..',
    '.obwwbbbbwwbo.',
    'obbbbbbwbbbbbo',
    'obwbbbbbbbbwbo',
    'oddddddddddddo',
    '.oooggggggooo.',
    '...ogpeggpeo..',
    '...oggggggo...',
    '...oggmmggo...',
    '...ogggggggo..',
    '..oogggggggoo.',
    '..ooooooooooo.',
  ], [
    '..............',
    '....oooooo....',
    '..oobbwbbboo..',
    '.obwwbbbbwwbo.',
    'obbbbbbwbbbbbo',
    'obwbbbbbbbbwbo',
    'oddddddddddddo',
    '.oooggggggooo.',
    '...ogpeggpeo..',
    '...oggggggo...',
    '...oggmmggo...',
    '..oogggggggoo.',
    '..ooooooooooo.',
  ]],
  goblin: [[
    '..k.........',
    '.kkk........',
    '.kkk.oooo...',
    '..k.obbbbo..',
    '..kobpebpbo.',
    '..kobbbbbbbo',
    'obbobmmmbbo.',
    '..k.obbbbo..',
    '..koddddddo.',
    '..obdddddbo.',
    '...odddddo..',
    '...obo.obo..',
    '...obo.obo..',
    '..oooo.oooo.',
  ], [
    '............',
    '.k..........',
    'kkk..oooo...',
    'kkk.obbbbo..',
    '.k.obpebpbo.',
    '.k.obbbbbbbo',
    'obbobmmmbbo.',
    '.k..obbbbo..',
    '..koddddddo.',
    '..obdddddbo.',
    '...odddddo..',
    '...obo.obo..',
    '..obo...obo.',
    '.oooo...oooo',
  ]],
  skeleton: [[
    '....oooo....',
    '...obbbbo...',
    '..obobbobo..',
    '..obbbbbbo..',
    '...obmbmo...',
    '....oboo....',
    'g..obbbbo...',
    'g.obobbobo..',
    'gooobbbbobo.',
    'g...obobo...',
    '....obbbo...',
    '....ob.bo...',
    '....ob.bo...',
    '...oob.boo..',
  ], [
    '............',
    '....oooo....',
    '...obbbbo...',
    '..obobbobo..',
    '..obbbbbbo..',
    '...obmbmo...',
    '.g..oboo....',
    '.g.obbbbo...',
    '.gobobbobo..',
    '.go.obbbbo..',
    '....obobo...',
    '....obbbo...',
    '...ob...bo..',
    '..oob...boo.',
  ]],
}

export interface EnemySprite { frames: HTMLCanvasElement[]; white: HTMLCanvasElement[]; w: number; h: number }

const enemyCache = new Map<string, EnemySprite>()

export function enemySprite(kind: EnemyKind, tint: string, px: number): EnemySprite {
  const key = `${kind}|${tint}|${px}`
  const hit = enemyCache.get(key)
  if (hit) return hit
  const drawn = artEnemy(kind, tint, px)
  if (drawn) { enemyCache.set(key, drawn); return drawn }
  const bone = kind === 'skeleton'
  const colors: Record<string, string> = {
    o: '#14121a', b: tint, l: shade(tint, 0.45), d: shade(tint, -0.3), e: '#ffffff', p: '#14121a',
    w: '#ffffff', m: bone ? '#14121a' : shade(tint, -0.55), k: '#7a4a24', g: '#b8c0cc',
  }
  if (kind === 'mushroom') { colors.g = '#f3e6cf'; colors.e = '#14121a'; colors.p = '#14121a' }
  if (kind === 'skeleton') { colors.e = '#14121a' }
  const maps = ENEMIES[kind]
  const out: EnemySprite = {
    frames: maps.map(m => paint(m, colors, px)),
    white: maps.map(m => paint(m, colors, px, true)),
    w: Math.max(...maps[0]!.map(r => r.length)) * px,
    h: maps[0]!.length * px,
  }
  enemyCache.set(key, out)
  return out
}

/* ---------------------------------------------------------------- iconos */

const COIN = ['.oooo.', 'oyyyyo', 'oyhyyo', 'oyhyyo', 'oyyyyo', '.oooo.']
const MUG = ['.oooo..', 'owwwwo.', 'oyyyyoo', 'oyyyyo.o', 'oyyyyo.o', 'oyyyyoo.', 'oooooo..']

export const coinIcon = (px: number) => paint(COIN, { o: '#7a4a00', y: '#ffcc33', h: '#fff2a8' }, px)
export const mugIcon = (px: number) => paint(MUG, { o: '#3a2412', w: '#ffffff', y: '#f2a81d' }, px)
