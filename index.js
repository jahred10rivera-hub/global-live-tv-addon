import sdk from "stremio-addon-sdk";

const { addonBuilder, serveHTTP } = sdk;
const PORT = Number(process.env.PORT || 7000);
const CACHE_MS = 15 * 60 * 1000;
const CINEMETA = "https://v3-cinemeta.strem.io";

const LIVE_CATALOGS = [
  { id: "country_pr", name: "Puerto Rico", url: "https://iptv-org.github.io/iptv/countries/pr.m3u" },
  { id: "country_us", name: "Estados Unidos", url: "https://iptv-org.github.io/iptv/countries/us.m3u" },
  { id: "country_ca", name: "Canadá", url: "https://iptv-org.github.io/iptv/countries/ca.m3u" },
  { id: "country_mx", name: "México", url: "https://iptv-org.github.io/iptv/countries/mx.m3u" },
  { id: "country_ar", name: "Argentina", url: "https://iptv-org.github.io/iptv/countries/ar.m3u" },
  { id: "country_bo", name: "Bolivia", url: "https://iptv-org.github.io/iptv/countries/bo.m3u" },
  { id: "country_br", name: "Brasil", url: "https://iptv-org.github.io/iptv/countries/br.m3u" },
  { id: "country_cl", name: "Chile", url: "https://iptv-org.github.io/iptv/countries/cl.m3u" },
  { id: "country_co", name: "Colombia", url: "https://iptv-org.github.io/iptv/countries/co.m3u" },
  { id: "country_cr", name: "Costa Rica", url: "https://iptv-org.github.io/iptv/countries/cr.m3u" },
  { id: "country_cu", name: "Cuba", url: "https://iptv-org.github.io/iptv/countries/cu.m3u" },
  { id: "country_do", name: "República Dominicana", url: "https://iptv-org.github.io/iptv/countries/do.m3u" },
  { id: "country_ec", name: "Ecuador", url: "https://iptv-org.github.io/iptv/countries/ec.m3u" },
  { id: "country_sv", name: "El Salvador", url: "https://iptv-org.github.io/iptv/countries/sv.m3u" },
  { id: "country_gt", name: "Guatemala", url: "https://iptv-org.github.io/iptv/countries/gt.m3u" },
  { id: "country_hn", name: "Honduras", url: "https://iptv-org.github.io/iptv/countries/hn.m3u" },
  { id: "country_ni", name: "Nicaragua", url: "https://iptv-org.github.io/iptv/countries/ni.m3u" },
  { id: "country_pa", name: "Panamá", url: "https://iptv-org.github.io/iptv/countries/pa.m3u" },
  { id: "country_py", name: "Paraguay", url: "https://iptv-org.github.io/iptv/countries/py.m3u" },
  { id: "country_pe", name: "Perú", url: "https://iptv-org.github.io/iptv/countries/pe.m3u" },
  { id: "country_uy", name: "Uruguay", url: "https://iptv-org.github.io/iptv/countries/uy.m3u" },
  { id: "country_ve", name: "Venezuela", url: "https://iptv-org.github.io/iptv/countries/ve.m3u" },
  { id: "country_es", name: "España", url: "https://iptv-org.github.io/iptv/countries/es.m3u" },
  { id: "country_pt", name: "Portugal", url: "https://iptv-org.github.io/iptv/countries/pt.m3u" },
  { id: "country_uk", name: "Reino Unido", url: "https://iptv-org.github.io/iptv/countries/uk.m3u" },
  { id: "country_ie", name: "Irlanda", url: "https://iptv-org.github.io/iptv/countries/ie.m3u" },
  { id: "country_fr", name: "Francia", url: "https://iptv-org.github.io/iptv/countries/fr.m3u" },
  { id: "country_de", name: "Alemania", url: "https://iptv-org.github.io/iptv/countries/de.m3u" },
  { id: "country_it", name: "Italia", url: "https://iptv-org.github.io/iptv/countries/it.m3u" },
  { id: "country_nl", name: "Países Bajos", url: "https://iptv-org.github.io/iptv/countries/nl.m3u" },
  { id: "country_be", name: "Bélgica", url: "https://iptv-org.github.io/iptv/countries/be.m3u" },
  { id: "country_ch", name: "Suiza", url: "https://iptv-org.github.io/iptv/countries/ch.m3u" },
  { id: "country_at", name: "Austria", url: "https://iptv-org.github.io/iptv/countries/at.m3u" },
  { id: "country_se", name: "Suecia", url: "https://iptv-org.github.io/iptv/countries/se.m3u" },
  { id: "country_no", name: "Noruega", url: "https://iptv-org.github.io/iptv/countries/no.m3u" },
  { id: "country_dk", name: "Dinamarca", url: "https://iptv-org.github.io/iptv/countries/dk.m3u" },
  { id: "country_fi", name: "Finlandia", url: "https://iptv-org.github.io/iptv/countries/fi.m3u" },
  { id: "country_is", name: "Islandia", url: "https://iptv-org.github.io/iptv/countries/is.m3u" },
  { id: "country_pl", name: "Polonia", url: "https://iptv-org.github.io/iptv/countries/pl.m3u" },
  { id: "country_cz", name: "Chequia", url: "https://iptv-org.github.io/iptv/countries/cz.m3u" },
  { id: "country_sk", name: "Eslovaquia", url: "https://iptv-org.github.io/iptv/countries/sk.m3u" },
  { id: "country_hu", name: "Hungría", url: "https://iptv-org.github.io/iptv/countries/hu.m3u" },
  { id: "country_ro", name: "Rumanía", url: "https://iptv-org.github.io/iptv/countries/ro.m3u" },
  { id: "country_bg", name: "Bulgaria", url: "https://iptv-org.github.io/iptv/countries/bg.m3u" },
  { id: "country_gr", name: "Grecia", url: "https://iptv-org.github.io/iptv/countries/gr.m3u" },
  { id: "country_tr", name: "Turquía", url: "https://iptv-org.github.io/iptv/countries/tr.m3u" },
  { id: "country_ua", name: "Ucrania", url: "https://iptv-org.github.io/iptv/countries/ua.m3u" },
  { id: "country_ru", name: "Rusia", url: "https://iptv-org.github.io/iptv/countries/ru.m3u" },
  { id: "country_il", name: "Israel", url: "https://iptv-org.github.io/iptv/countries/il.m3u" },
  { id: "country_sa", name: "Arabia Saudita", url: "https://iptv-org.github.io/iptv/countries/sa.m3u" },
  { id: "country_ae", name: "Emiratos Árabes Unidos", url: "https://iptv-org.github.io/iptv/countries/ae.m3u" },
  { id: "country_qa", name: "Catar", url: "https://iptv-org.github.io/iptv/countries/qa.m3u" },
  { id: "country_eg", name: "Egipto", url: "https://iptv-org.github.io/iptv/countries/eg.m3u" },
  { id: "country_ma", name: "Marruecos", url: "https://iptv-org.github.io/iptv/countries/ma.m3u" },
  { id: "country_dz", name: "Argelia", url: "https://iptv-org.github.io/iptv/countries/dz.m3u" },
  { id: "country_tn", name: "Túnez", url: "https://iptv-org.github.io/iptv/countries/tn.m3u" },
  { id: "country_za", name: "Sudáfrica", url: "https://iptv-org.github.io/iptv/countries/za.m3u" },
  { id: "country_ng", name: "Nigeria", url: "https://iptv-org.github.io/iptv/countries/ng.m3u" },
  { id: "country_ke", name: "Kenia", url: "https://iptv-org.github.io/iptv/countries/ke.m3u" },
  { id: "country_gh", name: "Ghana", url: "https://iptv-org.github.io/iptv/countries/gh.m3u" },
  { id: "country_ug", name: "Uganda", url: "https://iptv-org.github.io/iptv/countries/ug.m3u" },
  { id: "country_et", name: "Etiopía", url: "https://iptv-org.github.io/iptv/countries/et.m3u" },
  { id: "country_in", name: "India", url: "https://iptv-org.github.io/iptv/countries/in.m3u" },
  { id: "country_pk", name: "Pakistán", url: "https://iptv-org.github.io/iptv/countries/pk.m3u" },
  { id: "country_bd", name: "Bangladés", url: "https://iptv-org.github.io/iptv/countries/bd.m3u" },
  { id: "country_lk", name: "Sri Lanka", url: "https://iptv-org.github.io/iptv/countries/lk.m3u" },
  { id: "country_np", name: "Nepal", url: "https://iptv-org.github.io/iptv/countries/np.m3u" },
  { id: "country_th", name: "Tailandia", url: "https://iptv-org.github.io/iptv/countries/th.m3u" },
  { id: "country_vn", name: "Vietnam", url: "https://iptv-org.github.io/iptv/countries/vn.m3u" },
  { id: "country_id", name: "Indonesia", url: "https://iptv-org.github.io/iptv/countries/id.m3u" },
  { id: "country_my", name: "Malasia", url: "https://iptv-org.github.io/iptv/countries/my.m3u" },
  { id: "country_sg", name: "Singapur", url: "https://iptv-org.github.io/iptv/countries/sg.m3u" },
  { id: "country_ph", name: "Filipinas", url: "https://iptv-org.github.io/iptv/countries/ph.m3u" },
  { id: "country_jp", name: "Japón", url: "https://iptv-org.github.io/iptv/countries/jp.m3u" },
  { id: "country_kr", name: "Corea del Sur", url: "https://iptv-org.github.io/iptv/countries/kr.m3u" },
  { id: "country_tw", name: "Taiwán", url: "https://iptv-org.github.io/iptv/countries/tw.m3u" },
  { id: "country_hk", name: "Hong Kong", url: "https://iptv-org.github.io/iptv/countries/hk.m3u" },
  { id: "country_cn", name: "China", url: "https://iptv-org.github.io/iptv/countries/cn.m3u" },
  { id: "country_au", name: "Australia", url: "https://iptv-org.github.io/iptv/countries/au.m3u" },
  { id: "country_nz", name: "Nueva Zelanda", url: "https://iptv-org.github.io/iptv/countries/nz.m3u" },
  { id: "country_fj", name: "Fiyi", url: "https://iptv-org.github.io/iptv/countries/fj.m3u" },
  { id: "country_jm", name: "Jamaica", url: "https://iptv-org.github.io/iptv/countries/jm.m3u" },
  { id: "country_tt", name: "Trinidad y Tobago", url: "https://iptv-org.github.io/iptv/countries/tt.m3u" },
  { id: "country_bs", name: "Bahamas", url: "https://iptv-org.github.io/iptv/countries/bs.m3u" },
  { id: "country_bb", name: "Barbados", url: "https://iptv-org.github.io/iptv/countries/bb.m3u" },
  { id: "country_ag", name: "Antigua y Barbuda", url: "https://iptv-org.github.io/iptv/countries/ag.m3u" },
  { id: "country_aw", name: "Aruba", url: "https://iptv-org.github.io/iptv/countries/aw.m3u" },
  { id: "country_cw", name: "Curazao", url: "https://iptv-org.github.io/iptv/countries/cw.m3u" },
  { id: "country_ht", name: "Haití", url: "https://iptv-org.github.io/iptv/countries/ht.m3u" },
  { id: "live_world", name: "Mundo · todos los países", url: "https://iptv-org.github.io/iptv/index.country.m3u" },
  { id: "live_americas", name: "Región · América", url: "https://iptv-org.github.io/iptv/regions/amer.m3u" },
  { id: "live_europe", name: "Región · Europa", url: "https://iptv-org.github.io/iptv/regions/eur.m3u" },
  { id: "live_asia", name: "Región · Asia", url: "https://iptv-org.github.io/iptv/regions/asia.m3u" },
  { id: "live_africa", name: "Región · África", url: "https://iptv-org.github.io/iptv/regions/afr.m3u" },
  { id: "live_latam", name: "Región · Latinoamérica", url: "https://iptv-org.github.io/iptv/regions/latam.m3u" }
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
