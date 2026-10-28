
import { addonBuilder, serveHTTP } from "stremio-addon-sdk";

const PORT = Number(process.env.PORT || 7000);
const CACHE_MS = 15 * 60 * 1000;

const CATALOGS = [
  {
    id: "live_pr",
    name: "Puerto Rico",
    url: "https://iptv-org.github.io/iptv/countries/pr.m3u"
  },
  {
    id: "live_us",
    name: "Estados Unidos",
    url: "https://iptv-org.github.io/iptv/countries/us.m3u"
  },
  {
    id: "live_us_ca",
    name: "California",
    url: "https://iptv-org.github.io/iptv/subdivisions/us-ca.m3u"
  },
  {
    id: "live_us_fl",
    name: "Florida",
    url: "https://iptv-org.github.io/iptv/subdivisions/us-fl.m3u"
  },
  {
    id: "live_us_ny",
    name: "New York",
    url: "https://iptv-org.github.io/iptv/subdivisions/us-ny.m3u"
  },
  {
    id: "live_us_tx",
    name: "Texas",
    url: "https://iptv-org.github.io/iptv/subdivisions/us-tx.m3u"
  }
];

const manifest = {
  id: "org.community.global-live-tv",
  version: "6.0.1",
  name: "Global Live TV",
  description: "Canales de televisión en vivo de listas M3U públicas.",
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

function parseM3U(text) {
  const result = [];
  let current = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const comma = line.indexOf(",");
      const header = comma >= 0 ? line.slice(0, comma) : line;
      const name = comma >= 0
        ? line.slice(comma + 1).trim()
        : "Canal sin nombre";

      const attribute = (key) => {
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = header.match(
          new RegExp(escapedKey + '="([^"]*)"', "i")
        );
        return match ? match[1] : "";
      };

      current = {
        name: name || "Canal sin nombre",
        logo: attribute("tvg-logo"),
        group: attribute("group-title") || "Televisión en vivo",
        url: ""
      };
    } else if (!line.startsWith("#") && current) {
      if (/^https?:\/\//i.test(line)) {
        current.url = line;
        result.push(current);
      }
      current = null;
    }
  }

  return result;
}

async function downloadPlaylist(catalog) {
  const response = await fetch(catalog.url, {
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent": "GlobalLiveTV/6.0.1"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return parseM3U(await response.text());
}

async function getCatalogs() {
  if (cache.size && Date.now() - lastRefresh < CACHE_MS) {
    return cache;
  }

  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const updated = new Map();

    await Promise.all(
      CATALOGS.map(async (catalog) => {
        try {
          const channels = await downloadPlaylist(catalog);
          updated.set(catalog.id, channels);
          console.log(`${catalog.name}: ${channels.length} canales`);
        } catch (error) {
          console.error(
            `Error cargando ${catalog.name}: ${error.message}`
          );
          updated.set(catalog.id, cache.get(catalog.id) || []);
        }
      })
    );

    cache = updated;
    lastRefresh = Date.now();
    return cache;
  })();

  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
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

    if (typeof data.url !== "string") return null;
    if (!/^https?:\/\//i.test(data.url)) return null;

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

  const all = await getCatalogs();
  let channels = all.get(id) || [];

  const query = String(extra?.search || "").trim().toLowerCase();

  if (query) {
    channels = channels.filter((channel) =>
      channel.name.toLowerCase().includes(query)
    );
  }

  const unique = new Map();

  for (const channel of channels) {
    const key = `${channel.name.toLowerCase()}|${channel.url}`;
    if (!unique.has(key)) unique.set(key, channel);
  }

  return {
    metas: [...unique.values()]
      .slice(0, 300)
      .map((channel) => makeMeta(channel, catalog))
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
        url: channel.url
      }
    ]
  };
});

const addonInterface = builder.getInterface();

serveHTTP(addonInterface, { port: PORT });

console.log(`Global Live TV iniciado en el puerto ${PORT}`);
