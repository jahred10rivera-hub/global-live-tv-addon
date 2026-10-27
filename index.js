
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const PORT = process.env.PORT || 7000;
const ANILIST_URL = "https://graphql.anilist.co";

const manifest = {
  id: "org.community.global-live-tv",
  version: "4.0.0",
  name: "Global Live TV + Anime",
  description:
    "Canales de Puerto Rico y Estados Unidos, además de anime por temporada, populares y clásicos.",
  resources: ["catalog", "meta", "stream"],
  types: ["tv", "series"],
  idPrefixes: ["glvtv_", "anilist_"],
  catalogs: [
    { type: "tv", id: "all_channels", name: "🌎 Todos los canales" },
    { type: "tv", id: "pr", name: "🇵🇷 Puerto Rico" },
    { type: "tv", id: "us", name: "🇺🇸 Estados Unidos" },
    { type: "tv", id: "news", name: "📰 Noticias" },
    { type: "tv", id: "kids", name: "🧒 Infantil" },
    { type: "tv", id: "animation", name: "🎨 Animación" },
    { type: "tv", id: "movies", name: "🎬 Películas" },
    { type: "tv", id: "entertainment", name: "📺 Entretenimiento" },
    { type: "tv", id: "music", name: "🎵 Música" },
    { type: "tv", id: "sports", name: "🏆 Deportes" },

    {
      type: "series",
      id: "anime_current",
      name: "🍂 Anime de la temporada actual"
    },
    {
      type: "series",
      id: "anime_2026_fall",
      name: "🍂 Anime otoño 2026"
    },
    {
      type: "series",
      id: "anime_2026_summer",
      name: "☀️ Anime verano 2026"
    },
    {
      type: "series",
      id: "anime_2026_spring",
      name: "🌸 Anime primavera 2026"
    },
    {
      type: "series",
      id: "anime_2026_winter",
      name: "❄️ Anime invierno 2026"
    },
    {
      type: "series",
      id: "anime_popular",
      name: "🔥 Anime populares"
    },
    {
      type: "series",
      id: "anime_classics",
      name: "🏆 Anime clásicos"
    }
  ]
};

const builder = new addonBuilder(manifest);

const SOURCES = {
  pr: "https://iptv-org.github.io/iptv/countries/pr.m3u",
  us: "https://iptv-org.github.io/iptv/countries/us.m3u"
};

const CHANNEL_CACHE_MS = 10 * 60 * 1000;
let channelCache = { time: 0, channels: [] };

const SEASONS = {
  winter: "WINTER",
  spring: "SPRING",
  summer: "SUMMER",
  fall: "FALL"
};

function cleanText(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function getAttribute(line, name) {
  const regex = new RegExp(name + '="([^"]*)"', "i");
  const match = line.match(regex);
  return match ? cleanText(match[1]) : "";
}

function makeChannelId(name, url) {
  const base = (name + "_" + url)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 100);

  return "glvtv_" + base;
}

function parseM3U(text, country) {
  const lines = String(text || "").split(/\r?\n/);
  const channels = [];
  let pending = null;

  for (const lineRaw of lines) {
    const line = lineRaw.trim();

    if (line.startsWith("#EXTINF")) {
      const comma = line.lastIndexOf(",");
      const name = comma >= 0
        ? cleanText(line.slice(comma + 1))
        : getAttribute(line, "tvg-name");

      pending = {
        name: name || getAttribute(line, "tvg-name") || "Canal",
        logo: getAttribute(line, "tvg-logo"),
        group: getAttribute(line, "group-title"),
        language: getAttribute(line, "tvg-language"),
        country,
        url: ""
      };
    } else if (line && !line.startsWith("#") && pending) {
      pending.url = line;
      pending.id = makeChannelId(pending.name, line);
      channels.push(pending);
      pending = null;
    }
  }

  return channels;
}

async function fetchPlaylist(country, url) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "GlobalLiveTV-Stremio/4.0" }
    });

    if (!response.ok) return [];

    const text = await response.text();
    return parseM3U(text, country);
  } catch (error) {
    console.error("Error descargando lista", country, error.message);
    return [];
  }
}

async function getChannels() {
  if (
    channelCache.channels.length &&
    Date.now() - channelCache.time < CHANNEL_CACHE_MS
  ) {
    return channelCache.channels;
  }

  const [pr, us] = await Promise.all([
    fetchPlaylist("pr", SOURCES.pr),
    fetchPlaylist("us", SOURCES.us)
  ]);

  const unique = new Map();

  for (const channel of [...pr, ...us]) {
    if (channel.url && !unique.has(channel.id)) {
      unique.set(channel.id, channel);
    }
  }

  const channels = [...unique.values()];
  channelCache = { time: Date.now(), channels };
  return channels;
}

function matchesCategory(channel, category) {
  const text = (
    channel.name + " " +
    channel.group + " " +
    channel.language
  ).toLowerCase();

  const groups = {
    news: /news|noticia|noticias|actualidad|informativo/,
    kids: /kids|children|infantil|family|niños|ninos/,
    animation: /animation|cartoon|anime|animación|animacion/,
    movies: /movie|movies|film|película|pelicula|cinema|cine/,
    entertainment: /entertainment|variety|reality|entretenimiento/,
    music: /music|musica|música|concert|radio/,
    sports: /sport|sports|deporte|deportes|football|soccer/
  };

  return groups[category] ? groups[category].test(text) : false;
}

function channelMeta(channel) {
  return {
    id: channel.id,
    type: "tv",
    name: channel.name,
    poster: channel.logo || undefined,
    posterShape: "landscape",
    description:
      "Canal de televisión en directo. " +
      "La disponibilidad depende de la fuente y la región.",
    genres: [channel.country === "pr" ? "Puerto Rico" : "Estados Unidos"],
    links: [
      {
        name: "Abrir fuente original",
        category: "other",
        url: channel.url
      }
    ]
  };
}

async function aniListRequest(query, variables = {}) {
  try {
    const response = await fetch(ANILIST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      console.error("AniList respondió", response.status);
      return null;
    }

    const json = await response.json();
    if (json.errors) {
      console.error("Error de AniList:", JSON.stringify(json.errors));
      return null;
    }

    return json.data || null;
  } catch (error) {
    console.error("No se pudo consultar AniList:", error.message);
    return null;
  }
}

const ANIME_FIELDS = `
  id
  idMal
  title { romaji english native }
  description(asHtml: false)
  coverImage { extraLarge large }
  bannerImage
  season
  seasonYear
  episodes
  averageScore
  genres
  format
  status
  startDate { year month day }
  trailer { id site }
`;

const ANIME_QUERY = `
  query (
    $page: Int,
    $perPage: Int,
    $season: MediaSeason,
    $seasonYear: Int,
    $search: String,
    $sort: [MediaSort]
  ) {
    Page(page: $page, perPage: $perPage) {
      media(
        type: ANIME,
        isAdult: false,
        page: $page,
        perPage: $perPage,
        season: $season,
        seasonYear: $seasonYear,
        search: $search,
        sort: $sort
      ) {
        ${ANIME_FIELDS}
      }
    }
  }
`;

function currentSeason() {
  const month = new Date().getUTCMonth() + 1;

  if (month <= 3) return "WINTER";
  if (month <= 6) return "SPRING";
  if (month <= 9) return "SUMMER";
  return "FALL";
}

function currentSeasonYear() {
  return new Date().getUTCFullYear();
}

function animeId(id) {
  return "anilist_" + id;
}

function animeTitle(anime) {
  return (
    anime.title?.english ||
    anime.title?.romaji ||
    anime.title?.native ||
    "Anime sin título"
  );
}

function animeMeta(anime) {
  const title = animeTitle(anime);
  const description = cleanText(
    (anime.description || "No hay sinopsis disponible.")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
  );

  const meta = {
    id: animeId(anime.id),
    type: "series",
    name: title,
    poster:
      anime.coverImage?.extraLarge ||
      anime.coverImage?.large ||
      undefined,
    background: anime.bannerImage || undefined,
    description: description.slice(0, 5000),
    genres: anime.genres || [],
    releaseInfo: anime.seasonYear
      ? String(anime.seasonYear)
      : "",
    links: [
      {
        name: "Ficha de AniList",
        category: "other",
        url: "https://anilist.co/anime/" + anime.id
      }
    ]
  };

  if (anime.averageScore) {
    meta.imdbRating = (anime.averageScore / 10).toFixed(1);
  }

  // Solo añadimos un video cuando AniList informa un tráiler de YouTube.
  // Es un tráiler, no un episodio completo.
  if (
    anime.trailer &&
    anime.trailer.site === "youtube" &&
    /^[A-Za-z0-9_-]+$/.test(anime.trailer.id || "")
  ) {
    meta.videos = [
      {
        id: "glvtv_trailer_" + anime.id,
        title: "Tráiler oficial (no es un episodio)",
        season: 0,
        episode: 1,
        thumbnail: meta.background || meta.poster,
        overview: "Tráiler listado por AniList."
      }
    ];
  }

  return meta;
}

async function getAnimeCatalog(catalogId, search) {
  let season;
  let year;
  let sort = ["POPULARITY_DESC", "SCORE_DESC"];
  let page = 1;

  if (catalogId === "anime_current") {
    season = currentSeason();
    year = currentSeasonYear();
    sort = ["POPULARITY_DESC", "SCORE_DESC"];
  } else if (catalogId.startsWith("anime_2026_")) {
    season = SEASONS[catalogId.replace("anime_2026_", "")];
    year = 2026;
    sort = ["POPULARITY_DESC", "SCORE_DESC"];
  } else if (catalogId === "anime_popular") {
    sort = ["POPULARITY_DESC", "SCORE_DESC"];
  } else if (catalogId === "anime_classics") {
    // Series anteriores a 2015 ordenadas por puntuación.
    sort = ["SCORE_DESC", "POPULARITY_DESC"];
  } else {
    return [];
  }

  const query = search
    ? ANIME_QUERY
    : ANIME_QUERY;

  const variables = {
    page,
    perPage: 100,
    sort
  };

  if (season) variables.season = season;
  if (year) variables.seasonYear = year;
  if (search) variables.search = search;

  const data = await aniListRequest(query, variables);
  let results = data?.Page?.media || [];

  if (catalogId === "anime_classics") {
    results = results.filter(
      anime => anime.seasonYear && anime.seasonYear < 2015
    );
  }

  return results.map(animeMeta);
}

builder.defineCatalogHandler(async (args) => {
  const { type, id, extra = {} } = args;
  const search = extra.search || "";

  if (type === "series") {
    const metas = await getAnimeCatalog(id, search);
    return { metas };
  }

  if (type === "tv") {
    const channels = await getChannels();
    let filtered = channels;

    if (id === "pr" || id === "us") {
      filtered = channels.filter(channel => channel.country === id);
    } else if (id !== "all_channels") {
      filtered = channels.filter(channel => matchesCategory(channel, id));
    }

    if (search) {
      const needle = search.toLowerCase();
      filtered = filtered.filter(channel =>
        channel.name.toLowerCase().includes(needle)
      );
    }

    const skip = Math.max(0, Number(extra.skip) || 0);
    const metas = filtered
      .slice(skip, skip + 100)
      .map(channelMeta);

    return { metas };
  }

  return { metas: [] };
});

builder.defineMetaHandler(async (args) => {
  const { type, id } = args;

  if (type === "tv") {
    const channels = await getChannels();
    const channel = channels.find(item => item.id === id);
    return { meta: channel ? channelMeta(channel) : null };
  }

  if (type === "series" && id.startsWith("anilist_")) {
    const rawId = id.replace("anilist_", "");
    if (!/^\d+$/.test(rawId)) return { meta: null };

    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          ${ANIME_FIELDS}
        }
      }
    `;

    const data = await aniListRequest(query, { id: Number(rawId) });
    return { meta: data?.Media ? animeMeta(data.Media) : null };
  }

  return { meta: null };
});

builder.defineStreamHandler(async (args) => {
  const { type, id } = args;

  if (type === "tv") {
    const channels = await getChannels();
    const channel = channels.find(item => item.id === id);

    if (!channel || !channel.url) return { streams: [] };

    return {
      streams: [
        {
          title: "Live TV • Fuente de la lista pública",
          url: channel.url,
          behaviorHints: {
            notWebReady: false
          }
        }
      ]
    };
  }

  if (type === "series" && id.startsWith("glvtv_trailer_")) {
    const rawId = id.replace("glvtv_trailer_", "");
    if (!/^\d+$/.test(rawId)) return { streams: [] };

    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          trailer { id site }
        }
      }
    `;

    const data = await aniListRequest(query, { id: Number(rawId) });
    const trailer = data?.Media?.trailer;

    if (
      trailer?.site === "youtube" &&
      /^[A-Za-z0-9_-]+$/.test(trailer.id || "")
    ) {
      return {
        streams: [
          {
            title: "Tráiler de YouTube • No es el episodio completo",
            ytId: trailer.id
          }
        ]
      };
    }
  }

  // No generamos enlaces falsos ni sustituimos episodios por fuentes no verificadas.
  return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: PORT });
