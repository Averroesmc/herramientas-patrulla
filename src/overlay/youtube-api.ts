/**
 * API oficial de YouTube (Data API v3), llamada desde el navegador con la clave del Worker
 * (YOUTUBE_API_KEY, la misma del teatro y el bingo, limitada en Google a los dominios de herramientas).
 * El chat llega por liveChatMessages.streamList: una conexión abierta por la que YouTube empuja cada
 * mensaje al momento y que se reanuda desde el último si se corta. Copiado del bingo.
 */

const API = "https://youtube.googleapis.com/youtube/v3";

export class YouTubeApiError extends Error {
  readonly status: number;
  readonly reason: string;
  constructor(message: string, status: number, reason: string) {
    super(message);
    this.status = status;
    this.reason = reason;
  }
  /** Se ha gastado la cuota diaria gratuita (10.000 unidades). */
  get quota() {
    return /quota|dailyLimit|rateLimit/i.test(this.reason);
  }
  /** La clave no vale o no está permitida desde esta página. */
  get key() {
    return (
      /key|referer|referrer|forbidden|accessNotConfigured/i.test(
        `${this.reason} ${this.message}`,
      ) && !this.quota
    );
  }
  /** El chat ya no existe (directo acabado, chat desactivado…). */
  get gone() {
    return this.status === 404 || /liveChat(Ended|NotFound|Disabled)/i.test(this.reason);
  }
}

async function get<T>(
  path: string,
  params: Record<string, string>,
  key: string,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL(`${API}/${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  url.searchParams.set("key", key);
  const res = await fetch(url, signal ? { signal } : {});
  const body = (await res.json().catch(() => ({}))) as T & {
    error?: { message?: string; errors?: { reason?: string }[] };
  };
  if (!res.ok)
    throw new YouTubeApiError(
      body.error?.message ?? `YouTube respondió ${res.status}`,
      res.status,
      body.error?.errors?.[0]?.reason ?? "",
    );
  return body;
}

/** Del texto del panel (@canal, id UC…, enlace del canal o de un vídeo) a cómo pedirlo a la API. */
export function channelQuery(
  raw: string,
): { forHandle: string } | { id: string } | { video: string } | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^@[\w.-]{3,40}$/.test(text)) return { forHandle: text };
  if (/^UC[\w-]{22}$/.test(text)) return { id: text };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return /^[\w.-]{3,40}$/.test(text) ? { forHandle: `@${text}` } : null;
  }
  if (!/(^|\.)youtube\.com$|^youtu\.be$/i.test(url.hostname))
    return /^[\w.-]{3,40}$/.test(text) ? { forHandle: `@${text}` } : null;
  const video =
    url.searchParams.get("v") ??
    (url.hostname === "youtu.be" ? url.pathname.slice(1) : null) ??
    url.pathname.match(/^\/(?:live|shorts|embed)\/([\w-]{11})/)?.[1];
  if (video && /^[\w-]{11}$/.test(video)) return { video };
  const handle = url.pathname.match(/^\/(@[\w.-]{3,40})/)?.[1];
  if (handle) return { forHandle: handle };
  const id = url.pathname.match(/^\/channel\/(UC[\w-]{22})/)?.[1];
  return id ? { id } : null;
}

type Video = {
  id: string;
  snippet?: { title?: string };
  liveStreamingDetails?: {
    activeLiveChatId?: string;
    actualStartTime?: string;
    actualEndTime?: string;
  };
};

export type LiveChat = {
  videoId: string;
  liveChatId: string;
  title: string | null;
  started: boolean;
};

/** De unos vídeos, el que tiene el chat abierto: primero uno en marcha, si no uno programado. */
async function liveAmong(
  ids: string[],
  key: string,
  signal?: AbortSignal,
): Promise<LiveChat | null> {
  if (!ids.length) return null;
  const { items = [] } = await get<{ items?: Video[] }>(
    "videos",
    { part: "snippet,liveStreamingDetails", id: ids.join(",") },
    key,
    signal,
  );
  const open = items.filter(
    (video) =>
      video.liveStreamingDetails?.activeLiveChatId && !video.liveStreamingDetails.actualEndTime,
  );
  const best = open.find((video) => video.liveStreamingDetails?.actualStartTime) ?? open[0];
  if (!best) return null;
  return {
    videoId: best.id,
    liveChatId: best.liveStreamingDetails!.activeLiveChatId!,
    title: best.snippet?.title ?? null,
    started: !!best.liveStreamingDetails?.actualStartTime,
  };
}

const uploadsCache = new Map<string, string | null>();

/** La lista de vídeos subidos del canal; los directos aparecen ahí en cuanto se programan o empiezan. */
async function uploads(
  query: { forHandle: string } | { id: string },
  key: string,
  signal?: AbortSignal,
) {
  const cacheKey = "id" in query ? query.id : query.forHandle.toLowerCase();
  if (uploadsCache.has(cacheKey)) return uploadsCache.get(cacheKey)!;
  const { items = [] } = await get<{
    items?: { contentDetails?: { relatedPlaylists?: { uploads?: string } } }[];
  }>("channels", { part: "contentDetails", ...query }, key, signal);
  const playlist = items[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
  uploadsCache.set(cacheKey, playlist);
  return playlist;
}

/**
 * El directo con chat del canal escrito en el panel, o null si ahora no tiene ninguno.
 * `hint` es un id de vídeo que ha encontrado el servidor en la página del canal (gratis).
 * Con `full`, además se mira la lista de vídeos del canal: 2 unidades de cuota (3 la primera
 * vez). Sin `full`, solo se confirma la pista: 1 unidad, o ninguna si no hay pista.
 */
export async function findLiveChat(
  raw: string,
  key: string,
  hint?: string | null,
  signal?: AbortSignal,
  full = true,
): Promise<LiveChat | null> {
  const query = channelQuery(raw);
  if (!query) throw new YouTubeApiError("Ese canal de YouTube no es válido", 400, "invalidChannel");
  if ("video" in query) return liveAmong([query.video], key, signal);
  if (!full) return hint ? liveAmong([hint], key, signal) : null;
  const playlist = await uploads(query, key, signal);
  if (!playlist)
    throw new YouTubeApiError("No existe ese canal de YouTube", 404, "channelNotFound");
  const { items = [] } = await get<{ items?: { contentDetails?: { videoId?: string } }[] }>(
    "playlistItems",
    { part: "contentDetails", playlistId: playlist, maxResults: "10" },
    key,
    signal,
  );
  const ids = [
    ...new Set([
      ...(hint ? [hint] : []),
      ...items.map((item) => item.contentDetails?.videoId).filter((id): id is string => !!id),
    ]),
  ];
  return liveAmong(ids.slice(0, 50), key, signal);
}

export type ChatItem = {
  id: string;
  snippet: {
    type: string;
    publishedAt: string;
    displayMessage?: string;
    textMessageDetails?: { messageText?: string };
    superChatDetails?: { amountDisplayString?: string; userComment?: string };
    superStickerDetails?: { amountDisplayString?: string };
    memberMilestoneChatDetails?: { memberMonth?: number; userComment?: string };
    membershipGiftingDetails?: { giftMembershipsCount?: number };
  };
  authorDetails?: {
    channelId?: string;
    displayName?: string;
    profileImageUrl?: string;
    isChatOwner?: boolean;
    isChatModerator?: boolean;
    isChatSponsor?: boolean;
  };
};

export type ChatResponse = {
  items?: ChatItem[];
  nextPageToken?: string;
  offlineAt?: string;
  pollingIntervalMillis?: number;
};

/**
 * Abre la conexión del chat y va entregando cada respuesta según llega. La API manda un
 * array JSON que no se cierra hasta que acaba la conexión, así que se trocea a mano: cada
 * objeto de primer nivel es una respuesta con mensajes.
 */
export async function* streamChat(
  liveChatId: string,
  key: string,
  pageToken: string | undefined,
  signal: AbortSignal,
): AsyncGenerator<ChatResponse> {
  const url = new URL(`${API}/liveChat/messages/stream`);
  url.searchParams.set("liveChatId", liveChatId);
  url.searchParams.set("part", "snippet,authorDetails");
  url.searchParams.set("maxResults", "500");
  url.searchParams.set("profileImageSize", "88");
  url.searchParams.set("hl", "es");
  url.searchParams.set("key", key);
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => ({}))) as
      | { error?: { message?: string; errors?: { reason?: string }[] } }
      | { error?: { message?: string; errors?: { reason?: string }[] } }[];
    const error = (Array.isArray(body) ? body[0] : body)?.error;
    throw new YouTubeApiError(
      error?.message ?? `YouTube respondió ${res.status}`,
      res.status,
      error?.errors?.[0]?.reason ?? "",
    );
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let scan = 0;
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += value;
    for (; scan < buffer.length; scan++) {
      const char = buffer[scan];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{" || char === "[") {
        if (char === "{" && depth === 1) start = scan;
        depth++;
      } else if (char === "}" || char === "]") {
        depth--;
        if (char === "}" && depth === 1 && start >= 0) {
          yield JSON.parse(buffer.slice(start, scan + 1)) as ChatResponse;
          buffer = buffer.slice(scan + 1);
          scan = -1;
          start = -1;
        }
      }
    }
  }
}
