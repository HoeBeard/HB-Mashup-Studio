/* HB Mashup Studio — app logic. © HB Software */
(() => {
  'use strict';
  const E = window.Engine;
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const COLORS = ['#1e6bff', '#3fe0ff', '#9b5cff', '#ffc94a', '#4cf0a0', '#ff8a3d', '#ff5ad8', '#6c8cff'];
  const isTouch = matchMedia('(pointer: coarse)').matches;
  const css = getComputedStyle(document.documentElement);
  const HEADER_W = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-w')) || 230;
  const LANE_H = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lane-h')) || 96;
  void css;

  /* ---------------- state ---------------- */
  const S = {
    levels: {},   // smooth-volume curves, shared by clips (kept out of undo history to stay light)
    tracks: [], clips: [],
    zoom: 20, playhead: 0, selected: null, range: null,
    master: 1, limiter: true, target: -14, snap: true,
    name: 'My Mashup',
  };
  const sources = new Map();   // sourceId -> { name, bytes, color }
  const buffers = new Map();   // sourceId -> AudioBuffer
  const peaks = new Map();     // sourceId -> { data, perSecond }
  const loudCache = new Map();
  const undoStack = [], redoStack = [];
  let lastHistKey = null, lastHistTime = 0;

  const snapshot = () => JSON.stringify({ tracks: S.tracks, clips: S.clips });
  function pushHistory(key) {
    const now = Date.now();
    if (key && key === lastHistKey && now - lastHistTime < 1500) { lastHistTime = now; return; }
    lastHistKey = key || null; lastHistTime = now;
    undoStack.push(snapshot()); if (undoStack.length > 150) undoStack.shift();
    redoStack.length = 0;
    setDirty(true);
  }
  function restore(json) {
    const s = JSON.parse(json); S.tracks = s.tracks; S.clips = s.clips;
    if (S.selected && !S.clips.find((c) => c.id === S.selected)) S.selected = null;
  }
  function undo() { if (!undoStack.length) return toast('Nothing to undo yet'); redoStack.push(snapshot()); restore(undoStack.pop()); lastHistKey = null; setDirty(true); renderAll(); P.refresh(); }
  function redo() { if (!redoStack.length) return toast('Nothing to redo — Redo brings back something you undid'); undoStack.push(snapshot()); restore(redoStack.pop()); lastHistKey = null; setDirty(true); renderAll(); P.refresh(); }
  function commit(fn, key) { pushHistory(key); fn(); renderAll(); P.refresh(); }
  function setDirty(v) { window.__hbDirty = v; }

  const clipById = (id) => S.clips.find((c) => c.id === id);
  const trackIndex = (id) => S.tracks.findIndex((t) => t.id === id);
  const selClip = () => (S.selected ? clipById(S.selected) : null);
  const mixLen = () => E.mixLength(S.clips);

  function newTrack(name) {
    const color = COLORS[S.tracks.length % COLORS.length];
    return { id: E.uid('t'), name: name || `Track ${S.tracks.length + 1}`, volume: 1, muted: false, solo: false, color };
  }

  /* ---------------- audio player ---------------- */
  const P = {
    ctx: null, master: null, limiter: null, out: null, analysers: [],
    playing: false, t0: 0, from: 0, until: 0, nodes: null, raf: 0, refreshTimer: 0,
    ensure() {
      if (this.ctx) return this.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.limiter = E.makeLimiter(this.ctx);
      this.out = this.ctx.createGain();
      const split = this.ctx.createChannelSplitter(2);
      this.analysers = [0, 1].map((i) => { const a = this.ctx.createAnalyser(); a.fftSize = 1024; split.connect(a, i); return a; });
      this.out.connect(split); this.out.connect(this.ctx.destination);
      this.applyChain();
      return this.ctx;
    },
    applyChain() {
      if (!this.ctx) return;
      this.master.disconnect(); this.limiter.disconnect();
      this.master.gain.value = S.master;
      if (S.limiter) { this.master.connect(this.limiter); this.limiter.connect(this.out); } else this.master.connect(this.out);
    },
    position() { return this.playing ? this.from + Math.max(0, this.ctx.currentTime - this.t0) : S.playhead; },
    start(from) {
      const ctx = this.ensure();
      if (ctx.state === 'suspended') ctx.resume();
      const len = mixLen();
      if (S.range) { this.until = S.range.b; if (from < S.range.a || from >= S.range.b - 0.05) from = S.range.a; }
      else { this.until = len; if (from >= len - 0.05) from = 0; }
      this.from = from; this.t0 = ctx.currentTime + 0.06;
      this.nodes = E.scheduleMix(ctx, this.master, S.tracks, S.clips, buffers, from, this.t0, this.until, S.levels);
      this.playing = true;
      cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame(tick);
      updatePlayButton();
    },
    killNodes() {
      if (!this.nodes) return;
      for (const s of this.nodes.sources) { try { s.stop(); } catch {} try { s.disconnect(); } catch {} }
      for (const [, g] of this.nodes.trackNodes) { try { g.disconnect(); } catch {} }
      this.nodes = null;
    },
    pause() { if (!this.playing) return; S.playhead = Math.min(this.position(), this.until); this.killNodes(); this.playing = false; updatePlayButton(); updatePlayhead(); },
    toggle() { if (!S.clips.length) return toast('Add a song first ✦'); this.playing ? this.pause() : this.start(S.playhead); },
    stop() { this.pause(); S.playhead = S.range ? S.range.a : 0; updatePlayhead(); },
    seek(t) { t = Math.max(0, t); if (this.playing) { this.killNodes(); this.playing = false; S.playhead = t; this.start(t); } else { S.playhead = t; } updatePlayhead(); },
    refresh() { // re-schedule after an edit while playing
      if (!this.playing) return;
      clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => { if (!this.playing) return; const pos = this.position(); this.killNodes(); this.playing = false; this.start(pos); }, 120);
    },
    setTrackGain(track) {
      if (!this.playing || !this.nodes) return;
      const anySolo = S.tracks.some((t) => t.solo);
      for (const t of S.tracks) {
        const g = this.nodes.trackNodes.get(t.id); if (!g) continue;
        const audible = !t.muted && (!anySolo || t.solo);
        g.gain.setTargetAtTime(audible ? t.volume : 0, this.ctx.currentTime, 0.02);
      }
      void track;
    },
  };

  function tick() {
    if (!P.playing) { meter(true); return; }
    const pos = P.position();
    if (pos >= P.until - 0.005) {
      P.killNodes(); P.playing = false;
      S.playhead = S.range ? S.range.a : P.until;
      updatePlayButton(); updatePlayhead(); meter(true); return;
    }
    S.playhead = pos; updatePlayhead(true); meter();
    P.raf = requestAnimationFrame(tick);
  }
  const meterBuf = new Float32Array(1024);
  function meter(reset) {
    ['#meterL', '#meterR'].forEach((sel, i) => {
      let pct = 0;
      if (!reset && P.analysers[i]) {
        P.analysers[i].getFloatTimeDomainData(meterBuf);
        let pk = 0; for (const v of meterBuf) { const a = Math.abs(v); if (a > pk) pk = a; }
        const db = E.gainToDb(pk); pct = E.clamp((db + 48) / 48, 0, 1) * 100;
      }
      $(sel).style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    });
  }

  /* ---------------- importing songs ---------------- */
  const AUDIO_RE = /\.(mp3|wav|wave|m4a|aac|mp4|flac|ogg|oga|opus|aif|aiff|caf|webm)$/i;
  const stripExt = (n) => n.replace(/\.[^.]+$/, '');
  const channelsOf = (buf) => Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));

  function decode(bytes) {
    const ctx = P.ensure();
    return new Promise((res, rej) => {
      const p = ctx.decodeAudioData(bytes.slice(0), res, rej);
      if (p && p.then) p.then(res, rej);
    });
  }
  async function addSource(name, bytes, id) {
    const buf = await decode(bytes);
    id = id || E.uid('s');
    const color = COLORS[sources.size % COLORS.length];
    sources.set(id, { name, bytes, color });
    buffers.set(id, buf);
    peaks.set(id, E.computePeaks(channelsOf(buf), buf.sampleRate));
    return { id, buf };
  }

  async function importFiles(fileList, targetTrackId = null, atTime = null) {
    const files = [...fileList].filter((f) => (f.type || '').startsWith('audio') || AUDIO_RE.test(f.name));
    if (!files.length) return toast('Those don’t look like songs — try MP3, WAV or M4A');
    P.ensure();
    const firstImport = !S.clips.length;
    const loaded = [], failed = [];
    for (let i = 0; i < files.length; i++) {
      status(`Loading ${files[i].name} (${i + 1} of ${files.length})…`);
      try {
        const bytes = await files[i].arrayBuffer();
        const { id, buf } = await addSource(files[i].name, bytes);
        loaded.push({ id, buf, name: stripExt(files[i].name) });
      } catch (e) { console.error(e); failed.push(files[i].name); }
    }
    if (loaded.length) {
      commit(() => {
        let t = atTime == null ? mixLen() : atTime;
        loaded.forEach((L, i) => {
          let trackId = i === 0 && targetTrackId ? targetTrackId : null;
          if (!trackId) {
            const empty = S.tracks.find((tr) => !S.clips.some((c) => c.track === tr.id));
            const tr = empty || newTrack(L.name);
            if (!empty) S.tracks.push(tr); else if (/^Track \d+$/.test(tr.name)) tr.name = L.name;
            trackId = tr.id;
          }
          const c = E.makeClip({ sourceId: L.id, track: trackId, start: t, offset: 0, duration: L.buf.duration, name: L.name });
          S.clips.push(c); S.selected = c.id; t += L.buf.duration;
        });
      });
      if (firstImport) zoomFit();
      status(`Added ${loaded.length} song${loaded.length > 1 ? 's' : ''}`);
    }
    if (failed.length) toast(`Couldn’t open: ${failed.join(', ')}. Try MP3 or WAV.`);
    else if (!loaded.length) status('Ready');
  }

  /* ---------------- editing actions ---------------- */
  const NEED_RANGE = 'First drag across the time numbers at the top to highlight a section';
  const NEED_CLIP = (what) => `First ${isTouch ? 'tap' : 'click'} a clip to pick it, then press ${what}`;
  function splitAtPlayhead() {
    if (!S.clips.length) return toast('Add a song first ✦');
    const t = S.playhead; const sel = selClip();
    const targets = sel ? [sel] : S.clips.filter((c) => t > c.start && t < E.clipEnd(c));
    const can = targets.filter((c) => E.splitClip(c, t));
    if (!can.length) return toast(sel ? 'Move the gold playhead inside the clip to split it' : 'Put the playhead over a clip to split');
    commit(() => {
      for (const c of can) {
        const [l, r] = E.splitClip(c, t);
        S.clips.splice(S.clips.indexOf(c), 1, l, r);
        if (sel) S.selected = r.id;
      }
    });
    status('Split ✂ — the clip is now two pieces');
  }
  function deleteSelected() {
    const c = selClip(); if (!c) return toast(NEED_CLIP('Delete Clip'));
    commit(() => { S.clips = S.clips.filter((x) => x.id !== c.id); S.selected = null; });
  }
  function duplicateSelected() {
    const c = selClip(); if (!c) return toast(NEED_CLIP('Copy Clip'));
    commit(() => { const d = Object.assign({}, c, { id: E.uid('c'), start: E.clipEnd(c) }); S.clips.push(d); S.selected = d.id; });
  }
  function cutRange() {
    if (!S.range) return toast(NEED_RANGE);
    const { a, b } = S.range;
    commit(() => { S.clips = E.rippleDelete(S.clips, a, b); S.range = null; S.selected = null; S.playhead = a; });
    status(`Cut ${(b - a).toFixed(1)}s out of the mix`);
  }
  function keepRange() {
    if (!S.range) return toast(NEED_RANGE);
    const { a, b } = S.range;
    commit(() => { S.clips = E.keepRange(S.clips, a, b); S.range = null; S.selected = null; S.playhead = 0; });
    zoomFit(); status('Kept only the chosen section');
  }
  function addPause(sec) {
    const t = S.playhead;
    commit(() => { S.clips = E.insertGap(S.clips, t, sec); });
    status(`Added a ${sec}s pause at ${E.formatTime(t, true)}`);
  }
  function measureClip(c) {
    const key = `${c.sourceId}|${c.offset.toFixed(3)}|${E.sourceSpan(c).toFixed(3)}`;
    if (loudCache.has(key)) return loudCache.get(key);
    const buf = buffers.get(c.sourceId);
    const sr = buf.sampleRate;
    const m = E.measureLoudness(channelsOf(buf), sr, c.offset * sr, (c.offset + E.sourceSpan(c)) * sr);
    loudCache.set(key, m); return m;
  }
  // Smooth-volume curve for a whole song/old mix, worked out once and reused.
  function levelKeyFor(sourceId) {
    const key = `${sourceId}|${S.target}`;
    if (!S.levels[key]) {
      const buf = buffers.get(sourceId);
      S.levels[key] = E.computeLevelCurve(channelsOf(buf), buf.sampleRate, S.target);
    }
    return key;
  }
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  // mode 'songs'  = every clip at the same overall loudness (keeps each song's own ups and downs)
  // mode 'smooth' = also levels loud and quiet parts inside each clip, e.g. an old mix
  async function evenOut(mode) {
    if (!S.clips.length) return toast('Add some songs first ✦');
    const smooth = mode === 'smooth';
    showBusy(smooth ? 'Smoothing the whole mix…' : 'Matching every song…',
      smooth ? 'Listening all the way through and evening out the loud and quiet parts.' : 'Listening to every clip so they all play equally loud.');
    await pause(60);
    try {
      const plan = new Map();
      for (const c of S.clips) {
        if (smooth) plan.set(c.id, { gainDb: 0, levelKey: levelKeyFor(c.sourceId) });
        else plan.set(c.id, { gainDb: E.matchGainDb(measureClip(c), S.target), levelKey: null });
        await pause(0);
      }
      commit(() => {
        for (const c of S.clips) { const p = plan.get(c.id); c.gainDb = p.gainDb; if (p.levelKey) c.levelKey = p.levelKey; else delete c.levelKey; }
        for (const t of S.tracks) t.volume = 1;
      });
      const n = S.clips.length, many = n > 1 ? 's' : '';
      toast(smooth ? `✦ Smoothed ${n} clip${many} — steady volume from start to finish` : `✦ ${n} clip${many} now play at the same loudness`);
      status(smooth ? 'Whole mix smoothed' : 'Every song matched');
    } finally { closeModal(); }
  }
  async function smoothOff() {
    commit(() => { for (const c of S.clips) delete c.levelKey; });
    toast('Smoothing turned off — songs keep their own ups and downs');
  }
  async function toggleClipSmooth(c) {
    if (c.levelKey) { commit(() => { delete c.levelKey; }); return toast('Smoothing off for this clip'); }
    showBusy('Smoothing this clip…', 'Evening out its loud and quiet parts.'); await pause(60);
    try { const key = levelKeyFor(c.sourceId); commit(() => { c.levelKey = key; c.gainDb = 0; }); toast('✦ This clip now stays at a steady volume'); }
    finally { closeModal(); }
  }
  function openEvenOut() {
    if (!S.clips.length) return toast('Add some songs first ✦');
    const suggestSmooth = S.clips.length === 1 || S.clips.some((c) => c.duration > 7 * 60);
    const anySmoothed = S.clips.some((c) => c.levelKey);
    const opt = (v, val, label) => `<option value="${val}"${S.target === val ? ' selected' : ''}>${label}</option>`;
    openModal(`
      <h2>Even out the volume</h2><div class="sub">Pick what you need — you can always press Undo.</div>
      <div class="format-opts">
        <label class="format-opt"><input type="radio" name="evmode" value="songs" ${suggestSmooth ? '' : 'checked'} />
          <div><b>🎵 Match every song</b>${suggestSmooth ? '' : ' <span class="rec">recommended</span>'}
          <small>Every clip plays at the same overall volume. Soft intros and big moments keep their feel. Best when you added separate songs.</small></div></label>
        <label class="format-opt"><input type="radio" name="evmode" value="smooth" ${suggestSmooth ? 'checked' : ''} />
          <div><b>🎚 Smooth the whole mix</b>${suggestSmooth ? ' <span class="rec">recommended</span>' : ''}
          <small>Also fixes loud and quiet parts <u>inside</u> a song — perfect for an old mix you made before. The volume stays steady from start to finish.</small></div></label>
      </div>
      <div class="field" style="margin-top:16px"><div class="field-label">How loud?</div>
        <select id="evTarget">${opt(0, -11, 'Loud (club)')}${opt(0, -14, 'Standard')}${opt(0, -17, 'Softer')}</select></div>
      <div class="modal-actions">
        ${anySmoothed ? '<button class="ghost-btn" id="evOff" style="margin-right:auto">Turn smoothing off</button>' : ''}
        <button class="ghost-btn" data-close>Cancel</button><button class="primary-btn" id="evGo">Even it out</button></div>`);
    $('#evGo').onclick = () => {
      S.target = +$('#evTarget').value; syncFooter();
      evenOut(document.querySelector('input[name=evmode]:checked').value);
    };
    if (anySmoothed) $('#evOff').onclick = () => { closeModal(); smoothOff(); };
  }

  /* ---------------- rendering ---------------- */
  const scroller = $('#scroller'), content = $('#content'), tracksEl = $('#tracks'), ruler = $('#ruler');

  function timelineWidth() {
    const view = scroller.clientWidth - HEADER_W();
    return Math.max(view, (mixLen() + 30) * S.zoom);
  }
  const xToTime = (clientX) => Math.max(0, (clientX - scroller.getBoundingClientRect().left + scroller.scrollLeft - HEADER_W()) / S.zoom);

  function renderAll() {
    content.style.width = `${HEADER_W() + timelineWidth()}px`;
    renderTracks(); renderRuler(); renderRange(); updatePlayhead(); renderInspector(); updateButtons(); updateTotals();
    $('#emptyState').hidden = S.clips.length > 0;
  }

  function renderTracks() {
    const anySolo = S.tracks.some((t) => t.solo);
    let html = '';
    for (const t of S.tracks) {
      const dim = t.muted || (anySolo && !t.solo);
      html += `<div class="row track-row${dim ? ' dim' : ''}" data-track="${t.id}">
        <div class="track-head">
          <div class="th-top"><span class="th-dot" style="background:${t.color}"></span>
            <input class="th-name" value="${esc(t.name)}" data-act="name" spellcheck="false" />
            <button class="th-del" data-act="deltrack" title="Remove this track" aria-label="Remove track">✕</button></div>
          <div class="th-bottom">
            <button class="ms-btn mute${t.muted ? ' on' : ''}" data-act="mute" title="Mute — silence this track">Mute</button>
            <button class="ms-btn solo${t.solo ? ' on' : ''}" data-act="solo" title="Solo — hear only this track">Solo</button>
            <input class="th-vol" type="range" min="0" max="1.5" step="0.01" value="${t.volume}" data-act="vol" title="Volume for this whole track" aria-label="Track volume" />
            <span class="th-vol-val">${Math.round(t.volume * 100)}%</span>
          </div>
        </div>
        <div class="lane"></div>
      </div>`;
    }
    html += `<div class="row add-track-row"><div class="track-head"><button class="tiny-btn" data-act="addtrack" title="Add an empty row to put clips on">＋ Add Track</button></div><div class="lane"></div></div>`;
    tracksEl.innerHTML = html;
    for (const c of S.clips) {
      const row = tracksEl.querySelector(`[data-track="${c.track}"] .lane`);
      if (row) row.appendChild(makeClipEl(c));
    }
  }

  function makeClipEl(c) {
    const el = document.createElement('div');
    el.className = 'clip' + (c.id === S.selected ? ' selected' : '');
    el.dataset.id = c.id;
    el.innerHTML = `<div class="clip-label"></div><canvas></canvas><svg class="fades" preserveAspectRatio="none"><polygon class="fi"/><polygon class="fo"/></svg><div class="handle l"></div><div class="handle r"></div>`;
    positionClipEl(el, c);
    return el;
  }
  function positionClipEl(el, c) {
    const color = sources.get(c.sourceId)?.color || COLORS[0];
    const w = Math.max(6, c.duration * S.zoom);
    el.style.left = `${c.start * S.zoom}px`; el.style.width = `${w}px`; el.style.setProperty('--c', color);
    const badges = [];
    if (Math.abs(c.gainDb) >= 0.1) badges.push(`${c.gainDb > 0 ? '+' : ''}${c.gainDb.toFixed(1)} dB`);
    if (E.rateOf(c) !== 1) badges.push(`${E.rateOf(c)}×`);
    if (c.levelKey) badges.push('🎚 smoothed');
    el.querySelector('.clip-label').innerHTML = esc(c.name) + badges.map((b) => `<span class="clip-badge">${b}</span>`).join('');
    const svg = el.querySelector('svg'); svg.setAttribute('viewBox', `0 0 ${w} 100`);
    const fi = Math.min(c.fadeIn, c.duration) * S.zoom, fo = Math.min(c.fadeOut, c.duration) * S.zoom;
    svg.querySelector('.fi').setAttribute('points', fi > 0 ? `0,0 ${fi},0 0,100` : '');
    svg.querySelector('.fo').setAttribute('points', fo > 0 ? `${w - fo},0 ${w},0 ${w},100` : '');
    drawWave(el, c);
  }

  // Waveform: only the visible part is drawn, so it stays sharp at any zoom.
  function drawWave(el, c) {
    const cv = el.querySelector('canvas'); const pk = peaks.get(c.sourceId);
    if (!pk) return;
    const w = c.duration * S.zoom;
    const viewL = scroller.scrollLeft - HEADER_W() - 200, viewR = scroller.scrollLeft + scroller.clientWidth + 200;
    const x0 = Math.max(0, viewL - c.start * S.zoom), x1 = Math.min(w, viewR - c.start * S.zoom);
    if (x1 <= x0) { cv.style.display = 'none'; return; }
    cv.style.display = ''; cv.style.left = `${x0}px`; cv.style.width = `${x1 - x0}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const H = Math.max(10, LANE_H() - 32);
    cv.width = Math.ceil((x1 - x0) * dpr); cv.height = Math.ceil(H * dpr);
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    g.fillStyle = sources.get(c.sourceId)?.color || '#1e6bff';
    const gain = E.dbToGain(c.gainDb || 0), r = E.rateOf(c);
    const curve = c.levelKey ? S.levels[c.levelKey] : null;
    const mid = H / 2;
    for (let x = Math.floor(x0); x < x1; x++) {
      const tl0 = x / S.zoom, tl1 = (x + 1) / S.zoom; // clip-local seconds
      const i0 = Math.floor((c.offset + tl0 * r) * pk.perSecond), i1 = Math.max(i0 + 1, Math.floor((c.offset + tl1 * r) * pk.perSecond));
      let m = 0; for (let i = i0; i < i1 && i < pk.data.length; i++) if (pk.data[i] > m) m = pk.data[i];
      const lv = curve ? E.dbToGain(E.levelDbAt(curve, c.offset + tl0 * r)) : 1;
      const v = Math.min(1, m * gain * lv * E.envelopeAt(c, tl0));
      const h = Math.max(0.5, v * mid * 0.95);
      g.fillRect(x - x0, mid - h, 1, h * 2);
    }
  }
  function redrawVisibleWaves() { for (const el of tracksEl.querySelectorAll('.clip')) { const c = clipById(el.dataset.id); if (c) drawWave(el, c); } }

  function rulerStep() {
    const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    return steps.find((s) => s * S.zoom >= 70) || 600;
  }
  function renderRuler() {
    const step = rulerStep(), minor = step / (step >= 10 ? 5 : 4);
    const t0 = Math.max(0, (scroller.scrollLeft - HEADER_W()) / S.zoom - step), t1 = (scroller.scrollLeft + scroller.clientWidth) / S.zoom + step;
    let html = '';
    for (let t = Math.floor(t0 / minor) * minor; t <= t1; t += minor) {
      const x = t * S.zoom; const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      html += `<div class="tick${major ? ' major' : ''}" style="left:${x}px"></div>`;
      if (major) html += `<div class="tick-label" style="left:${x}px">${step < 1 ? E.formatTime(t, true) : E.formatTime(t)}</div>`;
    }
    ruler.innerHTML = html;
  }
  function renderRange() {
    const layer = $('#rangeLayer');
    if (!S.range) { layer.hidden = true; return; }
    layer.hidden = false;
    layer.style.left = `${HEADER_W() + S.range.a * S.zoom}px`;
    layer.style.width = `${(S.range.b - S.range.a) * S.zoom}px`;
  }
  function updatePlayhead(follow) {
    const x = HEADER_W() + S.playhead * S.zoom;
    $('#playhead').style.transform = `translateX(${x}px)`;
    $('#timeNow').textContent = E.formatTime(S.playhead, true);
    if (follow) {
      const right = scroller.scrollLeft + scroller.clientWidth;
      if (x > right - 60 || x < scroller.scrollLeft + HEADER_W()) scroller.scrollLeft = x - HEADER_W() - 80;
    }
  }
  function updateTotals() { $('#timeTotal').textContent = E.formatTime(mixLen(), true); }
  function updatePlayButton() { $('#playIcon').textContent = P.playing ? '❚❚' : '▶'; $('#btnPlay').setAttribute('aria-label', P.playing ? 'Pause' : 'Play'); $('#btnPlay').classList.toggle('playing', P.playing); }
  // Buttons stay tappable; when they can't work yet they look faded and explain what to do.
  function updateButtons() {
    const has = !!selClip(), any = S.clips.length > 0;
    const need = (id, ok) => $(id).classList.toggle('needs', !ok);
    need('#btnDelete', has); need('#btnDuplicate', has); need('#btnSplit', any);
    need('#btnCutRange', !!S.range); need('#btnKeepRange', !!S.range); need('#btnGap', any);
    need('#btnUndo', undoStack.length > 0); need('#btnRedo', redoStack.length > 0);
    need('#btnEven', any); need('#btnExport', any); need('#btnSave', any); need('#btnSaveM', any);
  }

  /* ---------------- inspector ---------------- */
  const inspector = $('#inspector');
  const speeds = [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2, 1.25, 1.33, 1.5];
  function renderInspector() {
    const c = selClip();
    document.body.classList.toggle('has-selection', !!c || !!S.range);
    if (c) {
      const src = sources.get(c.sourceId);
      const maxFade = Math.max(0.1, Math.min(15, c.duration)).toFixed(1);
      inspector.innerHTML = `
        <button class="sheet-close" data-act="deselect" aria-label="Close">×</button>
        <h3>Selected clip</h3><div class="sub">${esc(stripExt(src?.name || ''))}</div>
        <div class="field"><div class="field-label">Name</div><input type="text" data-k="name" value="${esc(c.name)}" /></div>
        <div class="field"><div class="field-label">Clip volume <span class="val" data-v="gainDb">${fmtDb(c.gainDb)}</span></div>
          <input type="range" min="-24" max="18" step="0.5" value="${c.gainDb}" data-k="gainDb" />
          <div class="chips">${[-6, -3, 0, 3, 6].map((v) => `<button class="chip" data-set="gainDb" data-val="${v}">${v > 0 ? '+' : ''}${v} dB</button>`).join('')}</div>
          <div class="hint">“Even Out Volume” sets this for every clip at once.</div></div>
        <div class="field"><div class="field-label">Smooth volume <span class="val">${c.levelKey ? 'On' : 'Off'}</span></div>
          <button class="tool-btn smooth-btn${c.levelKey ? ' on' : ''}" data-act="smooth">${c.levelKey ? 'Turn smoothing off' : '🎚 Smooth this clip'}</button>
          <div class="hint">Evens out loud and quiet parts inside this clip — great for an old mix.</div></div>
        <div class="field"><div class="field-label">Fade in <span class="val" data-v="fadeIn">${c.fadeIn.toFixed(1)}s</span></div>
          <input type="range" min="0" max="${maxFade}" step="0.1" value="${c.fadeIn}" data-k="fadeIn" />
          <div class="chips">${[0, 0.5, 2, 5].map((v) => `<button class="chip" data-set="fadeIn" data-val="${v}">${v ? v + 's' : 'None'}</button>`).join('')}</div></div>
        <div class="field"><div class="field-label">Fade out <span class="val" data-v="fadeOut">${c.fadeOut.toFixed(1)}s</span></div>
          <input type="range" min="0" max="${maxFade}" step="0.1" value="${c.fadeOut}" data-k="fadeOut" />
          <div class="chips">${[0, 0.5, 2, 5].map((v) => `<button class="chip" data-set="fadeOut" data-val="${v}">${v ? v + 's' : 'None'}</button>`).join('')}</div></div>
        <div class="field"><div class="field-label">Speed</div>
          <select data-k="rate">${speeds.map((s) => `<option value="${s}"${s === E.rateOf(c) ? ' selected' : ''}>${s === 1 ? 'Normal (1×)' : s + '×' + (s > 1 ? ' faster' : ' slower')}</option>`).join('')}</select>
          <div class="hint">Changes the pitch too — great for “sped up” versions.</div></div>
        <div class="info-grid"><span>Starts at</span><b>${E.formatTime(c.start, true)}</b><span>Length</span><b>${E.formatTime(c.duration, true)}</b><span>From song at</span><b>${E.formatTime(c.offset, true)}</b></div>
        <div class="btn-col">
          <button class="tool-btn" data-act="split">✂ Split at playhead</button>
          <button class="tool-btn" data-act="dup">⧉ Duplicate</button>
          <button class="tool-btn" data-act="solo-clip">▶ Play from this clip</button>
          <button class="tool-btn danger" data-act="del">🗑 Delete clip</button>
        </div>`;
    } else if (S.range) {
      const { a, b } = S.range;
      inspector.innerHTML = `
        <button class="sheet-close" data-act="clearrange" aria-label="Close">×</button>
        <h3>Section chosen</h3><div class="sub">${E.formatTime(a, true)} – ${E.formatTime(b, true)} · ${(b - a).toFixed(1)} seconds</div>
        <div class="btn-col">
          <button class="tool-btn" data-act="playrange">▶ Play this section</button>
          <button class="tool-btn" data-act="cutrange">✂ Cut it out (closes the gap)</button>
          <button class="tool-btn" data-act="keeprange">★ Keep only this section</button>
          <button class="tool-btn" data-act="clearrange">✕ Clear selection</button>
        </div>
        <div class="hint" style="margin-top:14px">Cutting affects every track, so the songs stay lined up.</div>`;
    } else {
      inspector.innerHTML = `
        <h3>Quick tips</h3><div class="sub">Tap a clip to edit it.</div>
        <ul class="tips">
          <li><b>Trim:</b> drag the left or right edge of a clip.</li>
          <li><b>Move:</b> drag a clip left/right, or up/down to another track.</li>
          <li><b>Split:</b> put the gold playhead where you want, then <b>Split</b>${isTouch ? '' : ' (<kbd>S</kbd>)'}.</li>
          <li><b>Cut a section:</b> drag across the time ruler at the top, then <b>Cut Section</b>.</li>
          <li><b>Blend songs:</b> overlap two clips on different tracks and add fades.</li>
          <li><b>Even Out Volume</b> makes every song equally loud in one click.</li>
          <li><b>Save</b> keeps your project to finish later. <b>Export Mix</b> makes the song file.</li>
        </ul>`;
    }
  }
  const fmtDb = (v) => `${v > 0 ? '+' : ''}${(+v).toFixed(1)} dB`;

  function setClipProp(c, k, v, live) {
    if (k === 'rate') { // keep the same part of the song, so the length changes
      const nr = +v, span = E.sourceSpan(c); c.rate = nr; c.duration = span / nr;
      c.fadeIn = Math.min(c.fadeIn, c.duration); c.fadeOut = Math.min(c.fadeOut, c.duration);
    } else if (k === 'name') c.name = v;
    else c[k] = +v;
    if (live) {
      const el = tracksEl.querySelector(`.clip[data-id="${c.id}"]`); if (el) positionClipEl(el, c);
      const vs = inspector.querySelector(`[data-v="${k}"]`); if (vs) vs.textContent = k === 'gainDb' ? fmtDb(v) : `${(+v).toFixed(1)}s`;
      updateTotals(); P.refresh();
    } else { renderAll(); P.refresh(); }
  }

  inspector.addEventListener('input', (e) => {
    const k = e.target.dataset.k; const c = selClip(); if (!k || !c) return;
    if (e.target.type === 'range') { pushHistory(`clip:${c.id}:${k}`); setClipProp(c, k, e.target.value, true); }
  });
  inspector.addEventListener('change', (e) => {
    const k = e.target.dataset.k; const c = selClip(); if (!k || !c) return;
    if (k === 'name' || k === 'rate') { pushHistory(); setClipProp(c, k, e.target.value, false); }
  });
  inspector.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const c = selClip();
    if (b.dataset.set && c) { pushHistory(); setClipProp(c, b.dataset.set, b.dataset.val, false); return; }
    switch (b.dataset.act) {
      case 'smooth': if (c) toggleClipSmooth(c); break;
      case 'split': splitAtPlayhead(); break;
      case 'dup': duplicateSelected(); break;
      case 'del': deleteSelected(); break;
      case 'solo-clip': if (c) { S.range = null; P.seek(c.start); if (!P.playing) P.start(c.start); renderAll(); } break;
      case 'playrange': if (S.range) { P.seek(S.range.a); if (!P.playing) P.start(S.range.a); } break;
      case 'cutrange': cutRange(); break;
      case 'keeprange': keepRange(); break;
      case 'clearrange': S.range = null; renderAll(); break;
      case 'deselect': S.selected = null; renderAll(); break;
    }
  });

  /* ---------------- track header events ---------------- */
  tracksEl.addEventListener('input', (e) => {
    const row = e.target.closest('.track-row'); if (!row || e.target.dataset.act !== 'vol') return;
    const t = S.tracks.find((x) => x.id === row.dataset.track);
    pushHistory(`tvol:${t.id}`); t.volume = +e.target.value;
    row.querySelector('.th-vol-val').textContent = `${Math.round(t.volume * 100)}%`;
    P.setTrackGain(t);
  });
  tracksEl.addEventListener('change', (e) => {
    const row = e.target.closest('.track-row'); if (!row || e.target.dataset.act !== 'name') return;
    const t = S.tracks.find((x) => x.id === row.dataset.track); pushHistory(); t.name = e.target.value || t.name;
  });
  tracksEl.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.act === 'addtrack') return commit(() => S.tracks.push(newTrack()));
    const row = b.closest('.track-row'); if (!row) return;
    const t = S.tracks.find((x) => x.id === row.dataset.track);
    if (b.dataset.act === 'mute') commit(() => { t.muted = !t.muted; });
    if (b.dataset.act === 'solo') commit(() => { t.solo = !t.solo; });
    if (b.dataset.act === 'deltrack') {
      const n = S.clips.filter((c) => c.track === t.id).length;
      if (n && !confirm(`Remove “${t.name}” and its ${n} clip${n > 1 ? 's' : ''}?`)) return;
      commit(() => { S.tracks = S.tracks.filter((x) => x !== t); S.clips = S.clips.filter((c) => c.track !== t.id); if (S.selected && !clipById(S.selected)) S.selected = null; });
    }
  });

  /* ---------------- pointer: clips, lanes, ruler ---------------- */
  function snapTime(t, excludeId, extraEdge) {
    if (!S.snap) return t;
    const thr = (isTouch ? 16 : 10) / S.zoom;
    const cands = [0, S.playhead];
    if (S.range) cands.push(S.range.a, S.range.b);
    for (const c of S.clips) if (c.id !== excludeId) cands.push(c.start, E.clipEnd(c));
    let best = t, bestD = thr;
    for (const v of cands) {
      const d1 = Math.abs(v - t); if (d1 < bestD) { bestD = d1; best = v; }
      if (extraEdge != null) { const d2 = Math.abs(v - (t + extraEdge)); if (d2 < bestD) { bestD = d2; best = v - extraEdge; } }
    }
    return best;
  }

  let drag = null;
  tracksEl.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('.track-head')) return;
    const clipEl = e.target.closest('.clip');
    if (clipEl) {
      const c = clipById(clipEl.dataset.id); if (!c) return;
      e.preventDefault();
      const mode = e.target.classList.contains('handle') ? (e.target.classList.contains('l') ? 'trimL' : 'trimR') : 'move';
      if (S.selected !== c.id) { S.selected = c.id; for (const el of tracksEl.querySelectorAll('.clip.selected')) el.classList.remove('selected'); clipEl.classList.add('selected'); renderInspector(); updateButtons(); }
      drag = { mode, c, el: clipEl, x: e.clientX, y: e.clientY, orig: Object.assign({}, c), snap: snapshot(), moved: false, pid: e.pointerId };
      clipEl.setPointerCapture(e.pointerId);
      return;
    }
    if (e.target.closest('.lane')) {
      // empty space: on touch let the finger scroll; on a tap, move the playhead
      drag = { mode: 'lane', x: e.clientX, y: e.clientY, moved: false };
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < (isTouch ? 8 : 3)) return;
    drag.moved = true;
    if (drag.mode === 'lane' || drag.mode === 'ruler') { if (drag.mode === 'ruler') rulerMove(e); return; }
    const { c, orig } = drag; const r = E.rateOf(orig); const buf = buffers.get(c.sourceId);
    drag.el.classList.add('dragging');
    if (drag.mode === 'move') {
      c.start = Math.max(0, snapTime(Math.max(0, orig.start + dx / S.zoom), c.id, orig.duration));
      const idx = E.clamp(trackIndex(orig.track) + Math.round(dy / LANE_H()), 0, S.tracks.length - 1);
      const tid = S.tracks[idx].id;
      if (tid !== c.track) { c.track = tid; tracksEl.querySelector(`[data-track="${tid}"] .lane`).appendChild(drag.el); }
    } else if (drag.mode === 'trimL') {
      const end = E.clipEnd(orig);
      const minStart = Math.max(0, orig.start - orig.offset / r);
      const ns = E.clamp(snapTime(orig.start + dx / S.zoom, c.id), minStart, end - 0.05);
      c.start = ns; c.offset = orig.offset + (ns - orig.start) * r; c.duration = end - ns;
    } else if (drag.mode === 'trimR') {
      const maxEnd = orig.start + (buf.duration - orig.offset) / r;
      const ne = E.clamp(snapTime(E.clipEnd(orig) + dx / S.zoom, c.id), orig.start + 0.05, maxEnd);
      c.duration = ne - orig.start;
    }
    c.fadeIn = Math.min(c.fadeIn, c.duration); c.fadeOut = Math.min(c.fadeOut, c.duration);
    positionClipEl(drag.el, c); updateTotals();
  });
  window.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.mode === 'lane') { if (!d.moved) { S.selected = null; S.range = null; P.seek(xToTime(e.clientX)); renderAll(); } return; }
    if (d.mode === 'ruler') return rulerUp(e, d);
    d.el.classList.remove('dragging');
    if (d.moved) {
      undoStack.push(d.snap); redoStack.length = 0; lastHistKey = null; setDirty(true);
      renderAll(); P.refresh();
    }
  });
  window.addEventListener('pointercancel', () => { if (drag?.el) { drag.el.classList.remove('dragging'); restore(drag.snap); renderAll(); } drag = null; });

  ruler.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const t = xToTime(e.clientX);
    drag = { mode: 'ruler', x: e.clientX, y: e.clientY, t, moved: false };
    ruler.setPointerCapture(e.pointerId);
  });
  function rulerMove(e) {
    const t = xToTime(e.clientX); const a = Math.min(drag.t, t), b = Math.max(drag.t, t);
    S.range = { a: snapTime(a), b: snapTime(b) }; renderRange();
    updateButtons();
  }
  function rulerUp(e, d) {
    if (!d.moved) { S.range = null; P.seek(snapTime(d.t)); }
    else if (S.range && S.range.b - S.range.a < 0.05) S.range = null;
    else { S.selected = null; S.playhead = S.range.a; if (P.playing) P.seek(S.range.a); }
    renderAll();
  }

  let scrollRaf = 0;
  scroller.addEventListener('scroll', () => {
    cancelAnimationFrame(scrollRaf);
    scrollRaf = requestAnimationFrame(() => { renderRuler(); redrawVisibleWaves(); });
  });
  scroller.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    setZoom(S.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), e.clientX);
  }, { passive: false });

  // two-finger pinch to zoom on phones/tablets
  const pinch = { pts: new Map(), d0: 0, z0: 0 };
  scroller.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      const [a, b] = e.touches; pinch.d0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); pinch.z0 = S.zoom;
      if (drag?.el) { restore(drag.snap); drag = null; renderAll(); } else drag = null;
    }
  }, { passive: true });
  scroller.addEventListener('touchmove', (e) => {
    if (e.touches.length !== 2 || !pinch.d0) return;
    e.preventDefault();
    const [a, b] = e.touches; const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    setZoom(pinch.z0 * d / pinch.d0, (a.clientX + b.clientX) / 2);
  }, { passive: false });
  scroller.addEventListener('touchend', (e) => { if (e.touches.length < 2) pinch.d0 = 0; });

  function setZoom(z, anchorClientX) {
    z = E.clamp(z, 1, 400);
    const rect = scroller.getBoundingClientRect();
    const ax = anchorClientX == null ? rect.left + HEADER_W() + (scroller.clientWidth - HEADER_W()) / 2 : anchorClientX;
    const tAnchor = xToTime(ax);
    S.zoom = z; renderAll();
    scroller.scrollLeft = tAnchor * z + HEADER_W() - (ax - rect.left);
    renderRuler(); redrawVisibleWaves();
  }
  function zoomFit() {
    const len = Math.max(10, mixLen());
    S.zoom = E.clamp((scroller.clientWidth - HEADER_W() - 40) / len, 1, 400);
    scroller.scrollLeft = 0; renderAll();
  }

  /* ---------------- drag & drop files (computers) ---------------- */
  let dragDepth = 0;
  scroller.addEventListener('dragenter', (e) => { if ([...e.dataTransfer.types].includes('Files')) { dragDepth++; $('#dropHint').hidden = false; } });
  scroller.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropHint').hidden = true; } });
  scroller.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
  scroller.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; $('#dropHint').hidden = true;
    const files = e.dataTransfer.files; if (!files.length) return;
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest('.track-row');
    const onLane = row && e.clientX - scroller.getBoundingClientRect().left > HEADER_W();
    importFiles(files, onLane ? row.dataset.track : null, onLane ? snapTime(xToTime(e.clientX)) : null);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  /* ---------------- saving, opening, exporting ---------------- */
  async function saveBytes(defaultName, filters, data, mime) {
    if (window.hb?.saveFile) return window.hb.saveFile(defaultName, filters, data);
    const blob = new Blob([data], { type: mime });
    const file = new File([blob], defaultName, { type: mime });
    // Phones: open the share sheet so it can go to Files, AirDrop, Drive, messages…
    if (isTouch && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: defaultName }); return defaultName; }
      catch (err) { if (err.name === 'AbortError') return null; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = defaultName;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    return defaultName;
  }
  const safeName = (n) => (n || 'My Mashup').replace(/[\\/:*?"<>|]+/g, '').trim() || 'My Mashup';

  async function saveProject() {
    if (!S.clips.length) return toast('Nothing to save yet');
    const used = new Map();
    for (const c of S.clips) if (!used.has(c.sourceId)) used.set(c.sourceId, sources.get(c.sourceId));
    const usedLevels = {}; for (const c of S.clips) if (c.levelKey && S.levels[c.levelKey]) usedLevels[c.levelKey] = S.levels[c.levelKey];
    const state = { levels: usedLevels, tracks: S.tracks, clips: S.clips, zoom: S.zoom, master: S.master, limiter: S.limiter, target: S.target, name: S.name };
    const data = E.packProject(state, used);
    const where = await saveBytes(`${safeName(S.name)}.hbmix`, [{ name: 'HB Mashup Project', extensions: ['hbmix'] }], data, 'application/octet-stream');
    if (where) { setDirty(false); toast('Project saved ✦'); status(`Saved ${where}`); }
  }
  async function openProject() {
    if (window.__hbDirty && !confirm('Open another project? Unsaved changes here will be lost.')) return;
    if (window.hb?.openProject) { const r = await window.hb.openProject(); if (r) await loadProject(r.data, r.name); }
    else $('#projectInput').click();
  }
  async function loadProject(buf, fileName) {
    try {
      showBusy('Opening project…', fileName || '');
      const { state, sources: src } = E.unpackProject(buf);
      P.pause(); sources.clear(); buffers.clear(); peaks.clear(); loudCache.clear();
      for (const [id, s] of src) await addSource(s.name, s.bytes, id);
      Object.assign(S, { levels: state.levels || {}, tracks: state.tracks, clips: state.clips, zoom: state.zoom || 20, master: state.master ?? 1, limiter: state.limiter ?? true, target: state.target ?? -14, name: state.name || stripExt(fileName || 'My Mashup'), selected: null, range: null, playhead: 0 });
      undoStack.length = 0; redoStack.length = 0; setDirty(false);
      syncFooter(); P.applyChain(); renderAll(); status(`Opened ${fileName || 'project'}`);
    } catch (err) { console.error(err); toast(err.message || 'Could not open that file'); }
    finally { closeModal(); }
  }
  function newProject() {
    if (!S.clips.length && !S.tracks.length) return toast('This is already a fresh, empty mix ✦');
    if (window.__hbDirty && !confirm('Start a new mix? Unsaved changes will be lost.')) return;
    P.pause(); sources.clear(); buffers.clear(); peaks.clear(); loudCache.clear();
    Object.assign(S, { levels: {}, tracks: [], clips: [], selected: null, range: null, playhead: 0, zoom: 20, name: 'My Mashup' });
    undoStack.length = 0; redoStack.length = 0; setDirty(false); renderAll(); status('New mix');
  }

  async function renderMix(sr = 44100) {
    const len = mixLen();
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new AC(2, Math.ceil((len + 0.05) * sr), sr);
    const master = off.createGain(); master.gain.value = S.master;
    if (S.limiter) { const lim = E.makeLimiter(off); master.connect(lim); lim.connect(off.destination); } else master.connect(off.destination);
    E.scheduleMix(off, master, S.tracks, S.clips, buffers, 0, 0, null, S.levels);
    const out = await off.startRendering();
    const ch = [out.getChannelData(0), out.getChannelData(1)];
    if (S.limiter) { // final safety so nothing clips in the file
      let pk = 0; for (const c of ch) for (let i = 0; i < c.length; i++) { const a = c[i] < 0 ? -c[i] : c[i]; if (a > pk) pk = a; }
      if (pk > 0.989) { const k = 0.989 / pk; for (const c of ch) for (let i = 0; i < c.length; i++) c[i] *= k; }
    }
    return { ch, sr };
  }

  function openExport() {
    if (!S.clips.length) return toast('Add some songs first ✦');
    const mp3 = !!window.lamejs;
    openModal(`
      <h2>Export your mix</h2><div class="sub">Length ${E.formatTime(mixLen(), true)} — ready for the stage ✦</div>
      <div class="field"><div class="field-label">File name</div><input type="text" id="exName" value="${esc(S.name)}" /></div>
      <div class="format-opts">
        <label class="format-opt"><input type="radio" name="fmt" value="mp3-320" ${mp3 ? 'checked' : 'disabled'} /><div><b>MP3 — best quality</b><small>Works everywhere. Great for sending to the DJ or the venue.</small></div></label>
        <label class="format-opt"><input type="radio" name="fmt" value="mp3-192" ${mp3 ? '' : 'disabled'} /><div><b>MP3 — smaller file</b><small>Easier to text or email.</small></div></label>
        <label class="format-opt"><input type="radio" name="fmt" value="wav" ${mp3 ? '' : 'checked'} /><div><b>WAV — studio quality</b><small>Biggest file, no quality loss.</small></div></label>
      </div>
      <div class="modal-actions"><button class="ghost-btn" data-close>Cancel</button><button class="primary-btn" id="exGo">Export</button></div>`);
    $('#exGo').onclick = async () => {
      const fmt = document.querySelector('input[name=fmt]:checked').value;
      S.name = safeName($('#exName').value);
      showBusy('Making your mix…', 'Hang tight, queen — this takes a few seconds.');
      await new Promise((r) => setTimeout(r, 50));
      try {
        const { ch, sr } = await renderMix();
        await new Promise((r) => setTimeout(r, 20));
        let data, ext, mime;
        if (fmt === 'wav') { data = E.encodeWav(ch, sr); ext = 'wav'; mime = 'audio/wav'; }
        else { data = E.encodeMp3(window.lamejs, ch, sr, fmt === 'mp3-192' ? 192 : 320); ext = 'mp3'; mime = 'audio/mpeg'; }
        closeModal();
        const where = await saveBytes(`${S.name}.${ext}`, [{ name: ext.toUpperCase(), extensions: [ext] }], data, mime);
        if (where) {
          toast('Mix exported ✦'); status(`Exported ${where}`);
          if (window.hb?.showInFolder && /[\\/]/.test(where)) window.hb.showInFolder(where);
        }
      } catch (err) { console.error(err); closeModal(); toast('Export failed: ' + (err.message || err)); }
    };
  }

  function openPauseDialog() {
    if (!S.clips.length) return toast('Add some songs first ✦');
    openModal(`<h2>Add a pause</h2><div class="sub">Everything after the playhead (${E.formatTime(S.playhead, true)}) moves later, on every track.</div>
      <div class="chips">${[1, 2, 3, 5, 8, 10].map((s) => `<button class="chip big-chip" data-gap="${s}">${s} sec</button>`).join('')}</div>
      <div class="modal-actions"><button class="ghost-btn" data-close>Cancel</button></div>`);
    $('#modalCard').querySelectorAll('[data-gap]').forEach((b) => (b.onclick = () => { closeModal(); addPause(+b.dataset.gap); }));
  }

  function openHelp() {
    const tap = isTouch ? 'Tap' : 'Click';
    const row = (btn, txt) => `<div class="hb-row"><span class="hb-btn">${btn}</span><span>${txt}</span></div>`;
    const k = (x) => `<kbd>${x}</kbd>`;
    openModal(`<h2>What every button does</h2><div class="sub">HB Mashup Studio by HB Software</div>
      <h3>Playing</h3>
      ${row('▶ / ❚❚', 'Play or pause the mix.')}
      ${row('⏮ Start', 'Jump back to the beginning.')}
      ${row('■ Stop', 'Stop and go back to the start.')}
      ${row('Gold line', 'The playhead — where the music is playing. ' + tap + ' the time numbers or an empty spot to move it.')}
      <h3>Songs &amp; clips</h3>
      ${row('＋ Add Songs', 'Pick songs to use. Each song gets its own row (track).')}
      ${row('Drag a clip', 'Move it earlier/later, or onto another row to play songs at the same time.')}
      ${row('Drag an edge', 'Trim — shorten the start or end of a clip.')}
      ${row('✂ Split', 'Cut a clip in two at the gold line. Pick a clip first, or it splits whatever is under the line.')}
      ${row('⧉ Copy Clip', 'Make a copy of the clip you picked, right after it.')}
      ${row('🗑 Delete Clip', 'Remove the clip you picked.')}
      <h3>Sections</h3>
      ${row('Highlight', 'Drag across the time numbers at the top to highlight a section (shows in blue).')}
      ${row('✂ Cut Section', 'Remove the highlighted part from every row and close the gap.')}
      ${row('★ Keep Section', 'Throw away everything except the highlighted part.')}
      ${row('⏸ Add Pause', 'Add 1–10 seconds of silence at the gold line.')}
      <h3>Sound</h3>
      ${row('⚖ Even Out Volume', 'Makes the volume even. Pick <b>Match every song</b> (each song equally loud) or <b>Smooth the whole mix</b> (also fixes loud and quiet parts inside a song or an old mix).')}
      ${row('Old mixes', 'Add a mix you made before with ＋ Add Songs, then use Smooth the whole mix.')}
      ${row('🎚 Smooth this clip', 'In a clip’s settings: steady volume for just that clip.')}
      ${row('Mute', 'Silence a row.')}
      ${row('Solo', 'Hear only that row (great for checking one song).')}
      ${row('Row slider', 'Volume for that whole row.')}
      ${row('Main volume', 'Volume for the whole mix.')}
      ${row('Protect from distortion', 'Keep this on — it stops loud mixes from crackling.')}
      ${row('Clip settings', tap + ' a clip to change its volume, fade in, fade out and speed.')}
      <h3>Other</h3>
      ${row('↶ Undo / ↷ Redo', 'Take back a change, or bring it back.')}
      ${row('Snap clips', 'When on, clips line up neatly as you drag them.')}
      ${row('Zoom − Fit ＋', 'Make the timeline bigger or smaller. Fit shows the whole mix.' + (isTouch ? ' You can also pinch with two fingers.' : ''))}
      ${row('＋ Add Track', 'Add an empty row.')}
      ${row('✕ on a row', 'Remove that row and its clips.')}
      <h3>Files</h3>
      ${row('New', 'Clear everything and start over.')}
      ${row('Save', 'Save your project to keep working later. The songs are saved inside it, so you can send it to a friend.')}
      ${row('Open', 'Open a project you saved.')}
      ${row('Export Mix', 'Make the finished MP3 or WAV to perform with.')}
      ${isTouch ? '' : `<h3>Keyboard shortcuts</h3><div class="help-grid">
        ${k('Space')}<span>Play / pause</span>${k('S')}<span>Split</span>${k('Delete')}<span>Delete clip</span>
        <span>${k('Ctrl')} ${k('Z')} / ${k('Y')}</span><span>Undo / redo</span><span>${k('Ctrl')} ${k('D')}</span><span>Copy clip</span>
        <span>${k('Ctrl')} ${k('S')}</span><span>Save</span><span>${k('Ctrl')} ${k('E')}</span><span>Export</span>
        <span>${k('+')} / ${k('−')}</span><span>Zoom</span>${k('Home')}<span>Back to start</span>${k('Esc')}<span>Un-pick clip / section</span></div>`}
      <div class="modal-actions"><a class="footer-brand" href="https://hbcs.info" target="_blank" style="margin-right:auto;align-self:center">HB Software · hbcs.info</a><button class="primary-btn" data-close>Got it</button></div>`);
  }

  /* ---------------- modal / toast / status ---------------- */
  function openModal(html) { $('#modalCard').innerHTML = html; $('#modal').hidden = false; $('#modalCard').querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeModal)); }
  function closeModal() { $('#modal').hidden = true; $('#modalCard').innerHTML = ''; }
  function showBusy(title, sub) { openModal(`<h2>${esc(title)}</h2><div class="sub">${esc(sub)}</div><div class="progress"><div></div></div>`); }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !$('#modalCard .progress')) closeModal(); });
  let toastTimer = 0;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200); }
  function status(msg) { $('#status').textContent = msg; }

  /* ---------------- wiring ---------------- */
  const on = (id, fn) => $(id).addEventListener('click', fn);
  on('#btnAdd', () => $('#fileInput').click());
  on('#btnAddEmpty', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
  $('#projectInput').addEventListener('change', async (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadProject(await f.arrayBuffer(), f.name); });
  on('#btnPlay', () => P.toggle());
  on('#btnStop', () => { if (!S.clips.length) return toast('Add a song first ✦'); P.stop(); status('Stopped'); });
  on('#btnToStart', () => { if (!S.clips.length) return toast('Add a song first ✦'); P.seek(S.range ? S.range.a : 0); status('Back to the start'); });
  on('#btnSplit', splitAtPlayhead);
  on('#btnDelete', deleteSelected);
  on('#btnDuplicate', duplicateSelected);
  on('#btnEven', openEvenOut);
  on('#btnCutRange', cutRange);
  on('#btnKeepRange', keepRange);
  on('#btnGap', openPauseDialog);
  on('#btnUndo', undo);
  on('#btnRedo', redo);
  on('#btnZoomIn', () => setZoom(S.zoom * 1.5));
  on('#btnZoomOut', () => setZoom(S.zoom / 1.5));
  on('#btnZoomFit', zoomFit);
  on('#btnHelp', openHelp);
  on('#btnHelpEmpty', openHelp);
  on('#btnAddTrack', () => commit(() => S.tracks.push(newTrack())));
  on('#btnExport', openExport);
  on('#btnSave', saveProject);
  on('#btnOpen', openProject);
  on('#btnNew', newProject);
  on('#btnNewM', newProject);
  on('#btnOpenM', openProject);
  on('#btnSaveM', saveProject);
  $('#snapToggle').addEventListener('change', (e) => (S.snap = e.target.checked));
  $('#limiterToggle').addEventListener('change', (e) => { S.limiter = e.target.checked; P.applyChain(); setDirty(true); });
  $('#targetSelect').addEventListener('change', (e) => { S.target = +e.target.value; });
  $('#masterVol').addEventListener('input', (e) => { S.master = +e.target.value; $('#masterVal').textContent = `${Math.round(S.master * 100)}%`; if (P.master) P.master.gain.setTargetAtTime(S.master, P.ctx.currentTime, 0.02); setDirty(true); });
  function syncFooter() {
    $('#masterVol').value = S.master; $('#masterVal').textContent = `${Math.round(S.master * 100)}%`;
    $('#limiterToggle').checked = S.limiter; $('#targetSelect').value = String(S.target);
  }

  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
    if (e.key === 'Escape') { if (!$('#modal').hidden && !$('#modalCard .progress')) return closeModal(); if (typing) return document.activeElement.blur(); S.selected = null; S.range = null; return renderAll(); }
    if (typing || !$('#modal').hidden) return;
    const mod = e.ctrlKey || e.metaKey; const k = e.key.toLowerCase();
    if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (mod && k === 'd') { e.preventDefault(); duplicateSelected(); }
    else if (mod && k === 's') { e.preventDefault(); saveProject(); }
    else if (mod && k === 'o') { e.preventDefault(); openProject(); }
    else if (mod && k === 'e') { e.preventDefault(); openExport(); }
    else if (mod) return;
    else if (e.code === 'Space') { e.preventDefault(); P.toggle(); }
    else if (k === 's') splitAtPlayhead();
    else if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSelected(); }
    else if (k === 'home') P.seek(0);
    else if (k === 'end') P.seek(mixLen());
    else if (k === '+' || k === '=') setZoom(S.zoom * 1.5);
    else if (k === '-' || k === '_') setZoom(S.zoom / 1.5);
    else if (k === 'arrowleft') P.seek(S.playhead - (e.shiftKey ? 5 : 1));
    else if (k === 'arrowright') P.seek(S.playhead + (e.shiftKey ? 5 : 1));
  });
  window.addEventListener('resize', () => renderAll());

  // Offline + "Add to Home Screen" support when running as a web app
  if ('serviceWorker' in navigator && /^https?:/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => {});

  if (isTouch) {
    $('.empty-card p').textContent = 'Tap below to pick songs from your phone.';
    $('.steps li:nth-child(2)').innerHTML = '<b>Trim &amp; cut.</b> Drag a clip’s edges to trim. Tap <b>Split</b> to cut at the playhead.';
  }
  renderAll(); syncFooter();
  window.__hbDirty = false;
  // exposed for automated checks
  window.__hbStudio = { S, sources, buffers, importFiles, evenOut, splitAtPlayhead, cutRange, renderMix, undo, redo, P };
})();
