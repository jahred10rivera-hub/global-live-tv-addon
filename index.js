const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 7000);
const CACHE_MS = 15 * 60 * 1000;

const SOURCES = {
  global_live: {
    name: "Global Live TV",
    url: "https://iptv-org.github.io/iptv/index.m3u"
  },
  us_live: {
    name: "United States",
    url: "https://iptv-org.github.io/iptv/countries/us.m3u"
  },
  animation: {
    name: "Animation",
    url: "https://iptv-org.github.io/iptv/categories/animation.m3u"
  },
  kids: {
    name: "Kids & Family",
    url: "https://iptv-org.github.io/iptv/categories/kids.m3u"
  },
  entertainment: {
    name: "Entertainment",
    url: "https://iptv-org.github.io/iptv/categories/entertainment.m3u"
  },
  movies: {
    name: "Movies",
    url: "https://iptv-org.github.io/iptv/categories/movies.m3u"
  },
  news: {
    name: "News",
    url: "https://iptv-org.github.io/iptv/categories/news.m3u"
  },
  music: {
    name: "Music",
    url: "https://iptv-org.github.io/iptv/categories/music.m3u"
  },
  english: {
    name: "English Language",
    url: "https://iptv-org.github.io/iptv/languages/eng.m3u"
  },
  spanish: {
    name: "Spanish Language",
    url: "https://iptv-org.github.io/iptv/languages/spa.m3u"
  }
};

const manifest = {
  id: "org.community.global-live-tv",
  version: "1.1.0",
  name: "Global Live TV",
  description:
    "Live TV directory from publicly listed streams. Availability, licensing, and geographic access vary by channel.",
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
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escapedKey + '="([^"]*)"', "i");
  const match = line.match(re);
  return match ? match[1].trim() : "";
}

function makeId(name, url) {
  return (
    "gltv:" +
    crypto.createHash("sha1")
      .update(name + "|" + url)
      .digest("hex")
      .slice(0, 18)
  );
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

      const displayName =
        comma >= 0
          ? info.slice(comma + 1).trim()
          : attr(info, "tvg-name") || "Live channel";

      channels.push({
        id: makeId(displayName, line),
        name:
          displayName ||
          attr(info, "tvg-name") ||
          "Live channel",
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

  return channels;
}

const channelCache = {};

async function getChannels(sourceKey = "global_live") {
  const source = SOURCES[sourceKey];

  if (!source) {
    throw new Error(
      "Unknown channel category: " + sourceKey
    );
  }

  const cached = channelCache[sourceKey];

  if (cached && Date.now() - cached.time < CACHE_MS) {
    return cached.channels;
  }

  const response = await fetch(source.url, {
    headers: {
      "User-Agent": "GlobalLiveTV-StremioAddon/1.1"
    }
  });

  if (!response.ok) {
    throw new Error(
      "Playlist request failed for " +
      sourceKey +
      ": HTTP " +
      response.status
    );
  }

  const text = await response.text();
  const channels = parseM3U(text);

  if (!channels.length) {
    throw new Error(
      "No channels parsed from playlist: " + sourceKey
    );
  }

  channelCache[sourceKey] = {
    channels,
    time: Date.now()
  };

  return channels;
}

async function findChannelById(id) {
  // Search playlists already loaded.
  for (const entry of Object.values(channelCache)) {
    const found = entry.channels.find(
      (channel) => channel.id === id
    );

    if (found) return found;
  }

  // If necessary, search the other categories.
  for (const sourceKey of Object.keys(SOURCES)) {
    try {
      const channels = await getChannels(sourceKey);

      const found = channels.find(
        (channel) => channel.id === id
      );

      if (found) return found;
    } catch (error) {
      console.error(
        "Could not search source",
        sourceKey,
        error.message
      );
    }
  }

  return null;
}

function toMeta(channel) {
  const details = [
    channel.country
      ? "Country/area: " + channel.country
      : "",
    channel.language
      ? "Language: " + channel.language
      : "",
    channel.group
      ? "Category: " + channel.group
      : "",
    "Source: publicly listed IPTV-org playlist. Streams may be offline or geo-restricted."
  ].filter(Boolean);

  return {
    id: channel.id,
    type: "tv",
    name: channel.name,
    poster: channel.logo || undefined,
    posterShape: "landscape",
    description: details.join("\n"),
    genres: [
      channel.group,
      channel.language,
      channel.country
    ].filter(Boolean).slice(0, 3),
    runtime: "Live"
  };
}

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async (args) => {
  try {
    const sourceKey = SOURCES[args.id]
      ? args.id
      : "global_live";

    const allChannels = await getChannels(sourceKey);

    const search = String(
      (args.extra && args.extra.search) || ""
    ).trim().toLowerCase();

    const filtered = search
      ? allChannels.filter((channel) =>
          [
            channel.name,
            channel.country,
            channel.language,
            channel.group,
            channel.tvgId
          ]
            .join(" ")
            .toLowerCase()
            .includes(search)
        )
      : allChannels;

    const skip = Math.max(
      0,
      Number((args.extra && args.extra.skip) || 0)
    );

    return {
      metas: filtered
        .slice(skip, skip + 100)
        .map(toMeta)
    };
  } catch (error) {
    console.error("Catalog error:", error);
    return { metas: [] };
  }
});

builder.defineMetaHandler(async ({ id }) => {
  try {
    const channel = await findChannelById(id);

    if (!channel) {
      return { meta: null };
    }

    return {
      meta: {
        ...toMeta(channel),
        videos: [
          {
            id: channel.id,
            title: "Watch live",
            released: new Date()
              .toISOString()
              .slice(0, 10)
          }
        ]
      }
    };
  } catch (error) {
    console.error("Meta error:", error);
    return { meta: null };
  }
});

builder.defineStreamHandler(async ({ id }) => {
  try {
    const channel = await findChannelById(id);

    if (!channel) {
      return { streams: [] };
    }

    return {
      streams: [
        {
          title:
            "Live stream" +
            (channel.country
              ? " · " + channel.country
              : ""),
          name: "Global Live TV",
          url: channel.url,
          behaviorHints: {
            notWebReady: false
          }
        }
      ]
    };
  } catch (error) {
    console.error("Stream error:", error);
    return { streams: [] };
  }
});

serveHTTP(builder.getInterface(), { port: PORT });

console.log(
  "Global Live TV addon running on port " + PORT
);
