'use strict';
// RetroTV – the television: power, channel tuning, real-time playback, TV guide.
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const T = (k, v) => window.RTV_I18N.t(k, v);
const api = async (url, opts) => {
  const r = await fetch(url, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP error ' + r.status);
  return j;
};
const pad2 = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const epLabel = (s) => (s.season ? `S${s.season}E${s.episode}` : '');

const TV = {
  channels: [], idx: 0, on: false, segs: [], segsTo: 0, cur: null, token: 0,
  volume: Number(localStorage.getItem('rtv.vol') ?? 0.8), muted: false,
  settings: { language: 'en', crt: true, staticSound: true, tuneEffect: true, watermark: true },
  cfg: null, yt: null, hls: null, ytState: 'idle', pendingAd: null, numBuf: '', numTimer: 0, osdTimers: {},
};
window.TV = TV;
const vid = $('#vid'), screen = $('#screen');

// ---------- settings ----------
function applySettings() {
  document.body.classList.toggle('no-crt', TV.settings.crt === false);
  document.body.classList.toggle('no-tune', TV.settings.tuneEffect === false);
  if (!TV.settings.watermark) hideWatermark();
  else applyWatermark(TV.channels[TV.idx]);
}
TV.setCrt = function (on) {
  TV.settings.crt = on === undefined ? !TV.settings.crt : !!on;
  document.body.classList.toggle('no-crt', !TV.settings.crt);
  toast(T(TV.settings.crt ? 'tv.crtOn' : 'tv.crtOff'));
  api('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ crt: TV.settings.crt }) }).catch(() => {});
};

// ---------- watermark ----------
function hideWatermark() { $('#watermark').style.display = 'none'; }
function applyWatermark(ch) {
  const wm = $('#watermark'), img = $('#wmImg');
  const logo = ch && ch.logo;
  if (!logo || !logo.url || !TV.settings.watermark) return hideWatermark();
  wm.style.display = 'block';
  if (img.getAttribute('src') !== logo.url) img.src = logo.url;
  const size = Number(logo.size) || 13, m = logo.margin === undefined ? 2.5 : Number(logo.margin);
  const pos = logo.pos || 'br', v = pos[0], h = pos[1];
  wm.style.width = size + '%';
  wm.style.opacity = String(logo.opacity === undefined ? 0.9 : logo.opacity);
  wm.style.left = wm.style.right = wm.style.top = wm.style.bottom = 'auto';
  wm.style.transform = 'none';
  if (h === 'l') wm.style.left = m + '%'; else if (h === 'r') wm.style.right = m + '%'; else wm.style.left = '50%';
  if (v === 't') wm.style.top = m + '%'; else if (v === 'b') wm.style.bottom = m + '%'; else wm.style.top = '50%';
  const tx = h === 'c' ? '-50%' : '0', ty = v === 'm' ? '-50%' : '0';
  if (tx !== '0' || ty !== '0') wm.style.transform = `translate(${tx}, ${ty})`;
}

// ---------- channel loading ----------
TV.reload = async function (opts) {
  const cfg = await api('/api/config');
  TV.cfg = cfg;
  TV.channels = cfg.channels;
  TV.settings = { language: 'en', crt: true, staticSound: true, tuneEffect: true, watermark: true, ...(cfg.settings || {}) };
  window.RTV_I18N.set(TV.settings.language);
  applySettings();
  const last = localStorage.getItem('rtv.ch');
  if (TV.idx >= TV.channels.length || (last && !TV.cur)) {
    const i = TV.channels.findIndex((c) => c.id === last);
    TV.idx = i >= 0 ? i : 0;
  }
  $('#knobNum').textContent = TV.channels[TV.idx] ? pad2(TV.channels[TV.idx].number) : '--';
  if (TV.on && !(opts && opts.noTune)) TV.tune(TV.idx, true);
  return cfg;
};

// ---------- effects: noise, static sound, beep, OSD ----------
let noiseRaf = 0;
function startNoise(ms) {
  const c = $('#noise'), g = c.getContext('2d'), img = g.createImageData(c.width, c.height);
  c.style.display = 'block';
  cancelAnimationFrame(noiseRaf);
  const frame = () => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { const v = (Math.random() * 255) | 0; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(img, 0, 0);
    noiseRaf = requestAnimationFrame(frame);
  };
  frame();
  startStaticSound();
  if (ms) setTimeout(() => { if (!TV.loading) stopNoise(); }, ms);
}
function stopNoise() {
  cancelAnimationFrame(noiseRaf);
  $('#noise').style.display = 'none';
  stopStaticSound();
}

let actx, staticSrc = null, staticGain = null, staticBuf = null;
function ensureAudio() {
  try {
    if (!actx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      actx = new C();
    }
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  } catch (e) { return null; }
}
function getStaticBuffer(ctx) {
  if (staticBuf && staticBuf.sampleRate === ctx.sampleRate) return staticBuf;
  const len = Math.floor(ctx.sampleRate * 2);
  staticBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = staticBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return staticBuf;
}
function startStaticSound() {
  if (!TV.settings.staticSound) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  stopStaticSound(0);
  try {
    const src = ctx.createBufferSource();
    src.buffer = getStaticBuffer(ctx); src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7200;
    const gain = ctx.createGain();
    const target = Math.max(0.0001, 0.055 * (TV.muted ? 0 : TV.volume));
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.06);
    src.connect(hp).connect(lp).connect(gain).connect(ctx.destination);
    src.start();
    staticSrc = src; staticGain = gain;
  } catch (e) { /* audio not available */ }
}
function stopStaticSound(fade = 0.2) {
  if (!staticGain || !actx) return;
  const src = staticSrc, gain = staticGain;
  staticSrc = null; staticGain = null;
  try {
    const now = actx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), now);
    gain.gain.linearRampToValueAtTime(0.0001, now + fade);
    if (src) src.stop(now + fade + 0.02);
  } catch (e) { /* already stopped */ }
}
function beep(freq = 880, dur = 0.08) {
  try {
    const ctx = ensureAudio();
    if (!ctx) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = freq; o.type = 'square'; g.gain.value = 0.03;
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + dur);
  } catch (e) { /* audio not available */ }
}

function tuneIn() {
  if (!TV.settings.tuneEffect) return;
  screen.classList.remove('tuning');
  void screen.offsetWidth;
  screen.classList.add('tuning');
  clearTimeout(TV.osdTimers.tune);
  TV.osdTimers.tune = setTimeout(() => screen.classList.remove('tuning'), 1500);
}
function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(TV.osdTimers.toast);
  TV.osdTimers.toast = setTimeout(() => el.classList.remove('show'), 1800);
}

function flash(el, ms) {
  el.classList.add('show');
  clearTimeout(TV.osdTimers[el.id]);
  TV.osdTimers[el.id] = setTimeout(() => el.classList.remove('show'), ms);
}
function showNum(text) { $('#osdNum').textContent = text; flash($('#osdNum'), 2500); }
function showInfo(seg, ch) {
  if (!seg || seg.kind !== 'ep') return;
  $('#oiTitle').textContent = `${pad2(ch.number)}  ${ch.name.toUpperCase()}`;
  $('#oiSub').textContent = `${seg.title} ${epLabel(seg)}${seg.sub ? ' – ' + seg.sub : ''}`;
  $('#oiTime').textContent = `${hhmm(seg.start)} – ${hhmm(seg.end)}`;
  flash($('#osdInfo'), 4500);
}

function showTestcard(title, sub) {
  const t = $('#testcard');
  if (!title) { t.style.display = 'none'; return; }
  detachHls();
  $('#tcTitle').textContent = title; $('#tcSub').textContent = sub || '';
  t.style.display = 'block';
  vid.pause(); hideYt();
}
setInterval(() => { $('#tcClock').textContent = new Date().toLocaleTimeString(window.RTV_I18N.locale); }, 1000);

// ---------- volume ----------
function applyVolume() {
  vid.volume = TV.volume; vid.muted = TV.muted;
  if (TV.yt && TV.yt.setVolume) { TV.yt.setVolume(TV.volume * 100); TV.muted ? TV.yt.mute() : TV.yt.unMute(); }
  if (staticGain && actx) {
    try {
      const v = Math.max(0.0001, 0.055 * (TV.muted ? 0 : TV.volume));
      staticGain.gain.cancelScheduledValues(actx.currentTime);
      staticGain.gain.setTargetAtTime(v, actx.currentTime, 0.05);
    } catch (e) { /* ignore */ }
  }
  $('#btnMute').textContent = TV.muted ? '🔇' : '🔊';
  $('#volBar').style.setProperty('--v', (TV.muted ? 0 : TV.volume * 100) + '%');
  localStorage.setItem('rtv.vol', TV.volume);
}
function changeVolume(d) { TV.muted = false; TV.volume = Math.max(0, Math.min(1, TV.volume + d)); applyVolume(); flash($('#vol'), 1500); }

// ---------- YouTube (commercials) ----------
// Commercials are muted videos with no captions. The iframe API does not always
// honour cc_load_policy, so captions are unloaded again on every state change.
function muteCaptions() {
  const p = TV.yt;
  if (!p) return;
  try { if (p.unloadModule) p.unloadModule('captions'); } catch (e) { /* ignore */ }
  try { if (p.setOption) p.setOption('captions', 'track', {}); } catch (e) { /* ignore */ }
}
function hideYt() {
  $('#ytbox').style.display = 'none';
  try { if (TV.yt && TV.yt.stopVideo) TV.yt.stopVideo(); } catch (e) { /* ignore */ }
}
function ensureYt() {
  if (TV.ytState !== 'idle') return;
  TV.ytState = 'loading';
  window.onYouTubeIframeAPIReady = () => {
    TV.yt = new YT.Player('yt', {
      width: '100%', height: '100%',
      playerVars: {
        autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, rel: 0,
        playsinline: 1, fs: 0, iv_load_policy: 3, cc_load_policy: 0,
      },
      events: {
        onReady: () => {
          TV.ytState = 'ready'; muteCaptions(); applyVolume();
          if (TV.pendingAd) playAd(TV.pendingAd);
        },
        onStateChange: () => muteCaptions(),
        onError: () => { if (TV.cur && TV.cur.kind === 'ad') showTestcard(T('tv.ad'), T('tv.embedBlocked')); },
      },
    });
  };
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  s.onerror = () => { TV.ytState = 'failed'; if (TV.cur && TV.cur.kind === 'ad') showTestcard(T('tv.ad'), T('tv.youtubeDown')); };
  document.head.appendChild(s);
}
function playAd(seg) {
  TV.pendingAd = seg;
  if (TV.ytState === 'failed') return showTestcard(T('tv.ad'), T('tv.youtubeDown'));
  if (TV.ytState !== 'ready') return ensureYt();
  TV.pendingAd = null;
  detachHls(); vid.pause(); showTestcard(null);
  $('#ytbox').style.display = 'block';
  stopNoise(); TV.loading = false;
  TV.yt.loadVideoById({ videoId: seg.ytId, startSeconds: Math.max(0, (Date.now() - seg.start) / 1000) });
  muteCaptions();
  setTimeout(muteCaptions, 400);
  setTimeout(muteCaptions, 1500);
  applyVolume();
  afterPlaybackStarts();
}

// ---------- HLS (forced audio track) ----------
function detachHls() {
  if (!TV.hls) return;
  try { TV.hls.destroy(); } catch (e) { /* ignore */ }
  TV.hls = null;
}
function startHls(url, onReady) {
  if (!window.Hls || !window.Hls.isSupported()) {
    // Safari/iOS can play HLS natively; everything else needs hls.js.
    if (vid.canPlayType('application/vnd.apple.mpegurl')) { vid.src = url; return true; }
    return false;
  }
  const hls = new window.Hls({ enableWorker: true, lowLatencyMode: false });
  TV.hls = hls;
  hls.on(window.Hls.Events.ERROR, (ev, data) => {
    if (!data || !data.fatal) return;
    TV.loading = false; stopNoise(); detachHls();
    showTestcard(T('tv.noSignal'), T('tv.codec'));
  });
  hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
    try { onReady(); } catch (e) { /* ignore */ }
    applyVolume();
    vid.play().catch(() => showTestcard(T('tv.autoplay'), T('tv.autoplayHint')));
  });
  hls.loadSource(url);
  hls.attachMedia(vid);
  return true;
}

// ---------- segment playback ----------
function afterPlaybackStarts() {
  TV.loading = false;
  stopNoise();
  tuneIn();
}
async function playEp(seg, ch) {
  const tok = ++TV.token;
  hideYt(); showTestcard(null); vid.pause(); detachHls();
  TV.loading = true; startNoise();
  try {
    // How far into the episode the channel is right now.
    const liveTarget = Math.max(0, (seg.offset || 0) + (Date.now() - seg.start) / 1000);
    let url = seg.mediaUrl, kind = 'direct';
    let target = liveTarget;
    if (!url) {
      const r = await api(`/api/resolve?type=${seg.type}&key=${encodeURIComponent(seg.epKey)}&t=${Math.round(liveTarget)}`);
      if (tok !== TV.token) return;
      url = r.url; kind = r.kind === 'hls' ? 'hls' : 'direct';
      // The server already started the remux at the live position.
      if (kind === 'hls') target = 0;
    }
    vid.onloadedmetadata = () => {
      if (tok !== TV.token) return;
      if (kind === 'hls') return;
      if (vid.duration && target >= vid.duration - 2) { TV.loading = false; stopNoise(); return showTestcard(T('tv.endProgram'), T('tv.waitingNext')); }
      if (target > 1) { try { vid.currentTime = target; } catch (e) { /* seeking may not be ready */ } }
      applyVolume();
      vid.play().catch(() => showTestcard(T('tv.autoplay'), T('tv.autoplayHint')));
    };
    vid.onplaying = () => { if (tok === TV.token) afterPlaybackStarts(); };
    vid.onended = () => { if (tok === TV.token) showTestcard(T('tv.endProgram'), T('tv.waitingNext')); };
    vid.onerror = () => {
      if (tok !== TV.token || kind === 'hls') return;
      TV.loading = false; stopNoise(); showTestcard(T('tv.noSignal'), T('tv.codec'));
    };
    if (kind === 'hls') {
      const ok = startHls(url, () => { if (target > 1) { try { vid.currentTime = target; } catch (e) { /* ignore */ } } });
      if (!ok) { TV.loading = false; stopNoise(); return showTestcard(T('tv.noSignal'), T('tv.codec')); }
    } else {
      vid.src = url;
    }
    showInfo(seg, ch);
  } catch (e) {
    if (tok !== TV.token) return;
    TV.loading = false; stopNoise();
    showTestcard(T('tv.noSignal'), String(e.message).slice(0, 140));
  }
}
function playSegment(seg) {
  TV.cur = seg;
  const ch = TV.channels[TV.idx];
  if (!seg) { TV.token++; TV.loading = false; stopNoise(); return showTestcard(T('tv.nothingNow'), T('tv.offAir')); }
  if (seg.kind === 'ad') { TV.token++; return playAd(seg); }
  playEp(seg, ch);
}

// ---------- tuning and tick ----------
async function fetchSegs() {
  const ch = TV.channels[TV.idx];
  if (!ch) return;
  const now = Date.now();
  const [res] = await api(`/api/guide?ch=${ch.id}&from=${now - 1800e3}&to=${now + 10 * 3600e3}`);
  TV.segs = res ? res.segments : [];
  TV.segsTo = now + 10 * 3600e3;
}
TV.tune = async function (idx, quiet) {
  if (!TV.channels.length) { showTestcard(T('tv.noChannels'), T('tv.createHint')); return; }
  TV.idx = ((idx % TV.channels.length) + TV.channels.length) % TV.channels.length;
  const ch = TV.channels[TV.idx];
  localStorage.setItem('rtv.ch', ch.id);
  $('#knobNum').textContent = pad2(ch.number);
  $('#knobCh').style.transform = `rotate(${TV.idx * 40}deg)`;
  $('#knobNum').style.transform = `rotate(${-TV.idx * 40}deg)`;
  applyWatermark(ch);
  showNum(pad2(ch.number));
  if (!quiet) { startNoise(500); beep(); }
  const tok = ++TV.token;
  TV.cur = null; vid.pause(); hideYt();
  try { await fetchSegs(); } catch (e) { TV.segs = []; }
  if (tok !== TV.token) return;
  tick(true);
};
function tick(force) {
  if (!TV.on || !TV.channels.length) return;
  const now = Date.now();
  if (now > TV.segsTo - 3600e3) fetchSegs().catch(() => {});
  const seg = TV.segs.find((s) => s.start <= now && now < s.end) || null;
  if (force || !!(seg && seg.id) !== !!(TV.cur && TV.cur.id) || (seg && TV.cur && seg.id !== TV.cur.id) || (!seg && TV.cur)) playSegment(seg);
}
setInterval(() => tick(false), 500);
TV.next = (d) => TV.tune(TV.idx + d);

// ---------- updates ----------
TV.updateInfo = null;
TV.updating = false;
function hideUpdateBar() { $('#updateBar').hidden = true; }
function showUpdateBar(info, force) {
  if (!info || !info.update) return;
  if (!force && sessionStorage.getItem('rtv.updateLater') === info.latest) return;
  TV.updateInfo = info;
  $('#ubTitle').textContent = T('update.available');
  $('#ubSub').textContent = T('update.availableText', { version: 'v' + info.latest, current: 'v' + info.current });
  $('#updateBar').hidden = false;
  $('#updateBar').classList.remove('busy');
  $('#ubNow').disabled = false;
  $('#ubLater').hidden = false;
}
TV.showUpdateBar = showUpdateBar;
TV.checkUpdate = async function (manual) {
  try {
    const info = await api('/api/update/check');
    TV.updateInfo = info;
    if (info.disabled) {
      hideUpdateBar();
      if (manual) toast(T('update.disabled'));
      return info;
    }
    if (!info.ok) {
      hideUpdateBar();
      if (manual) toast(T('update.failed', { msg: info.error || '' }));
      return info;
    }
    if (info.update) showUpdateBar(info, manual);
    else {
      hideUpdateBar();
      if (manual) toast(info.reason === 'no-releases'
        ? T('update.noReleases')
        : T('update.upToDate', { version: 'v' + info.current }));
    }
    return info;
  } catch (e) {
    if (manual) toast(T('update.failed', { msg: e.message }));
    return null;
  }
};
async function waitForRestart(expected) {
  const started = Date.now();
  await new Promise((r) => setTimeout(r, 1200));
  while (Date.now() - started < 120000) {
    try {
      const info = await api('/api/info');
      if (!expected || info.version === expected) return true;
    } catch (e) { /* the server is still restarting */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}
TV.applyUpdate = async function () {
  if (TV.updating) return;
  TV.updating = true;
  const bar = $('#updateBar');
  bar.hidden = false;
  bar.classList.add('busy');
  $('#ubNow').disabled = true;
  $('#ubLater').hidden = true;
  $('#ubTitle').textContent = T('update.working');
  $('#ubSub').textContent = '';
  try {
    const out = await api('/api/update/apply', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    if (!out.updated) {
      TV.updating = false;
      bar.classList.remove('busy');
      $('#ubTitle').textContent = T('update.available');
      $('#ubSub').textContent = T('update.upToDate', { version: 'v' + (out.current || out.latest || '') });
      $('#ubLater').hidden = false;
      return;
    }
    $('#ubTitle').textContent = T('update.restarting');
    $('#ubSub').textContent = T('update.installing', { version: 'v' + out.to });
    if (await waitForRestart(out.to)) { location.reload(); return; }
    TV.updating = false;
    bar.classList.remove('busy');
    $('#ubTitle').textContent = T('update.failedTitle');
    $('#ubSub').textContent = T('update.restartHint');
    $('#ubNow').disabled = false;
    $('#ubLater').hidden = false;
  } catch (e) {
    TV.updating = false;
    bar.classList.remove('busy');
    $('#ubTitle').textContent = T('update.failedTitle');
    $('#ubSub').textContent = T('update.failed', { msg: e.message });
    $('#ubNow').disabled = false;
    $('#ubLater').hidden = false;
  }
};
$('#ubNow').onclick = () => TV.applyUpdate();
$('#ubLater').onclick = () => {
  if (TV.updateInfo && TV.updateInfo.latest) sessionStorage.setItem('rtv.updateLater', TV.updateInfo.latest);
  hideUpdateBar();
};

// ---------- power ----------
TV.power = function (on) {
  TV.on = on === undefined ? !TV.on : on;
  screen.classList.toggle('on', TV.on);
  $('#led').classList.toggle('on', TV.on);
  if (TV.on) {
    ensureAudio();
    screen.classList.add('turning-on'); setTimeout(() => screen.classList.remove('turning-on'), 600);
    beep(220, 0.15);
    if (TV.settings.staticSound) startNoise(750);
    applyVolume();
    TV.reload({ noTune: true }).then(() => {
      if (!TV.channels.length) {
        showTestcard(T('tv.noChannels'), T('tv.createHint'));
        setTimeout(() => window.openMenu && window.openMenu(), 600);
      } else TV.tune(TV.idx, !TV.settings.staticSound);
    });
  } else {
    TV.token++; vid.pause(); hideYt(); stopNoise(); showTestcard(null); TV.cur = null; hideWatermark(); closeGuide();
  }
};

// ---------- TV guide ----------
const PX = 4;                       // pixels per minute
let guideDay = null, guideSel = null;
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
async function openGuide() {
  if (!TV.on) TV.power(true);
  guideDay = startOfDay(new Date());
  $('#guide').hidden = false;
  await renderGuide(true);
}
function closeGuide() { $('#guide').hidden = true; }
async function renderGuide(scrollNow) {
  const from = guideDay.getTime(), to = startOfDay(new Date(from + 36e5 * 26)).getTime();
  $('#gDate').textContent = guideDay.toLocaleDateString(window.RTV_I18N.locale, { weekday: 'long', day: 'numeric', month: 'long' });
  let data = [];
  try { data = await api(`/api/guide?ch=all&from=${from}&to=${to}`); } catch (e) { $('#gInfo').textContent = T('guide.error', { msg: e.message }); }
  const now = Date.now();
  $('#gChans').innerHTML = '<div class="g-ruler"></div>' + data.map((c, i) =>
    `<div class="g-chan" data-i="${i}" style="background:${esc(c.color)}">${pad2(c.number)} ${esc(c.name)}</div>`).join('');
  let ruler = '';
  for (let m = 0; m < 1440; m += 30) ruler += `<span style="left:${m * PX}px">${pad2(m / 60 | 0)}:${pad2(m % 60)}</span>`;
  const rows = data.map((c) => `<div class="g-row">${c.programs.map((p, k) => {
    const a = Math.max(p.start, from), b = Math.min(p.end, to);
    if (b <= a) return '';
    const isNow = p.kind === 'ep' && p.start <= now && now < p.end;
    const text = p.kind === 'ad' ? T('guide.ads') : `${p.title} ${epLabel(p)}${p.sub ? ' · ' + p.sub : ''}`;
    return `<div class="g-prog ${p.kind === 'ad' ? 'ad' : ''} ${isNow ? 'now' : ''}" data-c="${c.id}" data-k="${k}" ` +
      `style="left:${(a - from) / 60000 * PX}px;width:${Math.max(2, (b - a) / 60000 * PX - 2)}px" title="${esc(text)}">${esc(text)}</div>`;
  }).join('')}</div>`).join('');
  const nowLine = now >= from && now < to ? `<div class="g-now" style="left:${(now - from) / 60000 * PX}px"></div>` : '';
  const grid = $('#gGrid');
  grid.style.width = 1440 * PX + 'px';
  grid.innerHTML = `<div class="g-ruler">${ruler}</div>${rows}${nowLine}`;
  grid.onclick = (e) => {
    const el = e.target.closest('.g-prog'); if (!el) return;
    const c = data.find((x) => x.id === el.dataset.c), p = c.programs[+el.dataset.k];
    if (el.classList.contains('now')) { closeGuide(); TV.tune(TV.channels.findIndex((x) => x.id === c.id)); return; }
    $$('.g-prog.sel').forEach((x) => x.classList.remove('sel')); el.classList.add('sel');
    $('#gInfo').innerHTML = `<b>${pad2(c.number)} ${esc(c.name)}</b> · ${hhmm(p.start)}–${hhmm(p.end)} · ${esc(p.title)} ${epLabel(p)} ${esc(p.sub || '')}`;
  };
  $('#gChans').onclick = (e) => {
    const el = e.target.closest('.g-chan'); if (!el) return;
    closeGuide(); TV.tune(TV.channels.findIndex((x) => x.id === data[+el.dataset.i].id));
  };
  if (scrollNow) {
    const scroller = $('#gBody');
    scroller.scrollLeft = Math.max(0, ((now - from) / 60000 - 30) * PX);
  }
}
$('#gPrev').onclick = () => { guideDay = startOfDay(new Date(guideDay.getTime() - 36e5 * 12)); renderGuide(); };
$('#gNext').onclick = () => { guideDay = startOfDay(new Date(guideDay.getTime() + 36e5 * 36)); renderGuide(); };
$('#gToday').onclick = () => { guideDay = startOfDay(new Date()); renderGuide(true); };
$('#gClose').onclick = closeGuide;

// ---------- controls ----------
$('#powerBig').onclick = () => TV.power(true);
$('#btnPower').onclick = () => TV.power();
$('#chUp').onclick = () => TV.on && TV.next(1);
$('#chDown').onclick = () => TV.on && TV.next(-1);
$('#knobCh').onclick = () => TV.on && TV.next(1);
$('#btnGuide').onclick = () => ($('#guide').hidden ? openGuide() : closeGuide());
$('#btnMute').onclick = () => { TV.muted = !TV.muted; applyVolume(); flash($('#vol'), 1500); };
$('#btnMenu').onclick = () => window.openMenu && window.openMenu();
function toggleFull() { document.fullscreenElement ? document.exitFullscreen() : screen.requestFullscreen().catch(() => {}); }
$('#btnFull').onclick = toggleFull;
screen.addEventListener('dblclick', toggleFull);
screen.addEventListener('wheel', (e) => { if (TV.on && $('#guide').hidden) { e.preventDefault(); changeVolume(e.deltaY < 0 ? 0.05 : -0.05); } }, { passive: false });

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input,textarea,select') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (!$('#menu').hidden) return;
  const k = e.key;
  if (k === 'Escape') { if (!$('#guide').hidden) closeGuide(); return; }
  if (k === 'm' || k === 'M') { if (document.fullscreenElement) document.exitFullscreen(); window.openMenu && window.openMenu(); return; }
  if (k === 'g' || k === 'G') { $('#btnGuide').click(); return; }
  if (k === 'f' || k === 'F') { toggleFull(); return; }
  if (k === 'p' || k === 'P') { TV.power(); return; }
  if (k === 'c' || k === 'C') { TV.setCrt(); return; }
  if (!TV.on) { if (k === 'Enter' || k === ' ') TV.power(true); return; }
  if (!$('#guide').hidden) {
    if (k === 'ArrowLeft') $('#gPrev').click(); else if (k === 'ArrowRight') $('#gNext').click();
    return;
  }
  if (k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); TV.next(1); }
  else if (k === 'ArrowDown' || k === 'PageDown') { e.preventDefault(); TV.next(-1); }
  else if (k === 'ArrowRight') changeVolume(0.05);
  else if (k === 'ArrowLeft') changeVolume(-0.05);
  else if (k === 'x' || k === 'X') { TV.muted = !TV.muted; applyVolume(); flash($('#vol'), 1500); }
  else if (/^\d$/.test(k)) {
    TV.numBuf = (TV.numBuf + k).slice(-3);
    showNum(TV.numBuf);
    clearTimeout(TV.numTimer);
    TV.numTimer = setTimeout(() => {
      const n = Number(TV.numBuf); TV.numBuf = '';
      const i = TV.channels.findIndex((c) => c.number === n);
      if (i >= 0) TV.tune(i); else { showNum('--'); beep(200, 0.2); }
    }, 1200);
  }
});

// channel requested by URL (?ch=3): used by the “Open the vintage TV” link inside Stremio/Nuvio
(async () => {
  try {
    await TV.reload();
    const want = Number(new URLSearchParams(location.search).get('ch'));
    if (want) { const i = TV.channels.findIndex((c) => c.number === want); if (i >= 0) TV.idx = i; }
    if (!TV.channels.length) $('#powerBig span').textContent = T('power.createChannels');
  } catch (e) { $('#powerBig span').textContent = T('power.serverDown'); }
  applyVolume();
  setTimeout(() => { TV.checkUpdate(false); }, 1500);
})();
