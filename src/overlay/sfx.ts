/**
 * Sonidos de 8 bits hechos al vuelo con el sintetizador del navegador: no hay archivos de audio.
 * En OBS suenan por la fuente del navegador («Controlar audio mediante OBS» para mezclarlos).
 * Copiado de retos.
 */

let ac: AudioContext | null = null
let volume = 0.7
let enabled = true

export function setSound(on: boolean, vol: number) {
  enabled = on
  volume = Math.max(0, Math.min(1, vol / 100))
}

function ctx() {
  ac ??= new AudioContext()
  if (ac.state === 'suspended') void ac.resume()
  return ac
}

const level = () => (enabled ? volume : 0)

function tone(freq: number, at: number, dur: number, type: OscillatorType = 'square', gain = 0.14, to?: number) {
  const v = level()
  if (!v) return
  const a = ctx()
  const t = a.currentTime + at
  const osc = a.createOscillator()
  const g = a.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t)
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain * v + 0.0001, t + 0.012)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  osc.connect(g).connect(a.destination)
  osc.start(t)
  osc.stop(t + dur + 0.03)
}

function noise(at: number, dur: number, gain: number, f1: number, f2: number) {
  const v = level()
  if (!v) return
  const a = ctx()
  const t = a.currentTime + at
  const n = Math.floor(a.sampleRate * dur)
  const buffer = a.createBuffer(1, n, a.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1
  const src = a.createBufferSource()
  const bp = a.createBiquadFilter()
  const g = a.createGain()
  src.buffer = buffer
  bp.type = 'bandpass'
  bp.Q.value = 1.2
  bp.frequency.setValueAtTime(f1, t)
  bp.frequency.exponentialRampToValueAtTime(f2, t + dur)
  g.gain.setValueAtTime(gain * v, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  src.connect(bp).connect(g).connect(a.destination)
  src.start(t)
}

/** Una nota a `s` semitonos del Do central. */
const note = (s: number) => 440 * 2 ** ((s - 9) / 12)

export const sfx = {
  crit() { noise(0, 0.08, 0.35, 3000, 600); tone(note(7), 0, 0.08, 'square', 0.08, note(19)) },
  hurt() { tone(160, 0, 0.09, 'square', 0.07, 90) },
  ko() { ;[4, 0, -5].forEach((s, i) => tone(note(s), i * 0.09, 0.12, 'triangle', 0.14)) },
  coin() { tone(note(23), 0, 0.06, 'square', 0.06); tone(note(28), 0.06, 0.12, 'square', 0.06) },
  level() { ;[0, 4, 7, 12].forEach((s, i) => tone(note(12 + s), i * 0.07, 0.14, 'square', 0.09)); tone(note(24), 0.3, 0.35, 'triangle', 0.16) },
  wave() { ;[0, 4, 7].forEach((s, i) => tone(note(12 + s), i * 0.1, 0.16, 'triangle', 0.16)) },
  zone() {
    ;[0, 4, 7, 12].forEach((s, i) => tone(note(12 + s), 0.05 + i * 0.11, 0.2, 'square', 0.11))
    ;[12, 16, 19, 24].forEach(s => tone(note(12 + s), 0.55, 0.8, 'square', 0.06))
    tone(note(0), 0.55, 0.8, 'triangle', 0.22)
  },
  join() { tone(note(19), 0, 0.05, 'square', 0.04); tone(note(26), 0.05, 0.07, 'square', 0.04) },
  buy() { tone(note(12), 0, 0.08, 'square', 0.1); tone(note(19), 0.08, 0.08, 'square', 0.1); tone(note(24), 0.16, 0.25, 'square', 0.1) },
  frenzy() { noise(0, 0.5, 0.3, 300, 3000); for (let i = 0; i < 6; i++) tone(note(12 + i * 2), i * 0.06, 0.08, 'sawtooth', 0.06) },
  meteor() { noise(0, 0.9, 0.35, 3500, 200); tone(900, 0, 0.6, 'sawtooth', 0.05, 120) },
  goldrain() { for (let i = 0; i < 8; i++) tone(note(24 + (i % 4) * 3), i * 0.07, 0.07, 'square', 0.05) },
  day() { tone(note(7), 0, 0.12, 'triangle', 0.18); tone(note(12), 0.14, 0.12, 'triangle', 0.18); tone(note(16), 0.28, 0.4, 'triangle', 0.18) },
}
