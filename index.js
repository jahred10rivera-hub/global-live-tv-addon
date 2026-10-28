
import { addonBuilder, serveHTTP } from "stremio-addon-sdk";

const PORT = Number(process.env.PORT || 7000);
const CACHE_MS = 15 * 60 * 1000;

const PLAYLISTS = {
  pr: [
    {
      id: "live_pr",
      name: "Puerto Rico",
      url: "https://iptv-org.github.io/iptv/countries/pr.m3u"
    }
  ],
  us: [
    {
      id: "live_us",
      name: "Estados Unidos",
      url: "https://iptv-org.github.io/iptv/countries/us.m3u"
    }
  ],
  states: [
    ["ca", "California"],
    ["ny", "New York"],
    ["fl", "Florida"],
    ["tx", "Texas"],
    ["il", "Illinois"],
    ["ga", "Georgia"],
    ["nj", "New Jersey"],
    ["pa", "Pennsylvania"],
    ["wa", "Washington"],
    ["ma", "Massachusetts"],
    ["oh", "Ohio"]
  ].map(([code, name]) => ({
    id: `live_us_${code}`,
    name,
    url: `https://iptv-org.github.io/iptv/subdivisions/us-${code}.m3u`
  }))
};

const CATALOGS = [
  ...PLAYLISTS.pr,
  ...PLAYLISTS.us,
  ...PLAYLISTS.states
];

const manifest = {
  id: "org.community.global-live-tv",
  version: "6.0.0",
  name: "Global Live TV",
  description:
    "Televisión en vivo de Puerto Rico y Estados Unidos desde listas M3U públicas.",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  idPrefixes: ["gltv:"],
  catalogs: CATALOGS.map((catalog) => ({
    type: "tv",
    id: catalog.id,
    name: catalog.name,
    extra: [{ name: "search", isRequired: false }]
  }))
};

const builder = new addonBuilder(manifest);

let cachedAt = 0;
let cachedCatalogs = new Map();

function parseM3U(text, catalog) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const comma = line.indexOf(",");
      const attributes = comma >= 0 ? line.slice(0, comma) : line;
      const name = comma >= 0
        ? line.slice(comma + 1).trim()
        : "Canal sin nombre";

      const getAttribute = (key) => {
        const match = attributes.match(
          new RegExp(`(?:^|\\\\s)${key}="([^"]*)"`, "i")
        );
        return match?.[1] || "";
      };

      current = {
        name: name || "Canal sin nombre",
        logo: getAttribute("tvg-logo"),
        group: getAttribute("group-title") || catalog.name,
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

async function loadCatalog(catalog) {
  const response = await fetch(catalog.url, {
    headers: { "User-Agent": "GlobalLiveTV/6.0" },
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} en ${catalog.url}`);
  }

  const text = await response.text();
  return parseM3U(text, catalog);
}

async function refreshCatalogs() {
  if (Date.now() - cachedAt < CACHE_MS && cachedCatalogs.size) {
    return cachedCatalogs;
  }

  const next = new Map();

  await Promise.all(CATALOGS.map(async (catalog) => {
    try {
      const channels = await loadCatalog(catalog);
      next.set(catalog.id, channels);
      console.log(`${catalog.name}: ${channels.length} canales`);
    } catch (error) {
      console.error(
        `No se pudo actualizar ${catalog.name}: ${error.message}`
      );
      next.set(catalog.id, []);
    }
  }));

  cachedCatalogs = next;
  cachedAt = Date.now();
  return cachedCatalogs;
}

function makeId(channel, catalog) {
  const payload = {
    n: channel.name,
    u: channel.url,
    l: channel.logo,
    g: channel.group,
    c: catalog.name
  };

  return "gltv:" + Buffer.from(JSON.stringify(payload)).toString("base64url");
}

function decodeId(id) {
  if (!id.startsWith("gltv:")) return null;

  try {
    return JSON.parse(
      Buffer.from(id.slice(5), "base64url").toString("utf8")
    );
  } catch {
    return null;
  }
}

function toMeta(channel, catalog) {
  const meta = {
    id: makeId(channel, catalog),
    type: "tv",
    name: channel.name,
    description: `${catalog.name} · ${channel.group || "Televisión en vivo"}`,
    poster: channel.logo || undefined,
    posterShape: "landscape"
  };

  if (!meta.poster) delete meta.poster;
  return meta;
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== "tv") return { metas: [] };

  const catalog = CATALOGS.find((item) => item.id === id);
  if (!catalog) return { metas: [] };

  const catalogs = await refreshCatalogs();
  let channels = catalogs.get(id) || [];

  const search = String(extra?.search || "").trim().toLowerCase();
  if (search) {
    channels = channels.filter((channel) =>
      channel.name.toLowerCase().includes(search)
    );
  }

  const seen = new Set();
  const metas = [];

  for (const channel of channels) {
    const key = `${channel.name.toLowerCase()}|${channel.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    metas.push(toMeta(channel, catalog));
  }

  return { metas: metas.slice(0, 300) };
});

builder.defineMetaHandler(async ({ type, id }) => {
  if (type !== "tv") return { meta: null };

  const channel = decodeId(id);
  if (!channel?.u || !/^https?:\/\//i.test(channel.u)) {
    return { meta: null };
  }

  return {
    meta: {
      id,
      type: "tv",
      name: channel.n || "Canal en vivo",
      description: `${channel.c || "Global Live TV"} · ${channel.g || "Televisión"}`,
      poster: channel.l || undefined,
      posterShape: "landscape"
    }
  };
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== "tv") return { streams: [] };

  const channel = decodeId(id);
  if (!channel?.u || !/^https?:\/\//i.test(channel.u)) {
    return { streams: [] };
  }

  return {
    streams: [
      {
        name: "Global Live TV",
        title: channel.n || "Canal en vivo",
        url: channel.u
      }
    ]
  };
});

const addon = builder.getInterface();

serveHTTP(addon, { port: PORT });

console.log(`Global Live TV listo en el puerto ${PORT}`);
