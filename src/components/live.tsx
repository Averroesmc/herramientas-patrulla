import { useEffect, useRef, useState } from 'react'
import { Check, Copy, RefreshCw } from 'lucide-react'
import { Button } from '@/components/arc/button/button'
import { newKey, overlayOpen, overlayUrl, type PanelData } from '@/lib/api'
import {
  BIG_GIFT, EVENTS, EVENT_KINDS, PLATFORMS, PLATFORM_NAME, SHOP_SEC, UPGRADES, UPGRADE_IDS, fmt, stageLabel, upgradeCost, xpNeed, zoneName,
  type ReaderStatus,
} from '../../shared/game'

const STATUS_TEXT: Record<ReaderStatus, string> = { off: 'apagado', connecting: 'conectando…', ok: 'leyendo', error: 'con problemas' }
const dotClass = (s: ReaderStatus) => (s === 'ok' ? 'is-live' : s === 'connecting' ? 'is-connecting' : s === 'error' ? 'is-error' : '')

const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `hace ${s} s`
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`
  return `hace ${Math.round(s / 86400)} d`
}

/** El enlace para OBS, la vista previa (solo la parte de abajo, donde va la barra) y cómo va cada chat. */
export function ObsPanel({ data, accept, notify }: { data: PanelData; accept: (d: PanelData) => void; notify: (t: string, d?: string) => void }) {
  const [copied, setCopied] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const url = overlayUrl(data.key)
  const open = overlayOpen(data)
  const readers = data.overlay.readers
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  useEffect(() => {
    const el = frame.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const scale = width / 1920
  // Se ve la barra y un poco por encima (los avisos salen ahí).
  const visible = Math.min(1080, data.config.barBottom + data.config.barHeight + 300)

  const copy = async () => {
    await navigator.clipboard.writeText(url).catch(() => undefined)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }
  const regenerate = async () => {
    if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 4000); return }
    setConfirm(false)
    try { accept(await newKey()); notify('Enlace nuevo', 'Pega el enlace nuevo en OBS: el anterior ya no funciona') } catch { notify('No se pudo cambiar el enlace') }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Overlay para OBS</h2>
        <span className={`tag${open ? ' tag--ok' : ''}`}>{open ? 'Abierto en OBS' : data.overlay.at ? `Cerrado · última vez ${ago(data.now - data.overlay.at)}` : 'Aún no se ha abierto'}</span>
      </div>
      <div className="preview" ref={frame} style={{ height: visible * scale }}>
        <iframe title="Vista previa del overlay" src={`/o/${data.key}?preview=1`} style={{ transform: `scale(${scale})`, top: -(1080 - visible) * scale }} />
      </div>
      <p className="hint-text">Vista previa con héroes de prueba: no lee el chat ni guarda nada.</p>
      <div className="link-row">
        <code className="link" title={url}>{url}</code>
        <Button variant="secondary" size="sm" onClick={copy}>{copied ? <><Check size={15} /> Copiado</> : <><Copy size={15} /> Copiar</>}</Button>
      </div>
      <p className="hint-text">En OBS: <b>Fuente de navegador</b> de 1920 × 1080 con este enlace, encima de todo. Para tenerla en varias escenas (el inicio y el Just Chatting), añádela en las demás con <b>«Añadir fuente existente»</b>: así es la misma partida. Activa «Controlar audio mediante OBS» para oír los sonidos. No compartas el enlace.</p>
      <div className="chats">
        {PLATFORMS.map(p => {
          const on = data.config.enabled[p] && !!data.config.channels[p].trim()
          const status: ReaderStatus = !on || !open ? 'off' : readers[p]
          return (
            <span key={p} className={`chat-chip is-${p}`} title={on ? '' : 'Apagado o sin canal en la configuración'}>
              <span className={`status-dot ${dotClass(status)}`} />{PLATFORM_NAME[p]} <small>{on ? (open ? STATUS_TEXT[status] : 'overlay cerrado') : 'apagado'}</small>
            </span>
          )
        })}
      </div>
      {open && readers.note && <p className="hint-text">{readers.note}</p>}
      {!data.youtubeKey && data.config.enabled.youtube && <p className="hint-text">YouTube se lee sin clave de la API (método de reserva).</p>}
      <div className="row-end">
        <Button variant="ghost" size="sm" onClick={regenerate}><RefreshCw size={15} /> {confirm ? 'Pulsa otra vez para cambiarlo' : 'Cambiar enlace'}</Button>
      </div>
    </section>
  )
}

/** Cómo va la aventura: el día, la zona, el oro, las mejoras y los botones de prueba. */
export function AdventurePanel({ data }: { data: PanelData }) {
  const w = data.world
  const y = w.yesterday
  const s = w.session
  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">La aventura</h2>
        <span className="tag">Día {s.day}</span>
      </div>
      <div className="stats">
        <div className="stat"><small>Zona</small><strong>{zoneName(w.zone)}</strong><span>{stageLabel(w.zone, w.wave)} · oleada {w.wave + 1} de {data.config.wavesPerZone}</span></div>
        <div className="stat"><small>Oro</small><strong className="is-gold">{fmt(w.gold)}</strong><span>{fmt(w.totals.gold)} ganado en total</span></div>
        <div className="stat"><small>Hoy</small><strong>{s.heroes} {s.heroes === 1 ? 'héroe' : 'héroes'}</strong><span>{s.waves} oleadas · {fmt(s.kills)} enemigos</span></div>
        <div className="stat"><small>En total</small><strong>{fmt(w.totals.kills)}</strong><span>enemigos · {fmt(w.totals.waves)} oleadas</span></div>
      </div>
      {s.top.length > 0 && <p className="hint-text">MVP de hoy: <b>{s.top[0]!.name}</b> ({fmt(s.top[0]!.dmg)} de daño).</p>}
      {y && <p className="hint-text">Ayer (día {y.day}): {y.heroes} héroes, {y.waves} oleadas{y.mvp ? <> · MVP <b>{y.mvp.name}</b> ({fmt(y.mvp.dmg)} de daño)</> : null}.</p>}

      <h3 className="group__title">Mejoras del grupo</h3>
      <ul className="upgrades">
        {UPGRADE_IDS.map((id, i) => {
          const u = UPGRADES[id]
          const level = w.upgrades[id]
          const max = level >= u.max
          return (
            <li key={id}>
              <span className="upgrades__n">{i + 1}</span>
              <span className="upgrades__text"><b>{u.name}</b> <small>nivel {level}</small><em>{u.effect}</em></span>
              <span className="upgrades__cost">{max ? 'Máximo' : `${fmt(upgradeCost(id, level))} de oro`}</span>
            </li>
          )
        })}
      </ul>
      <p className="hint-text">Se compran con el oro de todos: después de cada oleada sale la tienda en el overlay y el chat vota escribiendo <code>1</code> a <code>4</code> durante {SHOP_SEC} s. Se compra la más votada (solo se puede votar lo que se pueda pagar).</p>

    </section>
  )
}

/** Los héroes con más nivel. */
export function HeroesPanel({ data }: { data: PanelData }) {
  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Héroes</h2>
        <span className="tag">{data.heroCount} en total</span>
      </div>
      {data.top.length ? (
        <ol className="heroes">
          {data.top.map((h, i) => (
            <li key={h.k}>
              <span className="heroes__n">{i + 1}</span>
              <span className="heroes__name"><span className={`dot is-${h.p}`} title={PLATFORM_NAME[h.p]} />{h.name}</span>
              <span className="heroes__lv">Nv {h.level}<small>{Math.floor((h.xp / xpNeed(h.level)) * 100)} %</small></span>
              <span className="heroes__dmg">{fmt(h.dmg)}<small>daño</small></span>
              <span className="heroes__seen">{ago(data.now - h.last)}</span>
            </li>
          ))}
        </ol>
      ) : <p className="hint-text">Todavía no ha jugado nadie. Cuando alguien escriba en el chat con el overlay abierto, saldrá aquí.</p>}
      <p className="hint-text">Cada persona tiene su héroe en cada plataforma. Con el nivel cambia de aspecto: casco a partir del 5, capa a partir del 10, armadura dorada a partir del 20 y aura a partir del 35.</p>
    </section>
  )
}

/** Los comandos del chat, para ponerlos en el bot o en un panel del canal. */
export function CommandsPanel({ data }: { data: PanelData }) {
  const c = data.config
  return (
    <section className="panel">
      <h2 className="panel__title">Comandos del chat</h2>
      <ul className="commands">
        <li><span><b>Hablar en el chat</b></span><span>Tu héroe sale de la taberna, se pone el primero de la fila y pega solo mientras sigas activo. Tras {c.idleMin} min sin escribir, vuelve a la taberna y deja de pegar. Escribir más no da más golpes: solo hace falta estar.</span></li>
        <li><code>!yo</code><span>Tu nivel y el daño que llevas, encima de tu héroe.</span></li>
        <li><span><code>1</code> a <code>4</code></span><span>Solo cuando sale la tienda (después de cada oleada): votas qué mejora se compra con el oro de todos (1 Herrería, 2 Estandarte, 3 Armería, 4 Hoguera). Gana la más votada.</span></li>
      </ul>
      <p className="hint-text">Subs, regalos, bits (desde 100) y Super Chats lanzan un <b>evento</b> al azar{c.events ? '' : ' (ahora están apagados en la configuración)'}: {EVENT_KINDS.map(k => EVENTS[k].name.toLowerCase()).join(', ')}. Un regalo de {BIG_GIFT} subs o más lanza todos a la vez. Quien apoya se lleva además experiencia extra.</p>
    </section>
  )
}
