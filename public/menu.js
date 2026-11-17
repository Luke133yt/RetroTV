'use strict';
// RetroTV – settings menu: channels, schedules, commercials, sources, local library, addon, options, backup.
(() => {
  let draft = null, sel = 0, info = null, lib = null, dirty = false;

  const dayLetter = (d) => new Date(2024, 0, 7 + d).toLocaleDateString(window.RTV_I18N.locale, { weekday: 'short' }).slice(0, 2).toUpperCase();
  const WD = [1, 2, 3, 4, 5, 6, 0].map((d) => [d, dayLetter(d)]);
  const COLORS = ['#e8b923', '#d9482b', '#3aa8c1', '#6bbf59', '#c46bd1', '#f08a24', '#e8e0c8'];
  const POSITIONS = ['tl', 'tc', 'tr', 'ml', 'mc', 'mr', 'bl', 'bc', 'br'];
  const LOGO_DEFAULT = { url: '', size: 13, pos: 'br', opacity: 0.9, margin: 2.5 };

  const status = (msg, cls = 'ok') => { const s = $('#mStatus'); s.textContent = msg; s.className = cls; };
  const mark = () => { dirty = true; status(T('menu.unsaved'), 'err'); };
  const curCh = () => draft.channels[sel];
  const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
  const newSlot = () => ({ type: 'series', imdb: '', name: '', start: '20:00', end: '22:00', repeat: 'daily', weekdays: [0, 1, 2, 3, 4, 5, 6],
    monthDays: [], startMode: 'random', startSeason: 1, startEpisode: 1, seasons: '', epMinutes: 0, seed: Math.floor(Math.random() * 1e9), anchor: todayLocal() });
  const fmtSize = (b) => (b > 1024 * 1024 * 1024 ? (b / 1024 / 1024 / 1024).toFixed(1) + ' GB' : Math.max(1, Math.round(b / 1024 / 1024)) + ' MB');
  const fmtDur = (sec) => {
    const m = Math.round(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${pad2(m % 60)}m` : `${m}m`;
  };

  window.openMenu = async function () {
    try {
      [draft, info, lib] = await Promise.all([api('/api/config'), api('/api/info'), api('/api/library')]);
    } catch (e) { return alert(T('menu.alertServer', { msg: e.message })); }
    sel = Math.min(sel, Math.max(0, draft.channels.length - 1));
    dirty = false; status('');
    window.RTV_I18N.set(draft.settings.language);
    TV.settings = { ...TV.settings, ...draft.settings };
    document.body.classList.toggle('no-crt', draft.settings.crt === false);
    $('#menu').hidden = false;
    renderAll();
  };
  function closeMenu() {
    if (dirty && !confirm(T('menu.unsavedClose'))) return;
    $('#menu').hidden = true;
    if (dirty) TV.reload().catch(() => {});
  }
  $('#mClose').onclick = closeMenu;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#menu').hidden) closeMenu(); });
  $('#mTabs').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    switchTab(b.dataset.tab);
  };
  function switchTab(name) {
    $$('#mTabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === name));
    $$('.tab').forEach((t) => t.classList.toggle('on', t.id === 'tab-' + name));
  }
  function renderAll() { renderChannels(); renderSources(); renderLibrary(); renderAddon(); renderOptions(); renderBackup(); }

  // ---------- save ----------
  $('#mSave').onclick = async () => {
    status(T('menu.saving'), 'ok');
    $('#mSave').disabled = true;
    try {
      const res = await api('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      draft = res.config; dirty = false;
      sel = Math.min(sel, Math.max(0, draft.channels.length - 1));
      lib = await api('/api/library').catch(() => lib);
      renderAll();
      await TV.reload();
      status(res.errors.length ? T('menu.savedWith', { errors: res.errors.map((x) => x.error).join(' | ') }) : T('menu.saved'), res.errors.length ? 'err' : 'ok');
    } catch (e) { status(T('menu.error', { msg: e.message }), 'err'); }
    $('#mSave').disabled = false;
  };

  // ---------- CHANNELS ----------
  function renderChannels() {
    const root = $('#tab-channels');
    const list = draft.channels.map((c, i) =>
      `<div class="ch-item ${i === sel ? 'on' : ''}" data-i="${i}"><b>${pad2(c.number)}</b><span>${esc(c.name)}</span><small>${c.mode === 'downloads' ? '⬇' : c.mode === 'random' ? '⚄' : '▤'}</small></div>`).join('');
    root.innerHTML = `<div class="ch-layout"><div><div class="ch-list">${list || `<div class="ch-item">${T('ch.emptyList')}</div>`}</div>
      <button class="ch-add" id="addCh">${T('ch.new')}</button></div><div class="ch-edit" id="chEdit"></div></div>`;
    $('#addCh').onclick = () => {
      const max = draft.channels.reduce((m, c) => Math.max(m, c.number), 0);
      draft.channels.push({
        name: T('ch.newName'), number: max + 1, color: COLORS[(max + 1) % COLORS.length], mode: 'sequential',
        logo: { ...LOGO_DEFAULT }, adBreakSec: 180, midRoll: false, slots: [newSlot()], ads: [],
      });
      sel = draft.channels.length - 1; mark(); renderChannels();
    };
    $$('.ch-item[data-i]', root).forEach((el) => { el.onclick = () => { sel = +el.dataset.i; renderChannels(); }; });
    renderEditor();
  }

  function slotHtml(s, i) {
    const wd = WD.map(([d, l]) => `<label>${l}<input type="checkbox" data-s="${i}" data-wd="${d}" ${s.weekdays.includes(d) ? 'checked' : ''}></label>`).join('');
    return `<div class="slot" data-si="${i}">
      <div class="row">
        <label class="f pick">${T('ch.chooseTitle')}
          <input class="q" data-s="${i}" style="width:330px" value="${esc(s.name)}" placeholder="${esc(T('ch.searchPlaceholder'))}" autocomplete="off">
          <div class="results" hidden></div>
        </label>
        <label class="f">${T('ch.from')}<input type="time" data-s="${i}" data-f="start" value="${esc(s.start)}"></label>
        <label class="f">${T('ch.to')}<input type="time" data-s="${i}" data-f="end" value="${esc(s.end)}"></label>
        <label class="f">${T('ch.repeat')}<select data-s="${i}" data-f="repeat" data-re="1">
          <option value="daily" ${s.repeat === 'daily' ? 'selected' : ''}>${T('ch.daily')}</option>
          <option value="weekly" ${s.repeat === 'weekly' ? 'selected' : ''}>${T('ch.weekly')}</option>
          <option value="monthly" ${s.repeat === 'monthly' ? 'selected' : ''}>${T('ch.monthly')}</option></select></label>
        ${s.repeat === 'weekly' ? `<span class="wd">${wd}</span>` : ''}
        ${s.repeat === 'monthly' ? `<label class="f">${T('ch.monthDays')}<input data-s="${i}" data-f="monthDays" value="${esc(s.monthDays.join(', '))}"></label>` : ''}
      </div>
      <div class="row">
        <label class="f">${T('ch.startFrom')}<select data-s="${i}" data-f="startMode" data-re="1">
          <option value="random" ${s.startMode === 'random' ? 'selected' : ''}>${T('ch.startRandom')}</option>
          <option value="first" ${s.startMode === 'first' ? 'selected' : ''}>${T('ch.startFirst')}</option>
          <option value="fixed" ${s.startMode === 'fixed' ? 'selected' : ''}>${T('ch.startFixed')}</option></select></label>
        ${s.startMode === 'fixed' ? `<label class="f">${T('ch.season')}<input type="number" min="0" style="width:70px" data-s="${i}" data-f="startSeason" value="${s.startSeason}"></label>
          <label class="f">${T('ch.episode')}<input type="number" min="0" style="width:70px" data-s="${i}" data-f="startEpisode" value="${s.startEpisode}"></label>` : ''}
        <label class="f">${T('ch.seasons')}<input style="width:110px" placeholder="1-3" data-s="${i}" data-f="seasons" value="${esc(s.seasons)}"></label>
        <label class="f">${T('ch.epMinutes')}<input type="number" min="0" style="width:90px" data-s="${i}" data-f="epMinutes" value="${s.epMinutes || ''}"></label>
        <label class="f">${T('ch.dateFrom')}<input type="date" data-s="${i}" data-f="dateFrom" value="${esc(s.dateFrom)}"></label>
        <label class="f">${T('ch.dateTo')}<input type="date" data-s="${i}" data-f="dateTo" value="${esc(s.dateTo)}"></label>
      </div>
      <div class="row"><small class="${s.imdb ? 'ok' : 'err'}" style="flex:1">${s.imdb ? T('ch.episodeCount', { name: esc(s.name), imdb: esc(s.imdb), type: s.type === 'movie' ? T('common.movie') : T('common.series') }) : T('ch.statusPick')}</small>
        <button data-act="shuffle" data-s="${i}" title="${esc(T('ch.shuffleTitle'))}">${T('ch.shuffle')}</button>
        <button class="danger" data-act="delslot" data-s="${i}">${T('ch.deleteSlot')}</button></div>
    </div>`;
  }

  function logoHtml(c) {
    const opts = POSITIONS.map((p) => `<option value="${p}" ${c.logo.pos === p ? 'selected' : ''}>${T('pos.' + p)}</option>`).join('');
    return `<h3>${T('ch.logo')}</h3>
      <div class="logo-box">
        <div class="logo-prev" id="logoPrev">${c.logo.url ? `<img src="${esc(c.logo.url)}" style="width:${c.logo.size}%;opacity:${c.logo.opacity}">` : `<span>${T('ch.logoNone')}</span>`}</div>
        <div class="logo-controls">
          <p class="note">${T('ch.logoUpload')}</p>
          <input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp,image/gif">
          <label class="f">${T('ch.logoSize')}<input type="range" min="3" max="40" step="1" data-logo="size" value="${c.logo.size}"> <output id="logoSizeOut">${c.logo.size}%</output></label>
          <label class="f">${T('ch.logoPosition')}<select data-logo="pos">${opts}</select></label>
          <label class="f">${T('ch.logoOpacity')}<input type="range" min="0.05" max="1" step="0.05" data-logo="opacity" value="${c.logo.opacity}"> <output id="logoOpOut">${Math.round(c.logo.opacity * 100)}%</output></label>
          <label class="f">${T('ch.logoMargin')}<input type="range" min="0" max="20" step="0.5" data-logo="margin" value="${c.logo.margin}"> <output id="logoMarginOut">${c.logo.margin}%</output></label>
          <p><button class="danger" data-act="dellogo">${T('ch.logoRemove')}</button></p>
        </div>
      </div>
      <p class="note">${T('ch.logoHint')}</p>`;
  }

  function renderEditor() {
    const root = $('#chEdit'); if (!root) return;
    const c = curCh();
    if (!c) { root.innerHTML = `<p class="note">${T('ch.firstNote')}</p>`; return; }
    const ads = c.ads.map((a, i) => `<div class="ad-item"><span>▶ ${esc(a.title)}</span>
      <input type="number" min="1" data-ad="${i}" value="${a.duration}" title="${esc(T('common.sec'))}"> ${T('common.sec')}
      <button class="danger" data-act="delad" data-ad="${i}">✕</button></div>`).join('');
    root.innerHTML = `
      <div class="row"><label class="f">${T('ch.name')}<input data-f="name" value="${esc(c.name)}" style="width:240px"></label>
        <label class="f">${T('ch.number')}<input type="number" min="1" max="999" data-f="number" value="${c.number}" style="width:80px"></label>
        <label class="f">${T('ch.color')}<select data-f="color">${COLORS.map((x) => `<option value="${x}" ${x === c.color ? 'selected' : ''} style="background:${x};color:#000">${x}</option>`).join('')}</select></label>
        <label class="f">${T('ch.mode')}<select data-f="mode" data-re="1">
          <option value="sequential" ${c.mode === 'sequential' ? 'selected' : ''}>${T('ch.modeSequential')}</option>
          <option value="random" ${c.mode === 'random' ? 'selected' : ''}>${T('ch.modeRandom')}</option>
          <option value="downloads" ${c.mode === 'downloads' ? 'selected' : ''}>${T('ch.modeDownloads')}</option></select></label></div>
      ${c.mode === 'downloads'
        ? `<p class="note">${T('ch.modeDownloadsNote')}</p><p class="note ok">${T('lib.offline')}</p>`
        : `<p class="note">${c.mode === 'random' ? T('ch.modeRandomNote') : T('ch.modeSequentialNote')}</p>
      <h3>${T('ch.programming')}</h3>
      ${c.slots.map(slotHtml).join('')}
      <button data-act="addslot">${T('ch.addSlot')}</button>
      <h3>${T('ch.ads')}</h3>
      <div class="row"><label class="f">${T('ch.adBreak')}<input type="number" min="10" data-f="adBreakSec" value="${c.adBreakSec}" style="width:100px"></label></div>
      <p class="note">${T('ch.adsNote')}</p>
      ${ads || `<p class="note">${T('ch.noAds')}</p>`}
      <div class="row"><input id="adUrl" placeholder="${esc(T('ch.adPlaceholder'))}" style="flex:1;min-width:200px"><button data-act="addad" style="margin-left:6px">${T('ch.add')}</button></div>
      <p class="note" id="adMsg"></p>`}
      ${logoHtml(c)}
      <h3>&nbsp;</h3><button class="danger" data-act="delch">${T('ch.deleteChannel')}</button>`;
  }

  // editor events (delegated)
  const ed = $('#tab-channels');
  const onField = (e) => {
    const t = e.target, c = curCh(); if (!c) return;
    if (t.dataset.logo !== undefined) {
      c.logo[t.dataset.logo] = t.type === 'range' ? Number(t.value) : t.value;
      const img = $('#logoPrev img');
      if (img) {
        if (t.dataset.logo === 'size') img.style.width = c.logo.size + '%';
        if (t.dataset.logo === 'opacity') img.style.opacity = c.logo.opacity;
      }
      if (t.dataset.logo === 'size') $('#logoSizeOut').textContent = c.logo.size + '%';
      if (t.dataset.logo === 'opacity') $('#logoOpOut').textContent = Math.round(c.logo.opacity * 100) + '%';
      if (t.dataset.logo === 'margin') $('#logoMarginOut').textContent = c.logo.margin + '%';
      return mark();
    }
    if (t.dataset.ad !== undefined && t.type === 'number') { c.ads[+t.dataset.ad].duration = Number(t.value) || 1; return mark(); }
    if (t.dataset.wd !== undefined) {
      const s = c.slots[+t.dataset.s], d = Number(t.dataset.wd);
      s.weekdays = t.checked ? [...new Set([...s.weekdays, d])] : s.weekdays.filter((x) => x !== d); return mark();
    }
    const f = t.dataset.f; if (!f) return;
    const obj = t.dataset.s !== undefined ? c.slots[+t.dataset.s] : c;
    let v = t.type === 'checkbox' ? t.checked : t.type === 'number' ? Number(t.value) : t.value;
    if (f === 'monthDays') v = String(t.value).split(/[\s,;]+/).map(Number).filter((n) => n >= 1 && n <= 31);
    if (f === 'epMinutes') v = Number(t.value) || 0;
    obj[f] = v; mark();
    if (t.dataset.re && e.type === 'change') renderEditor();
    if (f === 'name' || f === 'number') {
      const item = $$('.ch-item')[sel];
      if (item) item.innerHTML = `<b>${pad2(c.number)}</b><span>${esc(c.name)}</span><small>${c.mode === 'downloads' ? '⬇' : c.mode === 'random' ? '⚄' : '▤'}</small>`;
    }
  };
  ed.addEventListener('input', onField);
  ed.addEventListener('change', onField);

  // logo upload
  ed.addEventListener('change', (e) => {
    if (e.target.id !== 'logoFile') return;
    const file = e.target.files && e.target.files[0], c = curCh();
    if (!file || !c) return;
    if (!/^image\/(png|jpeg|webp|gif)$/i.test(file.type)) { status(T('ch.logoBadType'), 'err'); e.target.value = ''; return; }
    if (file.size > 1.5 * 1024 * 1024) { status(T('ch.logoTooBig'), 'err'); e.target.value = ''; return; }
    const reader = new FileReader();
    reader.onload = () => { c.logo.url = String(reader.result); mark(); renderEditor(); };
    reader.readAsDataURL(file);
  });

  // title search
  let searchTimer = 0;
  ed.addEventListener('input', (e) => {
    const t = e.target; if (!t.classList.contains('q')) return;
    const box = t.parentElement.querySelector('.results');
    clearTimeout(searchTimer);
    if (t.value.trim().length < 2) { box.hidden = true; return; }
    searchTimer = setTimeout(async () => {
      box.hidden = false; box.innerHTML = `<div>${T('ch.searching')}</div>`;
      try {
        const r = await api('/api/search?q=' + encodeURIComponent(t.value.trim()) + '&base=' + encodeURIComponent(draft.sources.metaAddon || ''));
        box.innerHTML = r.length ? r.map((x, k) => `<div data-k="${k}">${esc(x.name)} <small>${esc(x.year)} · ${x.type === 'movie' ? T('common.movie') : T('common.series')}</small></div>`).join('') : `<div>${T('ch.noResults')}</div>`;
        box.onclick = (ev) => {
          const d = ev.target.closest('div[data-k]'); if (!d) return;
          const x = r[+d.dataset.k];
          const s = curCh().slots[+t.dataset.s];
          Object.assign(s, { type: x.type, imdb: x.imdb, name: x.name }); mark(); box.hidden = true; renderEditor();
        };
      } catch (err) { box.innerHTML = `<div class="err">${esc(err.message)}</div>`; }
    }, 400);
  });

  // editor buttons
  ed.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const c = curCh(), act = b.dataset.act, i = Number(b.dataset.s ?? b.dataset.ad);
    if (act === 'addslot') { c.slots.push(newSlot()); mark(); renderEditor(); }
    else if (act === 'delslot') { c.slots.splice(i, 1); mark(); renderEditor(); }
    else if (act === 'shuffle') { c.slots[i].seed = Math.floor(Math.random() * 1e9); c.slots[i].anchor = todayLocal(); mark(); status(T('ch.shuffleDone'), 'err'); }
    else if (act === 'delad') { c.ads.splice(i, 1); mark(); renderEditor(); }
    else if (act === 'dellogo') { c.logo = { ...c.logo, url: '' }; mark(); renderEditor(); }
    else if (act === 'delch') {
      if (confirm(T('menu.confirmDeleteChannel', { name: c.name }))) { draft.channels.splice(sel, 1); sel = 0; mark(); renderChannels(); }
    } else if (act === 'addad') {
      const url = $('#adUrl').value.trim(), msg = $('#adMsg');
      if (!url) return;
      msg.textContent = T('ch.reading'); msg.className = 'note';
      try {
        const y = await api('/api/yt?url=' + encodeURIComponent(url));
        c.ads.push({ url, ytId: y.ytId, title: y.title || T('tv.ad'), duration: y.duration || 30 });
        mark(); renderEditor();
        if (!y.duration) { $('#adMsg').textContent = T('ch.manualDuration'); $('#adMsg').className = 'note err'; }
      } catch (err) { msg.textContent = err.message; msg.className = 'note err'; }
    }
  });

  // ---------- SOURCES ----------
  function renderSources() {
    const s = draft.sources;
    const srcLangs = info.sourceLanguages || [];
    const profile = srcLangs.find((l) => l.code === s.language) ||
      srcLangs.find((l) => l.code === draft.settings.language) || {};
    const langOpts = srcLangs.map((l) =>
      `<option value="${l.code}" ${l.code === profile.code ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
    $('#tab-sources').innerHTML = `
      <h3>${T('src.title')}</h3>
      <label class="f">${T('src.language')}<select id="srcLang">${langOpts}</select></label>
      <p class="note">${T('src.languageNote')}</p>
      <label><input type="checkbox" id="srcForce" ${s.forceAudio !== false ? 'checked' : ''}> ${T('src.forceAudio')}</label>
      <p class="note">${T('src.forceAudioNote')}</p>
      <p class="note">${T('src.note')}</p>
      <label class="f" style="display:flex">${T('src.meta')}<input id="srcMeta" value="${esc(s.metaAddon)}"></label>
      <p class="note">${esc(T('src.langDefault', { language: profile.name || s.language, url: profile.metaAddon || '' }))}
        ${profile.metaAddon ? `<button id="srcUseLang">${T('src.useLang')}</button>` : ''}</p>
      <label class="f" style="display:flex">${T('src.streams')}
        <textarea id="srcStreams" rows="5" placeholder="https://torrentio.strem.fun/…/manifest.json">${esc(s.streamAddons.join('\n'))}</textarea></label>
      <label class="f" style="display:flex">${T('src.server')}<input id="srcServer" value="${esc(s.stremioServer)}"></label>
      <p class="note">${T('src.secret')}</p>
      <button id="srcCheck">${T('src.check')}</button> <span id="srcOut"></span>`;
    const upd = () => {
      draft.sources = {
        ...draft.sources,
        language: $('#srcLang').value,
        forceAudio: $('#srcForce').checked,
        metaAddon: $('#srcMeta').value,
        streamAddons: $('#srcStreams').value.split('\n').map((x) => x.trim()).filter(Boolean),
        stremioServer: $('#srcServer').value,
      };
      mark();
    };
    ['#srcMeta', '#srcStreams', '#srcServer'].forEach((q) => { $(q).oninput = upd; });
    $('#srcForce').onchange = upd;
    $('#srcLang').onchange = () => {
      const code = $('#srcLang').value;
      draft.sources.language = code;
      const p = srcLangs.find((l) => l.code === code);
      if (p) {
        // If the current addons are just the language defaults, follow the new
        // language. Custom addons (with a debrid key) are left untouched.
        const known = srcLangs.map((l) => l.torrentio);
        const cur = draft.sources.streamAddons.map((x) => x.trim());
        if (!cur.length || cur.every((u) => known.includes(u))) draft.sources.streamAddons = [p.torrentio];
        const metaDefaults = srcLangs.map((l) => l.metaAddon);
        if (!draft.sources.metaAddon || metaDefaults.includes(draft.sources.metaAddon)) draft.sources.metaAddon = p.metaAddon;
      }
      mark(); renderSources();
      status(T('src.audioSet', { language: (p && p.name) || code }), 'ok');
    };
    if ($('#srcUseLang')) $('#srcUseLang').onclick = () => {
      draft.sources.language = profile.code;
      draft.sources.metaAddon = profile.metaAddon;
      const known = srcLangs.map((l) => l.torrentio);
      const cur = draft.sources.streamAddons.map((x) => x.trim());
      if (!cur.length || cur.every((u) => known.includes(u))) draft.sources.streamAddons = [profile.torrentio];
      mark(); renderSources();
      status(T('src.langApplied', { language: profile.name || profile.code }), 'ok');
    };
    $('#srcCheck').onclick = async () => {
      $('#srcOut').textContent = T('src.checking');
      try {
        const saved = await api('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
        draft = saved.config;
        const r = await api('/api/sources/check');
        $('#srcOut').innerHTML = r.map((x) => `<div class="${x.ok ? 'ok' : 'err'}">${x.ok ? '✔' : '✘'} ${esc(x.role === 'metadata' ? T('src.roleMetadata') : T('src.roleStream'))}: ${esc(x.ok ? x.name : x.error)}</div>`).join('');
      } catch (e) { $('#srcOut').innerHTML = `<span class="err">${esc(e.message)}</span>`; }
    };
  }

  // ---------- LIBRARY ----------
  function renderLibrary() {
    const L = lib || { items: [], count: 0, folders: [], errors: [], totalDuration: 0 };
    const items = (L.items || []).slice(0, 300).map((x) => `<div class="lib-item">
      <b>${esc(x.title)}${x.epLabel ? ' ' + esc(x.epLabel) : ''}</b>
      <span>${fmtDur(x.duration)} · ${fmtSize(x.size)}${x.probed ? '' : ' (' + T('lib.estimated') + ')'}</span>
      <small>${esc(x.path)}</small></div>`).join('');
    $('#tab-library').innerHTML = `
      <h3>${T('lib.title')}</h3>
      <p class="note">${T('lib.note')}</p>
      <label class="f" style="display:flex">${T('lib.folders')}
        <textarea id="libFolders" rows="4" placeholder="${esc(T('lib.placeholder'))}">${esc((draft.library.folders || []).join('\n'))}</textarea></label>
      <label class="f">${T('lib.defaultMinutes')}<input type="number" min="1" max="600" id="libDefault" value="${draft.library.defaultMinutes}" style="width:100px"></label>
      <p><button id="libScan">${T('lib.scan')}</button> <span id="libOut"></span></p>
      <p class="note">${T('lib.count', { count: L.count || 0, duration: fmtDur(L.totalDuration || 0) })}</p>
      <p class="note ok">${T('lib.offline')}</p>
      ${(L.errors || []).length ? `<p class="note err">${esc(T('lib.errors', { errors: L.errors.map((x) => `${x.folder}: ${x.error}`).join(' | ') }))}</p>` : ''}
      <div class="lib-list">${items || `<p class="note">${L.count ? '' : T('lib.empty')}</p>`}</div>
      <p><button id="libMake">${T('lib.createChannel')}</button></p>`;
    const upd = () => {
      draft.library.folders = $('#libFolders').value.split('\n').map((x) => x.trim()).filter(Boolean);
      draft.library.defaultMinutes = Number($('#libDefault').value) || 45;
      mark();
    };
    $('#libFolders').oninput = upd;
    $('#libDefault').oninput = upd;
    $('#libScan').onclick = async () => {
      const b = $('#libScan'); b.disabled = true; $('#libOut').textContent = T('lib.scanning');
      try {
        const saved = await api('/api/config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
        draft = saved.config;
        lib = await api('/api/library/scan', { method: 'POST' });
        renderLibrary(); status(T('lib.scanned'), 'ok');
        await TV.reload();
      } catch (e) { $('#libOut').textContent = e.message; status(T('menu.error', { msg: e.message }), 'err'); }
      b.disabled = false;
    };
    $('#libMake').onclick = () => {
      if (draft.channels.some((c) => c.mode === 'downloads')) return status(T('lib.already'), 'err');
      const max = draft.channels.reduce((m, c) => Math.max(m, c.number), 0);
      draft.channels.push({
        name: T('lib.channelName'), number: max + 1, color: COLORS[(max + 1) % COLORS.length], mode: 'downloads',
        logo: { ...LOGO_DEFAULT }, adBreakSec: 180, midRoll: false, slots: [], ads: [],
      });
      sel = draft.channels.length - 1; mark(); renderChannels(); switchTab('channels');
      status(T('lib.created'), 'err');
    };
  }

  // ---------- ADDON ----------
  function renderAddon() {
    const lan = info.lan || [];
    $('#tab-addon').innerHTML = `
      <h3>${T('addon.title')}</h3>
      <p class="note">${T('addon.address')}</p><p><code id="manUrl">${esc(info.manifest)}</code></p>
      <p><a href="${esc(info.stremio)}"><button>${T('addon.installStremio')}</button></a>
        <button id="copyMan">${T('addon.copy')}</button>
        <a href="/" target="_blank" rel="noopener"><button>${T('addon.open')}</button></a></p>
      <p class="note">${T('addon.nuvio')}</p>
      ${lan.length
        ? `<p class="note">${T('addon.lan')}</p>${lan.map((u) => `<p><code>${esc(u)}</code></p>`).join('')}`
        : `<p class="note">${T('addon.lanNote')}</p>`}`;
    $('#copyMan').onclick = () => { navigator.clipboard.writeText(info.manifest).then(() => status(T('menu.copied'))).catch(() => status(T('menu.copyManual'), 'err')); };
  }

  // ---------- OPTIONS ----------
  function renderOptions() {
    const langs = (info.languages || window.RTV_I18N.languages).map((l) =>
      `<option value="${l.code}" ${l.code === draft.settings.language ? 'selected' : ''}>${esc(l.name)}</option>`).join('');
    $('#tab-options').innerHTML = `
      <h3>${T('opt.title')}</h3>
      <label class="f">${T('opt.language')}<select id="optLang">${langs}</select></label>
      <p class="note">${T('opt.languageNote')}</p>
      <div class="opt-grid">
        <label><input type="checkbox" id="optCrt" ${draft.settings.crt ? 'checked' : ''}> ${T('opt.crt')}</label>
        <label><input type="checkbox" id="optStatic" ${draft.settings.staticSound ? 'checked' : ''}> ${T('opt.static')}</label>
        <label><input type="checkbox" id="optTune" ${draft.settings.tuneEffect ? 'checked' : ''}> ${T('opt.tune')}</label>
        <label><input type="checkbox" id="optWm" ${draft.settings.watermark ? 'checked' : ''}> ${T('opt.watermark')}</label>
      </div>
      <p class="note">${T('opt.note')}</p>
      <h3>${T('update.title')}</h3>
      <p class="note">${T('update.current', { version: 'v' + (info.version || '?') })}</p>
      <p><button id="optCheck">${T('update.check')}</button> <span id="optUpd" class="note"></span></p>`;

    $('#optLang').onchange = () => {
      const code = $('#optLang').value;
      draft.settings.language = code;
      window.RTV_I18N.set(code);
      mark();
      renderAll();
      status(T('opt.languageSaved', { language: $('#optLang').selectedOptions[0].textContent }), 'ok');
    };
    const bind = (id, key) => {
      const el = $(id);
      el.onchange = () => {
        draft.settings[key] = el.checked;
        TV.settings[key] = el.checked;
        if (key === 'crt') document.body.classList.toggle('no-crt', !el.checked);
        if (key === 'tuneEffect') document.body.classList.toggle('no-tune', !el.checked);
        if (key === 'watermark' && !el.checked) $('#watermark').style.display = 'none';
        else if (key === 'watermark') applyWatermark(TV.channels[TV.idx]);
        mark();
      };
    };
    bind('#optCrt', 'crt'); bind('#optStatic', 'staticSound'); bind('#optTune', 'tuneEffect'); bind('#optWm', 'watermark');

    $('#optCheck').onclick = async () => {
      const btn = $('#optCheck'), out = $('#optUpd');
      btn.disabled = true;
      out.className = 'note';
      out.textContent = T('update.checking');
      const r = await TV.checkUpdate(true);
      btn.disabled = false;
      if (!r) { out.className = 'note err'; out.textContent = T('update.failed', { msg: '' }); return; }
      if (r.disabled) { out.textContent = T('update.disabled'); return; }
      if (!r.ok) { out.className = 'note err'; out.textContent = T('update.failed', { msg: r.error || '' }); return; }
      if (r.update) {
        out.className = 'note ok';
        out.textContent = T('update.availableText', { version: 'v' + r.latest, current: 'v' + r.current });
        TV.showUpdateBar(r, true);
      } else {
        out.textContent = r.reason === 'no-releases'
          ? T('update.noReleases')
          : T('update.upToDate', { version: 'v' + r.current });
      }
    };
  }

  // ---------- BACKUP ----------
  function renderBackup() {
    $('#tab-backup').innerHTML = `
      <h3>${T('bk.title')}</h3>
      <p class="note">${T('bk.note')}</p>
      <label class="f">${T('bk.days')}<select id="bkDays"><option value="7">7</option><option value="30" selected>30</option><option value="90">90</option><option value="365">365</option></select></label>
      <p><button id="bkExport">${T('bk.download')}</button></p>
      <h3>${T('bk.importTitle')}</h3>
      <p class="note">${T('bk.importNote')}</p>
      <p><input type="file" id="bkFile" accept=".json,application/json"></p><p id="bkOut"></p>`;
    $('#bkExport').onclick = async () => {
      if (dirty && confirm(T('menu.unsavedExport'))) await $('#mSave').onclick();
      location.href = '/api/export?days=' + $('#bkDays').value;
    };
    $('#bkFile').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      if (!confirm(T('menu.confirmImport', { name: f.name }))) { e.target.value = ''; return; }
      try {
        const r = await api('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await f.text() });
        draft = await api('/api/config'); lib = await api('/api/library').catch(() => lib);
        dirty = false; sel = 0; renderAll(); await TV.reload();
        $('#bkOut').innerHTML = `<span class="ok">${T('bk.imported', { count: r.channels })}</span>${r.errors.length ? `<br><span class="err">${esc(r.errors.map((x) => x.error).join(' | '))}</span>` : ''}`;
      } catch (err) { $('#bkOut').innerHTML = `<span class="err">${esc(err.message)}</span>`; }
    };
  }
})();
