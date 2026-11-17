'use strict';
// Test end-to-end con finti addon (nessuna rete). Esegui: node test/run.js
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');
const assert = require('assert');
const updater = require('../lib/updater');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtv-'));
const MOCK = 7791, APP = 7792, MEDIA = 7793;

// Fake downloaded videos: no real duration, so the 5 minute fallback is used.
const mediaDir = path.join(tmp, 'media');
fs.mkdirSync(mediaDir, { recursive: true });
fs.writeFileSync(path.join(mediaDir, 'Test.Show.S01E01.720p.mp4'), Buffer.alloc(4096, 1));
fs.writeFileSync(path.join(mediaDir, 'Test.Show.S01E02.720p.mp4'), Buffer.alloc(8192, 2));
const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// A real two-audio file (English first, Italian second) for the remux test.
// ffmpeg is optional: the test is skipped when it is not installed.
const mediaFile = path.join(tmp, 'multi.mkv');
const hasFfmpeg = (() => {
  try { return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0; } catch (e) { return false; }
})();
let remuxReady = false;
if (hasFfmpeg) {
  const gen = spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=8',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8',
    '-f', 'lavfi', '-i', 'sine=frequency=880:duration=8',
    '-map', '0:v', '-map', '1:a', '-map', '2:a',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
    '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=ita', mediaFile], { stdio: 'ignore' });
  remuxReady = gen.status === 0 && fs.existsSync(mediaFile);
}
const mediaSrv = http.createServer((req, res) => {
  let st;
  try { st = fs.statSync(mediaFile); } catch (e) { res.statusCode = 404; return res.end(); }
  const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const start = +m[1], end = m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
    res.writeHead(206, { 'Content-Type': 'video/x-matroska', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}` });
    fs.createReadStream(mediaFile, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { 'Content-Type': 'video/x-matroska', 'Accept-Ranges': 'bytes', 'Content-Length': st.size });
    fs.createReadStream(mediaFile).pipe(res);
  }
});

const eps = [];
for (let s = 1; s <= 2; s++) for (let e = 1; e <= 10; e++) eps.push({ season: s, episode: e, name: `Ep ${s}x${e}` });
const mock = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  const u = decodeURIComponent(req.url);
  if (u === '/repos/test/repo/releases/latest') return res.end(JSON.stringify({
    tag_name: 'v99.0.0', name: 'RetroTV 99.0.0', html_url: 'https://example.test/release',
    tarball_url: `http://127.0.0.1:${MOCK}/archive.tar.gz`, assets: [], body: 'A test release.',
  }));
  if (u.includes('/catalog/')) return res.end(JSON.stringify({ metas: [{ id: 'tt1', imdb_id: 'tt1', name: 'Dragon Test', releaseInfo: '1990' }] }));
  if (u.includes('/meta/series/tt1')) return res.end(JSON.stringify({ meta: { name: 'Dragon Test', runtime: '24 min', videos: eps } }));
  if (u.includes('/stream/series/tt2:')) return res.end(JSON.stringify({ streams: [
    { name: '4K HEVC', title: 'Dragon.Test.S01E01.2160p.HEVC.ENG', url: 'http://x/en4k.mkv' },
    { name: '720p', title: 'Dragon.Test.S01E01.720p.ITA', url: 'http://x/it720.mp4' },
  ] }));
  if (u.includes('/stream/series/tt3:')) return res.end(JSON.stringify({ streams: [
    { name: 'MKV multi', title: 'Dragon.Test.S01E01.ITA.ENG', url: `http://127.0.0.1:${MEDIA}/multi.mkv` },
  ] }));
  if (u.includes('/stream/series/tt1:')) return res.end(JSON.stringify({ streams: [{ name: '4K HEVC', url: 'http://x/4k.mkv' }, { name: '720p', url: 'http://x/720.mp4' }] }));
  if (u.endsWith('manifest.json')) return res.end(JSON.stringify({ name: 'Mock' }));
  res.statusCode = 404; res.end('{}');
});

const get = (p, o) => fetch(`http://127.0.0.1:${APP}${p}`, { redirect: 'manual', ...o });
const j = async (p, o) => (await get(p, o)).json();

// Minimal tar.gz writer, only for the updater extraction test.
function tarEntry(name, data) {
  const h = Buffer.alloc(512);
  h.write(name.slice(0, 100), 0, 100, 'utf8');
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136);
  h.write('        ', 148); h.write('0', 156);
  h.write('ustar\0', 257); h.write('00', 263);
  let sum = 0; for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}
const makeTarGz = (entries) => zlib.gzipSync(Buffer.concat([
  ...entries.map((e) => tarEntry(e.name, e.data)), Buffer.alloc(1024),
]));

(async () => {
  // ---------- updater: version comparison and safe archive extraction ----------
  assert.strictEqual(updater.compareVersions('2.1.1', '2.1.0'), 1);
  assert.strictEqual(updater.compareVersions('v2.1.0', '2.1.0'), 0);
  assert.strictEqual(updater.compareVersions('2.0.9', '2.1.0'), -1);
  const installDir = path.join(tmp, 'update-install');
  const written = updater.installArchive(makeTarGz([
    { name: 'RetroTV-99.0.0/server.js', data: Buffer.from('// new server') },
    { name: 'RetroTV-99.0.0/public/marker.txt', data: Buffer.from('ok') },
    { name: 'RetroTV-99.0.0/data/config.json', data: Buffer.from('{"secret":1}') },
    { name: 'RetroTV-99.0.0/../escape.txt', data: Buffer.from('nope') },
  ]), installDir);
  assert(written.includes('server.js') && written.includes('public/marker.txt'), 'estrazione aggiornamento incompleta');
  assert(!written.some((n) => n.startsWith('data/')), 'data/ non deve essere sovrascritta');
  assert.strictEqual(fs.readFileSync(path.join(installDir, 'server.js'), 'utf8'), '// new server');
  assert(!fs.existsSync(path.join(installDir, 'escape.txt')), 'path traversal nell\'archivio');
  assert(!fs.existsSync(path.join(tmp, 'escape.txt')), 'path traversal fuori dalla destinazione');

  await new Promise((r) => mock.listen(MOCK, r));
  if (remuxReady) await new Promise((r) => mediaSrv.listen(MEDIA, r));
  const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], {
    env: {
      ...process.env, RETROTV_PORT: APP, RETROTV_DATA: tmp,
      RETROTV_UPDATE_API: `http://127.0.0.1:${MOCK}`, RETROTV_UPDATE_REPO: 'test/repo',
    }, stdio: 'pipe',
  });
  let log = ''; srv.stdout.on('data', (d) => (log += d)); srv.stderr.on('data', (d) => (log += d));
  await new Promise((r) => setTimeout(r, 800));
  try {
    const m = await j('/manifest.json');
    assert.strictEqual(m.id, 'community.retrotv'); assert.deepStrictEqual(m.types, ['tv']);

    // update check against the mock GitHub release API
    const up = await j('/api/update/check');
    assert.strictEqual(up.ok, true, 'controllo aggiornamenti fallito: ' + JSON.stringify(up));
    assert.strictEqual(up.update, true, 'aggiornamento non rilevato: ' + JSON.stringify(up));
    assert.strictEqual(up.latest, '99.0.0');
    assert.strictEqual(up.current, updater.appVersion());

    const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const cfg = {
      sources: { metaAddon: `http://127.0.0.1:${MOCK}`, streamAddons: [`http://127.0.0.1:${MOCK}/manifest.json`], stremioServer: 'http://127.0.0.1:1', language: 'en', forceAudio: false },
      channels: [{ name: 'Anime', number: 5, adBreakSec: 60, midRoll: false,
        ads: [{ ytId: 'dQw4w9WgXcQ', title: 'Spot A', duration: 30 }, { ytId: 'aaaaaaaaaaa', title: 'Spot B', duration: 20 }],
        slots: [{ type: 'series', imdb: 'tt1', name: 'Dragon Test', start: '00:00', end: '23:59', repeat: 'daily', startMode: 'first', anchor: ymd(new Date(Date.now() - 86400e3)) }] }],
    };
    const put = await j('/api/config', { method: 'PUT', body: JSON.stringify(cfg) });
    assert.deepStrictEqual(put.errors, [], 'errori meta: ' + JSON.stringify(put.errors));
    const chId = put.config.channels[0].id;

    // guida: 24 ore, episodi in ordine, pubblicità >= 60s tra un episodio e l'altro
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const [g] = await j(`/api/guide?ch=${chId}&from=${from.getTime()}&to=${from.getTime() + 86400e3}`);
    const segs = g.segments;
    assert(segs.length > 20, 'pochi segmenti: ' + segs.length);
    for (let i = 1; i < segs.length; i++) assert(segs[i].start >= segs[i - 1].end, 'sovrapposizione al segmento ' + i);
    const epSegs = segs.filter((s) => s.kind === 'ep');
    for (let i = 1; i < epSegs.length; i++) {
      const a = epSegs[i - 1], b = epSegs[i];
      const nextIdx = (a.season - 1) * 10 + a.episode; // indice 0-based dell'episodio successivo
      assert.strictEqual((b.season - 1) * 10 + b.episode - 1, nextIdx % 20, `ordine rotto tra ${a.epKey} e ${b.epKey}`);
    }
    const firstAdBlock = []; let i0 = segs.findIndex((s) => s.kind === 'ad');
    while (segs[i0] && segs[i0].kind === 'ad') firstAdBlock.push(segs[i0++]);
    assert(firstAdBlock.reduce((t, s) => t + (s.end - s.start) / 1000, 0) >= 60 - 1, 'pausa pubblicitaria troppo corta');

    // determinismo: stessa richiesta = stesso risultato
    const [g2] = await j(`/api/guide?ch=${chId}&from=${from.getTime()}&to=${from.getTime() + 86400e3}`);
    assert.deepStrictEqual(g2.segments.map((s) => s.id + s.start), segs.map((s) => s.id + s.start), 'palinsesto non deterministico');

    // continuità tra giorni: il primo episodio di domani segue l'ultimo di oggi
    const [g3] = await j(`/api/guide?ch=${chId}&from=${from.getTime() + 86400e3 - 3600e3}&to=${from.getTime() + 86400e3 + 3600e3}`);
    assert(g3.segments.some((s) => s.kind === 'ep'));

    // resolve: preferisce 720p mp4 al 4K HEVC mkv
    const r = await j('/api/resolve?type=series&key=tt1:1:1');
    assert.strictEqual(r.url, 'http://x/720.mp4');

    // addon: catalogo, meta, stream, play
    const cat = await j('/catalog/tv/retrotv.json');
    assert.strictEqual(cat.metas.length, 1); assert(cat.metas[0].name.startsWith('05'));
    const st = await j(`/stream/tv/retrotv:${chId}.json`);
    assert(st.streams.length >= 1 && st.streams[0].externalUrl);
    const play = await get(`/play/${chId}`); assert.strictEqual(play.status, 302);
    assert.strictEqual((await get(`/logo/${chId}.svg`)).status, 200);

    // ricerca titoli
    const sr = await j('/api/search?q=dragon'); assert(sr.some((x) => x.imdb === 'tt1'));

    // export / import
    const ex = await j('/api/export?days=7');
    assert.strictEqual(ex.format, 'retrotv-backup'); assert(ex.schedule.channels[0].programs.length > 0);
    const imp = await j('/api/import', { method: 'POST', body: JSON.stringify(ex) });
    assert.strictEqual(imp.ok, true); assert.strictEqual(imp.channels, 1);

    // fascia che attraversa la mezzanotte + giorni della settimana
    const cfg2 = JSON.parse(JSON.stringify(ex.config));
    cfg2.channels[0].slots = [{ ...cfg2.channels[0].slots[0], start: '22:00', end: '02:00', repeat: 'weekly', weekdays: [new Date().getDay()], anchor: ymd(new Date()) }];
    await j('/api/config', { method: 'PUT', body: JSON.stringify(cfg2) });
    const [g4] = await j(`/api/guide?ch=${chId}&from=${from.getTime()}&to=${from.getTime() + 2 * 86400e3}`);
    assert(g4.segments.length > 0, 'fascia notturna vuota');
    const hrs = new Set(g4.segments.map((s) => new Date(s.start).getHours()));
    assert(hrs.has(22) && hrs.has(1) && !hrs.has(12), 'ore errate: ' + [...hrs]);

    // ---------- settings + language persistence ----------
    const set1 = await j('/api/settings', { method: 'PUT', body: JSON.stringify({ language: 'it', crt: false, staticSound: false, tuneEffect: false, watermark: false }) });
    assert.deepStrictEqual(set1.settings, { language: 'it', crt: false, staticSound: false, tuneEffect: false, watermark: false });
    const cfgIt = await j('/api/config');
    assert.strictEqual(cfgIt.settings.language, 'it');
    assert.strictEqual(cfgIt.settings.crt, false);
    assert((await j('/manifest.json')).description.includes('televisione'), 'addon non tradotto in italiano');
    assert.strictEqual((await j('/api/info')).settings.language, 'it');
    const setBad = await j('/api/settings', { method: 'PUT', body: JSON.stringify({ language: 'zz' }) });
    assert.strictEqual(setBad.settings.language, 'en', 'lingua sconosciuta non riportata a inglese');

    // ---------- video language is independent from the interface ----------
    assert.strictEqual((await j('/api/config')).sources.language, 'en');
    await j('/api/settings', { method: 'PUT', body: JSON.stringify({ language: 'it' }) });
    const afterUi = await j('/api/config');
    assert.strictEqual(afterUi.settings.language, 'it');
    assert.strictEqual(afterUi.sources.language, 'en', 'la lingua dell’interfaccia non deve cambiare la lingua dei video');
    const langCfg = JSON.parse(JSON.stringify(afterUi));
    langCfg.sources.language = 'ja';
    const jaPut = await j('/api/config', { method: 'PUT', body: JSON.stringify(langCfg) });
    assert.strictEqual(jaPut.config.sources.language, 'ja', 'lingua giapponese non salvata');
    assert.strictEqual(jaPut.config.sources.forceAudio, false, 'forceAudio perso');
    assert.strictEqual(jaPut.config.settings.language, 'it', 'la lingua dei video ha cambiato l’interfaccia');
    const infoSrc = await j('/api/info');
    assert.strictEqual(infoSrc.sourceLanguage, 'ja');
    assert(infoSrc.sourceLanguages.some((l) => l.code === 'ja' && l.torrentio.includes('language=japanese')), 'profilo giapponese mancante');
    assert((await j('/manifest.json')).description.includes('televisione'), 'la lingua dei video ha cambiato l’addon');

    // ---------- language-aware stream choice ----------
    const pickLang = async (code) => {
      const c = JSON.parse(JSON.stringify(await j('/api/config')));
      c.sources.language = code;
      await j('/api/config', { method: 'PUT', body: JSON.stringify(c) });
      return j('/api/resolve?type=series&key=tt2:1:1');
    };
    assert.strictEqual((await pickLang('it')).url, 'http://x/it720.mp4', 'sorgente italiana non preferita');
    assert.strictEqual((await pickLang('en')).url, 'http://x/en4k.mkv', 'sorgente inglese non preferita');
    assert.strictEqual((await pickLang('ja')).url, 'http://x/it720.mp4', 'senza sorgenti giapponesi deve scegliere la migliore disponibile');

    // ---------- random mode is deterministic ----------
    const randCfg = JSON.parse(JSON.stringify(await j('/api/config')));
    const chRand = randCfg.channels[0];
    chRand.mode = 'random';
    chRand.slots = [{ ...chRand.slots[0], start: '00:00', end: '23:59', repeat: 'daily', startMode: 'random', anchor: ymd(new Date(Date.now() - 86400e3)), seed: 424242 }];
    await j('/api/config', { method: 'PUT', body: JSON.stringify(randCfg) });
    const rf = from.getTime(), rt = rf + 86400e3;
    const [r1] = await j(`/api/guide?ch=${chId}&from=${rf}&to=${rt}`);
    const [r2] = await j(`/api/guide?ch=${chId}&from=${rf}&to=${rt}`);
    assert.deepStrictEqual(r2.segments.map((s) => s.id + s.start + s.end), r1.segments.map((s) => s.id + s.start + s.end), 'modalità casuale non deterministica');
    const epRand = r1.segments.filter((s) => s.kind === 'ep');
    assert(epRand.length > 5, 'pochi episodi in modalità casuale: ' + epRand.length);
    let sequentialRuns = 0;
    for (let i = 1; i < epRand.length; i++) {
      const [ps, pe] = String(epRand[i - 1].epKey).split(':').slice(1).map(Number);
      const [cs, ce] = String(epRand[i].epKey).split(':').slice(1).map(Number);
      if (((ps - 1) * 10 + pe) % 20 + 1 === (cs - 1) * 10 + ce) sequentialRuns++;
    }
    assert(sequentialRuns < epRand.length - 1, 'la modalità casuale segue ancora l\'ordine sequenziale');

    // ---------- per-channel logo (uploaded data URL) ----------
    const logoCfg = JSON.parse(JSON.stringify(await j('/api/config')));
    logoCfg.channels[0].logo = { url: PNG_1PX, size: 999, pos: 'xx', opacity: 5, margin: -3 };
    await j('/api/config', { method: 'PUT', body: JSON.stringify(logoCfg) });
    const afterLogo = await j('/api/config');
    const lg = afterLogo.channels[0].logo;
    assert.strictEqual(lg.url, PNG_1PX, 'logo valido scartato');
    assert.deepStrictEqual({ size: lg.size, pos: lg.pos, opacity: lg.opacity, margin: lg.margin }, { size: 60, pos: 'br', opacity: 1, margin: 0 }, 'logo non normalizzato');
    const lgRes = await get(`/chlogo/${afterLogo.channels[0].id}`);
    assert.strictEqual(lgRes.status, 200);
    assert.strictEqual(lgRes.headers.get('content-type'), 'image/png');
    assert(Buffer.from(await lgRes.arrayBuffer()).length > 0, 'logo vuoto');
    assert((await j(`/meta/tv/retrotv:${afterLogo.channels[0].id}.json`)).meta.poster.includes('/chlogo/'), 'poster addon non usa il logo caricato');
    logoCfg.channels[0].logo.url = 'data:image/svg+xml;base64,PHN2Zy8+';
    await j('/api/config', { method: 'PUT', body: JSON.stringify(logoCfg) });
    const afterBadLogo = await j('/api/config');
    assert.strictEqual(afterBadLogo.channels[0].logo.url, '', 'logo non valido accettato');
    assert.strictEqual((await get(`/chlogo/${afterBadLogo.channels[0].id}`)).status, 404);
    assert.strictEqual((await get(`/logo/${afterBadLogo.channels[0].id}.svg`)).status, 200);

    // ---------- downloaded library + Range streaming ----------
    const libCfg = JSON.parse(JSON.stringify(await j('/api/config')));
    libCfg.library = { folders: [mediaDir], defaultMinutes: 5 };
    await j('/api/config', { method: 'PUT', body: JSON.stringify(libCfg) });
    const lib = await j('/api/library');
    assert.strictEqual(lib.count, 2, 'file locali non trovati: ' + lib.count);
    assert(lib.items.every((x) => x.duration === 300), 'durata di riserva non applicata');
    assert(lib.items.some((x) => x.epLabel === 'S01E01'), 'nome episodio non riconosciuto');
    const item = lib.items[0];
    const rng = await get(`/media/${item.id}`, { headers: { Range: 'bytes=0-9' } });
    assert.strictEqual(rng.status, 206);
    assert.strictEqual(rng.headers.get('content-range'), `bytes 0-9/${item.size}`);
    assert.strictEqual(Buffer.from(await rng.arrayBuffer()).length, 10);
    const head = await get(`/media/${item.id}`, { method: 'HEAD' });
    assert.strictEqual(head.status, 200);
    assert.strictEqual(head.headers.get('content-length'), String(item.size));
    const full = await get(`/media/${item.id}`);
    assert.strictEqual(full.status, 200);
    assert(full.headers.get('content-type').startsWith('video/mp4'));
    assert.strictEqual((await j('/api/library/scan', { method: 'POST' })).count, 2);
    assert.strictEqual((await j('/api/info')).library.count, 2);

    // ---------- downloads mode: guide, addon stream, /play ----------
    const dlCfg = JSON.parse(JSON.stringify(await j('/api/config')));
    dlCfg.channels[0].mode = 'downloads';
    await j('/api/config', { method: 'PUT', body: JSON.stringify(dlCfg) });
    const df = Date.now() - 3600e3, dt = Date.now() + 2 * 3600e3;
    const [gd] = await j(`/api/guide?ch=${chId}&from=${df}&to=${dt}`);
    assert(gd.segments.length > 0, 'canale Scaricati vuoto');
    assert(gd.segments.every((s) => s.kind === 'ep' && s.mediaId && s.slotId === 'downloads'), 'segmenti non locali nel canale Scaricati');
    assert(!gd.segments.some((s) => s.kind === 'ad'), 'pubblicità nel canale Scaricati');
    const [gd2] = await j(`/api/guide?ch=${chId}&from=${df}&to=${dt}`);
    assert.deepStrictEqual(gd2.segments.map((s) => s.id + s.start), gd.segments.map((s) => s.id + s.start), 'palinsesto Scaricati non deterministico');
    assert(new Set(gd.segments.map((s) => s.mediaId)).size === 2, 'la libreria non viene percorsa tutta');
    const stD = await j(`/stream/tv/retrotv:${chId}.json`);
    assert(stD.streams.some((s) => s.url && s.url.includes('/media/')), 'addon senza stream locale');
    const playD = await get(`/play/${chId}`);
    assert.strictEqual(playD.status, 302);
    const loc = playD.headers.get('location');
    assert(loc.startsWith('/media/'), 'redirect /play non locale: ' + loc);
    assert.strictEqual((await get(loc, { headers: { Range: 'bytes=0-4' } })).status, 206);

    // ---------- complete episodes, fit rule, no mid-episode ads ----------
    const schedCfg = JSON.parse(JSON.stringify(await j('/api/config')));
    const baseSlot = {
      type: 'series', imdb: 'tt1', name: 'Dragon Test', start: '20:00', end: '21:00', repeat: 'daily',
      startMode: 'first', startSeason: 1, startEpisode: 1, seasons: '', epMinutes: 25, seed: 1, anchor: ymd(new Date()),
    };
    schedCfg.channels = [{
      name: 'Scheduler Test', number: 60, color: '#e8b923', mode: 'sequential', adBreakSec: 60, midRoll: true,
      slots: [{ ...baseSlot }],
      ads: [{ ytId: 'dQw4w9WgXcQ', title: 'Spot', duration: 30 }],
    }];
    const schedPut = await j('/api/config', { method: 'PUT', body: JSON.stringify(schedCfg) });
    assert.deepStrictEqual(schedPut.errors, []);
    schedCfg.channels[0] = schedPut.config.channels[0];
    const schedId = schedPut.config.channels[0].id;
    const sFrom = new Date(); sFrom.setHours(20, 0, 0, 0);
    const [sg] = await j(`/api/guide?ch=${schedId}&from=${sFrom.getTime()}&to=${sFrom.getTime() + 3600e3}`);
    const seps = sg.segments.filter((s) => s.kind === 'ep');
    assert.strictEqual(seps.length, 2, 'fascia 1h / episodi 25min: attesi 2 episodi, trovati ' + seps.length);
    assert(seps.every((s) => s.end - s.start === 25 * 60 * 1000), 'episodio troncato alla fine della fascia');
    for (const ad of sg.segments.filter((s) => s.kind === 'ad')) {
      for (const ep of seps) assert(!(ad.start < ep.end && ad.end > ep.start), 'pubblicità dentro un episodio');
    }
    assert(sg.segments.some((s) => s.kind === 'ad' && s.start >= seps[0].end), 'pubblicità non messa dopo l\'episodio');
    const sProgs = sg.programs;
    assert(sProgs.filter((p) => p.kind === 'ep').every((p) => p.end - p.start === 25 * 60 * 1000), 'guida con episodi troncati');
    // Leftover airtime is filled with commercials, so playback never falls into
    // an off-air hole between two complete episodes.
    assert(sg.segments[0].start <= sFrom.getTime(), 'la guida non parte dall\'inizio della fascia');
    for (let i = 1; i < sg.segments.length; i++) {
      assert.strictEqual(sg.segments[i].start, sg.segments[i - 1].end, 'buco tra due segmenti della guida');
    }
    assert(sg.segments[sg.segments.length - 1].end >= sFrom.getTime() + 3600e3, 'la guida non copre tutta la fascia');

    // Overlapping slots that start together share the airtime instead of
    // truncating or interleaving each other's episodes.
    schedCfg.channels[0].slots = [
      { ...baseSlot, name: 'Show A' },
      { ...baseSlot, name: 'Show B' },
    ];
    await j('/api/config', { method: 'PUT', body: JSON.stringify(schedCfg) });
    const [ov] = await j(`/api/guide?ch=${schedId}&from=${sFrom.getTime()}&to=${sFrom.getTime() + 3600e3}`);
    const ovEps = ov.segments.filter((s) => s.kind === 'ep');
    assert(new Set(ovEps.map((s) => s.slotId)).size === 2, 'slot sovrapposti: uno dei due programmi è sparito');
    assert(ovEps.every((s) => s.end - s.start === 25 * 60 * 1000), 'slot sovrapposti: episodio troncato');
    for (let i = 1; i < ovEps.length; i++) assert(ovEps[i].start >= ovEps[i - 1].end, 'slot sovrapposti: episodi intrecciati');
    for (const ad of ov.segments.filter((s) => s.kind === 'ad')) {
      for (const ep of ovEps) assert(!(ad.start < ep.end && ad.end > ep.start), 'slot sovrapposti: pubblicità dentro un episodio');
    }

    // ---------- forced audio track via HLS remux ----------
    if (remuxReady) {
      const rCfg = JSON.parse(JSON.stringify(await j('/api/config')));
      rCfg.sources.language = 'it';
      rCfg.sources.forceAudio = true;
      await j('/api/config', { method: 'PUT', body: JSON.stringify(rCfg) });
      const hr = await j('/api/resolve?type=series&key=tt3:1:1');
      assert.strictEqual(hr.kind, 'hls', 'scambio audio non attivato: ' + JSON.stringify(hr));
      assert.strictEqual(hr.audio, 'it');
      assert(hr.url.startsWith('/hls/'), 'URL HLS inatteso: ' + hr.url);
      const pl = await get(hr.url);
      assert.strictEqual(pl.status, 200);
      const plText = await pl.text();
      assert(plText.includes('#EXTM3U'), 'playlist HLS non valida');
      const segName = /^([^\s#]+\.ts)$/m.exec(plText);
      assert(segName, 'nessun segmento nella playlist');
      const sg = await get(hr.url.replace(/index\.m3u8$/, segName[1]));
      assert.strictEqual(sg.status, 200);
      assert.strictEqual(sg.headers.get('content-type'), 'video/mp2t');
      const segFile = path.join(tmp, 'seg-check.ts');
      fs.writeFileSync(segFile, Buffer.from(await sg.arrayBuffer()));
      const pr = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream_tags=language', '-of', 'csv=p=0', segFile], { encoding: 'utf8' });
      assert.strictEqual(String(pr.stdout).trim().toLowerCase(), 'ita', 'il remux non ha scelto la traccia italiana');

      rCfg.sources.language = 'en';
      await j('/api/config', { method: 'PUT', body: JSON.stringify(rCfg) });
      const dr = await j('/api/resolve?type=series&key=tt3:1:1');
      assert.strictEqual(dr.kind, 'direct', 'prima traccia già corretta: nessun remux necessario');
      assert.strictEqual(dr.url, `http://127.0.0.1:${MEDIA}/multi.mkv`);

      rCfg.sources.forceAudio = false;
      await j('/api/config', { method: 'PUT', body: JSON.stringify(rCfg) });
    }

    // ---------- language sets the default metadata source ----------
    const finalCfg = JSON.parse(JSON.stringify(await j('/api/config')));
    finalCfg.channels = [];
    finalCfg.settings.language = 'es';
    finalCfg.sources = { metaAddon: '', streamAddons: [], stremioServer: 'http://127.0.0.1:1' };
    const fin = await j('/api/config', { method: 'PUT', body: JSON.stringify(finalCfg) });
    assert.strictEqual(fin.config.settings.language, 'es');
    assert.strictEqual(fin.config.sources.language, 'es', 'lingua video non ereditata dalla lingua interfaccia');
    assert.strictEqual(fin.config.sources.forceAudio, true, 'forceAudio non attivo di default');
    assert.strictEqual(fin.config.sources.metaAddon, 'https://v3-cinemeta.strem.io');
    assert((await j('/manifest.json')).description.includes('televisión'), 'addon non tradotto in spagnolo');
    const infoEs = await j('/api/info');
    assert(infoEs.languages.some((l) => l.code === 'es' && l.torrentio.includes('language=spanish')), 'profilo lingua spagnolo mancante');

    // sicurezza: path traversal
    const tr = await get('/..%2f..%2fetc%2fpasswd'); assert([403, 404].includes(tr.status));
    console.log('TUTTI I TEST OK ✔');
  } catch (e) {
    console.error('FALLITO:', e.stack || e.message, '\n--- log server ---\n' + log);
    process.exitCode = 1;
  } finally { srv.kill(); mock.close(); if (remuxReady) mediaSrv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
})();
