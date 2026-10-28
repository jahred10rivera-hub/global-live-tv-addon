import sdk from "stremio-addon-sdk";

const { addonBuilder, serveHTTP } = sdk;

const PORT = Number(process.env.PORT || 7000);
const CACHE_MS = 30 * 60 * 1000;

const CATALOGS = [
  {
    id: "live_spa",
    name: "🗣️ Español (Todo el Mundo)",
    url: "https://iptv-org.github.io/iptv/languages/spa.m3u"
  },
  {
    id: "live_latam",
    name: "📺 Latinoamérica",
    url: "https://iptv-org.github.io/iptv/regions/latam.m3u"
  },
  {
    id: "live_news",
    name: "📰 Noticias (Global)",
    url: "https://iptv-org.github.io/iptv/categories/news.m3u"
  },
  {
    id: "live_sports",
    name: "⚽ Deportes (Global)",
    url: "https://iptv-org.github.io/iptv/categories/sports.m3u"
  },
  {
    id: "live_movies",
    name: "🎬 Cine y Series",
    url: "https://iptv-org.github.io/iptv/categories/movies.m3u"
  }
];

const manifest = {
  id: "org.community.global-live-tv",
  version: "8.2.0",
  name: "Global Live TV - Massive",
  description: "Acceso masivo a miles de canales de televisión en vivo globales y regionales.",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  idPrefixes: ["gltv:"],
  catalogs: CATALOGS.map((catalog) => ({
    type: "tv",
    id: catalog.id,
    name: catalog.name
  }))
};

const builder = new addonBuilder(manifest);

let cache = new Map();
let lastRefresh = 0;
let refreshPromise = null;

const LOGO_REGEX = /tvg-logo="([^"]*)"/i;
const GROUP_REGEX = /group-title="([^"]*)"/i;

function parseM3U(text) {
  const channels = [];
  let current = null;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const comma = line.indexOf(",");
      const header = comma >= 0 ? line.slice(0, comma) : line;
      const name = comma >= 0 ? line.slice(comma + 1).trim() : "Canal sin nombre";

      const logoMatch = header.match(LOGO_REGEX);
      const groupMatch = header.match(GROUP_REGEX);

      current = {
        name: name || "Canal sin nombre",
        logo: logoMatch ? logoMatch[1] : "",
        group: groupMatch ? groupMatch[1] : "General",
        url: ""
      };
    } else if (!line.startsWith("#") && current) {
      if (/^https?:\/\//i.test(line)) {
        current.url = line;
        channels.push(current);
      }
      current = null;
    }
  }

  return channels;
}

async function downloadPlaylist(catalog) {
  const response = await fetch(catalog.url, {
    signal: AbortSignal.timeout(20000),
    headers: { 
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" 
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return parseM3U(await response.text());
}

async function refreshCatalogsInBackground() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const updated = new Map();

    for (const catalog of CATALOGS) {
      try {
        const channels = await downloadPlaylist(catalog);
        updated.set(catalog.id, channels);
        console.log(`[Global Live TV] ${catalog.name}: ${channels.length} canales cargados.`);
      } catch (error) {
        console.error(`Error cargando ${catalog.name}: ${error.message}`);
        updated.set(catalog.id, cache.get(catalog.id) || []);
      }
    }

    cache = updated;
    lastRefresh = Date.now();
  })();

  try {
    await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

async function getCatalogs() {
  const isExpired = Date.now() - lastRefresh > CACHE_MS;

  if (cache.size > 0) {
    if (isExpired) {
      refreshCatalogsInBackground().catch(() => {});
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
    country: catalog.name
  };

  return "gltv:" + Buffer.from(JSON.stringify(data)).toString("base64url");
}

function decodeChannel(id) {
  if (typeof id !== "string" || !id.startsWith("gltv:")) {
    return null;
  }

  try {
    const data = JSON.parse(
      Buffer.from(id.slice(5), "base64url").toString("utf8")
    );

    if (typeof data.url !== "string" || !/^https?:\/\//i.test(data.url)) {
      return null;
    }

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

  if (channel.logo && /^https?:\/\//i.test(channel.logo)) {
    meta.poster = channel.logo;
  }

  return meta;
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== "tv") return { metas: [] };

  const catalog = CATALOGS.find((item) => item.id === id);
  if (!catalog) return { metas: [] };

  const catalogs = await getCatalogs();
  let channels = catalogs.get(id) || [];

  const search = String(extra?.search || "").trim().toLowerCase();

  if (search) {
    channels = channels.filter((channel) =>
      channel.name.toLowerCase().includes(search)
    );
  }

  const unique = new Map();
  for (let i = 0; i < channels.length; i++) {
    const channel = channels[i];
    const key = `${channel.name.toLowerCase()}|${channel.url}`;
    if (!unique.has(key)) unique.set(key, channel);
  }

  return {
    metas: [...unique.values()].map((channel) => makeMeta(channel, catalog))
  };
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

  if (channel.logo && /^https?:\/\//i.test(channel.logo)) {
    meta.poster = channel.logo;
  }

  return { meta };
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== "tv") return { streams: [] };

  const channel = decodeChannel(id);
  if (!channel) return { streams: [] };

  return {
    streams: [
      {
        name: "Global Live TV",
        title: channel.name || "Canal en vivo",
        url: channel.url,
        behaviorHints: {
          notResponseLocation: true,
          proxyHeaders: {
            request: {
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
          }
        }
      }
    ]
  };
});

// Iniciar servidor HTTP al instante para pasar el health check del deploy
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`Global Live TV v8.2.0 iniciado en el puerto ${PORT}`);

// Descarga inicial de listas en segundo plano
refreshCatalogsInBackground().catch((err) => console.error("Error en carga de fondo:", err));
