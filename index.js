
const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

const PORT = process.env.PORT || 7000;
const ANILIST_URL = "https://graphql.anilist.co";

const manifest = {
  id: "org.community.global-live-tv",
  version: "5.0.0",
  name: "Global Live TV USA + Puerto Rico + Anime",
  description:
    "Televisión de Puerto Rico y Estados Unidos, canales destacados y catálogo de anime por temporada.",
  resources: ["catalog", "meta", "stream"],
  types: ["tv", "series"],
  idPrefixes: ["glvtv_", "anilist_"],
  catalogs: [
    { type: "tv", id: "featured_us", name: "⭐ Canales populares de EE. UU." },
    { type: "tv", id: "us", name: "🇺🇸 Todos los canales de EE. UU." },
    { type: "tv", id: "pr", name: "🇵🇷 Puerto Rico" },
    { type: "tv", id: "news", name: "📰 Noticias" },
    { type: "tv", id: "sports", name: "🏈 Deportes" },
    { type: "tv", id: "movies", name: "🎬 Películas" },
    { type: "tv", id: "entertainment", name: "📺 Entretenimiento" },
    { type: "tv", id: "kids", name: "🧒 Infantil" },
    { type: "tv", id: "animation", name: "🎨 Animación" },
    { type: "tv", id: "music", name: "🎵 Música" },
    { type: "tv", id: "all_channels", name: "🌎 Todos los canales" },

    { type: "series", id: "anime_current", name: "🍂 Anime de la temporada actual" },
    { type: "series", id: "anime_2026_fall", name: "🍂 Anime otoño 2026" },
    { type: "series", id: "anime_2026_summer", name: "☀️ Anime verano 2026" },
    { type: "series", id: "anime_2026_spring", name: "🌸 Anime primavera 2026" },
    { type: "series", id: "anime_2026_winter", name: "❄️ Anime invierno 2026" },
    { type: "series", id: "anime_popular", name: "🔥 Anime populares" },
    { type: "series", id: "anime_classics", name: "🏆 Anime clásicos" }
  ]
};

const builder = new addonBuilder(manifest);

// Listas públicas de IPTV-org.
// Las listas estatales añaden canales locales que pueden faltar
// o resultar difíciles de encontrar en la lista nacional.
const PLAYLISTS = [
  { country: "pr", url: "https://iptv-org.github.io/iptv/countries/pr.m3u" },
  { country: "us", url: "https://iptv-org.github.io/iptv/countries/us.m3u" },

  { country: "us", url: "https://iptv-org.github.io/iptv/subdivisions/us-ca.m3u" },
  { country: "us", url: "https://iptv-org.github.io/iptv/subdivisions/us-ny.m3u" },
  { country: "us", url: "https://iptv-org.github.io/iptv/subdivisions/us-fl.m3u" },
  { country: "us", url: "https://iptv-org.github.io/iptv/subdivisions/us-tx.m3u" },
  { country: "us", url: "https://iptv-org.github.io/iptv/subdivisions/us-il.m3u" },
  { country: "us", url: "https://iptv-org.github.io/iptv/subdivisions/us-ga.m3u" },
  { country: "us", url: "https://iptv-org.github.io/iptv/subdivisions/us-nj.m3u" },
  { country: "us", url: "https://iptv-org.github.io/iptv/subdivisions/us-pa.m3u" },
  { country: "us", url: "https://iptv-org.github.io/iptv/subdivisions/us-wa.m3u" },
  { country: "us", url: "https://iptv-org.github.io/iptv/subdivisions/us-ma.m3u" },
  { country: "us", url: "https://iptv-org.github.io/iptv/subdivisions/us-oh.m3u" }
];

const CACHE_MS = 15 * 60 * 1000;
let channelCache = { time: 0, channels: [] };

const FEATURED_NAMES = [
  "abc news live",
  "cbs news",
  "nbc news",
  "nbc news now",
  "pbs",
  "pbs kids",
  "nasa",
  "bloomberg",
  "weather channel",
  "court tv",
  "c-span",
  "newsmax",
  "cheddar",
  "fox weather",
  "sky news",
  "reuters",
  "telemundo",
  "univision",
  "ion",
  "buzzr",
  "retro tv",
  "tastemade",
  "qvc",
  "hsn",
  "vevo",
  "vevo pop",
  "vevo country",
  "vevo 80s",
  "vevo 90s"
];

function clean(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function attr(line, name) {
  const match = line.match(new RegExp(name + '="([^"]*)"', "i"));
  return match ? clean(match[1]) : "";
}

function makeId(name, url) {
  return "glvtv_" + (name + "_" + url)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 110);
}

function parseM3U(text, sourceCountry) {
  const lines = String(text || "").split(/\r?\n/);
  const channels = [];
  let pending = null;

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith("#EXTINF")) {
      const comma = line.lastIndexOf(",");
      const fallbackName = comma >= 0 ? line.slice(comma + 1) : "";

      pending = {
        name: clean(attr(line, "tvg-name") || fallbackName || "Canal"),
        logo: attr(line, "tvg-logo"),
        group: attr(line, "group-title"),
        language: attr(line, "tvg-language"),
        listedCountry: attr(line, "tvg-country"),
        country: sourceCountry,
        url: ""
      };
    } else if (line && !line.startsWith("#") && pending) {
      pending.url = line;
      pending.id = makeId(pending.name, line);
      channels.push(pending);
      pending = null;
    }
  }

  return channels;
}

async function loadPlaylist(source) {
  try {
    const response = await fetch(source.url, {
      headers: { "User-Agent": "GlobalLiveTV/5.0" },
      signal: AbortSignal.timeout(20000)
    });

    if (!response.ok) {
      console.warn("Playlist no disponible:", source.url, response.status);
      return [];
    }

    return parseM3U(await response.text(), source.country);
  } catch (error) {
    console.warn("No se pudo cargar:", source.url, error.message);
    return [];
  }
}

async function getChannels() {
  if (
    channelCache.channels.length &&
    Date.now() - channelCache.time < CACHE_MS
  ) {
    return channelCache.channels;
  }

  const results = await Promise.all(PLAYLISTS.map(loadPlaylist));
  const byUrl = new Map();

  for (const list of results) {
    for (const channel of list) {
      if (!channel.url) continue;

      // Un mismo enlace puede salir en la lista nacional y en la estatal.
      // Guardamos una sola copia.
      const key = channel.url.trim();
      if (!byUrl.has(key)) byUrl.set(key, channel);
    }
  }

  const channels = [...byUrl.values()];
  channelCache = { time: Date.now(), channels };
  console.log("Canales cargados:", channels.length);
  return channels;
}

function categoryMatch(channel, category) {
  const text = (
    channel.name + " " + channel.group + " " + channel.language
  ).toLowerCase();

  const patterns = {
    news: /news|noticia|noticias|actualidad|informativo|bloomberg|c-span/,
    sports: /sport|sports|deporte|deportes|football|soccer|basketball|baseball|racing/,
    movies: /movie|movies|film|película|pelicula|cinema|cine|classic films/,
    entertainment: /entertainment|reality|variety|game show|comedy|drama/,
    kids: /kids|children|infantil|family|pbs kids|cartoonito/,
    animation: /animation|cartoon|anime|animación|animacion/,
    music: /music|musica|música|vevo|concert|mtv/
  };

  return patterns[category] ? patterns[category].test(text) : false;
}

function isUS(channel) {
  return channel.country === "us";
}

function isPR(channel) {
  return channel.country === "pr";
}

function featuredScore(channel) {
  const name = channel.name.toLowerCase();
  const index = FEATURED_NAMES.findIndex(term => name.includes(term));

  // Coincidencias conocidas aparecen primero.
  if (index !== -1) return index;

  // Otras fuentes públicas de noticias y televisión general después.
  if (/news|pbs|nasa|weather|bloomberg|c-span/.test(name)) return 100;
  if (/vevo|music|radio/.test(name)) return 200;
  if (/classic|retro|archive/.test(name)) return 300;

  return 1000;
}

function channelMeta(channel) {
  return {
    id: channel.id,
    type: "tv",
    name: channel.name,
    poster: channel.logo || undefined,
    posterShape: "landscape",
    description:
      "Canal de televisión listado en una playlist pública. " +
      "La disponibilidad, calidad y autorización de cada señal dependen de su proveedor.",
    genres: [
      channel.country === "pr" ? "Puerto Rico" : "Estados Unidos",
      channel.group || "Televisión"
    ].filter(Boolean),
    links: [{
      name: "Fuente de la señal",
      category: "other",
      url: channel.url
    }]
  };
}

// ---------------- ANIME / ANILIST ----------------

const SEASONS = {
  winter: "WINTER",
  spring: "SPRING",
  summer: "SUMMER",
  fall: "FALL"
};

function currentSeason() {
  const month = new Date().getUTCMonth() + 1;
  if (month <= 3) return "WINTER";
  if (month <= 6) return "SPRING";
  if (month <= 9) return "SUMMER";
  return "FALL";
}

function animeTitle(anime) {
  return anime.title?.english ||
    anime.title?.romaji ||
    anime.title?.native ||
    "Anime";
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
      console.warn("AniList respondió:", response.status);
      return null;
    }

    const json = await response.json();
    if (json.errors) {
      console.warn("Error de AniList:", JSON.stringify(json.errors));
      return null;
    }

    return json.data || null;
  } catch (error) {
    console.warn("Error consultando AniList:", error.message);
    return null;
  }
}

const ANIME_FIELDS = `
  id
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

function animeMeta(anime) {
  const meta = {
    id: "anilist_" + anime.id,
    type: "series",
    name: animeTitle(anime),
    poster: anime.coverImage?.extraLarge || anime.coverImage?.large,
    background: anime.bannerImage || undefined,
    description: (anime.description || "Sinopsis no disponible.")
      .replace(/<[^>]*>/g, " ")
      .slice(0, 5000),
    genres: anime.genres || [],
    releaseInfo: anime.seasonYear ? String(anime.seasonYear) : "",
    links: [{
      name: "Ficha de AniList",
      category: "other",
      url: "https://anilist.co/anime/" + anime.id
    }]
  };

  // Los tráileres se ofrecen como tráileres, no como episodios completos.
  if (
    anime.trailer?.site === "youtube" &&
    /^[A-Za-z0-9_-]+$/.test(anime.trailer.id || "")
  ) {
    meta.videos = [{
      id: "glvtv_trailer_" + anime.id,
      title: "Tráiler de YouTube (no es episodio completo)",
      season: 0,
      episode: 1,
      thumbnail: meta.background || meta.poster,
      overview: "Tráiler listado por AniList."
    }];
  }

  return meta;
}

async function getAnimeCatalog(id, search) {
  let season;
  let year;
  let sort = ["POPULARITY_DESC", "SCORE_DESC"];

  if (id === "anime_current") {
    season = currentSeason();
    year = new Date().getUTCFullYear();
  } else if (id.startsWith("anime_2026_")) {
    season = SEASONS[id.replace("anime_2026_", "")];
    year = 2026;
  } else if (id === "anime_classics") {
    sort = ["SCORE_DESC", "POPULARITY_DESC"];
  } else if (id !== "anime_popular") {
    return [];
  }

  const variables = { page: 1, perPage: 100, sort };
  if (season) variables.season = season;
  if (year) variables.seasonYear = year;
  if (search) variables.search = search;

  const data = await aniListRequest(ANIME_QUERY, variables);
  let anime = data?.Page?.media || [];

  if (id === "anime_classics") {
    anime = anime.filter(item => item.seasonYear && item.seasonYear < 2015);
  }

  return anime.map(animeMeta);
}

// ---------------- STREMIO HANDLERS ----------------

builder.defineCatalogHandler(async ({ type, id, extra = {} }) => {
  const search = extra.search || "";

  if (type === "series") {
    return { metas: await getAnimeCatalog(id, search) };
  }

  if (type !== "tv") return { metas: [] };

  const channels = await getChannels();
  let filtered = channels;

  if (id === "us" || id === "featured_us") {
    filtered = channels.filter(isUS);

    if (id === "featured_us") {
      filtered = filtered
        .filter(channel => featuredScore(channel) < 1000)
        .sort((a, b) => featuredScore(a) - featuredScore(b));
    }
  } else if (id === "pr") {
    filtered = channels.filter(isPR);
  } else if (id !== "all_channels") {
    filtered = channels.filter(channel => categoryMatch(channel, id));
  }

  if (search) {
    const needle = search.toLowerCase();
    filtered = filtered.filter(channel =>
      channel.name.toLowerCase().includes(needle)
    );
  }

  const skip = Math.max(0, Number(extra.skip) || 0);
  return { metas: filtered.slice(skip, skip + 100).map(channelMeta) };
});

builder.defineMetaHandler(async ({ type, id }) => {
  if (type === "tv") {
    const channels = await getChannels();
    const channel = channels.find(item => item.id === id);
    return { meta: channel ? channelMeta(channel) : null };
  }

  if (type === "series" && id.startsWith("anilist_")) {
    const rawId = id.slice("anilist_".length);
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

builder.defineStreamHandler(async ({ type, id }) => {
  if (type === "tv") {
    const channels = await getChannels();
    const channel = channels.find(item => item.id === id);

    if (!channel?.url) return { streams: [] };

    return {
      streams: [{
        title: "Señal listada públicamente (puede no estar disponible)",
        url: channel.url
      }]
    };
  }

  if (type === "series" && id.startsWith("glvtv_trailer_")) {
    const rawId = id.slice("glvtv_trailer_".length);
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
        streams: [{
          title: "Tráiler (no es episodio completo)",
          ytId: trailer.id
        }]
      };
    }
  }

  // No se inventan URLs de episodios ni se añaden enlaces no verificados.
  return { streams: [] };
});

serveHTTP(builder.getInterface(), { port: PORT });
