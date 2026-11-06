/**
 * Chat de YouTube sin clave de API, a través de este servidor (YouTube no deja leerlo
 * desde el navegador). Copiado del bingo (marta-sims-robar/src/lib/votacion/youtube.server.ts),
 * que a su vez viene del teatro. Con YOUTUBE_API_KEY el overlay usa la API oficial y esto
 * queda de reserva. Además de los mensajes, trae los miembros nuevos y los regalos.
 */

const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "accept-language": "es-ES,es;q=0.9",
  // Evita la página de consentimiento de cookies que YouTube muestra en Europa.
  cookie: "SOCS=CAI; CONSENT=YES+1",
};

/** Ruta de la página /live del canal a partir de @canal, un id UC… o un enlace. Si es un vídeo, su id. */
function target(raw: string): { live: string } | { video: string } | null {
  const text = raw.trim();
  if (!text) return null;
  if (/^@[\w.-]{3,40}$/.test(text)) return { live: `/${text}/live` };
  if (/^UC[\w-]{22}$/.test(text)) return { live: `/channel/${text}/live` };
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return /^[\w.-]{3,40}$/.test(text) ? { live: `/@${text}/live` } : null;
  }
  if (!/(^|\.)youtube\.com$|^youtu\.be$/i.test(url.hostname)) {
    return /^[\w.-]{3,40}$/.test(text) ? { live: `/@${text}/live` } : null;
  }
  const video =
    url.searchParams.get("v") ??
    (url.hostname === "youtu.be" ? url.pathname.slice(1) : null) ??
    url.pathname.match(/^\/(?:live|shorts|embed)\/([\w-]{11})/)?.[1];
  if (video && /^[\w-]{11}$/.test(video)) return { video };
  const channel = url.pathname.match(
    /^\/(@[\w.-]{3,40}|channel\/UC[\w-]{22}|c\/[\w.-]+|user\/[\w.-]+)/,
  )?.[1];
  return channel ? { live: `/${channel}/live` } : null;
}

/**
 * El id del directo del canal, en marcha o programado; null si no tiene ninguno.
 * La página /live de un canal con directo lleva el vídeo en currentVideoEndpoint
 * (y a veces en el enlace canonical); sin directo, no lleva ninguno de los dos.
 */
export async function findLiveVideo(raw: string): Promise<string | null> {
  const where = target(raw);
  if (!where) throw new Error("Ese canal de YouTube no es válido");
  if ("video" in where) return where.video;
  const res = await fetch(`https://www.youtube.com${where.live}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  if (res.status === 404) throw new Error("No existe ese canal de YouTube");
  if (!res.ok) throw new Error(`YouTube respondió ${res.status}`);
  const html = await res.text();
  return (
    html.match(
      /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/,
    )?.[1] ??
    html.match(/"currentVideoEndpoint":\{[\s\S]*?"videoId":"([\w-]{11})"/)?.[1] ??
    null
  );
}

export type ChatSession = {
  videoId: string;
  title: string | null;
  clientVersion: string;
  visitorData?: string | undefined;
  apiKey?: string | undefined;
  reload: string;
};

export async function startChat(channel: string): Promise<ChatSession | null> {
  const videoId = await findLiveVideo(channel);
  if (!videoId) return null;
  const res = await fetch(`https://www.youtube.com/live_chat?is_popout=1&v=${videoId}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  // El segundo "reload" es el chat completo; el primero, el de mensajes destacados.
  const reloads = [...html.matchAll(/"reloadContinuationData":\{"continuation":"([^"]+)"/g)].map(
    (match) => match[1],
  );
  const reload = reloads[1] ?? reloads[0] ?? html.match(/"continuation":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/"clientVersion":"([^"]+)"/)?.[1];
  // Un vídeo sin chat (directo acabado o chat desactivado) cuenta como sin directo.
  if (!reload || !clientVersion) return null;
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  return {
    videoId,
    title: title ?? null,
    clientVersion,
    visitorData: html.match(/"visitorData":"([^"]+)"/)?.[1],
    apiKey: html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1],
    reload,
  };
}

type Thumbs = { thumbnails?: { url: string }[] };
type Run = {
  text?: string;
  emoji?: { emojiId?: string; isCustomEmoji?: boolean; image?: Thumbs; shortcuts?: string[] };
};
type Badge = {
  liveChatAuthorBadgeRenderer?: {
    icon?: { iconType?: string };
    customThumbnail?: Thumbs;
    tooltip?: string;
  };
};
type Renderer = {
  id: string;
  timestampUsec?: string;
  authorName?: { simpleText?: string };
  authorExternalChannelId?: string;
  authorPhoto?: Thumbs;
  authorBadges?: Badge[];
  message?: { runs?: Run[] };
  headerSubtext?: { runs?: Run[]; simpleText?: string };
  headerPrimaryText?: { runs?: Run[] };
  purchaseAmountText?: { simpleText?: string };
};
type Item = {
  liveChatTextMessageRenderer?: Renderer;
  liveChatPaidMessageRenderer?: Renderer;
  liveChatPaidStickerRenderer?: Renderer;
  liveChatMembershipItemRenderer?: Renderer;
  liveChatSponsorshipsGiftPurchaseAnnouncementRenderer?: {
    authorExternalChannelId?: string;
    header?: { liveChatSponsorshipsHeaderRenderer?: Renderer & { primaryText?: { runs?: Run[] } } };
  };
};
type LiveChat = {
  continuations?: Record<string, { continuation?: string; timeoutMs?: number } | undefined>[];
  actions?: { addChatItemAction?: { item?: Item } }[];
};

export type Part = { text: string } | { emote: string; name: string };

export type YouTubeMessage = {
  id: string;
  /** Cuándo se escribió (ms). */
  at: number;
  author: string;
  channelId: string | null;
  photo: string | null;
  roles: { mod: boolean; sub: boolean; broadcaster: boolean };
  parts: Part[];
  /** Super Chat, sticker, miembro nuevo, aniversario o regalo de membresías. */
  event?:
    | { type: "tip"; amount: string }
    | { type: "sub" }
    | { type: "resub"; months: number }
    | { type: "giftbomb"; gifted: number };
};

const runsText = (runs?: Run[]) =>
  (runs ?? []).map((run) => run.text ?? run.emoji?.shortcuts?.[0] ?? "").join("");
const firstNumber = (text: string) => Number(/(\d+)/.exec(text)?.[1] ?? 0);

function parts(runs?: Run[]): Part[] {
  return (runs ?? []).map((run) => {
    if (!run.emoji) return { text: run.text ?? "" };
    // Los emojis normales llegan como el propio carácter; los de YouTube y del canal, como imagen.
    if (!run.emoji.isCustomEmoji && run.emoji.emojiId && !/^UC/.test(run.emoji.emojiId))
      return { text: run.emoji.emojiId };
    const name = (run.emoji.shortcuts?.[0] ?? "").replace(/\s+/g, "");
    const url = run.emoji.image?.thumbnails?.at(-1)?.url ?? "";
    return name && url ? { emote: url, name } : { text: name };
  });
}

const timeOf = (renderer: Renderer) =>
  Math.floor(Number(renderer.timestampUsec ?? 0) / 1000) || Date.now();

function author(renderer: Renderer, channelId?: string) {
  const roles = { mod: false, sub: false, broadcaster: false };
  for (const badge of renderer.authorBadges ?? []) {
    const b = badge.liveChatAuthorBadgeRenderer;
    const icon = b?.icon?.iconType;
    if (icon === "OWNER") roles.broadcaster = true;
    else if (icon === "MODERATOR") roles.mod = true;
    else if (b?.customThumbnail) roles.sub = true;
  }
  return {
    author: renderer.authorName?.simpleText ?? "",
    channelId: channelId ?? renderer.authorExternalChannelId ?? null,
    photo: renderer.authorPhoto?.thumbnails?.at(-1)?.url ?? null,
    roles,
  };
}

function toMessage(item: Item): YouTubeMessage | null {
  const text = item.liveChatTextMessageRenderer;
  if (text)
    return { id: text.id, at: timeOf(text), ...author(text), parts: parts(text.message?.runs) };

  const paid = item.liveChatPaidMessageRenderer ?? item.liveChatPaidStickerRenderer;
  if (paid) {
    return {
      id: paid.id,
      at: timeOf(paid),
      ...author(paid),
      parts: parts(paid.message?.runs),
      event: { type: "tip", amount: paid.purchaseAmountText?.simpleText ?? "" },
    };
  }

  const member = item.liveChatMembershipItemRenderer;
  if (member) {
    const header =
      runsText(member.headerPrimaryText?.runs) ||
      runsText(member.headerSubtext?.runs) ||
      member.headerSubtext?.simpleText ||
      "";
    const months = member.headerPrimaryText ? firstNumber(header) : 0;
    return {
      id: member.id,
      at: timeOf(member),
      ...author(member),
      parts: parts(member.message?.runs),
      event: months > 1 ? { type: "resub", months } : { type: "sub" },
    };
  }

  const gift = item.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer;
  const giftHeader = gift?.header?.liveChatSponsorshipsHeaderRenderer;
  if (gift && giftHeader) {
    return {
      id: giftHeader.id ?? `gift-${Date.now()}`,
      at: Date.now(),
      ...author(giftHeader, gift.authorExternalChannelId),
      parts: [],
      event: { type: "giftbomb", gifted: firstNumber(runsText(giftHeader.primaryText?.runs)) || 1 },
    };
  }
  return null;
}

export async function pollChat(
  session: Pick<ChatSession, "clientVersion" | "visitorData" | "apiKey">,
  continuation: string,
) {
  const query = session.apiKey ? `&key=${encodeURIComponent(session.apiKey)}` : "";
  const res = await fetch(
    `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false${query}`,
    {
      method: "POST",
      headers: { ...HEADERS, "content-type": "application/json" },
      body: JSON.stringify({
        context: {
          client: {
            clientName: "WEB",
            clientVersion: session.clientVersion,
            visitorData: session.visitorData,
          },
        },
        continuation,
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) throw new Error(`YouTube respondió ${res.status}`);
  const json = (await res.json()) as { continuationContents?: { liveChatContinuation?: LiveChat } };
  const chat = json?.continuationContents?.liveChatContinuation;
  if (!chat) return { messages: [], continuation: null, timeoutMs: 0, ended: true };
  const next = chat.continuations?.[0] ?? {};
  const data =
    next["invalidationContinuationData"] ??
    next["timedContinuationData"] ??
    next["reloadContinuationData"];
  const messages = (chat.actions ?? [])
    .map((action) => action.addChatItemAction?.item)
    .filter((item): item is Item => !!item)
    .map(toMessage)
    .filter((message): message is YouTubeMessage => !!message && !!message.author);
  return {
    messages,
    continuation: data?.continuation ?? null,
    timeoutMs: Number(data?.timeoutMs ?? 5000),
    ended: !data,
  };
}

const liveCache = new Map<string, { videoId: string | null; at: number }>();

/**
 * Como findLiveVideo, pero recordando la respuesta un minuto: lo usan el overlay y el panel
 * como pista junto a la API oficial, sin descargar la página del canal cada vez.
 */
export async function cachedLiveVideo(raw: string): Promise<string | null> {
  const key = raw.trim().toLowerCase();
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.videoId;
  const videoId = await findLiveVideo(raw).catch(() => null);
  liveCache.set(key, { videoId, at: Date.now() });
  if (liveCache.size > 200) liveCache.delete(liveCache.keys().next().value!);
  return videoId;
}
