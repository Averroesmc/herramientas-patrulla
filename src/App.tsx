import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Swords } from 'lucide-react'
import { Avatar } from '@/components/arc/avatar/avatar'
import Toast from '@/components/arc/toast/toast'
import { ThemeToggle } from '@/components/theme-toggle'
import { AdventurePanel, CommandsPanel, HeroesPanel, ObsPanel } from '@/components/live'
import { BackupPanel, SettingsPanel } from '@/components/settings'
import { ApiError, fetchPanel, HOME, saveConfig, sendOps, type PanelData } from '@/lib/api'
import type { Config, PanelOp } from '../shared/game'

type Notice = { key: number; title: string; description?: string }

export default function App() {
  const [data, setData] = useState<PanelData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [saving, setSaving] = useState(false)
  const pending = useRef<Partial<Config>>({})

  const notify = useCallback((title: string, description?: string) => setNotice({ key: Date.now(), title, description }), [])
  // Lo que llega del servidor, sin pisar lo que se está escribiendo y aún no se ha guardado.
  const accept = useCallback((next: PanelData) => setData({ ...next, config: { ...next.config, ...pending.current } }), [])

  // Cada 4 s se mira cómo va (lo que guarda el overlay: zona, oro, héroes, chats).
  useEffect(() => {
    let stop = false
    let timer: ReturnType<typeof setTimeout>
    const tick = async () => {
      try {
        accept(await fetchPanel())
        setError(null)
      } catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404)) { setError(e.message); return }
      }
      if (!stop) timer = setTimeout(tick, 4000)
    }
    void tick()
    return () => { stop = true; clearTimeout(timer) }
  }, [accept])

  const ops = useCallback(async (...list: PanelOp[]) => {
    try { accept(await sendOps(...list)) } catch { notify('No se pudo hacer', 'Vuelve a intentarlo') }
  }, [accept, notify])

  // La configuración se guarda sola al cambiar algo (solo lo que cambia).
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const patch = useCallback((change: Partial<Config>) => {
    setData(d => (d ? { ...d, config: { ...d.config, ...change } } : d))
    pending.current = { ...pending.current, ...change }
    clearTimeout(saveTimer.current)
    setSaving(true)
    saveTimer.current = setTimeout(async () => {
      const body = pending.current
      try {
        const next = await saveConfig(body)
        pending.current = {}
        accept(next)
      } catch {
        pending.current = {}
        notify('No se ha guardado', 'Revisa la conexión y vuelve a cambiarlo')
      }
      setSaving(false)
    }, 500)
  }, [accept, notify])

  return (
    <div className="app">
      <header className="nav">
        <a className="brand" href={HOME} title="Volver a herramientas">
          <span className="brand__mark"><Swords size={18} /></span>Patrulla
        </a>
        <span className="save-state">{saving ? 'Guardando…' : data ? 'Todo guardado' : ''}</span>
        <div className="nav__actions">
          <ThemeToggle />
          {data && <span className="who"><Avatar name={data.user.name} src={data.user.avatar} size="sm" /><span className="who__name">{data.user.name}</span></span>}
        </div>
      </header>

      <main className="main">
        {error ? (
          <section className="panel empty"><strong>No se puede abrir</strong>{error}<a className="back-link" href={HOME}><ArrowLeft size={16} /> Volver a herramientas</a></section>
        ) : !data ? (
          <div className="loading"><span className="spinner" /></div>
        ) : (
          <div className="view">
            {data.other && (
              <div className="other-banner">
                <Avatar name={data.owner.name} src={data.owner.avatar} size="sm" />
                <span>Estás editando la patrulla de <strong>{data.owner.name}</strong>. Lo que cambies aquí es su configuración y su overlay.</span>
                <a href="/">Volver a la mía</a>
              </div>
            )}
            <section className="hero hero--patrulla">
              <div className="hero__blobs" aria-hidden="true" />
              <div className="hero__copy">
                <span className="hero__eyebrow">Héroes del chat</span>
                <h1 className="hero__title">La patrulla</h1>
                <p className="hero__lead">Una barra abajo de la pantalla donde el chat entero va de aventura. Cada persona que escribe sale como un héroe, pegan solos a los enemigos y suben de nivel. El progreso se guarda de un directo a otro.</p>
              </div>
            </section>
            <ObsPanel data={data} accept={accept} notify={notify} />
            <div className="columns">
              <div className="column">
                <AdventurePanel data={data} ops={ops} />
                <HeroesPanel data={data} />
                <CommandsPanel data={data} />
              </div>
              <div className="column">
                <SettingsPanel data={data} patch={patch} />
                <BackupPanel data={data} accept={accept} notify={notify} />
              </div>
            </div>
          </div>
        )}
      </main>

      <div className="toasts">
        {notice && <Toast key={notice.key} title={notice.title} description={notice.description} open onOpenChange={open => { if (!open) setNotice(null) }} duration={3200} />}
      </div>
    </div>
  )
}
