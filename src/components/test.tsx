import { useState } from 'react'
import { Button } from '@/components/arc/button/button'
import { Input } from '@/components/arc/input/input'
import { overlayOpen, type PanelData } from '@/lib/api'
import {
  BIG_GIFT, EVENTS, EVENT_KINDS, PLATFORMS, PLATFORM_NAME, THEMES, zoneName,
  type PanelOp, type Platform, type SupportKind,
} from '../../shared/game'

type Ops = (...ops: PanelOp[]) => Promise<void>

const SUPPORT_TEXT: Record<SupportKind, string> = { sub: 'Sub', gift: 'Regalo de subs', bits: 'Bits', superchat: 'Super Chat' }

/** Un número que se manda como texto hasta que se usa (así se puede borrar y escribir sin que salte). */
function Num({ label, value, set, min, max }: { label: string; value: string; set: (v: string) => void; min: number; max: number }) {
  return <Input label={label} type="number" inputMode="numeric" min={min} max={max} value={value} onChange={e => set(e.target.value)} />
}

function Choice<T extends string>({ label, value, set, options }: { label: string; value: T; set: (v: T) => void; options: [T, string][] }) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <select className="plain-select" value={value} onChange={e => set(e.target.value as T)}>
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </label>
  )
}

const num = (v: string, fallback: number) => (v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : fallback)

/** Todo para probar el juego sin chat: bots, mensajes, subs, eventos, saltar de zona… Se hace en el overlay de OBS. */
export function TestPanel({ data, ops }: { data: PanelData; ops: Ops }) {
  const open = overlayOpen(data)
  const [bots, setBots] = useState({ n: '5', level: '0', minutes: '5', p: 'twitch' as Platform })
  const [say, setSay] = useState({ name: 'Prueba', text: '!yo', p: 'twitch' as Platform })
  const [sup, setSup] = useState({ kind: 'sub' as SupportKind, n: '1', name: 'Prueba' })
  const [zone, setZone] = useState(String(data.world.zone + 1))
  const [gold, setGold] = useState('500')

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Probar</h2>
        <span className={`tag${open ? ' tag--ok' : ''}`}>{open ? 'Se hace en unos segundos' : 'Abre el overlay en OBS'}</span>
      </div>
      <p className="hint-text" style={{ marginTop: 0 }}>
        Los bots no se guardan y se van solos al acabar su tiempo, pero el oro, las oleadas y las zonas que se consigan sí cuentan. El overlay recoge las órdenes cada 3 s.
        {data.pendingOps > 0 && <> · <b>{data.pendingOps} pendiente{data.pendingOps === 1 ? '' : 's'}</b></>}
      </p>

      <div className="group">
        <h3 className="group__title">Bots</h3>
        <div className="fields fields--4">
          <Num label="Cuántos" value={bots.n} set={n => setBots({ ...bots, n })} min={1} max={30} />
          <Num label="Nivel (0 = al azar)" value={bots.level} set={level => setBots({ ...bots, level })} min={0} max={99} />
          <Num label="Minutos" value={bots.minutes} set={minutes => setBots({ ...bots, minutes })} min={1} max={600} />
          <Choice label="Plataforma" value={bots.p} set={p => setBots({ ...bots, p })} options={PLATFORMS.map(p => [p, PLATFORM_NAME[p]])} />
        </div>
        <div className="row-start">
          <Button size="sm" onClick={() => ops({ type: 'fake', n: num(bots.n, 5), level: num(bots.level, 0), minutes: num(bots.minutes, 5), p: bots.p })}>Meter bots</Button>
          <Button variant="secondary" size="sm" onClick={() => ops({ type: 'ko' })}>Dejar KO a todos</Button>
          <Button variant="ghost" size="sm" onClick={() => ops({ type: 'clearBots' })}>Quitar los bots</Button>
        </div>
        <p className="hint-text">El nivel cambia el aspecto: casco desde el 5, capa desde el 10, armadura dorada desde el 20 y aura desde el 35.</p>
      </div>

      <div className="group">
        <h3 className="group__title">Un espectador escribe</h3>
        <div className="fields fields--3">
          <Input label="Nombre" value={say.name} onChange={e => setSay({ ...say, name: e.target.value })} />
          <Input label="Mensaje" value={say.text} onChange={e => setSay({ ...say, text: e.target.value })} />
          <Choice label="Plataforma" value={say.p} set={p => setSay({ ...say, p })} options={PLATFORMS.map(p => [p, PLATFORM_NAME[p]])} />
        </div>
        <div className="row-start">
          <Button size="sm" disabled={!say.name.trim() || !say.text.trim()} onClick={() => ops({ type: 'say', name: say.name, text: say.text, p: say.p })}>Enviar</Button>
          {['!yo', '1', '2', '3', '4'].map(c => <Button key={c} variant="ghost" size="sm" onClick={() => setSay({ ...say, text: c })}>{c}</Button>)}
        </div>
        <p className="hint-text">Si ese nombre no existe, se crea como bot. Escribir saca de la taberna al héroe y lo pone el primero de la fila. Con la tienda abierta, un 1 a 4 es un voto: para probarla, suma oro, pasa la oleada y vota con varios bots.</p>
      </div>

      <div className="group">
        <h3 className="group__title">Subs, regalos, bits y Super Chats</h3>
        <div className="fields fields--3">
          <Choice label="Tipo" value={sup.kind} set={kind => setSup({ ...sup, kind, n: kind === 'bits' ? '500' : kind === 'gift' ? String(BIG_GIFT) : '1' })}
            options={(Object.keys(SUPPORT_TEXT) as SupportKind[]).map(k => [k, SUPPORT_TEXT[k]])} />
          <Num label={sup.kind === 'bits' ? 'Bits' : sup.kind === 'gift' ? 'Subs regaladas' : 'Cantidad'} value={sup.n} set={n => setSup({ ...sup, n })} min={1} max={9999} />
          <Input label="De quién" value={sup.name} onChange={e => setSup({ ...sup, name: e.target.value })} />
        </div>
        <div className="row-start">
          <Button size="sm" onClick={() => ops({ type: 'support', kind: sup.kind, n: num(sup.n, 1), name: sup.name })}>Simular</Button>
        </div>
        <p className="hint-text">Lanza un evento al azar, más fuerte cuanto más grande. Un regalo de {BIG_GIFT} subs o más los lanza todos; los bits cuentan desde 100.</p>
        <h3 className="group__title">Eventos sueltos</h3>
        <div className="row-start">
          {EVENT_KINDS.map(kind => <Button key={kind} variant="secondary" size="sm" onClick={() => ops({ type: 'event', kind })}>{EVENTS[kind].name}</Button>)}
          <Button variant="secondary" size="sm" onClick={() => ops({ type: 'event', kind: 'all' })}>Todos a la vez</Button>
        </div>
      </div>

      <div className="group">
        <h3 className="group__title">Aventura</h3>
        <div className="fields fields--3">
          <Choice label="Ir a la zona" value={zone} set={setZone}
            options={Array.from({ length: Math.max(24, data.world.best + 4) }, (_, i) => [String(i + 1), `${i + 1} · ${zoneName(i)}`] as [string, string])} />
          <Num label="Oro a sumar" value={gold} set={setGold} min={1} max={1_000_000_000} />
        </div>
        <div className="row-start">
          <Button size="sm" onClick={() => ops({ type: 'zone', zone: Math.max(0, num(zone, 1) - 1) })}>Ir a la zona</Button>
          <Button variant="secondary" size="sm" onClick={() => ops({ type: 'wave' })}>Pasar la oleada</Button>
          <Button variant="secondary" size="sm" onClick={() => ops({ type: 'gold', n: num(gold, 500) })}>Sumar oro</Button>
          <Button variant="secondary" size="sm" onClick={() => ops({ type: 'newDay' })}>Empezar día nuevo</Button>
        </div>
        <p className="hint-text">Hay {THEMES.length} paisajes distintos y luego se repiten (más difíciles). «Ir a la zona» sirve para ver cada fondo. El día cambia solo cuando pasan 3 horas sin que juegue nadie.</p>
      </div>
    </section>
  )
}
