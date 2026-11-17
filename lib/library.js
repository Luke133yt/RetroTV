'use strict';
// Local "Downloaded" library: scans folders for video files, reads durations
// (MP4/MKV), builds a deterministic TV-like schedule and streams files with
// HTTP Range support so seeking works in the browser and on TVs.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const store = require('./store');

const VIDEO_EXT = new Set([
  '.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi', '.ts', '.m2ts', '.mpg', '.mpeg', '.wmv', '.flv', '.ogv',
]);
const MIME = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.webm': 'video/webm', '.avi': 'video/x-msvideo', '.ts': 'video/mp2t', '.m2ts': 'video/mp2t',
  '.mpg': 'video/mpeg', '.mpeg': 'video/mpeg', '.wmv': 'video/x-ms-wmv', '.flv': 'video/x-flv', '.ogv': 'video/ogg',
};
const SKIP_DIRS = new Set(['$recycle.bin', 'system volume information', '.git', 'node_modules', '.trash', '.thumbnails']);
const QUALITY_RE = /\b(2160p?|1080p?|720p?|480p?|4k|uhd|hdr|dv|dolby|remux|webrip|web[- ]?dl|bluray|brrip|bdrip|dvdrip|hdtv|x264|x265|h ?264|h ?265|hevc|av1|aac|ac3|dts|ddp?5 ?1|ita|eng|spa|fre|ger|por|multi|sub|subs|subbed|dubbed|proper|repack)\b/gi;
const CACHE_FILE = path.join(store.DATA_DIR, 'library-cache.json');
const FIXED_EPOCH = new Date(2020, 0, 1, 0, 0, 0, 0).getTime();
const TTL = 15000;

let mem = { at: 0, items: [], errors: [], folders: [], scannedAt: 0 };
let durations = readCache();
let seq = 0;

function readCache() {
  try { return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) || {}; } catch (e) { return {}; }
}
function writeCache() {
  try {
    const tmp = CACHE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(durations));
    fs.renameSync(tmp, CACHE_FILE);
  } catch (e) { /* cache is optional */ }
}

function expandHome(p) {
  const s = String(p || '').trim();
  if (!s) return '';
  if (s === '~') return os.homedir();
  if (s.startsWith('~/') || s.startsWith('~\\')) return path.join(os.homedir(), s.slice(2));
  return s;
}

function scanFolders() {
  return (store.getConfig().library?.folders || []).map(expandHome).filter(Boolean);
}

function walk(dir, out, depth, errors) {
  if (depth > 8 || out.length >= 20000) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (e) { errors.push({ folder: dir, error: e.code || e.message }); return; }
  for (const ent of entries) {
    if (out.length >= 20000) break;
    const full = path.join(dir, ent.name);
    if (ent.isSymbolicLink()) continue;
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name.toLowerCase())) continue;
      if (ent.name.startsWith('.')) continue;
      walk(full, out, depth + 1, errors);
    } else if (ent.isFile()) {
      if (VIDEO_EXT.has(path.extname(ent.name).toLowerCase())) out.push(full);
    }
  }
}

function readAt(fd, position, length) {
  const buf = Buffer.alloc(length);
  const n = fs.readSync(fd, buf, 0, length, position);
  return buf.subarray(0, n);
}

function mp4Duration(buf) {
  let p = 0;
  while ((p = buf.indexOf('mvhd', p, 'latin1')) >= 0) {
    if (p + 24 > buf.length) break;
    const ver = buf[p + 4];
    if (ver === 0) {
      const scale = buf.readUInt32BE(p + 16), dur = buf.readUInt32BE(p + 20);
      if (scale > 0 && dur > 0 && dur !== 0xffffffff) return dur / scale;
    } else if (ver === 1 && p + 36 <= buf.length) {
      const scale = buf.readUInt32BE(p + 24);
      const dur = Number(buf.readBigUInt64BE(p + 28));
      if (scale > 0 && dur > 0 && dur < 1e12) return dur / scale;
    }
    p += 4;
  }
  return 0;
}

function readVint(buf, pos, keepMarker) {
  if (pos >= buf.length) return null;
  const first = buf[pos];
  if (!first) return null;
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8 || pos + len > buf.length) return null;
  let val = keepMarker ? first : first & (mask - 1);
  for (let i = 1; i < len; i++) val = val * 256 + buf[pos + i];
  return { value: val, length: len };
}

function mkvDuration(buf) {
  // Find the Info element and then its Duration / TimecodeScale children.
  const infoId = Buffer.from([0x15, 0x49, 0xa9, 0x66]);
  const info = buf.indexOf(infoId);
  if (info < 0) return 0;
  const size = readVint(buf, info + 4, false);
  if (!size) return 0;
  let end = Math.min(buf.length, info + 4 + size.length + size.value);
  let scale = 1e6, duration = 0;
  for (let p = info + 4 + size.length; p < end;) {
    const id = readVint(buf, p, true);
    if (!id) break;
    const sz = readVint(buf, p + id.length, false);
    if (!sz) break;
    const dataStart = p + id.length + sz.length;
    if (dataStart + sz.value > end) break;
    if (id.value === 0x2ad7b1 && sz.value <= 8) {
      scale = 0;
      for (let i = 0; i < sz.value; i++) scale = scale * 256 + buf[dataStart + i];
    } else if (id.value === 0x4489) {
      if (sz.value === 4) duration = buf.readFloatBE(dataStart);
      else if (sz.value === 8) duration = buf.readDoubleBE(dataStart);
    }
    p = dataStart + sz.value;
  }
  return duration > 0 && scale > 0 ? (duration * scale) / 1e9 : 0;
}

function probeDuration(file, size) {
  const ext = path.extname(file).toLowerCase();
  if (!['.mp4', '.m4v', '.mov', '.mkv', '.webm'].includes(ext)) return 0;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const headLen = Math.min(size, 6 * 1024 * 1024);
    let buf = readAt(fd, 0, headLen);
    let sec = ext === '.mkv' || ext === '.webm' ? mkvDuration(buf) : mp4Duration(buf);
    if (!sec && size > headLen) {
      const tailLen = Math.min(size - headLen, 6 * 1024 * 1024);
      buf = readAt(fd, size - tailLen, tailLen);
      sec = mp4Duration(buf);
    }
    return sec > 1 && sec < 24 * 3600 ? Math.round(sec) : 0;
  } catch (e) { return 0; }
  finally { if (fd !== undefined) try { fs.closeSync(fd); } catch (e) { /* ignore */ } }
}

function prettyName(file) {
  let base = path.basename(file, path.extname(file));
  base = base.replace(/\[[^\]]*\]/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  const m = /s(\d{1,2})[\s._-]*e(\d{1,3})/i.exec(base) || /(\d{1,2})x(\d{2,3})/.exec(base);
  let title = base, season = 0, episode = 0;
  if (m) {
    title = base.slice(0, m.index);
    if (m[0].includes('x') && !/s\d/i.test(m[0])) { season = +m[1]; episode = +m[2]; }
    else { season = +m[1]; episode = +m[2]; }
  }
  title = title.replace(QUALITY_RE, ' ').replace(/[\s._-]+$/g, '').replace(/^\s+/, '').replace(/\s+/g, ' ').trim();
  if (!title) title = path.basename(file, path.extname(file)).replace(/[._]+/g, ' ').trim();
  const epLabel = season || episode ? `S${String(season || 1).padStart(2, '0')}E${String(episode || 0).padStart(2, '0')}` : '';
  return { title: title.slice(0, 140), season, episode, epLabel };
}

function natural(a, b) {
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

function scan(force) {
  const now = Date.now();
  if (!force && now - mem.at < TTL) return mem;
  const folders = scanFolders();
  const files = [], errors = [];
  for (const f of folders) {
    let st;
    try { st = fs.statSync(f); } catch (e) { errors.push({ folder: f, error: 'not-found' }); continue; }
    if (!st.isDirectory()) { errors.push({ folder: f, error: 'not-a-folder' }); continue; }
    walk(f, files, 0, errors);
  }
  files.sort(natural);
  const fallback = (store.getConfig().library?.defaultMinutes || 45) * 60;
  const items = files.map((file) => {
    let st;
    try { st = fs.statSync(file); } catch (e) { return null; }
    const id = crypto.createHash('sha1').update(path.resolve(file)).digest('hex').slice(0, 16);
    const key = path.resolve(file);
    const cached = durations[key];
    let duration = cached && cached.mtime === st.mtimeMs && cached.size === st.size ? cached.duration : 0;
    if (!duration) {
      duration = probeDuration(file, st.size);
      durations[key] = { mtime: st.mtimeMs, size: st.size, duration };
    }
    const meta = prettyName(file);
    return {
      id, path: file, rel: path.basename(file), mime: MIME[path.extname(file).toLowerCase()] || 'video/mp4',
      title: meta.title, season: meta.season, episode: meta.episode, epLabel: meta.epLabel,
      duration: duration || fallback, probed: !!duration, size: st.size, mtime: st.mtimeMs,
    };
  }).filter(Boolean);
  writeCache();
  mem = { at: now, items, errors, folders, scannedAt: now };
  seq++;
  return mem;
}

function getItems() { return scan(false).items; }
function summarize() {
  const s = scan(false);
  return {
    folders: s.folders, errors: s.errors, scannedAt: s.scannedAt, count: s.items.length,
    totalDuration: s.items.reduce((t, x) => t + x.duration, 0),
    totalSize: s.items.reduce((t, x) => t + x.size, 0),
    items: s.items.map((x) => ({
      id: x.id, title: x.title, season: x.season, episode: x.episode, epLabel: x.epLabel,
      duration: x.duration, probed: x.probed, size: x.size, path: x.path, rel: x.rel, mime: x.mime,
    })),
  };
}

function findItem(id) {
  let it = getItems().find((x) => x.id === id);
  if (!it) it = scan(true).items.find((x) => x.id === id);
  return it || null;
}

function hhmm(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// A continuous, deterministic TV channel made of the local files.
function getSegments(channel, items, fromMs, toMs) {
  if (!items.length) return [];
  const list = items.slice().sort((a, b) => natural(a.path, b.path));
  const total = list.reduce((t, x) => t + Math.max(1, x.duration) * 1000, 0);
  if (!total) return [];
  let k = Math.floor((fromMs - FIXED_EPOCH) / total) - 1;
  const out = [];
  // Number of library cycles needed to cover the window (plus a small margin).
  const limit = Math.min(Math.ceil(Math.max(0, toMs - fromMs) / total) + 3, 50000);
  let guard = 0;
  while (guard++ < limit) {
    const cycle = FIXED_EPOCH + k * total;
    if (cycle >= toMs) break;
    let t = cycle;
    let idx = 0;
    for (const it of list) {
      const end = t + Math.max(1, it.duration) * 1000;
      if (end > fromMs && t < toMs) {
        out.push({
          id: `dl|${channel.id}|${k}|${idx++}`, kind: 'ep', start: Math.max(t, fromMs - 1), end: Math.min(end, toMs + 1),
          slotId: 'downloads', type: 'local', mediaId: it.id, mediaUrl: `/media/${it.id}`,
          title: it.title, sub: it.epLabel, season: it.season, episode: it.episode,
          offset: Math.max(0, Math.round((Math.max(t, fromMs - 1) - t) / 1000)), runtime: it.duration,
          epKey: `local:${it.id}`,
        });
      }
      t = end;
      if (t >= toMs) break;
    }
    k++;
  }
  return out;
}

function label(seg, lang) {
  if (!seg) return lang.libraryEmpty;
  return `${seg.title}${seg.sub ? ' ' + seg.sub : ''}`;
}

// HTTP Range streaming.
function stream(req, res, item, cors = '*') {
  let st;
  try { st = fs.statSync(item.path); } catch (e) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  const size = st.size;
  const base = {
    'Content-Type': item.mime, 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': cors,
    'Access-Control-Allow-Headers': '*', 'Cache-Control': 'no-store',
  };
  if (req.method === 'HEAD') { res.writeHead(200, { ...base, 'Content-Length': size }); return res.end(); }
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (!m) { res.writeHead(416, { ...base, 'Content-Range': `bytes */${size}` }); return res.end(); }
    let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
    let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
    if (!isFinite(start) || !isFinite(end)) start = 0, end = size - 1;
    start = Math.max(0, Math.min(start, size - 1));
    end = Math.max(start, Math.min(end, size - 1));
    res.writeHead(206, { ...base, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(item.path, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...base, 'Content-Length': size });
    fs.createReadStream(item.path).pipe(res);
  }
}

module.exports = {
  VIDEO_EXT, MIME, scan, getItems, summarize, findItem, getSegments, stream, prettyName, hhmm,
  probeDuration, FIXED_EPOCH,
};
