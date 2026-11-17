'use strict';
// RetroTV: Stremio/Nuvio addon + vintage TV interface. No external dependencies (Node 18+).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const store = require('./lib/store');
const engine = require('./lib/engine');
const sources = require('./lib/sources');
const library = require('./lib/library');
const languages = require('./lib/languages');
const remux = require('./lib/remux');
const updater = require('./lib/updater');

const PORT = Number(process.env.RETROTV_PORT || process.env.PORT || 7777);
const HOST = process.env.RETROTV_HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
let VERSION = '2.1.0';
try { VERSION = require('./package.json').version || VERSION; } catch (e) { /* keep the fallback */ }
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

// ---------- helpers ----------
function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  const buf = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, {
    'Content-Type': type, 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Cache-Control': 'no-store', ...extra,
  });
  res.end(buf);
}
const sendJson = (res, obj, code = 200) => send(res, code, obj);
const fail = (res, code, msg) => send(res, code, { error: String(msg) });

function readBody(req, limit = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(new Error('Invalid JSON')); } });
    req.on('error', reject);
  });
}

function lanUrls() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(`http://${i.address}:${PORT}`);
  }
  return out;
}
const lang = () => languages.get(store.getConfig().settings.language);
const channelById = (id) => store.getConfig().channels.find((c) => c.id === id);
const baseUrl = (req) => `http://${req.headers.host || `127.0.0.1:${PORT}`}`;
const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
function label(s) {
  const L = lang();
  if (!s) return L.nothingOnAir;
  if (s.kind === 'ad') return L.ads;
  const ep = s.sub || (s.season ? `S${s.season}E${s.episode}` : '');
  return `${s.title}${ep ? ' ' + ep : ''}`;
}

function segsFor(ch, from, to) {
  if (ch.mode === 'downloads') return library.getSegments(ch, library.getItems(), from, to);
  return engine.getSegments(ch, store.getMeta(), from, to);
}
function nowAndNext(ch) {
  const now = Date.now();
  const segs = segsFor(ch, now - 3600e3, now + 6 * 3600e3);
  const progs = engine.toPrograms(segs).filter((p) => p.kind === 'ep');
  const cur = progs.find((p) => p.start <= now && now < p.end) || null;
  const next = progs.filter((p) => p.start >= now).slice(0, 3);
  return { cur, next, segs };
}
function describe(ch) {
  const L = lang();
  const { cur, next } = nowAndNext(ch);
  const lines = [];
  if (cur) lines.push(`${L.onAir}: ${label(cur)} (${L.until.replace('{time}', hhmm(cur.end))})`);
  else lines.push(L.nothingOnAir);
  next.slice(0, 3).forEach((p) => lines.push(`${hhmm(p.start)}  ${label(p)}`));
  return lines.join('\n');
}

// ---------- channel logo (generated SVG) ----------
function logoSvg(ch) {
  const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="#1a1410"/>
<rect x="24" y="24" width="592" height="312" rx="40" fill="#050505" stroke="${esc(ch.color)}" stroke-width="8"/>
<text x="60" y="200" font-family="Courier New,monospace" font-size="170" font-weight="bold" fill="${esc(ch.color)}">${String(ch.number).padStart(2, '0')}</text>
<text x="60" y="290" font-family="Courier New,monospace" font-size="44" fill="#e8e0c8">${esc(ch.name.toUpperCase().slice(0, 18))}</text>
<text x="590" y="80" text-anchor="end" font-family="Courier New,monospace" font-size="28" fill="#6bbf59">RETROTV</text></svg>`;
}

function decodeLogo(dataUrl) {
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=]+)$/i.exec(String(dataUrl || ''));
  if (!m) return null;
  return { type: m[1], buf: Buffer.from(m[2], 'base64') };
}

// ---------- Stremio addon protocol ----------
function manifest() {
  const L = lang();
  return {
    id: 'community.retrotv', version: VERSION, name: 'RetroTV',
    description: L.addonDescription,
    resources: ['catalog', 'meta', 'stream'], types: ['tv'], idPrefixes: ['retrotv:'],
    catalogs: [{ type: 'tv', id: 'retrotv', name: L.catalogName }],
    behaviorHints: { configurable: false, adult: false },
  };
}
function chMeta(ch, base, withDesc = true) {
  const image = ch.logo && ch.logo.url ? `${base}/chlogo/${ch.id}?v=${encodeURIComponent(String(ch.logo.url.length))}` : `${base}/logo/${ch.id}.svg`;
  return {
    id: 'retrotv:' + ch.id, type: 'tv', name: `${String(ch.number).padStart(2, '0')} · ${ch.name}`,
    poster: image, posterShape: 'landscape', background: image, logo: image,
    ...(withDesc ? { description: describe(ch) } : {}),
  };
}

async function addonRoute(req, res, url) {
  const p = decodeURIComponent(url.pathname);
  const base = baseUrl(req);
  const L = lang();
  if (p === '/manifest.json') { sendJson(res, manifest()); return true; }
  let m = /^\/catalog\/tv\/retrotv(?:\/[^/]*)?\.json$/.exec(p);
  if (m) { sendJson(res, { metas: store.getConfig().channels.map((c) => chMeta(c, base)) }); return true; }
  m = /^\/meta\/tv\/retrotv:([\w-]+)\.json$/.exec(p);
  if (m) {
    const ch = channelById(m[1]);
    sendJson(res, ch ? { meta: chMeta(ch, base) } : { meta: null });
    return true;
  }
  m = /^\/stream\/tv\/retrotv:([\w-]+)\.json$/.exec(p);
  if (m) {
    const ch = channelById(m[1]);
    if (!ch) { sendJson(res, { streams: [] }); return true; }
    const now = Date.now();
    const segs = segsFor(ch, now - 60e3, now + 6 * 3600e3);
    const cur = segs.find((s) => s.kind === 'ep' && s.start <= now && now < s.end) ||
      segs.find((s) => s.kind === 'ep' && s.end > now) || null;
    const streams = [{
      name: 'RetroTV', title: L.openWeb,
      externalUrl: `${base}/?ch=${ch.number}`,
    }];
    if (cur && cur.mediaId) {
      streams.push({ name: 'RetroTV', title: L.nowPlaying.replace('{title}', label(cur)), url: `${base}/media/${cur.mediaId}` });
    } else if (cur) {
      try {
        const r = await sources.resolveStream(cur.type, cur.epKey);
        const o = await remux.play(r.url, { start: 0 });
        streams.push({ name: 'RetroTV', title: L.nowPlaying.replace('{title}', label(cur)), url: o.kind === 'hls' ? base + o.url : r.url });
      } catch (e) { /* the web link still works */ }
    }
    sendJson(res, { streams });
    return true;
  }
  return false;
}

// ---------- internal API ----------
async function ensureMeta(force = false) {
  const errors = [];
  const seen = new Set();
  for (const ch of store.getConfig().channels) {
    if (ch.mode === 'downloads') continue;
    for (const s of ch.slots) {
      if (!s.imdb) { errors.push({ slot: s.id, error: 'No title selected' }); continue; }
      const k = `${s.type}:${s.imdb}`;
      if (seen.has(k)) continue;
      seen.add(k);
      try {
        const e = await sources.fetchMeta(s.type, s.imdb, force);
        if (!e.episodes.length) errors.push({ slot: s.id, error: 'No episodes found for ' + s.name });
      } catch (err) { errors.push({ slot: s.id, error: `${s.name}: ${err.message}` }); }
    }
  }
  return errors;
}

function buildExport(days) {
  const cfg = store.getConfig();
  const from = new Date(); from.setHours(0, 0, 0, 0);
  const to = new Date(from.getTime()); to.setDate(to.getDate() + days);
  const meta = store.getMeta();
  const used = {};
  cfg.channels.forEach((c) => c.slots.forEach((s) => { const k = `${s.type}:${s.imdb}`; if (meta[k]) used[k] = meta[k]; }));
  const iso = (ms) => new Date(ms).toISOString();
  return {
    format: 'retrotv-backup', version: 2, exportedAt: new Date().toISOString(), config: cfg, meta: used,
    schedule: {
      from: from.toISOString(), to: to.toISOString(),
      channels: cfg.channels.map((c) => ({
        id: c.id, number: c.number, name: c.name, mode: c.mode,
        programs: engine.toPrograms(segsFor(c, from.getTime(), to.getTime())).map((p) => ({
          kind: p.kind, start: iso(p.start), end: iso(p.end), title: p.title, episode: p.sub || undefined,
          season: p.season || undefined, number: p.episode || undefined,
        })),
      })),
    },
  };
}

async function apiRoute(req, res, url) {
  const p = url.pathname, q = url.searchParams;
  try {
    if (p === '/api/info') {
      const b = baseUrl(req);
      const summary = library.summarize();
      return sendJson(res, {
        version: VERSION, manifest: `${b}/manifest.json`, stremio: `stremio://${(req.headers.host || '')}/manifest.json`,
        lan: lanUrls().map((u) => `${u}/manifest.json`), host: HOST, port: PORT,
        languages: languages.tuple(), sourceLanguages: languages.sourceTuple(),
        sourceLanguage: store.getConfig().sources.language, settings: store.getConfig().settings,
        library: { count: summary.count, folders: summary.folders, errors: summary.errors },
      });
    }
    if (p === '/api/update/check') {
      return sendJson(res, await updater.check(VERSION));
    }
    if (p === '/api/update/apply' && req.method === 'POST') {
      if (updater.isUpdating()) return fail(res, 409, 'An update is already in progress');
      const out = await updater.apply(VERSION);
      if (out.updated) setTimeout(() => restartServer(`Update to v${out.to} installed`), 800);
      return sendJson(res, out);
    }
    if (p === '/api/config' && req.method === 'GET') return sendJson(res, store.getConfig());
    if (p === '/api/config' && req.method === 'PUT') {
      store.setConfig(await readBody(req));
      engine.clearCache();
      if (store.getConfig().library.folders.length) library.scan(true);
      const errors = await ensureMeta();
      return sendJson(res, { config: store.getConfig(), errors });
    }
    if (p === '/api/settings' && req.method === 'PUT') {
      store.updateSettings(await readBody(req));
      return sendJson(res, { settings: store.getConfig().settings });
    }
    if (p === '/api/library' && req.method === 'GET') return sendJson(res, library.summarize());
    if (p === '/api/library/scan' && (req.method === 'POST' || req.method === 'GET')) {
      library.scan(true);
      return sendJson(res, library.summarize());
    }
    if (p === '/api/search') return sendJson(res, await sources.searchTitles(q.get('q') || '', q.get('base') || ''));
    if (p === '/api/meta') {
      const e = await sources.fetchMeta(q.get('type') === 'movie' ? 'movie' : 'series', q.get('imdb') || '', q.get('force') === '1');
      engine.clearCache();
      return sendJson(res, { name: e.name, runtimeMin: e.runtimeMin, episodes: e.episodes.length, seasons: [...new Set(e.episodes.map((x) => x.s))].length });
    }
    if (p === '/api/yt') return sendJson(res, await sources.youtubeInfo(q.get('url') || ''));
    if (p === '/api/sources/check') return sendJson(res, await sources.checkSources());
    if (p === '/api/guide') {
      const from = Number(q.get('from')) || Date.now() - 1800e3, to = Number(q.get('to')) || from + 12 * 3600e3;
      if (to - from > 40 * 86400e3) return fail(res, 400, 'Range too long');
      const pick = q.get('ch') || 'all';
      const chans = store.getConfig().channels.filter((c) => pick === 'all' || c.id === pick);
      return sendJson(res, chans.map((c) => {
        const segs = segsFor(c, from, to);
        return {
          id: c.id, number: c.number, name: c.name, color: c.color, mode: c.mode,
          segments: pick === 'all' ? undefined : segs, programs: engine.toPrograms(segs),
        };
      }));
    }
    if (p === '/api/resolve') {
      const type = q.get('type') === 'movie' ? 'movie' : 'series';
      const key = q.get('key') || '';
      if (!/^[\w:.-]+$/.test(key)) return fail(res, 400, 'Invalid key');
      const t = Math.max(0, Number(q.get('t')) || 0);
      const r = await sources.resolveStream(type, key);
      const out = await remux.play(r.url, { start: t });
      return sendJson(res, { ...r, url: out.url, kind: out.kind, audio: out.audio });
    }
    if (p === '/api/export') return send(res, 200, JSON.stringify(buildExport(Math.min(366, Math.max(1, Number(q.get('days')) || 30))), null, 2),
      'application/json; charset=utf-8', { 'Content-Disposition': `attachment; filename="retrotv-schedule-${store.todayStr()}.json"` });
    if (p === '/api/import' && req.method === 'POST') {
      const b = await readBody(req);
      if (b.format !== 'retrotv-backup' || !b.config) return fail(res, 400, 'This is not a RetroTV backup');
      store.replaceMeta({ ...store.getMeta(), ...(b.meta || {}) });
      store.setConfig(b.config);
      engine.clearCache();
      if (store.getConfig().library.folders.length) library.scan(true);
      return sendJson(res, { ok: true, channels: store.getConfig().channels.length, errors: await ensureMeta() });
    }
    return fail(res, 404, 'Unknown API endpoint');
  } catch (e) { return fail(res, 500, e.message); }
}

// ---------- server ----------
async function playRoute(req, res, id) {
  const ch = channelById(id);
  if (!ch) return fail(res, 404, 'Unknown channel');
  const now = Date.now();
  const seg = segsFor(ch, now - 60e3, now + 6 * 3600e3).find((s) => s.kind === 'ep' && s.end > now);
  if (!seg) return fail(res, 404, 'Nothing on air');
  if (seg.mediaId) {
    res.writeHead(302, { Location: seg.mediaUrl, 'Access-Control-Allow-Origin': '*' });
    return res.end();
  }
  try {
    const r = await sources.resolveStream(seg.type, seg.epKey);
    const o = await remux.play(r.url, { start: 0 });
    res.writeHead(302, { Location: o.kind === 'hls' ? baseUrl(req) + o.url : r.url, 'Access-Control-Allow-Origin': '*' });
    res.end();
  } catch (e) { fail(res, 502, e.message); }
}

// ---------- restart (used by the in-app updater) ----------
let restarting = false;
function restartServer(reason) {
  if (restarting) return;
  restarting = true;
  console.log(`\n  ${reason}. Restarting RetroTV on port ${PORT}...`);
  const fromLauncher = process.env.RETROTV_LAUNCHER === '1';
  try { server.close(); } catch (e) { /* ignore */ }
  if (server.closeAllConnections) server.closeAllConnections();
  setTimeout(() => {
    if (!fromLauncher) {
      // Started with `node server.js`: relaunch ourselves in the background.
      // A detached process survives the parent exit and the terminal closing.
      try {
        const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], {
          cwd: __dirname,
          env: { ...process.env, RETROTV_RELAUNCHED: '1' },
          detached: true,
          windowsHide: true,
          stdio: 'ignore',
        });
        child.unref();
      } catch (e) { console.error('  Automatic restart failed:', e.message); }
    }
    // Launchers set RETROTV_LAUNCHER=1 and loop when the exit code is 75.
    process.exit(fromLauncher ? 75 : 0);
  }, 600);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') return send(res, 204, '');
  if (url.pathname.startsWith('/api/')) return apiRoute(req, res, url);
  try { if (await addonRoute(req, res, url)) return; }
  catch (e) { return fail(res, 500, e.message); }

  let m = /^\/chlogo\/([\w-]+)$/.exec(url.pathname);
  if (m) {
    const ch = channelById(m[1]);
    const img = ch && decodeLogo(ch.logo?.url);
    if (!img) return fail(res, 404, 'No logo');
    return send(res, 200, img.buf, img.type, { 'Cache-Control': 'public, max-age=60' });
  }
  m = /^\/logo\/([\w-]+)\.svg$/.exec(url.pathname);
  if (m) { const ch = channelById(m[1]); return ch ? send(res, 200, logoSvg(ch), MIME['.svg']) : fail(res, 404, 'Unknown channel'); }
  m = /^\/media\/([\w-]+)$/.exec(url.pathname);
  if (m) {
    const item = library.findItem(m[1]);
    if (!item) return fail(res, 404, 'Media not found');
    return library.stream(req, res, item);
  }
  m = /^\/play\/([\w-]+)$/.exec(url.pathname);
  if (m) return playRoute(req, res, m[1]);
  m = /^\/hls\/([\w-]+)\/([\w.]+)$/.exec(url.pathname);
  if (m) {
    const f = await remux.getFile(m[1], m[2]);
    if (!f) return fail(res, 404, 'HLS stream not found');
    return send(res, 200, f.buf, f.type, { 'Cache-Control': f.playlist ? 'no-store' : 'public, max-age=300' });
  }

  // static files
  const rel = url.pathname === '/' || url.pathname === '/tv' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return fail(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => (err ? fail(res, 404, 'Not found') : send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream')));
});

let listenAttempts = 0;
function onListening() {
  console.log('\n  ┌─────────────────────────────────────────┐');
  console.log('  │   RetroTV is on  📺                      │');
  console.log('  └─────────────────────────────────────────┘');
  console.log(`\n  Version:  ${VERSION}`);
  console.log(`  TV:       http://127.0.0.1:${PORT}`);
  console.log(`  Addon:    http://127.0.0.1:${PORT}/manifest.json`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') {
    lanUrls().forEach((u) => console.log(`  LAN:      ${u}  (addon: ${u}/manifest.json)`));
  } else {
    console.log('\n  For phones and TVs on your home network, launch RetroTV-Server.bat (LAN mode).');
  }
  console.log('\n  Keep this window open while you use RetroTV. Ctrl+C to turn it off.\n');
}
function startListening() {
  server.listen(PORT, HOST, onListening);
}
server.on('error', (e) => {
  // After an in-app update the old process may still be releasing the port.
  if (e.code === 'EADDRINUSE' && process.env.RETROTV_RELAUNCHED === '1' && listenAttempts < 30) {
    listenAttempts++;
    setTimeout(startListening, 400);
    return;
  }
  if (e.code === 'EADDRINUSE') console.error(`\nPort ${PORT} is already in use: RetroTV may already be running. Open http://127.0.0.1:${PORT}`);
  else console.error(e);
  process.exit(1);
});
startListening();
