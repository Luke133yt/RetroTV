'use strict';
// Talks to Stremio addons (metadata and streams) and to YouTube (ad durations).
const store = require('./store');
const languages = require('./languages');

const UA = 'Mozilla/5.0 (RetroTV addon)';
const YT_HL = { en: 'en', it: 'it', ja: 'ja', es: 'es', fr: 'fr', de: 'de', pt: 'pt' };

// The video language chosen in Settings → Sources. It is independent from the
// interface language (settings.language).
function sourceLang() {
  const c = store.getConfig();
  return languages.normalizeSource(c.sources?.language, c.settings?.language);
}
function sourceProfile() {
  return languages.sourceInfo(sourceLang());
}
function acceptLanguage() {
  return sourceProfile().accept;
}
async function getJson(url, timeoutMs = 15000) {
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', 'Accept-Language': acceptLanguage() },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return r.json();
}

function normBase(u) {
  u = String(u || '').trim().replace(/^stremio:\/\//i, 'https://');
  return u.replace(/\/manifest\.json.*$/i, '').replace(/\/+$/, '');
}

// Adds ?lang=xx for addons that support localized metadata. Cinemeta ignores it,
// but other metadata addons may use it.
function withLang(url) {
  const l = sourceLang();
  if (!l || l === 'en') return url;
  return url + (url.includes('?') ? '&' : '?') + 'lang=' + encodeURIComponent(l);
}

// ---------- search and metadata ----------
async function searchTitles(q, baseOverride) {
  const base = normBase(baseOverride || store.getConfig().sources.metaAddon);
  const out = [];
  for (const type of ['series', 'movie']) {
    try {
      const j = await getJson(withLang(`${base}/catalog/${type}/top/search=${encodeURIComponent(q)}.json`));
      for (const m of (j.metas || []).slice(0, 8)) {
        out.push({ type, imdb: m.imdb_id || m.id, name: m.name, year: m.releaseInfo || m.year || '', poster: m.poster || '' });
      }
    } catch (e) { /* one type can fail while the other works */ }
  }
  return out;
}

function parseRuntime(str) {
  if (!str) return 0;
  const s = String(str);
  const h = /(\d+)\s*h/i.exec(s), m = /(\d+)\s*m/i.exec(s);
  if (h || m) return (h ? +h[1] * 60 : 0) + (m ? +m[1] : 0);
  const n = /(\d+)/.exec(s);
  return n ? +n[1] : 0;
}

async function fetchMeta(type, imdb, force) {
  const key = `${type}:${imdb}`;
  const srcLang = sourceLang();
  const cached = store.getMeta()[key];
  if (cached && !force && (cached.lang || 'en') === srcLang) return cached;
  const base = normBase(store.getConfig().sources.metaAddon);
  const j = await getJson(withLang(`${base}/meta/${type}/${imdb}.json`));
  const m = j.meta;
  if (!m) throw new Error('Metadata not found for ' + imdb);
  let episodes;
  if (type === 'movie') {
    episodes = [{ s: 0, e: 0, title: m.name || '' }];
  } else {
    let vids = (m.videos || []).map((v) => ({
      s: Number(v.season), e: Number(v.episode ?? v.number),
      title: v.name || v.title || '', released: v.released || '',
    })).filter((v) => isFinite(v.s) && isFinite(v.e));
    const regular = vids.filter((v) => v.s > 0);
    if (regular.length) vids = regular;                 // ignore specials (season 0)
    vids.sort((a, b) => a.s - b.s || a.e - b.e);
    episodes = vids;
  }
  const entry = {
    type, imdb, lang: srcLang, name: m.name || '', poster: m.poster || '',
    runtimeMin: parseRuntime(m.runtime), episodes, fetchedAt: Date.now(),
  };
  store.setMetaEntry(key, entry);
  return entry;
}

// ---------- stream resolution ----------
const streamCache = new Map();

const FLAGS = {
  en: ['🇬🇧', '🇺🇸', '🇦🇺'], it: ['🇮🇹'], ja: ['🇯🇵'],
  es: ['🇪🇸', '🇲🇽'], fr: ['🇫🇷'], de: ['🇩🇪'], pt: ['🇵🇹', '🇧🇷'],
};
function tagScore(txt, prof) {
  let s = 0;
  for (const flag of FLAGS[prof.code] || []) if (txt.includes(flag)) { s += 200; break; }
  for (const w of prof.titles) {
    if (new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i').test(txt)) { s += 200; break; }
  }
  if (!s) {
    // Only three-letter ISO codes: two-letter codes ("it", "de", "es") appear in
    // normal English titles too and would wrongly boost unrelated releases.
    for (const iso of prof.iso) {
      if (iso.length !== 3) continue;
      if (new RegExp(`(^|[^a-z0-9])${iso}([^a-z0-9]|$)`, 'i').test(txt)) { s += 160; break; }
    }
  }
  if (/multi/.test(txt)) s += 10;
  return s;
}

function scoreStream(st, prof) {
  const raw = `${st.name || ''} ${st.title || ''} ${st.description || ''}`;
  const txt = `${raw} ${st.url || ''}`.toLowerCase();
  let s = st.url ? 100 : 0;
  if (/2160|4k|uhd/.test(txt)) s -= 40;
  if (/hevc|x265|h\.?265/.test(txt)) s -= 30;
  if (/hdr|dolby\s*vision|\bdv\b|remux/.test(txt)) s -= 20;
  if (/1080/.test(txt)) s += 10;
  if (/720/.test(txt)) s += 12;
  if (/\.mp4|mp4/.test(txt)) s += 15;
  if (/\.mkv/.test(txt)) s -= 5;
  // Releases that explicitly carry the wanted language win over prettier ones:
  // the user asked for that language, not necessarily for the best resolution.
  s += tagScore(raw, prof);
  return s;
}

function addonLangBonus(addonUrl, prof) {
  return new RegExp(`language=${prof.torrentioLang}(?:[/&?]|$)`, 'i').test(addonUrl) ? 90 : 0;
}

async function resolveStream(type, key) {
  const lang = sourceLang();
  const ck = `${type}|${key}|${lang}`;
  const hit = streamCache.get(ck);
  if (hit && hit.exp > Date.now()) return hit.val;
  const cfg = store.getConfig().sources;
  if (!cfg.streamAddons.length) throw new Error('No stream addon configured (Settings → Sources)');
  const server = normBase(cfg.stremioServer);
  const prof = sourceProfile();
  const cands = [];
  await Promise.all(cfg.streamAddons.map(async (a) => {
    try {
      const j = await getJson(`${normBase(a)}/stream/${type}/${key}.json`, 20000);
      const bonus = addonLangBonus(a, prof);
      for (const st of j.streams || []) {
        if (st.url && /^https?:/i.test(st.url)) cands.push({ url: st.url, score: scoreStream(st, prof) + bonus, name: st.name || '' });
        else if (st.infoHash) {
          const idx = st.fileIdx != null ? st.fileIdx : -1;
          cands.push({ url: `${server}/${st.infoHash}/${idx}`, score: scoreStream(st, prof) + bonus - 50, name: (st.name || '') + ' (torrent)' });
        }
      }
    } catch (e) { /* addon unreachable: try the others */ }
  }));
  if (!cands.length) throw new Error('No stream found for ' + key);
  cands.sort((a, b) => b.score - a.score);
  const val = { url: cands[0].url, via: cands[0].name, lang };
  streamCache.set(ck, { val, exp: Date.now() + 20 * 60 * 1000 });
  return val;
}

async function checkSources() {
  const cfg = store.getConfig().sources;
  const list = [{ role: 'metadata', url: cfg.metaAddon }, ...cfg.streamAddons.map((u) => ({ role: 'stream', url: u }))];
  return Promise.all(list.map(async (x) => {
    try {
      const j = await getJson(`${normBase(x.url)}/manifest.json`, 10000);
      return { ...x, ok: true, name: j.name || j.id || 'ok' };
    } catch (e) { return { ...x, ok: false, error: e.message }; }
  }));
}

// ---------- YouTube ----------
function youtubeId(url) {
  const s = String(url || '').trim();
  let m = /(?:youtu\.be\/|youtube\.com\/(?:embed\/|shorts\/|live\/|v\/))([\w-]{11})/.exec(s);
  if (m) return m[1];
  m = /[?&]v=([\w-]{11})/.exec(s);
  if (m) return m[1];
  return /^[\w-]{11}$/.test(s) ? s : '';
}

async function youtubeInfo(url) {
  const id = youtubeId(url);
  if (!id) throw new Error('Unrecognised YouTube link');
  const hl = YT_HL[sourceLang()] || 'en';
  const out = { ytId: id, title: '', duration: 0 };
  try {
    const r = await fetch(`https://www.youtube.com/watch?v=${id}&hl=${hl}`, {
      headers: { 'User-Agent': UA, 'Accept-Language': acceptLanguage(), Cookie: 'SOCS=CAI; CONSENT=YES+1' },
      signal: AbortSignal.timeout(15000),
    });
    const html = await r.text();
    const d = /"lengthSeconds":"(\d+)"/.exec(html);
    if (d) out.duration = +d[1];
    const t = /<meta name="title" content="([^"]*)"/.exec(html) || /<title>([^<]*)<\/title>/.exec(html);
    if (t) out.title = t[1].replace(/ - YouTube$/, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  } catch (e) { /* manual entry will be used */ }
  if (!out.title) {
    try {
      const j = await getJson(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`, 8000);
      out.title = j.title || '';
    } catch (e) { /* ignore */ }
  }
  return out;
}

module.exports = { searchTitles, fetchMeta, resolveStream, checkSources, youtubeInfo, youtubeId, normBase };
