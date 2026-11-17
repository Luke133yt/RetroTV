'use strict';
// Motore del palinsesto: dato un canale produce, in modo deterministico, la sequenza
// di segmenti (episodi e pubblicità) per qualsiasi intervallo di tempo.

// ---------- numeri casuali con seme (stesso seme = stesso palinsesto) ----------
function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rngFor = (str) => mulberry32(xmur3(str)());

// ---------- date (sempre in ora locale della macchina) ----------
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
function parseYmd(s) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function parseHM(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? +m[1] * 60 + +m[2] : 0; }
function atMinutes(day, mins) { return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, mins).getTime(); }

function slotAirsOn(slot, day) {
  const ds = ymd(day);
  if (ds < slot.anchor) return false;
  if (slot.dateFrom && ds < slot.dateFrom) return false;
  if (slot.dateTo && ds > slot.dateTo) return false;
  if (slot.repeat === 'weekly') return slot.weekdays.includes(day.getDay());
  if (slot.repeat === 'monthly') return slot.monthDays.includes(day.getDate());
  return true;
}

// ---------- episodi ----------
function parseSeasons(str) {
  const set = new Set();
  String(str || '').split(/[\s,;]+/).forEach((p) => {
    const m = /^(\d+)(?:-(\d+))?$/.exec(p);
    if (!m) return;
    const a = +m[1], b = m[2] ? +m[2] : a;
    for (let i = a; i <= b && i < 200; i++) set.add(i);
  });
  return set;
}
function slotEpisodes(slot, entry) {
  if (!entry || !entry.episodes) return [];
  let eps = entry.episodes;
  if (slot.seasons) {
    const set = parseSeasons(slot.seasons);
    if (set.size) eps = eps.filter((x) => set.has(x.s));
  }
  return eps;
}
function startIndex(slot, eps) {
  const n = eps.length;
  if (slot.startMode === 'first') return 0;
  if (slot.startMode === 'fixed') {
    const i = eps.findIndex((x) => x.s > slot.startSeason || (x.s === slot.startSeason && x.e >= slot.startEpisode));
    return i < 0 ? 0 : i;
  }
  return Math.floor(rngFor(`start|${slot.seed}|${slot.id}`)() * n);
}
const keyFor = (slot, ep) => (slot.type === 'movie' ? slot.imdb : `${slot.imdb}:${ep.s}:${ep.e}`);

// ---------- simulazione di una singola messa in onda ----------
function nextAd(ads, rng, last) {
  let ad = ads[Math.floor(rng() * ads.length)];
  if (ads.length > 1 && ad === last) ad = ads[(ads.indexOf(ad) + 1) % ads.length];
  return ad;
}
function pickBreak(channel, rng) {
  const ads = (channel.ads || []).filter((a) => a.duration > 0 && a.ytId);
  if (!ads.length) return [];
  const out = [];
  let total = 0, last = null, guard = 0;
  while (total < (channel.adBreakSec || 180) && guard++ < 60) {
    const ad = nextAd(ads, rng, last);
    out.push(ad); total += ad.duration; last = ad;
  }
  return out;
}

// ---------- slot instances and exclusive airtime ----------
// A slot keeps its own complete episodes: it never starts an episode that would
// end after its available airtime. When slots overlap, the most recently started
// one owns the timeline; the earlier one resumes in the gaps. This keeps the
// guide clean and lets long "filler" slots work around shorter programmes.

function instancesForDay(channel, date) {
  const out = [];
  channel.slots.forEach((slot, index) => {
    if (!slotAirsOn(slot, date)) return;
    const sMin = parseHM(slot.start), eMin = parseHM(slot.end);
    const startMs = atMinutes(date, sMin);
    const endMs = atMinutes(date, eMin <= sMin ? eMin + 1440 : eMin);
    out.push({ slot, index, dateStr: ymd(date), startMs, endMs });
  });
  return out;
}

const instancesMemo = new Map();
function nearbyInstances(channel, date, dateStr) {
  const key = `${channel.id}|${dateStr}`;
  let list = instancesMemo.get(key);
  if (!list) {
    list = [];
    for (let d = -1; d <= 1; d++) list.push(...instancesForDay(channel, addDays(date, d)));
    instancesMemo.set(key, list);
  }
  return list;
}

const intervalsMemo = new Map();
function intervalsFor(channel, slot, dateStr) {
  const key = `${channel.id}|${dateStr}|${slot.id}`;
  if (intervalsMemo.has(key)) return intervalsMemo.get(key);
  const date = parseYmd(dateStr);
  const near = nearbyInstances(channel, date, dateStr);
  const self = near.find((x) => x.slot === slot && x.dateStr === dateStr);
  let out = [];
  if (self) {
    const points = new Set([self.startMs, self.endMs]);
    for (const o of near) {
      if (o === self || o.endMs <= self.startMs || o.startMs >= self.endMs) continue;
      points.add(Math.max(self.startMs, o.startMs));
      points.add(Math.min(self.endMs, o.endMs));
    }
    const pts = [...points].sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (b <= a) continue;
      const mid = (a + b) / 2;
      const active = near.filter((o) => o.startMs <= mid && mid < o.endMs);
      if (!active.length) continue;
      // The most recently started programme wins. Slots that start together
      // share the block in order, so none of them is starved.
      const topStart = Math.max(...active.map((o) => o.startMs));
      const group = active.filter((o) => o.startMs === topStart).sort((x, y) => x.index - y.index);
      const at = group.indexOf(self);
      if (at < 0) continue;
      const from = a + ((b - a) * at) / group.length;
      const to = a + ((b - a) * (at + 1)) / group.length;
      const last = out[out.length - 1];
      if (last && last.end === from) last.end = to;
      else out.push({ start: from, end: to });
    }
  }
  intervalsMemo.set(key, out);
  return out;
}

function simulate(channel, slot, entry, eps, dateStr, cursor) {
  const intervals = intervalsFor(channel, slot, dateStr);
  const rng = rngFor(`air|${slot.id}|${dateStr}`);
  const adList = (channel.ads || []).filter((a) => a.duration > 0 && a.ytId);
  const hasAds = adList.length > 0;
  const defRuntime = slot.type === 'movie' ? 100 : 24;
  let runtime = Math.max(1, Math.round((slot.epMinutes || entry.runtimeMin || defRuntime) * 60));
  // Some metadata sources report absurd runtimes (e.g. "1 min" for a normal
  // series). Only trust explicit per-slot overrides; otherwise use the default.
  if (!slot.epMinutes && slot.type === 'series' && runtime < 5 * 60) runtime = defRuntime * 60;
  const runtimeMs = runtime * 1000;
  const n = eps.length;
  const segs = [];
  let cur = cursor, consumed = 0, idx = 0, airIdx = 0;

  for (let ivIdx = 0; ivIdx < intervals.length; ivIdx++) {
    const iv = intervals[ivIdx];
    let t = iv.start;
    let aired = false;

    while (t < iv.end && n > 0) {
      // Never start an episode that cannot finish inside this airtime block.
      if (t + runtimeMs > iv.end) break;

      let ep;
      if (channel.mode === 'random') {
        // Every airing is picked independently but deterministically.
        const r = rngFor(`rand|${channel.id}|${slot.id}|${dateStr}|${airIdx}`)();
        ep = eps[Math.floor(r * n) % n];
      } else {
        ep = eps[cur % n];
      }
      aired = true;
      const key = keyFor(slot, ep);
      segs.push({
        id: `${slot.id}|${dateStr}|${idx++}`, kind: 'ep', start: t, end: t + runtimeMs,
        slotId: slot.id, type: slot.type, imdb: slot.imdb, epKey: key,
        title: slot.name || entry.name || '', sub: ep.title || '',
        season: slot.type === 'movie' ? 0 : ep.s, episode: slot.type === 'movie' ? 0 : ep.e,
        offset: 0, runtime,
      });
      t += runtimeMs;
      cur = (cur + 1) % n;
      consumed++;
      airIdx++;

      // Commercials always come after the episode. They may run a little past
      // the block; they are trimmed only where the next programme begins.
      if (hasAds) {
        for (const ad of pickBreak(channel, rng)) {
          const end = t + ad.duration * 1000;
          segs.push({
            id: `${slot.id}|${dateStr}|${idx++}`, kind: 'ad', start: t, end,
            slotId: slot.id, title: ad.title, ytId: ad.ytId, adId: ad.id, duration: ad.duration,
          });
          t = end;
        }
      }
    }

    // If the slot had episodes but the last break finished before its airtime
    // ends, keep the channel on air with more commercials: an off-air hole in
    // the middle of the guide is worse than a longer commercial block. Very
    // long leftovers stay empty instead of looping the same spot for hours,
    // and slots where no episode could fit at all are left untouched.
    if (aired && hasAds && t < iv.end && iv.end - t <= 30 * 60 * 1000) {
      const fillRng = rngFor(`fill|${slot.id}|${dateStr}|${ivIdx}`);
      let last = null, guard = 0;
      while (t < iv.end && guard++ < 500) {
        const ad = nextAd(adList, fillRng, last);
        const end = Math.min(t + ad.duration * 1000, iv.end);
        segs.push({
          id: `${slot.id}|${dateStr}|${idx++}`, kind: 'ad', start: t, end,
          slotId: slot.id, title: ad.title, ytId: ad.ytId, adId: ad.id, duration: ad.duration,
        });
        t = end;
        last = ad;
      }
    }
  }
  return { segs, consumed };
}

// ---------- cursore (quale episodio inizia in una certa data) ----------
const memo = new Map();
function clearCache() { memo.clear(); intervalsMemo.clear(); instancesMemo.clear(); }

function cursorFor(channel, slot, entry, eps, dateStr) {
  const n = eps.length;
  if (!n || dateStr < slot.anchor) return null;
  const key = `${channel.id}|${slot.id}`;
  let st = memo.get(key);
  if (!st) {
    st = { byDate: new Map(), walked: ymd(addDays(parseYmd(slot.anchor), -1)), cursor: startIndex(slot, eps) };
    memo.set(key, st);
  }
  let guard = 0;
  while (st.walked < dateStr && guard++ < 4000) {
    const d = addDays(parseYmd(st.walked), 1);
    const ds = ymd(d);
    if (slotAirsOn(slot, d)) {
      st.byDate.set(ds, st.cursor);
      st.cursor = (st.cursor + simulate(channel, slot, entry, eps, ds, st.cursor).consumed) % n;
    }
    st.walked = ds;
  }
  return st.byDate.has(dateStr) ? st.byDate.get(dateStr) : null;
}

// ---------- API pubblica ----------
function getSegments(channel, metaStore, fromMs, toMs) {
  const all = [];
  const first = addDays(new Date(fromMs), -1);
  const last = new Date(toMs);
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const ds = ymd(d);
    for (const slot of channel.slots) {
      if (!slotAirsOn(slot, d)) continue;
      const entry = metaStore[`${slot.type}:${slot.imdb}`];
      if (!entry) continue;
      const eps = slotEpisodes(slot, entry);
      if (!eps.length) continue;
      const cursor = cursorFor(channel, slot, entry, eps, ds);
      if (cursor === null) continue;
      all.push(...simulate(channel, slot, entry, eps, ds, cursor).segs);
    }
  }

  // Complete episodes never overlap. Ad breaks may overrun a block, so trim
  // them where the next programme starts; an ad never cuts into an episode.
  const episodes = all.filter((s) => s.kind === 'ep').sort((a, b) => a.start - b.start);
  const epStarts = episodes.map((s) => s.start);
  for (const s of all) {
    if (s.kind !== 'ad') continue;
    // If an episode is already playing, this overrun ad cannot air at all.
    let lo = 0, hi = epStarts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (epStarts[mid] <= s.start) lo = mid + 1; else hi = mid;
    }
    if (lo > 0 && episodes[lo - 1].end > s.start) { s.end = s.start; continue; }
    // Otherwise stop at the first programme that begins during the ad.
    if (lo < epStarts.length && epStarts[lo] < s.end) s.end = epStarts[lo];
  }

  all.sort((a, b) => a.start - b.start || (a.kind === 'ep' ? -1 : 1));
  const out = [];
  for (const s of all) {
    if (s.end <= s.start) continue;
    if (s.end > fromMs && s.start < toMs) out.push(s);
  }
  return out;
}

// Raggruppa i segmenti in "programmi" per la guida TV.
function toPrograms(segs) {
  const progs = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s.kind === 'ep') {
      const last = progs[progs.length - 1];
      if (last && last.kind === 'ep' && last.epKey === s.epKey && last.slotId === s.slotId && s.offset > 0) {
        last.end = s.end;
      } else {
        progs.push({ kind: 'ep', start: s.start, end: s.end, slotId: s.slotId, epKey: s.epKey,
          title: s.title, sub: s.sub, season: s.season, episode: s.episode });
      }
    } else {
      let j = i;
      while (j + 1 < segs.length && segs[j + 1].kind === 'ad') j++;
      const next = segs[j + 1];
      const inside = next && next.kind === 'ep' && next.offset > 0;
      if (!inside) progs.push({ kind: 'ad', start: s.start, end: segs[j].end, title: 'Pubblicità', sub: '' });
      i = j;
    }
  }
  return progs;
}

function findAt(segs, ms) { return segs.find((s) => s.start <= ms && ms < s.end) || null; }

module.exports = { getSegments, toPrograms, findAt, clearCache, ymd, slotEpisodes };
