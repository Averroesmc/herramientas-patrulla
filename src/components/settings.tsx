import { useRef, useState } from 'react'
import { Download, RotateCcw, Upload } from 'lucide-react'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { backupUrl, resetWorld, restoreBackup, type PanelData } from '@/lib/api'
import { DEFAULT_IGNORE, PLATFORMS, PLATFORM_NAME, type Config, type Platform } from '../../shared/game'

type Patch = (change: Partial<Config>) => void

function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="switch-row">
      <span className="switch-row__text"><span>{label}</span>{description && <small>{description}</small>}</span>
      <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)}><span /></button>
    </label>
  )
}

/** Un número que se guarda al dejar de escribir (no a cada tecla, para no guardar «1» mientras se escribe «15»). */
function NumberField({ label, value, min, max, onCommit, description }: { label: string; value: number; min: number; max: number; onCommit: (v: number) => void; description?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const n = Math.round(Number(draft))
    if (Number.isFinite(n) && draft.trim() !== '') onCommit(Math.min(max, Math.max(min, n)))
    setDraft(null)
  }
  return (
    <Input label={label} type="number" inputMode="numeric" min={min} max={max} description={description}
      value={draft ?? String(value)} onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
  )
}

function TextField({ label, value, onCommit, placeholder, description }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string; description?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => { if (draft !== null && draft !== value) onCommit(draft.trim()); setDraft(null) }
  return (
    <Input label={label} value={draft ?? value} placeholder={placeholder} description={description}
      onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} />
  )
}

function Range({ label, value, min, max, step = 1, unit = '', onChange }: { label: string; value: number; min: number; max: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <label className="range">
      <span>{label} <b>{value}{unit}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
    </label>
  )
}

const CHANNEL_HINT: Record<Platform, { label: string; placeholder: string }> = {
  twitch: { label: 'Canal de Twitch', placeholder: 'nombre del canal' },
  youtube: { label: 'Canal de YouTube', placeholder: '@canal, enlace del canal o del directo' },
  kick: { label: 'Canal de Kick', placeholder: 'nombre del canal' },
}

export function SettingsPanel({ data, patch }: { data: PanelData; patch: Patch }) {
  const c = data.config
  const per = <K extends 'enabled' | 'channels'>(key: K, p: Platform, value: Config[K][Platform]) =>
    patch({ [key]: { ...c[key], [p]: value } } as Partial<Config>)
  const [ignore, setIgnore] = useState<string | null>(null)

  return (
    <section className="panel">
      <h2 className="panel__title">Configuración</h2>

      <div className="group">
        <h3 className="group__title">Plataformas</h3>
        {PLATFORMS.map(p => (
          <div key={p} className={`platform is-${p}${c.enabled[p] ? '' : ' is-off'}`}>
            <Switch label={PLATFORM_NAME[p]} checked={c.enabled[p]} onChange={v => per('enabled', p, v)}
              description={p === 'kick' ? 'Se lee el chat público de Kick (no oficial): si Kick lo cambia puede fallar.' : undefined} />
            {c.enabled[p] && (
              <div className="fields">
                <TextField label={CHANNEL_HINT[p].label} placeholder={CHANNEL_HINT[p].placeholder} value={c.channels[p]} onCommit={v => per('channels', p, v)} />
                {p === 'kick' && <TextField label="Número del chat de Kick (si no lo encuentra solo)" placeholder="opcional" value={c.kickChatroom} onCommit={v => patch({ kickChatroom: v.replace(/\D/g, '') })} />}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="group">
        <h3 className="group__title">La barra</h3>
        <Range label="Alto" value={c.barHeight} min={90} max={200} step={2} unit=" px" onChange={v => patch({ barHeight: v })} />
        <NumberField label="Separación del borde de abajo (px)" value={c.barBottom} min={0} max={600} onCommit={v => patch({ barBottom: v })}
          description="Por si tienes algo abajo del todo en la escena. En píxeles de 1920 × 1080." />
        <Switch label="Paisaje" description="Cielo, montañas y árboles detrás. Si lo apagas, solo se ve el suelo y lo demás es transparente." checked={c.scenery} onChange={v => patch({ scenery: v })} />
        <Switch label="Modo discreto" description="Para el Just Chatting: sin sonido y con menos avisos (sin oleadas superadas ni «falta oro»)." checked={c.quiet} onChange={v => patch({ quiet: v })} />
      </div>

      <div className="group">
        <h3 className="group__title">El juego</h3>
        <div className="fields">
          <NumberField label="Héroes a la vez en la barra" value={c.maxHeroes} min={5} max={60} onCommit={v => patch({ maxHeroes: v })} description="El resto espera en la taberna." />
          <NumberField label="Minutos hasta irse a la taberna" value={c.idleMin} min={1} max={60} onCommit={v => patch({ idleMin: v })} description="Sin escribir en el chat." />
          <NumberField label="Segundos entre dos golpes fuertes" value={c.attackSec} min={1} max={60} onCommit={v => patch({ attackSec: v })} description="Cada mensaje es un golpe; así escribir mucho no da más." />
          <NumberField label="Oleadas por zona" value={c.wavesPerZone} min={2} max={40} onCommit={v => patch({ wavesPerZone: v })} description="Con 10, más o menos una zona por directo." />
        </div>
        <Range label="Dificultad (vida de los enemigos)" value={c.difficulty} min={25} max={400} step={5} unit=" %" onChange={v => patch({ difficulty: v })} />
        <Switch label="Eventos con subs, regalos, bits y Super Chats" description="Frenesí, lluvia de meteoritos, lluvia de oro o bendición, al azar. Más fuertes cuanto más grande el apoyo." checked={c.events} onChange={v => patch({ events: v })} />
        <label className="textarea-field">
          <span>Quién no juega</span>
          <textarea rows={3} value={ignore ?? c.ignore} onChange={e => setIgnore(e.target.value)}
            onBlur={() => { if (ignore !== null && ignore !== c.ignore) patch({ ignore }); setIgnore(null) }} />
          <small>Bots y gente que quieras sacar del juego, separados por comas.{c.ignore !== DEFAULT_IGNORE && <> <button type="button" className="link-button" onClick={() => patch({ ignore: DEFAULT_IGNORE })}>Lista por defecto</button></>}</small>
        </label>
      </div>

      <div className="group">
        <h3 className="group__title">Sonido</h3>
        <Switch label="Sonidos" description={c.quiet ? 'En modo discreto no suena nada.' : undefined} checked={c.sound} onChange={v => patch({ sound: v })} />
        {c.sound && <Range label="Volumen" value={c.volume} min={0} max={100} unit=" %" onChange={v => patch({ volume: v })} />}
      </div>
    </section>
  )
}

/** Descargar o restaurar una copia de todo, y empezar de cero. */
export function BackupPanel({ data, accept, notify }: { data: PanelData; accept: (d: PanelData) => void; notify: (t: string, d?: string) => void }) {
  const file = useRef<HTMLInputElement>(null)
  const [confirm, setConfirm] = useState<0 | 1 | 2>(0)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const restore = async (f: File) => {
    try {
      const backup = JSON.parse(await f.text())
      if (!window.confirm('¿Restaurar esta copia? Se cambia todo lo de ahora (mundo y héroes) por lo de la copia.')) return
      accept(await restoreBackup(backup))
      notify('Copia restaurada', 'El overlay la carga solo en unos segundos')
    } catch {
      notify('No se pudo restaurar', 'Elige un archivo descargado con «Descargar copia»')
    }
  }
  const reset = async () => {
    clearTimeout(timer.current)
    if (confirm < 2) {
      setConfirm(confirm === 0 ? 1 : 2)
      timer.current = setTimeout(() => setConfirm(0), 5000)
      return
    }
    setConfirm(0)
    try { accept(await resetWorld()); notify('Empezamos de cero', 'Día 1, zona 1 y todos los héroes a nivel 1') } catch { notify('No se pudo reiniciar') }
  }

  return (
    <section className="panel">
      <h2 className="panel__title">Copia de seguridad</h2>
      <p className="hint-text">Una copia con todo: el mundo, los {data.heroCount} héroes y la configuración. Conviene descargarla de vez en cuando.</p>
      <div className="row-start">
        <a className="button-link" href={backupUrl()} download><Download size={15} /> Descargar copia</a>
        <Button variant="secondary" size="sm" onClick={() => file.current?.click()}><Upload size={15} /> Restaurar copia</Button>
        <input ref={file} type="file" accept="application/json,.json" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void restore(f) }} />
      </div>
      <div className="danger-zone">
        <div>
          <strong>Empezar de cero</strong>
          <p className="hint-text">Vuelve al día 1 y a la primera zona, sin oro ni mejoras, y borra todos los héroes. Descarga antes una copia.</p>
        </div>
        <Button variant="danger" size="sm" onClick={reset}><RotateCcw size={15} /> {confirm === 0 ? 'Empezar de cero' : confirm === 1 ? '¿Seguro? Pulsa otra vez' : 'Última vez: se borra todo'}</Button>
      </div>
    </section>
  )
}
