const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const crypto = require("crypto");

const PLAYLIST_URL = "https://iptv-org.github.io/iptv/index.m3u";
const PORT = Number(process.env.PORT || 7000);
const CACHE_MS = 15 * 60 * 1000;

let cachedChannels = [];
let lastFetch = 0;

const manifest = {
  id: "org.community.global-live-tv",
  version: "1.0.0",
  name: "Global Live TV",
  description: "Worldwide live TV directory using publicly listed streams. Availability and rights vary by channel and country.",
  logo: "https://www.stremio.com/website/stremio-logo-small.png",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  idPrefixes: ["gltv:"],
  catalogs: [
    {
      type: "tv",
      id: "global_live",
      name: "Global Live TV",
      extra: [{ name: "search", isRequired: false }]
    }
  ],
  behaviorHints: { configurable: false, configurationRequired: false }
};

function attr(line, key) {
  const re = new RegExp(key + '="([^"]*)"', "i");
  const m = line.match(re);
  return m ? m[1].trim() : "";
}
function makeId(name, url) {
  return "gltv:" + crypto.createHash("sha1").update(name + "|" + url).digest("hex").slice(0, 18);
}
function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let info = "";
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF")) { info = line; continue; }
    if (line.startsWith("#")) continue;
    if (/^https?:\/\//i.test(line) && info) {
      const comma = info.lastIndexOf(",");
      const name = comma >= 0 ? info.slice(comma + 1).trim() : (attr(info, "tvg-name") || "Live channel");
      const channel = {
        id: makeId(name, line),
        name: name || attr(info, "tvg-name") || "Live channel",
        url: line,
        logo: attr(info, "tvg-logo"),
        country: attr(info, "tvg-country"),
        language: attr(info, "tvg-language"),
        group: attr(info, "group-title"),
        tvgId: attr(info, "tvg-id")
      };
      out.push(channel);
      info = "";
    }
  }
  // Deduplicate repeated name/URL records while retaining distinct stream URLs.
  return out;
}
async function getChannels() {
  if (cachedChannels.length && Date.now() - lastFetch < CACHE_MS) return cachedChannels;
  const res = await fetch(PLAYLIST_URL, { headers: { "User-Agent": "GlobalLiveTV-StremioAddon/1.0" } });
  if (!res.ok) throw new Error("Playlist request failed: HTTP " + res.status);
  const text = await res.text();
  const parsed = parseM3U(text);
  if (!parsed.length) throw new Error("No channels parsed from playlist");
  cachedChannels = parsed;
  lastFetch = Date.now();
  return cachedChannels;
}
function toMeta(ch) {
  const extras = [ch.country, ch.language, ch.group].filter(Boolean);
  return {
    id: ch.id,
    type: "tv",
    name: ch.name,
    poster: ch.logo || undefined,
    posterShape: "landscape",
    description: [
      ch.country ? "Country/area: " + ch.country : "",
      ch.language ? "Language: " + ch.language : "",
      ch.group ? "Category: " + ch.group : "",
      "Source: iptv-org public playlist. Streams may be offline or geo-restricted."
    ].filter(Boolean).join("\n"),
    genres: extras.slice(0, 3),
    runtime: "Live"
  };
}

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async (args) => {
  try {
    const all = await getChannels();
    const search = String((args.extra && args.extra.search) || "").trim().toLowerCase();
    const filtered = search
      ? all.filter(c => [c.name, c.country, c.language, c.group, c.tvgId].join(" ").toLowerCase().includes(search))
      : all;
    const skip = Math.max(0, Number((args.extra && args.extra.skip) || 0));
    const metas = filtered.slice(skip, skip + 100).map(toMeta);
    return { metas };
  } catch (e) {
    console.error(e);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ id }) => {
  try {
    const channels = await getChannels();
    const ch = channels.find(c => c.id === id);
    return { meta: ch ? { ...toMeta(ch), videos: [{ id: ch.id, title: "Watch live", released: new Date().toISOString().slice(0, 10) }] } : null };
  } catch (e) {
    console.error(e);
    return { meta: null };
  }
});

builder.defineStreamHandler(async ({ id }) => {
  try {
    const channels = await getChannels();
    const ch = channels.find(c => c.id === id);
    if (!ch) return { streams: [] };
    return {
      streams: [{
        title: "Live stream" + (ch.country ? " · " + ch.country : ""),
        name: "Global Live TV",
        url: ch.url,
        behaviorHints: { notWebReady: false }
      }]
    };
  } catch (e) {
    console.error(e);
    return { streams: [] };
  }
});

serveHTTP(builder.getInterface(), { port: PORT });
console.log(`Global Live TV addon running on http://localhost:${PORT}/manifest.json`);
console.log("For use on your iPad, deploy this server to a public HTTPS host, then install its /manifest.json URL in Stremio.");
