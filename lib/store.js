'use strict';
// Persistence: configuration (channels, settings, library) and metadata cache.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const languages = require('./languages');

const DATA_DIR = process.env.RETROTV_DATA || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const META_FILE = path.join(DATA_DIR, 'meta.json');

const COLORS = ['#e8b923', '#d9482b', '#3aa8c1', '#6bbf59', '#c46bd1', '#f08a24', '#e8e0c8'];
const POSITIONS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
const MODES = ['sequential', 'random', 'downloads'];
const LOGO_RE = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}
function writeJson(file, obj) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}
const uid = () => crypto.randomBytes(4).toString('hex');
const pad = (n) => String(n).padStart(2, '0');
const todayStr = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function cleanTime(s, fb) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
  if (!m) return fb;
  const h = Math.min(23, +m[1]), mi = Math.min(59, +m[2]);
  return `${pad(h)}:${pad(mi)}`;
}
function cleanDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? s : ''; }
const num = (v, fb, min, max) => {
  const n = Number(v);
  if (!isFinite(n)) return fb;
  return Math.max(min, Math.min(max, n));
};

function normLogo(l) {
  l = l || {};
  const url = String(l.url || '');
  const valid = LOGO_RE.test(url) && url.length <= 3 * 1024 * 1024;
  return {
    url: valid ? url : '',
    size: Math.round(num(l.size, 13, 3, 60) * 10) / 10,
    pos: POSITIONS.includes(l.pos) ? l.pos : 'br',
    opacity: Math.round(num(l.opacity, 0.9, 0.05, 1) * 100) / 100,
    margin: Math.round(num(l.margin, 2.5, 0, 20) * 10) / 10,
  };
}

function normSettings(s) {
  s = s || {};
  return {
    language: languages.normalize(s.language),
    crt: s.crt !== false,
    staticSound: s.staticSound !== false,
    tuneEffect: s.tuneEffect !== false,
    watermark: s.watermark !== false,
  };
}

function normLibrary(l) {
  l = l || {};
  const folders = (Array.isArray(l.folders) ? l.folders : [])
    .map((x) => String(x || '').trim()).filter(Boolean).slice(0, 20);
  return {
    folders: [...new Set(folders)],
    defaultMinutes: Math.round(num(l.defaultMinutes, 45, 1, 600)),
  };
}

function normSlot(s) {
  s = s || {};
  return {
    id: String(s.id || uid()),
    type: s.type === 'movie' ? 'movie' : 'series',
    imdb: String(s.imdb || ''),
    name: String(s.name || '').slice(0, 120),
    start: cleanTime(s.start, '20:00'),
    end: cleanTime(s.end, '23:00'),
    repeat: ['daily', 'weekly', 'monthly'].includes(s.repeat) ? s.repeat : 'daily',
    weekdays: (Array.isArray(s.weekdays) ? s.weekdays : [0, 1, 2, 3, 4, 5, 6])
      .map(Number).filter((x) => x >= 0 && x <= 6),
    monthDays: (Array.isArray(s.monthDays) ? s.monthDays : [])
      .map(Number).filter((x) => x >= 1 && x <= 31),
    dateFrom: cleanDate(s.dateFrom),
    dateTo: cleanDate(s.dateTo),
    startMode: ['random', 'first', 'fixed'].includes(s.startMode) ? s.startMode : 'random',
    startSeason: Math.round(num(s.startSeason, 1, 0, 999)),
    startEpisode: Math.round(num(s.startEpisode, 1, 0, 9999)),
    seasons: String(s.seasons || '').slice(0, 60),
    epMinutes: s.epMinutes ? num(s.epMinutes, 0, 1, 600) : 0,
    seed: Math.round(num(s.seed, Math.floor(Math.random() * 1e9), 0, 4e9)),
    anchor: cleanDate(s.anchor) || todayStr(),
  };
}

function normAd(a) {
  a = a || {};
  return {
    id: String(a.id || uid()),
    url: String(a.url || ''),
    ytId: String(a.ytId || '').replace(/[^\w-]/g, '').slice(0, 20),
    title: String(a.title || 'Advertisement').slice(0, 120),
    duration: Math.round(num(a.duration, 30, 1, 3600)),
  };
}

function normChannel(c, used) {
  c = c || {};
  let number = Math.round(num(c.number, 0, 0, 999));
  if (!number || used.has(number)) { number = 1; while (used.has(number)) number++; }
  used.add(number);
  return {
    id: String(c.id || uid()),
    name: String(c.name || 'Channel ' + number).slice(0, 40),
    number,
    color: String(c.color || COLORS[number % COLORS.length]).slice(0, 20),
    mode: MODES.includes(c.mode) ? c.mode : 'sequential',
    logo: normLogo(c.logo),
    adBreakSec: Math.round(num(c.adBreakSec, 180, 10, 1800)),
    midRoll: !!c.midRoll,
    slots: (Array.isArray(c.slots) ? c.slots : []).map(normSlot),
    ads: (Array.isArray(c.ads) ? c.ads : []).map(normAd),
  };
}

function normalizeConfig(input) {
  input = input || {};
  const settings = normSettings(input.settings);
  const src = input.sources || {};
  const used = new Set();
  const channels = (Array.isArray(input.channels) ? input.channels : [])
    .slice(0, 200).map((c) => normChannel(c, used));
  channels.sort((a, b) => a.number - b.number);
  const profile = languages.get(settings.language);
  // Video language is independent from the interface language. On old configs
  // (no sources.language) it starts from the interface language, then it stays
  // put when the user later changes only the UI language.
  const sourceLanguage = languages.normalizeSource(src.language, settings.language);
  return {
    version: 2,
    settings,
    library: normLibrary(input.library),
    sources: {
      language: sourceLanguage,
      forceAudio: src.forceAudio !== false,
      metaAddon: String(src.metaAddon || profile.metaAddon).trim() || profile.metaAddon,
      streamAddons: (Array.isArray(src.streamAddons) ? src.streamAddons : [])
        .map((x) => String(x).trim()).filter(Boolean).slice(0, 20),
      stremioServer: String(src.stremioServer || 'http://127.0.0.1:11470').trim(),
    },
    channels,
  };
}

let config = normalizeConfig(readJson(CONFIG_FILE, {}));
let meta = readJson(META_FILE, {});

module.exports = {
  DATA_DIR, COLORS, POSITIONS, MODES, uid, todayStr, normalizeConfig,
  getConfig: () => config,
  setConfig(c) { config = normalizeConfig(c); writeJson(CONFIG_FILE, config); return config; },
  updateSettings(patch) { config = normalizeConfig({ ...config, settings: { ...config.settings, ...(patch || {}) } }); writeJson(CONFIG_FILE, config); return config; },
  getMeta: () => meta,
  setMetaEntry(key, entry) { meta[key] = entry; writeJson(META_FILE, meta); },
  replaceMeta(m) { meta = m && typeof m === 'object' ? m : {}; writeJson(META_FILE, meta); },
};
