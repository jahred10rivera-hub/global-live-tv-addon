import sdk from "stremio-addon-sdk";

const { addonBuilder, serveHTTP } = sdk;
const PORT = Number(process.env.PORT || 7000);
const CACHE_MS = 15 * 60 * 1000;
const CINEMETA = "https://v3-cinemeta.strem.io";

const LIVE_CATALOGS = [
  { id: "live_pr", name: "Puerto Rico", url: "https://iptv-org.github.io/iptv/countries/pr.m3u" },
  { id: "live_us", name: "Estados Unidos", url: "https://iptv-org.github.io/iptv/countries/us.m3u" },
  { id: "live_us_ca", name: "California", url: "https://iptv-org.github.io/iptv/subdivisions/us-ca.m3u" },
  { id: "live_us_fl", name: "Florida", url: "https://iptv-org.github.io/iptv/subdivisions/us-fl.m3u" },
  { id: "live_us_ny", name: "New York", url: "https://iptv-org.github.io/iptv/subdivisions/us-ny.m3u" },
  { id: "live_us_tx", name: "Texas", url: "https://iptv-org.github.io/iptv/subdivisions/us-tx.m3u" }
];
const VOD_CATALOGS = [
  { type: "movie", id: "global_movies", name: "Películas · Catálogo global", cinemetaId: "top" },
  { type: "series", id: "global_series", name: "Series · Catálogo global", cinemetaId: "top" },
  { type: "series", id: "anime_series", name: "Anime · Series", cinemetaId: "top", genre: "Anime" }
];
const manifest = {
  id: "org.community.global-live-tv",
  version: "7.0.0",
  name: "Global Live TV + Cine",
  description: "Canales en vivo y catálogo global de películas, series y anime con metadatos.",
  resources: ["catalog", "meta", "stream"],
  types: ["tv", "movie", "series"],
  idPrefixes: ["gltv:", "cinemeta:"],
  catalogs: [
    ...LIVE_CATALOGS.map(c => ({ type: "tv", id: c.id, name: c.name })),
    ...VOD_CATALOGS.map(c => ({ type: c.type, id: c.id, name: c.name, extra: [{ name: "search", isRequired: false }] }))
  ]
};
const builder = new addonBuilder(manifest);
let liveCache = new Map();
let lastRefresh = 0;
let refreshPromise = null;

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
      const attr = key => header.match(new RegExp(key + '="([^"]*)"', "i"))?.[1] || "";
      current = { name: name || "Canal sin nombre", logo: attr("tvg-logo"), group: attr("group-title") || "Televisión en vivo", url: "" };
    } else if (!line.startsWith("#") && current) {
      if (/^https?:\/\//i.test(line)) { current.url = line; channels.push(current); }
      current = null;
    }
  }
  return channels;
}
async function downloadPlaylist(catalog) {
  const response = await fetch(catalog.url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "GlobalLiveTV/7.0.0" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return parseM3U(await response.text());
}
async function getLiveCatalogs() {
  if (liveCache.size && Date.now() - lastRefresh < CACHE_MS) return liveCache;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    const updated = new Map();
    await Promise.all(LIVE_CATALOGS.map(async c => {
      try { const items = await downloadPlaylist(c); updated.set(c.id, items); console.log(`${c.name}: ${items.length} canales`); }
      catch (e) { console.error(`Error ${c.name}: ${e.message}`); updated.set(c.id, liveCache.get(c.id) || []); }
    }));
    liveCache = updated; lastRefresh = Date.now(); return liveCache;
  })();
  try { return await refreshPromise; } finally { refreshPromise = null; }
}
function encodeChannel(channel, catalog) {
  return "gltv:" + Buffer.from(JSON.stringify({ name: channel.name, url: channel.url, logo: channel.logo, group: channel.group, country: catalog.name })).toString("base64url");
}
function decodeChannel(id) {
  if (typeof id !== "string" || !id.startsWith("gltv:")) return null;
  try {
    const d = JSON.parse(Buffer.from(id.slice(5), "base64url").toString("utf8"));
    return typeof d.url === "string" && /^https?:\/\//i.test(d.url) ? d : null;
  } catch { return null; }
}
function makeLiveMeta(channel, catalog) {
  const meta = { id: encodeChannel(channel, catalog), type: "tv", name: channel.name, description: `${catalog.name} · ${channel.group}`, posterShape: "landscape" };
  if (channel.logo && /^https?:\/\//i.test(channel.logo)) meta.poster = channel.logo;
  return meta;
}
async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { "User-Agent": "GlobalLiveTV/7.0.0" } });
  if (!response.ok) throw new Error(`Upstream HTTP ${response.status}`);
  return response.json();
}
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type === "tv") {
    const catalog = LIVE_CATALOGS.find(c => c.id === id);
    if (!catalog) return { metas: [] };
    const all = await getLiveCatalogs();
    let channels = all.get(id) || [];
    const search = String(extra?.search || "").trim().toLowerCase();
    if (search) channels = channels.filter(c => c.name.toLowerCase().includes(search));
    const unique = new Map();
    for (const c of channels) if (!unique.has(c.name.toLowerCase() + "|" + c.url)) unique.set(c.name.toLowerCase() + "|" + c.url, c);
    return { metas: [...unique.values()].slice(0, 300).map(c => makeLiveMeta(c, catalog)) };
  }
  const catalog = VOD_CATALOGS.find(c => c.id === id && c.type === type);
  if (!catalog) return { metas: [] };
  const search = String(extra?.search || "").trim();
  const url = new URL(`${CINEMETA}/catalog/${type}/${catalog.cinemetaId}.json`);
  if (search) url.searchParams.set("search", search);
  if (catalog.genre) url.searchParams.set("genre", catalog.genre);
  try {
    const data = await fetchJson(url.toString());
    let metas = Array.isArray(data.metas) ? data.metas : [];
    if (catalog.genre) metas = metas.filter(m => (m.genres || []).some(g => /anime/i.test(g)));
    return { metas: metas.slice(0, 100) };
  } catch (e) {
    console.error(`Error catálogo ${catalog.name}: ${e.message}`);
    return { metas: [] };
  }
});
builder.defineMetaHandler(async ({ type, id }) => {
  if (type === "tv") {
    const c = decodeChannel(id);
    if (!c) return { meta: null };
    const meta = { id, type: "tv", name: c.name || "Canal en vivo", description: `${c.country || "Global Live TV"} · ${c.group || ""}`, posterShape: "landscape" };
    if (c.logo && /^https?:\/\//i.test(c.logo)) meta.poster = c.logo;
    return { meta };
  }
  if ((type === "movie" || type === "series") && /^\w+:/.test(id)) {
    try {
      const data = await fetchJson(`${CINEMETA}/meta/${type}/${encodeURIComponent(id)}.json`);
      return { meta: data.meta || null };
    } catch (e) {
      console.error(`Error metadata ${id}: ${e.message}`);
      return { meta: null };
    }
  }
  return { meta: null };
});
builder.defineStreamHandler(async ({ type, id }) => {
  if (type === "tv") {
    const c = decodeChannel(id);
    if (!c) return { streams: [] };
    return { streams: [{ name: "Global Live TV", title: c.name || "Canal en vivo", url: c.url }] };
  }
  // Global metadata is not itself a video stream. Only add movie/episode URLs
  // here when the source is authorized and the direct playback URL is verified.
  return { streams: [] };
});
serveHTTP(builder.getInterface(), { port: PORT });
console.log(`Global Live TV + Cine iniciado en el puerto ${PORT}`);
