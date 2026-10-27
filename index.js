const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 7000);
const CACHE_MS = 15 * 60 * 1000;

const SOURCES = {
  pr: {
    name: "🇵🇷 Puerto Rico Local",
    url: "https://iptv-org.github.io/iptv/countries/pr.m3u"
  },
  us: {
    name: "🇺🇸 USA TV",
    url: "https://iptv-org.github.io/iptv/countries/us.m3u"
  },
  us_news: {
    name: "USA News",
    url: "https://iptv-org.github.io/iptv/categories/news.m3u"
  },
  kids: {
    name: "Kids & Cartoons",
    url: "https://iptv-org.github.io/iptv/categories/kids.m3u"
  },
  animation: {
    name: "Animation",
    url: "https://iptv-org.github.io/iptv/categories/animation.m3u"
  },
  movies: {
    name: "Movies",
    url: "https://iptv-org.github.io/iptv/categories/movies.m3u"
  },
  entertainment: {
    name: "Entertainment",
    url: "https://iptv-org.github.io/iptv/categories/entertainment.m3u"
  },
  music: {
    name: "Music",
    url: "https://iptv-org.github.io/iptv/categories/music.m3u"
  },
  sports: {
    name: "Sports",
    url: "https://iptv-org.github.io/iptv/categories/sports.m3u"
  },
  spanish: {
    name: "Spanish Language",
    url: "https://iptv-org.github.io/iptv/languages/spa.m3u"
  },
  english: {
    name: "English Language",
    url: "https://iptv-org.github.io/iptv/languages/eng.m3u"
  },
  caribbean: {
    name: "Caribbean TV",
    url: "https://iptv-org.github.io/iptv/regions/carib.m3u"
  },
  americas: {
    name: "Americas TV",
    url: "https://iptv-org.github.io/iptv/regions/amer.m3u"
  },
  world: {
    name: "World TV",
    url: "https://iptv-org.github.io/iptv/index.m3u"
  }
};

const manifest = {
  id: "org.community.global-live-tv",
  version: "3.0.0",
  name: "USA TV + Puerto Rico",
  description:
    "Public live TV streams from Puerto Rico, the United States, and worldwide categories.",
  logo: "https://www.stremio.com/website/stremio-logo-small.png",
  resources: ["catalog", "meta", "stream"],
  types: ["tv"],
  idPrefixes: ["gltv:"],
  catalogs: Object.entries(SOURCES).map(([id, source]) => ({
    type: "tv",
    id,
    name: source.name,
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
  return "gltv:" +
    crypto.createHash("sha1")
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

  return [...new Map(channels.map(c => [c.id, c])).values()];
}

const cache = {};

async function getChannels(sourceId) {
  const source = SOURCES[sourceId];

  if (!source) {
    throw new Error("Unknown source: " + sourceId);
  }

  const cached = cache[sourceId];

  if (cached && Date.now() - cached.time < CACHE_MS) {
    return cached.channels;
  }

  const response = await fetch(source.url, {
    headers: {
      "User-Agent": "GlobalLiveTV/3.0"
    },
    signal: AbortSignal.timeout(20000)
  });

  if (!response.ok) {
    throw new Error(
      "Playlist error " + response.status + " for " + sourceId
    );
  }

  const text = await response.text();
  const channels = parseM3U(text);

  if (!channels.length) {
    throw new Error("No channels found for " + sourceId);
  }

  cache[sourceId] = {
    channels,
    time: Date.now()
  };

  return channels;
}

async function findChannel(id) {
  for (const entry of Object.values(cache)) {
    const found = entry.channels.find(c => c.id === id);
    if (found) return found;
  }

  for (const sourceId of Object.keys(SOURCES)) {
    try {
      const channels = await getChannels(sourceId);
      const found = channels.find(c => c.id === id);
      if (found) return found;
    } catch (error) {
      console.error(
        "Could not load " + sourceId + ": " + error.message
      );
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
      "Public listing. Availability may vary."
    ].filter(Boolean).join("\n"),
    genres: [
      channel.group,
      channel.language,
      channel.country
    ].filter(Boolean).slice(0, 3),
    runtime: "Live"
  };
}

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async args => {
  try {
    const sourceId = SOURCES[args.id] ? args.id : "pr";
    const channels = await getChannels(sourceId);

    const search = String(
      (args.extra && args.extra.search) || ""
    ).trim().toLowerCase();

    const filtered = search
      ? channels.filter(c =>
          [
            c.name,
            c.country,
            c.language,
            c.group,
            c.tvgId
          ].join(" ").toLowerCase().includes(search)
        )
      : channels;

    const skip = Math.max(
      0,
      Number((args.extra && args.extra.skip) || 0)
    );

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
        name: "USA TV + Puerto Rico",
        url: channel.url,
        behaviorHints: {
          notWebReady: false
        }
      }]
    };
  } catch (error) {
    console.error("Stream error:", error);
    return { streams: [] };
  }
});

serveHTTP(builder.getInterface(), { port: PORT });

console.log("USA TV + Puerto Rico running on port " + PORT);
