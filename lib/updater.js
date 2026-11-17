'use strict';
// Update checker and installer.
//
// Checks the latest public GitHub release, compares it with the version in
// package.json and installs it either with git (when this copy is a clone) or
// by downloading the release source archive. Runtime data in data/ is never
// touched, so channels, settings and library paths survive every update.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const APP_DIR = path.join(__dirname, '..');
const REPO = process.env.RETROTV_UPDATE_REPO || 'Luke133yt/RetroTV';
const API = (process.env.RETROTV_UPDATE_API || 'https://api.github.com').replace(/\/+$/, '');
const DISABLED = /^(1|true|yes)$/i.test(String(process.env.RETROTV_UPDATE_DISABLE || ''));
const TIMEOUT_MS = Math.max(2000, Number(process.env.RETROTV_UPDATE_TIMEOUT) || 20000);
const MAX_ARCHIVE = 60 * 1024 * 1024;
const KEEP = new Set(['data', '.git', 'node_modules']);

function appVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(APP_DIR, 'package.json'), 'utf8'));
    if (parseVersion(pkg.version)) return String(pkg.version);
  } catch (e) { /* fall through */ }
  return '0.0.0';
}

function parseVersion(value) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value || '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || '' };
}

// Returns 1 when a is newer than b, -1 when older, 0 when equal/unparseable.
function compareVersions(a, b) {
  const A = parseVersion(a), B = parseVersion(b);
  if (!A || !B) return 0;
  for (const k of ['major', 'minor', 'patch']) {
    if (A[k] !== B[k]) return A[k] > B[k] ? 1 : -1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;            // a stable release is newer than a beta
  if (!B.pre) return -1;
  return A.pre > B.pre ? 1 : -1;
}

async function request(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      redirect: 'follow',
      ...opts,
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'RetroTV-Updater',
        Accept: 'application/vnd.github+json, application/octet-stream',
        ...(opts.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getJson(url) {
  const r = await request(url);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub replied with HTTP ${r.status}`);
  return r.json();
}

function releaseTarball(rel) {
  if (process.env.RETROTV_UPDATE_TARBALL) return process.env.RETROTV_UPDATE_TARBALL;
  const assets = Array.isArray(rel.assets) ? rel.assets : [];
  const asset = assets.find((a) => /\.(tar\.gz|tgz)$/i.test(String(a.name || '')));
  if (asset && asset.browser_download_url) return asset.browser_download_url;
  if (rel.tarball_url) return rel.tarball_url;
  return `${API}/repos/${REPO}/tarball/${encodeURIComponent(rel.tag_name || '')}`;
}

async function check(current = appVersion()) {
  const base = { current, repo: REPO };
  if (DISABLED) return { ...base, ok: true, disabled: true, update: false };
  try {
    const rel = await getJson(`${API}/repos/${REPO}/releases/latest`);
    if (!rel) return { ...base, ok: true, update: false, reason: 'no-releases', latest: current };
    const tag = String(rel.tag_name || '').trim();
    const latest = tag.replace(/^v/i, '');
    if (!parseVersion(latest)) {
      return { ...base, ok: false, update: false, error: `Unreadable release tag: ${tag || '(empty)'}` };
    }
    const update = compareVersions(latest, current) > 0;
    return {
      ...base,
      ok: true,
      update,
      latest,
      name: String(rel.name || tag || `v${latest}`),
      notes: String(rel.body || '').slice(0, 8000),
      url: String(rel.html_url || `https://github.com/${REPO}/releases`),
      publishedAt: rel.published_at || null,
      tarball: update ? releaseTarball(rel) : null,
      method: fs.existsSync(path.join(APP_DIR, '.git')) ? 'git' : 'download',
    };
  } catch (e) {
    return { ...base, ok: false, update: false, error: e.name === 'AbortError' ? 'The update server timed out' : e.message };
  }
}

function git(args) {
  return spawnSync('git', ['-C', APP_DIR, ...args], {
    encoding: 'utf8', timeout: 120000, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
}

// Update a git clone with the release tag (or main when the tag is missing).
// Local edits are protected: if tracked files were modified the update stops
// instead of silently discarding the user's work.
function applyWithGit(info) {
  const probe = git(['rev-parse', '--is-inside-work-tree']);
  if (probe.error || probe.status !== 0) return false;

  const dirty = git(['status', '--porcelain', '--untracked-files=no']);
  if (dirty.status !== 0) return false;
  if (String(dirty.stdout || '').trim()) {
    throw new Error('This copy has local changes: commit or discard them before updating.');
  }

  const tag = `v${info.latest}`;
  let fetched = git(['fetch', '--force', '--depth', '1', 'origin', `refs/tags/${tag}`]);
  if (fetched.status !== 0) fetched = git(['fetch', '--force', '--depth', '1', 'origin', 'main']);
  if (fetched.status !== 0) return false;

  const reset = git(['reset', '--hard', 'FETCH_HEAD']);
  if (reset.status !== 0) throw new Error(`git reset failed: ${String(reset.stderr || '').trim() || 'unknown error'}`);
  return true;
}

async function downloadArchive(url) {
  if (!url) throw new Error('This release has no downloadable archive');
  const r = await request(url);
  if (!r.ok) throw new Error(`Download failed with HTTP ${r.status}`);
  const len = Number(r.headers.get('content-length') || 0);
  if (len > MAX_ARCHIVE) throw new Error('The update archive is too large');
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error('The update archive is empty');
  if (buf.length > MAX_ARCHIVE) throw new Error('The update archive is too large');
  return buf;
}

function tarString(buf) {
  const end = buf.indexOf(0);
  return (end >= 0 ? buf.subarray(0, end) : buf).toString('utf8');
}

function safeRelative(name) {
  const norm = String(name || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const parts = norm.split('/').filter((p) => p && p !== '.');
  if (!parts.length) return '';
  if (parts.some((p) => p === '..')) return '';
  if (/^[a-zA-Z]:/.test(parts[0])) return '';
  return parts.join('/');
}

// Minimal tar.gz reader (ustar + pax/GNU long names), enough for the archives
// produced by GitHub. It never writes outside `dest`.
function readTarGz(buf) {
  let tar;
  try { tar = zlib.gunzipSync(buf); } catch (e) { throw new Error('The update archive is not a valid .tar.gz'); }
  const files = [];
  let off = 0, longName = '', paxPath = '';
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = tarString(h.subarray(0, 100));
    const size = parseInt(tarString(h.subarray(124, 136)).trim() || '0', 8) || 0;
    const type = String.fromCharCode(h[156] || 48);
    const prefix = tarString(h.subarray(345, 500));
    const magic = tarString(h.subarray(257, 263));
    const full = prefix && magic.startsWith('ustar') ? `${prefix}/${name}` : name;
    off += 512;
    const end = Math.min(tar.length, off + size);
    if (type === 'L') {
      longName = tarString(tar.subarray(off, end));
    } else if (type === 'x' || type === 'g') {
      const text = tar.subarray(off, end).toString('utf8');
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text) || /(?:^|\n)path=([^\n]*)\n/.exec(text);
      if (m) paxPath = m[1];
    } else if (type === '0' || type === '\0' || type === '7') {
      const chosen = paxPath || longName || full;
      files.push({ name: chosen, data: Buffer.from(tar.subarray(off, end)) });
      longName = ''; paxPath = '';
    }
    off += Math.ceil(size / 512) * 512;
  }
  return files;
}

function installArchive(buf, dest) {
  const files = readTarGz(buf);
  if (!files.length) throw new Error('The update archive contains no files');
  const clean = files.map((f) => ({ ...f, name: safeRelative(f.name) })).filter((f) => f.name);
  if (!clean.length) throw new Error('The update archive has no usable files');

  // GitHub archives put everything inside a single "Repo-tag/" folder.
  const firsts = new Set(clean.map((f) => f.name.split('/')[0]));
  const strip = firsts.size === 1 && clean.every((f) => f.name.includes('/')) ? `${[...firsts][0]}/` : '';

  const root = path.resolve(dest);
  fs.mkdirSync(root, { recursive: true });
  const written = [];
  for (const f of clean) {
    let rel = f.name;
    if (strip) {
      if (!rel.startsWith(strip)) continue;
      rel = rel.slice(strip.length);
    }
    rel = safeRelative(rel);
    if (!rel) continue;
    const top = rel.split('/')[0].toLowerCase();
    if (KEEP.has(top)) continue;

    const out = path.resolve(root, rel);
    if (out !== root && !out.startsWith(root + path.sep)) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, f.data);
    written.push(rel);
  }
  if (!written.length) throw new Error('The update archive contains no installable files');
  return written;
}

let applying = false;
const isUpdating = () => applying;

async function apply(current = appVersion()) {
  if (applying) throw new Error('An update is already in progress');
  applying = true;
  try {
    const info = await check(current);
    if (info.disabled) return { ok: true, updated: false, disabled: true, current };
    if (!info.ok) throw new Error(info.error || 'Could not check for updates');
    if (!info.update) return { ok: true, updated: false, current, latest: info.latest || current };

    let method;
    if (fs.existsSync(path.join(APP_DIR, '.git'))) {
      if (!applyWithGit(info)) {
        throw new Error('Could not update the git clone automatically. Run "git pull" in the RetroTV folder, then restart RetroTV.');
      }
      method = 'git';
    } else {
      const archive = await downloadArchive(info.tarball);
      installArchive(archive, APP_DIR);
      method = 'download';
    }
    return {
      ok: true, updated: true, from: current, to: info.latest, method,
      name: info.name, notes: info.notes, url: info.url, restarting: true,
    };
  } finally {
    applying = false;
  }
}

module.exports = {
  REPO, APP_DIR, appVersion, parseVersion, compareVersions,
  check, apply, installArchive, isUpdating,
};
