/**
 * El overlay de OBS lee los chats y se los pasa al juego:
 *   · cada mensaje (el héroe aparece o vuelve de la taberna; si es un comando, lo hace)
 *   · subs, regalos, bits y Super Chats (frenesí)
 *
 * Solo lo hace la fuente de OBS que juega (la que se queda el candado del navegador, ver main.ts).
 * Twitch se lee como invitado, sin cuenta. YouTube, con la API oficial (la clave del Worker) o, si no
 * hay clave o se acaba la cuota, a través del servidor. Kick, por su chat público (no oficial).
 *
 * Copiado del lector de retos (herramientas-retos/src/overlay/chat.ts), sin votos ni comandos de moderador.
 */
import { overlayApi } from './api'
import { findLiveChat, streamChat, YouTubeApiError, type ChatResponse, type LiveChat } from './youtube-api'
import type { LineIn, SupportIn } from './game'
import type { Config, Platform, ReaderStatus, Readers } from '../../shared/game'

/** Un mensaje normal de cualquier chat. */
type Line = { id: string; k: string; p: Platform; name: string; text: string; at: number }
/** Una sub, un regalo, bits o un Super Chat leído del chat. `k`: de quién, si se sabe. */
type Sub = { id: string; p: Platform; name: string; k?: string; n: number; at: number; kind: SupportIn['kind']; amount?: string }

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })

/* ---------------------------------------------------------------- Twitch */

function unescapeTag(value = '') {
  return value.replace(/\\s/g, ' ').replace(/\\:/g, ';').replace(/\\\\/g, '\\')
}

function parseIrc(line: string) {
  const tags: Record<string, string> = {}
  let rest = line
  if (rest.startsWith('@')) {
    const space = rest.indexOf(' ')
    for (const pair of rest.slice(1, space).split(';')) {
      const eq = pair.indexOf('=')
      tags[pair.slice(0, eq)] = unescapeTag(pair.slice(eq + 1))
    }
    rest = rest.slice(space + 1)
  }
  let prefix = ''
  if (rest.startsWith(':')) {
    const space = rest.indexOf(' ')
    prefix = rest.slice(1, space)
    rest = rest.slice(space + 1)
  }
  const at = rest.indexOf(' :')
  const trailing = at >= 0 ? rest.slice(at + 2) : ''
  const command = (at >= 0 ? rest.slice(0, at) : rest).split(' ')[0] ?? ''
  return { tags, prefix, command, trailing }
}

/** Los avisos de Twitch que son subs. Las regaladas llegan una a una (subgift), también las de un regalo grande. */
const TWITCH_SUBS: Record<string, SupportIn['kind'] | undefined> = {
  sub: 'sub',
  resub: 'sub',
  subgift: 'gift',
  anonsubgift: 'gift',
  giftpaidupgrade: 'sub',
  anongiftpaidupgrade: 'sub',
  primepaidupgrade: 'sub',
}

function connectTwitch(channel: string, onLine: (l: Line) => void, onSub: (s: Sub) => void, onStatus: (s: ReaderStatus) => void) {
  let socket: WebSocket | null = null
  let stopped = false
  let attempt = 0
  let retry: ReturnType<typeof setTimeout> | undefined
  const name = channel.trim().replace(/^#/, '').replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').replace(/[/?#].*$/, '').toLowerCase()

  const open = () => {
    onStatus('connecting')
    const ws = new WebSocket('wss://irc-ws.chat.twitch.tv:443')
    socket = ws
    ws.onopen = () => {
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands')
      ws.send('PASS SCHMOOPIIE')
      ws.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`)
      ws.send(`JOIN #${name}`)
    }
    ws.onmessage = event => {
      for (const raw of String(event.data).split('\r\n')) {
        if (!raw) continue
        if (raw.startsWith('PING')) { ws.send('PONG :tmi.twitch.tv'); continue }
        const msg = parseIrc(raw)
        if (msg.command === 'ROOMSTATE' || msg.command === '366') { attempt = 0; onStatus('ok') }
        const login = (msg.tags.login || msg.prefix.split('!')[0] || '').toLowerCase()
        const display = msg.tags['display-name'] || login
        const at = Number(msg.tags['tmi-sent-ts']) || Date.now()
        if (msg.command === 'USERNOTICE') {
          const kind = TWITCH_SUBS[msg.tags['msg-id'] ?? '']
          if (kind) {
            const anon = (msg.tags['msg-id'] ?? '').startsWith('anon')
            const k = !anon && msg.tags['user-id'] ? `t:${msg.tags['user-id']}` : undefined
            onSub({ id: `t-${msg.tags.id || `${login}-${at}`}`, p: 'twitch', name: anon ? 'Anónimo' : display, ...(k ? { k } : {}), n: 1, at, kind })
          }
          continue
        }
        if (msg.command !== 'PRIVMSG') continue
        const id = `t-${msg.tags.id || `${login}-${at}`}`
        const k = `t:${msg.tags['user-id'] || login}`
        const bits = Number(msg.tags.bits)
        if (bits > 0) onSub({ id: `${id}-bits`, p: 'twitch', name: display, k, n: bits, at, kind: 'bits' })
        onLine({ id, k, p: 'twitch', name: display, text: msg.trailing.trim(), at })
      }
    }
    ws.onclose = () => {
      if (socket !== ws) return
      onStatus(stopped ? 'off' : 'error')
      if (stopped) return
      retry = setTimeout(open, Math.min(30_000, 1000 * 2 ** attempt++))
    }
  }

  open()
  return () => { stopped = true; clearTimeout(retry); const ws = socket; socket = null; ws?.close() }
}

/* ---------------------------------------------------------------- Kick */

/**
 * El chat público de Kick (Pusher). No es oficial: si Kick lo cambia, puede dejar de ir. La clave la da
 * el servidor (la pregunta a Kick); si Kick la rechaza (error 4001), se vuelve a pedir y se reconecta.
 */
type KickCreds = { appKey: string; cluster: string }
const KICK_FALLBACK: KickCreds = { appKey: '34bf7a0ff419a2a775b9', cluster: 'us2' }
const kickUrl = (c: KickCreds) => `wss://ws-${c.cluster}.pusher.com/app/${c.appKey}?protocol=7&client=js&version=8.4.0&flash=false`

type KickMessage = { id?: string; content?: string; created_at?: string; sender?: { id?: number; username?: string; slug?: string } }

function connectKick(chatroom: string, creds: KickCreds, onLine: (l: Line) => void, onSub: (s: Sub) => void, onStatus: (s: ReaderStatus) => void, onBadKey: () => void) {
  let socket: WebSocket | null = null
  let stopped = false
  let attempt = 0
  let retry: ReturnType<typeof setTimeout> | undefined

  const open = () => {
    onStatus('connecting')
    const ws = new WebSocket(kickUrl(creds))
    socket = ws
    ws.onmessage = event => {
      let msg: { event?: string; data?: string; channel?: string }
      try { msg = JSON.parse(String(event.data)) } catch { return }
      let data: Record<string, unknown> = {}
      try { data = typeof msg.data === 'string' ? JSON.parse(msg.data) : (msg.data ?? {}) } catch { /* sin datos */ }
      switch (msg.event) {
        case 'pusher:connection_established':
          ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${chatroom}.v2` } }))
          break
        case 'pusher:error': {
          // 4001: la clave ya no vale (Kick la ha cambiado). Se deja de reintentar con esta y se pide otra.
          const code = Number((data as { code?: number }).code)
          if (code >= 4000 && code < 4100) { stopped = true; onStatus('error'); onBadKey(); ws.close() }
          break
        }
        case 'pusher:ping':
          ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }))
          break
        case 'pusher_internal:subscription_succeeded':
          attempt = 0
          onStatus('ok')
          break
        case 'App\\Events\\ChatMessageEvent': {
          const m = data as KickMessage
          const user = m.sender?.username ?? ''
          onLine({
            id: `k-${m.id ?? `${user}-${Date.now()}`}`,
            k: `k:${m.sender?.id ?? (m.sender?.slug || user)}`,
            p: 'kick',
            name: user || 'Kick',
            text: (m.content ?? '').trim(),
            at: Date.parse(m.created_at ?? '') || Date.now(),
          })
          break
        }
        case 'App\\Events\\SubscriptionEvent': {
          const user = String(data.username ?? 'Kick')
          const months = Number(data.months ?? 1)
          // Kick no da id: se usa el nombre y el minuto, para no contarla dos veces si se repite.
          onSub({ id: `k-sub-${user}-${months}-${Math.floor(Date.now() / 60_000)}`, p: 'kick', name: user, n: 1, at: Date.now(), kind: 'sub' })
          break
        }
        case 'App\\Events\\GiftedSubscriptionsEvent': {
          const gifted = Array.isArray(data.gifted_usernames) ? data.gifted_usernames.length : 1
          const gifter = String(data.gifter_username ?? 'Anónimo')
          onSub({ id: `k-gift-${gifter}-${data.gifter_total ?? ''}-${Math.floor(Date.now() / 10_000)}`, p: 'kick', name: gifter, n: Math.max(1, gifted), at: Date.now(), kind: 'gift' })
          break
        }
      }
    }
    ws.onclose = () => {
      if (socket !== ws) return
      onStatus(stopped ? 'off' : 'error')
      if (stopped) return
      retry = setTimeout(open, Math.min(30_000, 1000 * 2 ** attempt++))
    }
  }

  open()
  return () => { stopped = true; clearTimeout(retry); const ws = socket; socket = null; ws?.close() }
}

/* ---------------------------------------------------------------- YouTube */

type YouTubeSetup = { key: string | null; channel: string; videoId: string | null }
type ScrapedMessage = {
  id: string
  at: number
  author: string
  channelId: string | null
  roles: { mod: boolean; sub: boolean; broadcaster: boolean }
  parts: ({ text: string } | { emote: string; name: string })[]
  event?: { type: 'tip'; amount: string } | { type: 'sub' } | { type: 'resub'; months: number } | { type: 'giftbomb'; gifted: number }
}
type ScrapedSession = { videoId: string; clientVersion: string; visitorData?: string; apiKey?: string; reload: string }

const ytKey = (channelId: string | null, name: string) => `y:${channelId || name.replace(/[^\w.@-]/g, '').slice(0, 60) || 'anon'}`

/* ---------------------------------------------------------------- lector */

export interface ChatHandlers {
  line: (l: LineIn) => void
  support: (s: SupportIn) => void
}

export class ChatReader {
  private config: Config | null = null
  private readonly started = Date.now()
  private twitch: { channel: string; stop: () => void } | null = null
  private kick: { room: string; key: string; stop: () => void } | null = null
  private kickLookup = { slug: '', at: 0, running: false }
  private kickBadKey = false
  private youtube: { channel: string; abort: AbortController } | null = null
  readonly status: Readers = { twitch: 'off', youtube: 'off', kick: 'off', note: '' }
  private notes: Record<Platform, string> = { twitch: '', youtube: '', kick: '' }
  /** Lo ya visto (YouTube a veces repite mensajes al reconectar). */
  private seen = new Set<string>()
  /** Regalos de una misma persona que llegan seguidos: se juntan en uno («regala 5 subs»). */
  private gifts = new Map<string, { sub: Sub; timer: ReturnType<typeof setTimeout> }>()
  private timer: ReturnType<typeof setInterval> | undefined

  private readonly key: string
  private readonly on: ChatHandlers

  constructor(key: string, on: ChatHandlers) {
    this.key = key
    this.on = on
  }

  start(config: Config) {
    this.config = config
    this.sync()
    this.timer = setInterval(() => this.sync(), 5000)
  }

  update(config: Config) {
    this.config = config
    this.sync()
  }

  stop() {
    clearInterval(this.timer)
    this.twitch?.stop(); this.twitch = null
    this.kick?.stop(); this.kick = null
    this.youtube?.abort.abort(); this.youtube = null
  }

  /** Conecta o desconecta cada chat según la configuración. */
  private sync() {
    const config = this.config
    if (!config) return

    const twitch = config.enabled.twitch ? config.channels.twitch.trim() : ''
    if (this.twitch && this.twitch.channel !== twitch) { this.twitch.stop(); this.twitch = null }
    if (!this.twitch && twitch) {
      this.twitch = { channel: twitch, stop: connectTwitch(twitch, l => this.take(l), s => this.takeSub(s), s => this.setStatus('twitch', s)) }
    }
    if (!twitch) this.setStatus('twitch', 'off')

    const youtube = config.enabled.youtube ? config.channels.youtube.trim() : ''
    if (this.youtube && this.youtube.channel !== youtube) { this.youtube.abort.abort(); this.youtube = null }
    if (!this.youtube && youtube) {
      const abort = new AbortController()
      this.youtube = { channel: youtube, abort }
      void this.readYouTube(abort.signal)
    }
    if (!youtube) this.setStatus('youtube', 'off', '')

    void this.syncKick()
  }

  private async syncKick() {
    const config = this.config
    const slug = config?.enabled.kick ? config.channels.kick.trim() : ''
    if (!slug) {
      if (this.kick) { this.kick.stop(); this.kick = null }
      this.setStatus('kick', 'off', '')
      return
    }
    if (this.kickLookup.running) return
    if (this.kick && this.kickLookup.slug === slug + (config?.kickChatroom ?? '')) return
    if (!this.kick && this.kickLookup.slug === slug + (config?.kickChatroom ?? '') && Date.now() - this.kickLookup.at < 60_000) return
    this.kickLookup = { slug: slug + (config?.kickChatroom ?? ''), at: Date.now(), running: true }
    try {
      const fresh = this.kickBadKey
      this.kickBadKey = false
      const info = await overlayApi<{ slug: string; chatroomId: string | null; appKey?: string; cluster?: string }>(this.key, fresh ? '/kick?fresh=1' : '/kick').catch(() => null)
      const creds: KickCreds = info?.appKey && info.cluster ? { appKey: info.appKey, cluster: info.cluster } : KICK_FALLBACK
      let room = info?.chatroomId ?? null
      if (!room && info?.slug) {
        // Desde el ordenador del streamer Kick a veces sí contesta.
        room = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(info.slug)}`)
          .then(r => (r.ok ? r.json() : null))
          .then((d: { chatroom?: { id?: number } } | null) => (d?.chatroom?.id ? String(d.chatroom.id) : null))
          .catch(() => null)
      }
      if (this.kick && (this.kick.room !== room || this.kick.key !== creds.appKey)) { this.kick.stop(); this.kick = null }
      if (!room) { this.setStatus('kick', 'error', 'Kick: no se encuentra el chat. Pon su número en el panel.'); return }
      if (!this.kick) {
        const onBadKey = () => {
          // Kick ha rechazado la clave: en la siguiente vuelta se pide otra al servidor y se reconecta.
          this.kick = null
          this.kickBadKey = true
          this.kickLookup.at = 0
          this.kickLookup.slug = ''
          this.setStatus('kick', 'error', 'Kick: ha cambiado la clave de su chat, buscando la nueva…')
        }
        this.kick = { room, key: creds.appKey, stop: connectKick(room, creds, l => this.take(l), s => this.takeSub(s), s => this.setStatus('kick', s, ''), onBadKey) }
      }
    } finally {
      this.kickLookup.running = false
    }
  }

  private setStatus(p: Platform, status: ReaderStatus, note?: string) {
    this.status[p] = status
    if (note !== undefined) this.notes[p] = note
    this.status.note = Object.values(this.notes).filter(Boolean).join(' · ')
  }

  private fresh(id: string) {
    if (this.seen.has(id)) return false
    this.seen.add(id)
    if (this.seen.size > 3000) this.seen = new Set([...this.seen].slice(-1500))
    return true
  }

  /** Una sub o un regalo: los regalos seguidos de una misma persona se juntan. */
  private takeSub(sub: Sub) {
    const config = this.config
    if (!config || !config.enabled[sub.p] || !this.fresh(sub.id)) return
    // Lo que había en el chat antes de abrir el overlay no cuenta.
    if (sub.at < this.started - 60_000) return
    if (sub.kind !== 'gift' || sub.n > 1) { this.emit(sub); return }
    const key = `${sub.p}:${sub.name}`
    const group = this.gifts.get(key)
    if (group) {
      group.sub.n += 1
      clearTimeout(group.timer)
      group.timer = setTimeout(() => this.closeGift(key), 2500)
    } else {
      this.gifts.set(key, { sub: { ...sub }, timer: setTimeout(() => this.closeGift(key), 2500) })
    }
  }

  private closeGift(key: string) {
    const group = this.gifts.get(key)
    if (!group) return
    this.gifts.delete(key)
    this.emit(group.sub)
  }

  private emit(sub: Sub) {
    this.on.support({ name: sub.name, kind: sub.kind, n: sub.n, ...(sub.k ? { k: sub.k } : {}), ...(sub.amount ? { amount: sub.amount } : {}) })
  }

  private take(line: Line) {
    if (!line.text || !this.fresh(line.id)) return
    if (line.at < this.started - 60_000) return
    this.on.line({ k: line.k, p: line.p, name: line.name, text: line.text })
  }

  /* ------------------------------------------------------------ YouTube */

  private async readYouTube(signal: AbortSignal) {
    while (!signal.aborted) {
      this.setStatus('youtube', 'connecting')
      const setup = await overlayApi<YouTubeSetup>(this.key, '/youtube', { signal }).catch(() => null)
      if (signal.aborted) return
      if (!setup?.channel) { this.setStatus('youtube', 'error', 'YouTube: no se pudo preparar'); await sleep(30_000, signal); continue }
      if (setup.key) {
        const done = await this.officialYouTube(setup, signal)
        if (done === 'retry') continue
        if (done === 'offline') { await sleep(60_000, signal); continue }
      }
      if (!signal.aborted) await this.scrapedYouTube(signal)
    }
  }

  /** Mensajes, miembros nuevos, aniversarios y regalos de la API oficial. */
  private youtubeItem(item: NonNullable<ChatResponse['items']>[number]) {
    const who = item.authorDetails ?? {}
    const name = (who.displayName ?? '').replace(/^@/, '').trim() || 'YouTube'
    const at = Date.parse(item.snippet.publishedAt) || Date.now()
    const id = `y-${item.id}`
    const k = ytKey(who.channelId ?? null, name)
    switch (item.snippet.type) {
      case 'textMessageEvent':
        this.take({ id, k, p: 'youtube', name, at, text: (item.snippet.textMessageDetails?.messageText ?? item.snippet.displayMessage ?? '').trim() })
        break
      case 'superChatEvent':
      case 'superStickerEvent': {
        const amount = item.snippet.superChatDetails?.amountDisplayString ?? item.snippet.superStickerDetails?.amountDisplayString
        this.takeSub({ id, p: 'youtube', name, k, n: 1, at, kind: 'superchat', ...(amount ? { amount } : {}) })
        const comment = item.snippet.superChatDetails?.userComment?.trim()
        if (comment) this.take({ id: `${id}-c`, k, p: 'youtube', name, at, text: comment })
        break
      }
      case 'newSponsorEvent':
      case 'memberMilestoneChatEvent':
        this.takeSub({ id, p: 'youtube', name, k, n: 1, at, kind: 'sub' })
        break
      case 'membershipGiftingEvent':
        this.takeSub({ id, p: 'youtube', name, k, n: Math.max(1, item.snippet.membershipGiftingDetails?.giftMembershipsCount ?? 1), at, kind: 'gift' })
        break
    }
  }

  /** La API oficial. 'fallback' si la clave no vale o no queda cuota (se pasa al método del servidor). */
  private async officialYouTube(setup: YouTubeSetup, signal: AbortSignal): Promise<'offline' | 'fallback' | 'retry'> {
    const key = setup.key!
    const seen = new Set<string>()
    let chat: LiveChat | null = null
    let pageToken: string | undefined
    while (!signal.aborted) {
      try {
        if (!chat) {
          chat = await findLiveChat(setup.channel, key, setup.videoId, signal, !setup.videoId)
          if (!chat) { this.setStatus('youtube', 'ok', 'YouTube: sin directo ahora'); return 'offline' }
        }
        const began = Date.now()
        this.setStatus('youtube', 'ok', '')
        for await (const response of streamChat(chat.liveChatId, key, pageToken, signal) as AsyncGenerator<ChatResponse & { error?: { message?: string; code?: number; errors?: { reason?: string }[] } }>) {
          if (response.error) throw new YouTubeApiError(response.error.message ?? 'Error de YouTube', response.error.code ?? 500, response.error.errors?.[0]?.reason ?? '')
          pageToken = response.nextPageToken ?? pageToken
          for (const item of response.items ?? []) {
            if (seen.has(item.id)) continue
            seen.add(item.id)
            this.youtubeItem(item)
          }
          if (response.offlineAt) { this.setStatus('youtube', 'ok', 'YouTube: el directo ha terminado'); return 'offline' }
        }
        // YouTube cierra la conexión cada poco: se reabre desde el último mensaje.
        await sleep(Math.max(0, 3000 - (Date.now() - began)), signal)
      } catch (error) {
        if (signal.aborted) return 'retry'
        if (error instanceof YouTubeApiError && (error.quota || (error.key && !error.gone))) {
          this.setStatus('youtube', 'connecting', youtubeProblem(error))
          return 'fallback'
        }
        if (error instanceof YouTubeApiError && error.gone) return 'retry'
        this.setStatus('youtube', 'error', youtubeProblem(error))
        await sleep(5000, signal)
      }
    }
    return 'retry'
  }

  /** Sin clave: el servidor lee la web de YouTube y el overlay le va preguntando. */
  private async scrapedYouTube(signal: AbortSignal) {
    const seen = new Set<string>()
    while (!signal.aborted) {
      try {
        const start = await overlayApi<{ live: boolean; session?: ScrapedSession }>(this.key, '/youtube/start', { signal })
        if (!start?.live || !start.session) {
          this.setStatus('youtube', 'ok', 'YouTube: sin directo ahora')
          await sleep(30_000, signal)
          continue
        }
        const session = start.session
        this.setStatus('youtube', 'ok', 'YouTube: método de reserva (sin clave o sin cuota)')
        let continuation = session.reload
        while (!signal.aborted) {
          const result = await overlayApi<{ messages: ScrapedMessage[]; continuation: string | null; timeoutMs: number; ended: boolean }>(
            this.key, '/youtube/poll', { method: 'POST', body: JSON.stringify({ ...session, continuation }), signal })
          if (!result) break
          for (const m of result.messages) {
            if (seen.has(m.id)) continue
            seen.add(m.id)
            const name = m.author.replace(/^@/, '').trim() || 'YouTube'
            const id = `y-${m.id}`
            const k = ytKey(m.channelId, name)
            const text = m.parts.map(part => ('emote' in part ? ` ${part.name} ` : part.text)).join('').trim()
            if (m.event?.type === 'sub' || m.event?.type === 'resub') this.takeSub({ id, p: 'youtube', name, k, n: 1, at: m.at, kind: 'sub' })
            else if (m.event?.type === 'giftbomb') this.takeSub({ id, p: 'youtube', name, k, n: Math.max(1, m.event.gifted), at: m.at, kind: 'gift' })
            else if (m.event?.type === 'tip') {
              this.takeSub({ id, p: 'youtube', name, k, n: 1, at: m.at, kind: 'superchat', ...(m.event.amount ? { amount: m.event.amount } : {}) })
              if (text) this.take({ id: `${id}-c`, k, p: 'youtube', name, text, at: m.at })
            } else if (!m.event) {
              this.take({ id, k, p: 'youtube', name, text, at: m.at })
            }
          }
          if (result.ended || !result.continuation) break
          continuation = result.continuation
          await sleep(Math.min(3000, Math.max(1000, result.timeoutMs)), signal)
        }
      } catch (error) {
        if (signal.aborted) return
        this.setStatus('youtube', 'error', youtubeProblem(error))
        await sleep(5000, signal)
      }
    }
  }
}

function youtubeProblem(error: unknown): string {
  if (error instanceof YouTubeApiError) {
    if (error.quota) return 'YouTube: se ha gastado la cuota de hoy (se usa el método de reserva)'
    if (error.key) return 'YouTube: la clave no vale para esta página (se usa el método de reserva)'
    if (error.gone) return 'YouTube: el chat ya no está disponible'
    return `YouTube: ${error.message}`
  }
  return 'YouTube: no se pudo conectar'
}
