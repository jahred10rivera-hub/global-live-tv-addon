import sdk from "stremio-addon-sdk";

const { addonBuilder, serveHTTP } = sdk;

const PORT = Number(process.env.PORT || 7000);
const CACHE_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20000;
const USER_AGENT = "GlobalLiveTV/8.4.3 (+https://github.com/jahred10rivera-hub/global-live-tv-addon)";

const CATALOGS = [
  { id: "live_us", name: "🇺🇸 Estados Unidos (Todos)", url: "https://iptv-org.github.io/iptv/countries/us.m3u" },
  { id: "live_spa", name: "🗣️ Español (Todo el Mundo)", url: "https://iptv-org.github.io/iptv/languages/spa.m3u" },
  { id: "live_latam", name: "📺 Latinoamérica", url: "https://iptv-org.github.io/iptv/regions/latam.m3u" },
  { id: "live_kids", name: "👶 Infantiles (Kids)", url: "https://iptv-org.github.io/iptv/categories/kids.m3u" },
  { id: "live_news", name: "📰 Noticias (Global)", url: "https://iptv-org.github.io/iptv/categories/news.m3u" },
  { id: "live_sports", name: "⚽ Deportes (Global)", url: "https://iptv-org.github.io/iptv/categories/sports.m3u" },
  { id: "live_movies", name: "🎬 Cine y Series", url: "https://iptv-org.github.io/iptv/categories/movies.m3u" }
];

const manifest = {
  id: "org.community.global-live-tv",
  version: "8.4.3",
  name: "Global Live TV - Massive US",
  description: "Acceso a canales de televisión en vivo globales y regionales.",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  idPrefixes: ["gltv:"],
  catalogs: CATALOGS.map(({ id, name }) => ({ type: "tv", id, name }))
};

const builder = new addonBuilder(manifest);
let cache = new Map();
let lastRefresh = 0;
let refreshPromise = null;

const LOGO_REGEX = /tvg-logo="([^"]*)"/i;
const GROUP_REGEX = /group-title="([^"]*)"/i;
const REFERRER_REGEX = /http-referrer="([^"]*)"/i;
const CHANNEL_UA_REGEX = /http-user-agent="([^"]*)"/i;

function parseM3U(text) {
  const channels = [];
  let current = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const comma = line.indexOf(",");
      const header = comma >= 0 ? line.slice(0, comma) : line;
      const name = comma >= 0 ? line.slice(comma + 1).trim() : "Canal sin nombre";
      const logoMatch = header.match(LOGO_REGEX);
      const groupMatch = header.match(GROUP_REGEX);

      current = {
        name: name || "Canal sin nombre",
        logo: logoMatch?.[1] || "",
        group: groupMatch?.[1] || "General",
        referrer: header.match(REFERRER_REGEX)?.[1] || "",
        userAgent: header.match(CHANNEL_UA_REGEX)?.[1] || "",
        url: ""
      };
      continue;
    }

    if (line.startsWith("#")) continue;
    if (current && /^https?:\/\//i.test(line)) {
      current.url = line;
      channels.push(current);
    }
    current = null;
  }

  return channels;
}

async function downloadPlaylist(catalog) {
  const response = await fetch(catalog.url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/vnd.apple.mpegurl, audio/mpegurl, text/plain, */*"
    }
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const text = await response.text();
  if (!text.trim() || (!text.includes("#EXTM3U") && !text.includes("#EXTINF:"))) {
    throw new Error("La respuesta no parece una lista M3U válida");
  }

  const channels = parseM3U(text);
  if (channels.length === 0) throw new Error("La lista M3U no contiene canales válidos");
  return channels;
}

async function refreshCatalogsInBackground() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const results = await Promise.allSettled(
      CATALOGS.map(async (catalog) => ({
        catalog,
        channels: await downloadPlaylist(catalog)
      }))
    );

    const updated = new Map(cache);
    let successCount = 0;

    results.forEach((result, index) => {
      const catalog = CATALOGS[index];

      if (result.status === "fulfilled") {
        updated.set(result.value.catalog.id, result.value.channels);
        successCount++;
        console.log(`[Global Live TV] ${catalog.name}: ${result.value.channels.length} canales cargados.`);
      } else {
        console.error(`[Global Live TV] Error cargando ${catalog.name}: ${result.reason?.message || result.reason}`);
        // Keep the previous cache for this catalog when its remote playlist fails.
      }
    });

    cache = updated;
    if (successCount > 0) lastRefresh = Date.now();
    if (successCount === 0) {
      console.error("[Global Live TV] Ninguna lista pudo actualizarse; se conserva el caché existente.");
    }
  })();

  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function getCatalogs() {
  const expired = Date.now() - lastRefresh > CACHE_MS;

  if (cache.size > 0) {
    if (expired) {
      refreshCatalogsInBackground().catch((error) => {
        console.error("[Global Live TV] Error actualizando catálogos:", error);
      });
    }
    return cache;
  }

  await refreshCatalogsInBackground();
  return cache;
}

function encodeChannel(channel, catalog) {
  const data = {
    name: channel.name,
    url: channel.url,
    logo: channel.logo,
    group: channel.group,
    referrer: channel.referrer || "",
    userAgent: channel.userAgent || "",
    country: catalog.name
  };
  return "gltv:" + Buffer.from(JSON.stringify(data)).toString("base64url");
}

function decodeChannel(id) {
  if (typeof id !== "string" || !id.startsWith("gltv:")) return null;

  try {
    const data = JSON.parse(Buffer.from(id.slice(5), "base64url").toString("utf8"));
    if (typeof data.url !== "string" || !/^https?:\/\//i.test(data.url)) return null;
    return data;
  } catch {
    return null;
  }
}

function makeMeta(channel, catalog) {
  const meta = {
    id: encodeChannel(channel, catalog),
    type: "tv",
    name: channel.name,
    description: `${catalog.name} · ${channel.group}`,
    posterShape: "landscape"
  };
  if (channel.logo && /^https?:\/\//i.test(channel.logo)) meta.poster = channel.logo;
  return meta;
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== "tv") return { metas: [] };
  const catalog = CATALOGS.find((item) => item.id === id);
  if (!catalog) return { metas: [] };

  const catalogs = await getCatalogs();
  let channels = catalogs.get(id) || [];
  const search = String(extra?.search || "").trim().toLocaleLowerCase();

  if (search) {
    channels = channels.filter((channel) => channel.name.toLocaleLowerCase().includes(search));
  }

  const unique = new Map();
  for (const channel of channels) {
    const key = `${channel.name.toLocaleLowerCase()}|${channel.url}`;
    if (!unique.has(key)) unique.set(key, channel);
  }

  return { metas: [...unique.values()].map((channel) => makeMeta(channel, catalog)) };
});

builder.defineMetaHandler(async ({ type, id }) => {
  if (type !== "tv") return { meta: null };
  const channel = decodeChannel(id);
  if (!channel) return { meta: null };

  const meta = {
    id,
    type: "tv",
    name: channel.name || "Canal en vivo",
    description: `${channel.country || "Global Live TV"} · ${channel.group || ""}`,
    posterShape: "landscape"
  };
  if (channel.logo && /^https?:\/\//i.test(channel.logo)) meta.poster = channel.logo;
  return { meta };
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== "tv") return { streams: [] };
  const channel = decodeChannel(id);
  if (!channel) return { streams: [] };

  return {
    streams: [{
      name: "Global Live TV",
      title: channel.name || "Canal en vivo",
      url: channel.url,
      behaviorHints: {
        notResponseLocation: true,
        ...((channel.userAgent || channel.referrer) ? {
          proxyHeaders: { request: {
            ...(channel.userAgent ? { "User-Agent": channel.userAgent } : {}),
            ...(channel.referrer ? { Referer: channel.referrer } : {})
          } }
        } : {})
      }
    }]
  };
});

// Start HTTP immediately; do not make deploy health checks wait for playlist downloads.
try {
  serveHTTP(builder.getInterface(), { port: PORT });
  console.log(`[Global Live TV] v8.4.3 iniciado en el puerto ${PORT}`);
} catch (error) {
  console.error("[Global Live TV] No se pudo iniciar el servidor HTTP:", error);
  process.exitCode = 1;
}

refreshCatalogsInBackground().catch((error) => {
  console.error("[Global Live TV] Error inesperado al cargar listas:", error);
});
