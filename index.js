const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 7000);
const CACHE_MS = 15 * 60 * 1000;

const SOURCES = {
  all: ["All Public Channels", "https://iptv-org.github.io/iptv/index.m3u"],
  us: ["United States", "https://iptv-org.github.io/iptv/countries/us.m3u"],
  pr: ["Puerto Rico", "https://iptv-org.github.io/iptv/countries/pr.m3u"],

  animation: ["Animation", "https://iptv-org.github.io/iptv/categories/animation.m3u"],
  kids: ["Kids", "https://iptv-org.github.io/iptv/categories/kids.m3u"],
  family: ["Family", "https://iptv-org.github.io/iptv/categories/family.m3u"],
  entertainment: ["Entertainment", "https://iptv-org.github.io/iptv/categories/entertainment.m3u"],
  movies: ["Movies", "https://iptv-org.github.io/iptv/categories/movies.m3u"],
  series: ["Series", "https://iptv-org.github.io/iptv/categories/series.m3u"],
  comedy: ["Comedy", "https://iptv-org.github.io/iptv/categories/comedy.m3u"],
  news: ["News", "https://iptv-org.github.io/iptv/categories/news.m3u"],
  music: ["Music", "https://iptv-org.github.io/iptv/categories/music.m3u"],
  sports: ["Sports", "https://iptv-org.github.io/iptv/categories/sports.m3u"],
  documentary: ["Documentary", "https://iptv-org.github.io/iptv/categories/documentary.m3u"],
  education: ["Education", "https://iptv-org.github.io/iptv/categories/education.m3u"],
  cooking: ["Cooking", "https://iptv-org.github.io/iptv/categories/cooking.m3u"],
  culture: ["Culture", "https://iptv-org.github.io/iptv/categories/culture.m3u"],
  lifestyle: ["Lifestyle", "https://iptv-org.github.io/iptv/categories/lifestyle.m3u"],
  travel: ["Travel", "https://iptv-org.github.io/iptv/categories/travel.m3u"],
  science: ["Science", "https://iptv-org.github.io/iptv/categories/science.m3u"],
  weather: ["Weather", "https://iptv-org.github.io/iptv/categories/weather.m3u"],
  religious: ["Religious", "https://iptv-org.github.io/iptv/categories/religious.m3u"],
  public: ["Public TV", "https://iptv-org.github.io/iptv/categories/public.m3u"],
  general: ["General", "https://iptv-org.github.io/iptv/categories/general.m3u"],

  english: ["English", "https://iptv-org.github.io/iptv/languages/eng.m3u"],
  spanish: ["Spanish", "https://iptv-org.github.io/iptv/languages/spa.m3u"],
  portuguese: ["Portuguese", "https://iptv-org.github.io/iptv/languages/por.m3u"],
  french: ["French", "https://iptv-org.github.io/iptv/languages/fra.m3u"],
  italian: ["Italian", "https://iptv-org.github.io/iptv/languages/ita.m3u"],
  japanese: ["Japanese", "https://iptv-org.github.io/iptv/languages/jpn.m3u"],
  korean: ["Korean", "https://iptv-org.github.io/iptv/languages/kor.m3u"],

  americas: ["Americas", "https://iptv-org.github.io/iptv/regions/amer.m3u"],
  caribbean: ["Caribbean", "https://iptv-org.github.io/iptv/regions/carib.m3u"],
  latin_america: ["Latin America", "https://iptv-org.github.io/iptv/regions/latam.m3u"],
  worldwide: ["Worldwide", "https://iptv-org.github.io/iptv/regions/ww.m3u"]
};

const manifest = {
  id: "org.community.global-live-tv",
  version: "2.0.0",
  name: "Global Live TV",
  description: "Public live TV directory organized by country, language, region, and category.",
  logo: "https://www.stremio.com/website/stremio-logo-small.png",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  idPrefixes: ["gltv:"],
  catalogs: Object.entries(SOURCES).map(([id, source]) => ({
    type: "tv",
    id,
    name: source[0],
    extra: [{ name: "search", isRequired: false }]
  })),
  behaviorHints: {
    configurable: false,
    configurationRequired: false
  }
};

function attr(line, key) {
  const match = line.match(
    new RegExp(key + '="([^"]*)"', "i")
  );
  return match ? match[1].trim() : "";
}

function makeId(name, url) {
  return "gltv:" + crypto
    .createHash("sha1")
    .update(name + "|" + url)
    .digest("hex")
    .slice(0, 18);
}

function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const channels = [];
  let info = "";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      info = line;
      continue;
    }

    if (line.startsWith("#")) continue;

    if (/^https?:\/\//i.test(line) && info) {
      const comma = info.lastIndexOf(",");
      const name = comma >= 0
        ? info.slice(comma + 1).trim()
        : attr(info, "tvg-name") || "Live channel";

      channels.push({
        id: makeId(name, line),
        name: name || "Live channel",
        url: line,
        logo: attr(info, "tvg-logo"),
        country: attr(info, "tvg-country"),
        language: attr(info, "tvg-language"),
        group: attr(info, "group-title"),
        tvgId: attr(info, "tvg-id")
      });

      info = "";
    }
  }

  // Remove exact duplicate IDs.
  return [...new Map(channels.map(c => [c.id, c])).values()];
}

const cache = {};

async function getChannels(sourceId) {
  const source = SOURCES[sourceId];
  if (!source) throw new Error("Unknown source: " + sourceId);

  const cached = cache[sourceId];
  if (cached && Date.now() - cached.time < CACHE_MS) {
    return cached.channels;
  }

  const response = await fetch(source[1], {
    headers: { "User-Agent": "GlobalLiveTV/2.0" }
  });

  if (!response.ok) {
    throw new Error("Playlist failed: HTTP " + response.status);
  }

  const channels = parseM3U(await response.text());

  if (!channels.length) {
    throw new Error("No channels found in " + sourceId);
  }

  cache[sourceId] = {
    channels,
    time: Date.now()
  };

  return channels;
}

async function findChannel(id) {
  // The main playlist contains the broadest selection.
  const cachedMain = cache.all;
  if (cachedMain) {
    const found = cachedMain.channels.find(c => c.id === id);
    if (found) return found;
  }

  try {
    const main = await getChannels("all");
    const found = main.find(c => c.id === id);
    if (found) return found;
  } catch (error) {
    console.error("Main playlist lookup failed:", error.message);
  }

  // Search other lists if a channel is absent from the main list.
  for (const sourceId of Object.keys(SOURCES)) {
    if (sourceId === "all") continue;

    try {
      const channels = await getChannels(sourceId);
      const found = channels.find(c => c.id === id);
      if (found) return found;
    } catch (error) {
      console.error(sourceId + " lookup failed:", error.message);
    }
  }

  return null;
}

function toMeta(channel) {
  return {
    id: channel.id,
    type: "tv",
    name: channel.name,
    poster: channel.logo || undefined,
    posterShape: "landscape",
    description: [
      channel.country ? "Country: " + channel.country : "",
      channel.language ? "Language: " + channel.language : "",
      channel.group ? "Category: " + channel.group : "",
      "Public listing; stream availability and access may vary."
    ].filter(Boolean).join("\n"),
    genres: [channel.group, channel.language, channel.country]
      .filter(Boolean).slice(0, 3),
    runtime: "Live"
  };
}

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async args => {
  try {
    const sourceId = SOURCES[args.id] ? args.id : "all";
    const channels = await getChannels(sourceId);
    const search = String(args.extra?.search || "").trim().toLowerCase();

    const filtered = search
      ? channels.filter(c =>
          [c.name, c.country, c.language, c.group, c.tvgId]
            .join(" ")
            .toLowerCase()
            .includes(search)
        )
      : channels;

    const skip = Math.max(0, Number(args.extra?.skip || 0));

    return {
      metas: filtered.slice(skip, skip + 100).map(toMeta)
    };
  } catch (error) {
    console.error("Catalog error:", error);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ id }) => {
  try {
    const channel = await findChannel(id);
    if (!channel) return { meta: null };

    return {
      meta: {
        ...toMeta(channel),
        videos: [{
          id: channel.id,
          title: "Watch live",
          released: new Date().toISOString().slice(0, 10)
        }]
      }
    };
  } catch (error) {
    console.error("Meta error:", error);
    return { meta: null };
  }
});

builder.defineStreamHandler(async ({ id }) => {
  try {
    const channel = await findChannel(id);
    if (!channel) return { streams: [] };

    return {
      streams: [{
        title: "Live stream" +
          (channel.country ? " · " + channel.country : ""),
        name: "Global Live TV",
        url: channel.url,
        behaviorHints: { notWebReady: false }
      }]
    };
  } catch (error) {
    console.error("Stream error:", error);
    return { streams: [] };
  }
});

serveHTTP(builder.getInterface(), { port: PORT });
console.log("Global Live TV running on port " + PORT);
