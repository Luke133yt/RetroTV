'use strict';
// Forces the audio track in the selected video language.
//
// An addon cannot press the player's "audio track" button, so when a file has
// several audio tracks and the wanted one is not the first, RetroTV remuxes on
// this computer: video is copied, the chosen audio is kept (transcoded to AAC
// only when the browser cannot play it) and the result is served as HLS.
// Everything degrades to the original stream if ffmpeg is missing or slow.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const store = require('./store');
const languages = require('./languages');

const FFMPEG = process.env.RETROTV_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.RETROTV_FFPROBE || 'ffprobe';
const PROBE_TIMEOUT = 8000;
const PLAYLIST_TIMEOUT = 15000;
const SESSION_IDLE = 20 * 60e3;
const PROBE_TTL = 10 * 60e3;
const ROOT = path.join(os.tmpdir(), 'retrotv-hls');

const sessions = new Map();
const probes = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    let out = '', err = '', done = false;
    const p = spawn(cmd, args, { windowsHide: true });
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { p.kill('SIGKILL'); } catch (e) { /* ignore */ }
      reject(new Error(cmd + ' timed out'));
    }, timeoutMs);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => { if (done) return; done = true; clearTimeout(timer); reject(e); });
    p.on('close', (code) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(String(err || '').slice(-400) || `${cmd} failed (${code})`));
    });
  });
}

async function probeTracks(url) {
  const key = sha1(url);
  const hit = probes.get(key);
  if (hit && hit.exp > Date.now()) return hit.tracks;
  let tracks = null;
  try {
    const out = await run(FFPROBE, [
      '-v', 'error', '-show_entries',
      'stream=index,codec_type,codec_name:stream_tags=language,title', '-of', 'json', '-i', url,
    ], PROBE_TIMEOUT);
    const j = JSON.parse(out || '{}');
    tracks = (j.streams || []).filter((s) => s.codec_type === 'audio').map((s) => ({
      index: Number(s.index),
      codec: String(s.codec_name || '').toLowerCase(),
      lang: String(s.tags && s.tags.language || '').toLowerCase(),
      title: String(s.tags && s.tags.title || ''),
    }));
    if (!tracks.length) tracks = null;
  } catch (e) { tracks = null; }
  // Negative results are cached briefly so slow/dead sources are not probed on
  // every single channel switch.
  probes.set(key, { tracks, exp: Date.now() + (tracks ? PROBE_TTL : 60e3) });
  return tracks;
}

function matchTrack(tracks, prof) {
  const isos = new Set(prof.iso.map((x) => String(x).toLowerCase()));
  for (const t of tracks) {
    const base = t.lang.split(/[-_]/)[0];
    if (t.lang && (isos.has(t.lang) || isos.has(base))) return t;
  }
  const titles = prof.titles.map((x) => String(x).toLowerCase());
  for (const t of tracks) {
    const txt = t.title.toLowerCase();
    if (txt && titles.some((w) => txt.includes(w))) return t;
  }
  return null;
}

function killSession(id, s) {
  sessions.delete(id);
  try { if (s.proc && s.proc.exitCode === null) s.proc.kill('SIGKILL'); } catch (e) { /* ignore */ }
  try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch (e) { /* may still be locked */ }
}

async function startSession(url, track, start, lang) {
  const id = sha1(`${url}|${track.index}|${start}|${lang}`);
  const old = sessions.get(id);
  if (old) {
    old.lastAccess = Date.now();
    if (old.alive) return old;
    killSession(id, old);
  }
  // A viewer only watches one programme at a time; keep a small pool so
  // browsing channels cannot spawn an unbounded number of ffmpeg processes.
  if (sessions.size >= 6) {
    const oldest = [...sessions.values()].sort((a, b) => a.lastAccess - b.lastAccess)[0];
    if (oldest) killSession(oldest.id, oldest);
  }

  const dir = path.join(ROOT, id);
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });

  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (start > 0) args.push('-ss', String(start));
  args.push('-i', url, '-map', '0:v:0', '-map', `0:${track.index}`);
  // Chrome cannot play AC3/EAC3/DTS through MSE, so those tracks become AAC.
  if (['aac', 'mp3'].includes(track.codec)) args.push('-c:a', 'copy');
  else args.push('-c:a', 'aac', '-b:a', '192k', '-ac', '2');
  args.push(
    '-c:v', 'copy', '-sn', '-dn', '-f', 'hls',
    '-hls_time', '4', '-hls_list_size', '0', '-hls_playlist_type', 'event',
    '-hls_flags', 'independent_segments',
    '-hls_segment_filename', path.join(dir, 'seg%05d.ts'), path.join(dir, 'index.m3u8'),
  );

  const proc = spawn(FFMPEG, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const session = {
    id, dir, start, lang, trackIndex: track.index, proc,
    createdAt: Date.now(), lastAccess: Date.now(), alive: true, error: '',
  };
  proc.stderr.on('data', (d) => { session.error = (session.error + d.toString()).slice(-600); });
  proc.on('error', (e) => { session.error = e.message; });
  proc.on('close', () => { session.alive = false; });
  sessions.set(id, session);

  const playlist = path.join(dir, 'index.m3u8');
  const deadline = Date.now() + PLAYLIST_TIMEOUT;
  while (Date.now() < deadline) {
    try { if ((await fsp.stat(playlist)).size > 0) return session; } catch (e) { /* not ready yet */ }
    if (!session.alive) break;
    await sleep(150);
  }
  const err = session.error.trim() || 'ffmpeg could not start this stream';
  killSession(id, session);
  throw new Error(err);
}

// Returns { url, kind, audio }. `kind` is "hls" only when an audio swap is
// actually needed and the remux started; in every other case the original URL
// is returned untouched.
async function play(url, opts) {
  const direct = { url, kind: 'direct', audio: null };
  const start = Math.max(0, Math.round(Number(opts && opts.start) || 0));
  try {
    const cfg = store.getConfig();
    if (!cfg.sources.forceAudio) return direct;
    const prof = languages.sourceInfo(cfg.sources.language, cfg.settings.language);
    const tracks = await probeTracks(url);
    if (!tracks) return direct;
    const track = matchTrack(tracks, prof);
    if (!track) return { ...direct, audio: 'no-match' };
    if (tracks[0].index === track.index) return { ...direct, audio: prof.code };
    const session = await startSession(url, track, start, prof.code);
    return { url: `/hls/${session.id}/index.m3u8`, kind: 'hls', audio: prof.code };
  } catch (e) {
    return direct;
  }
}

async function getFile(id, file) {
  const s = sessions.get(id);
  if (!s || !/^(index\.m3u8|seg\d{5}\.ts)$/.test(String(file || ''))) return null;
  s.lastAccess = Date.now();
  const full = path.join(s.dir, file);

  if (file === 'index.m3u8') {
    const deadline = Date.now() + PLAYLIST_TIMEOUT;
    for (;;) {
      try {
        const buf = await fsp.readFile(full);
        if (buf.length) return { buf, type: 'application/vnd.apple.mpegurl', playlist: true };
      } catch (e) { /* ffmpeg has not written it yet */ }
      if (!s.alive || Date.now() >= deadline) return null;
      await sleep(150);
    }
  }

  try { return { buf: await fsp.readFile(full), type: 'video/mp2t', playlist: false }; }
  catch (e) { return null; }
}

const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.lastAccess > SESSION_IDLE) killSession(id, s);
}, 60e3);
if (sweeper.unref) sweeper.unref();

process.on('exit', () => {
  for (const s of sessions.values()) {
    try { if (s.proc && s.proc.exitCode === null) s.proc.kill('SIGKILL'); } catch (e) { /* ignore */ }
  }
});

module.exports = { play, getFile, probeTracks, matchTrack };
