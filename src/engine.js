/* HB Mashup Studio — audio engine (no UI). Works in the app and in Node for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-6;
  let idCounter = 1;
  const uid = (p = 'id') => `${p}${Date.now().toString(36)}${(idCounter++).toString(36)}`;

  const dbToGain = (db) => Math.pow(10, db / 20);
  const gainToDb = (g) => (g <= 0 ? -Infinity : 20 * Math.log10(g));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  /* ---------- clip helpers ---------- */
  // A clip: { id, sourceId, track, start, offset, duration, gainDb, fadeIn, fadeOut, rate, name, color }
  //   start    = where it sits on the timeline (seconds)
  //   offset   = where in the source song it begins (source seconds)
  //   duration = how long it lasts on the timeline (seconds)
  //   rate     = playback speed (1 = normal; also changes pitch)
  const clipEnd = (c) => c.start + c.duration;
  const rateOf = (c) => c.rate || 1;
  const sourceSpan = (c) => c.duration * rateOf(c);

  function makeClip(props) {
    return Object.assign({ id: uid('c'), gainDb: 0, fadeIn: 0, fadeOut: 0, rate: 1 }, props);
  }

  // Return the part of a clip that falls inside timeline [t1, t2], or null.
  function sliceClip(c, t1, t2) {
    const a = Math.max(c.start, t1);
    const b = Math.min(clipEnd(c), t2);
    if (b - a < 0.01) return null;
    const keepsLeft = a <= c.start + EPS;
    const keepsRight = b >= clipEnd(c) - EPS;
    const dur = b - a;
    return Object.assign({}, c, {
      id: keepsLeft ? c.id : uid('c'),
      start: a,
      offset: c.offset + (a - c.start) * rateOf(c),
      duration: dur,
      fadeIn: keepsLeft ? Math.min(c.fadeIn, dur) : 0,
      fadeOut: keepsRight ? Math.min(c.fadeOut, dur) : 0,
    });
  }

  function splitClip(c, t) {
    if (t <= c.start + 0.01 || t >= clipEnd(c) - 0.01) return null;
    const left = sliceClip(c, c.start, t);
    const right = sliceClip(c, t, clipEnd(c));
    right.id = uid('c');
    return [left, right];
  }

  // Remove timeline [a,b] from every clip and close the gap.
  function rippleDelete(clips, a, b) {
    const len = b - a;
    const out = [];
    for (const c of clips) {
      if (clipEnd(c) <= a + EPS) { out.push(c); continue; }
      if (c.start >= b - EPS) { out.push(Object.assign({}, c, { start: c.start - len })); continue; }
      const left = sliceClip(c, c.start, a);
      const right = sliceClip(c, b, clipEnd(c));
      if (left) out.push(left);
      if (right) { right.start -= len; if (left) right.id = uid('c'); out.push(right); }
    }
    return out;
  }

  // Keep only timeline [a,b]; it becomes the new start of the mix.
  function keepRange(clips, a, b) {
    const out = [];
    for (const c of clips) {
      const s = sliceClip(c, a, b);
      if (s) { s.start -= a; out.push(s); }
    }
    return out;
  }

  // Push everything at/after t later by len seconds (adds silence).
  function insertGap(clips, t, len) {
    const out = [];
    for (const c of clips) {
      if (clipEnd(c) <= t + EPS) { out.push(c); continue; }
      if (c.start >= t - EPS) { out.push(Object.assign({}, c, { start: c.start + len })); continue; }
      const [l, r] = splitClip(c, t);
      r.start += len;
      out.push(l, r);
    }
    return out;
  }

  function mixLength(clips) {
    return clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  }

  // Fade envelope (0..1) at clip-local time l. Returns sorted points for scheduling.
  function envelopePoints(c) {
    const d = c.duration;
    let fi = Math.max(0, c.fadeIn || 0), fo = Math.max(0, c.fadeOut || 0);
    if (fi + fo > d) { const k = d / (fi + fo); fi *= k; fo *= k; }
    const pts = [];
    pts.push([0, fi > 0 ? 0 : 1]);
    if (fi > 0) pts.push([fi, 1]);
    if (fo > 0) { pts.push([d - fo, 1]); pts.push([d, 0]); } else pts.push([d, 1]);
    return pts;
  }
  function envelopeAt(c, l) {
    const pts = envelopePoints(c);
    if (l <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const [t1, v1] = pts[i - 1], [t2, v2] = pts[i];
      if (l <= t2) return t2 - t1 < EPS ? v2 : v1 + (v2 - v1) * (l - t1) / (t2 - t1);
    }
    return pts[pts.length - 1][1];
  }

  /* ---------- loudness (EBU R128 / ITU-R BS.1770 style) ---------- */
  function biquadCoeffs(rate) {
    // K-weighting per ITU-R BS.1770, designed for any sample rate (same method as libebur128)
    let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    let K = Math.tan(Math.PI * f0 / rate);
    const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    const s1 = {
      b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0,
      a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0,
    };
    f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / rate);
    a0 = 1 + K / Q + K * K;
    const s2 = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
    return [s1, s2];
  }

  // channels: array of Float32Array. Returns { lufs, peakDb }.
  function measureLoudness(channels, rate, startSample = 0, endSample) {
    const n0 = Math.max(0, startSample | 0);
    const n1 = Math.min(endSample == null ? channels[0].length : endSample | 0, channels[0].length);
    const N = n1 - n0;
    const block = Math.round(0.4 * rate), hop = Math.round(0.1 * rate);
    if (N < block) return { lufs: -Infinity, peakDb: -Infinity };
    const [s1, s2] = biquadCoeffs(rate);
    const nBlocks = Math.floor((N - block) / hop) + 1;
    const nHops = Math.ceil(N / hop);
    const blockPower = new Float64Array(nBlocks);
    let peak = 0;
    for (const ch of channels) {
      // squared K-weighted energy per hop
      const hopE = new Float64Array(nHops);
      // two-stage K-weighting filter cascade
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, z1 = 0, z2 = 0;
      for (let i = 0; i < N; i++) {
        const x = ch[n0 + i];
        const ax = x < 0 ? -x : x; if (ax > peak) peak = ax;
        const y = s1.b0 * x + s1.b1 * x1 + s1.b2 * x2 - s1.a1 * y1 - s1.a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        const z = s2.b0 * y + s2.b1 * u1 + s2.b2 * u2 - s2.a1 * z1 - s2.a2 * z2;
        u2 = u1; u1 = y; z2 = z1; z1 = z;
        hopE[(i / hop) | 0] += z * z;
      }
      const hopsPerBlock = Math.round(block / hop);
      for (let b = 0; b < nBlocks; b++) {
        let s = 0;
        for (let h = 0; h < hopsPerBlock; h++) s += hopE[b + h];
        blockPower[b] += s / block;
      }
    }
    const L = (p) => -0.691 + 10 * Math.log10(p);
    let sum = 0, cnt = 0;
    for (const p of blockPower) if (L(p) > -70) { sum += p; cnt++; }
    if (!cnt) return { lufs: -Infinity, peakDb: gainToDb(peak) };
    const rel = L(sum / cnt) - 10;
    sum = 0; cnt = 0;
    for (const p of blockPower) { const l = L(p); if (l > -70 && l > rel) { sum += p; cnt++; } }
    return { lufs: cnt ? L(sum / cnt) : -Infinity, peakDb: gainToDb(peak) };
  }

  // How much gain (dB) a clip needs to hit the target loudness.
  function matchGainDb(measured, targetLufs = -14) {
    if (!isFinite(measured.lufs)) return 0;
    let g = targetLufs - measured.lufs;
    // never push peaks more than 6 dB past full scale; the output limiter catches the rest
    if (isFinite(measured.peakDb)) g = Math.min(g, 6 - measured.peakDb);
    return clamp(Math.round(g * 10) / 10, -24, 18);
  }

  /* ---------- whole-mix smoothing ("auto-level") ---------- */
  // Measures loudness every half second across a whole song or old mix and returns a
  // smooth volume curve that brings loud parts down and quiet parts up to the target.
  // Curve times are in SOURCE seconds, so it stays correct after trimming or splitting.
  function computeLevelCurve(channels, rate, targetLufs = -14, opt = {}) {
    const hopSec = opt.hopSec || 0.5, windowSec = opt.windowSec || 3, smoothSec = opt.smoothSec || 4;
    const gate = opt.gate == null ? -45 : opt.gate, maxBoost = opt.maxBoost || 18, maxCut = opt.maxCut || -18;
    const len = channels[0].length, hop = Math.max(1, Math.round(hopSec * rate));
    const nH = Math.ceil(len / hop);
    const e = new Float64Array(nH);
    const [s1, s2] = biquadCoeffs(rate);
    for (const ch of channels) {
      let x1 = 0, x2 = 0, y1 = 0, y2 = 0, u1 = 0, u2 = 0, z1 = 0, z2 = 0;
      for (let i = 0; i < len; i++) {
        const x = ch[i];
        const y = s1.b0 * x + s1.b1 * x1 + s1.b2 * x2 - s1.a1 * y1 - s1.a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        const z = s2.b0 * y + s2.b1 * u1 + s2.b2 * u2 - s2.a1 * z1 - s2.a2 * z2;
        u2 = u1; u1 = y; z2 = z1; z1 = z;
        e[(i / hop) | 0] += z * z;
      }
    }
    const w = Math.max(1, Math.round(windowSec / hopSec)), half = Math.floor(w / 2);
    const want = new Array(nH).fill(NaN);
    for (let i = 0; i < nH; i++) {
      const a = Math.max(0, i - half), b = Math.min(nH, a + w);
      // only count moments that actually have music, so silence never drags the reading down
      let s = 0, samples = 0;
      for (let k = a; k < b; k++) {
        const n = Math.min(len, (k + 1) * hop) - k * hop;
        if (-0.691 + 10 * Math.log10(e[k] / n + 1e-20) > gate) { s += e[k]; samples += n; }
      }
      if (!samples) continue;                                               // silence is never boosted
      const L = -0.691 + 10 * Math.log10(s / samples);
      want[i] = clamp(targetLufs - L, maxCut, maxBoost);
    }
    // quiet gaps keep the volume of the music around them
    let last = NaN;
    for (let i = 0; i < nH; i++) { if (isNaN(want[i])) want[i] = last; else last = want[i]; }
    last = NaN;
    for (let i = nH - 1; i >= 0; i--) { if (isNaN(want[i])) want[i] = last; else last = want[i]; }
    for (let i = 0; i < nH; i++) if (isNaN(want[i])) want[i] = 0;
    // Turn-down wins: near a change, use the lowest nearby setting so a loud part is
    // never boosted on its way in or out — then smooth so the volume glides.
    const r = Math.max(1, Math.round(smoothSec / hopSec / 2));
    const low = new Float64Array(nH);
    for (let i = 0; i < nH; i++) {
      let m = Infinity; for (let k = Math.max(0, i - r); k <= Math.min(nH - 1, i + r); k++) if (want[k] < m) m = want[k];
      low[i] = m;
    }
    const pre = new Float64Array(nH + 1);
    for (let i = 0; i < nH; i++) pre[i + 1] = pre[i] + low[i];
    const db = new Array(nH);
    for (let i = 0; i < nH; i++) {
      const a = Math.max(0, i - r), b = Math.min(nH, i + r + 1);
      db[i] = Math.round(((pre[b] - pre[a]) / (b - a)) * 10) / 10;
    }
    return { start: hopSec / 2, step: hopSec, db, target: targetLufs };
  }

  // Volume (dB) of a level curve at a moment in the source song.
  function levelDbAt(curve, srcT) {
    if (!curve || !curve.db.length) return 0;
    const f = (srcT - curve.start) / curve.step;
    if (f <= 0) return curve.db[0];
    const i = Math.floor(f);
    if (i >= curve.db.length - 1) return curve.db[curve.db.length - 1];
    return curve.db[i] + (curve.db[i + 1] - curve.db[i]) * (f - i);
  }

  /* ---------- waveform peaks ---------- */
  function computePeaks(channels, rate, perSecond = 200) {
    const step = Math.max(1, Math.floor(rate / perSecond));
    const n = Math.ceil(channels[0].length / step);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let m = 0; const a = i * step, b = Math.min(a + step, channels[0].length);
      for (const ch of channels) for (let j = a; j < b; j++) { const v = ch[j] < 0 ? -ch[j] : ch[j]; if (v > m) m = v; }
      out[i] = m;
    }
    return { data: out, perSecond: rate / step };
  }

  /* ---------- WAV encoder ---------- */
  function encodeWav(channels, rate) {
    const nCh = channels.length, len = channels[0].length;
    const buf = new ArrayBuffer(44 + len * nCh * 2);
    const v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + len * nCh * 2, true); w(8, 'WAVE');
    w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
    w(36, 'data'); v.setUint32(40, len * nCh * 2, true);
    let o = 44;
    for (let i = 0; i < len; i++) for (let c = 0; c < nCh; c++) {
      const s = clamp(channels[c][i], -1, 1);
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2;
    }
    return buf;
  }

  function floatToInt16(f) {
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) { const s = clamp(f[i], -1, 1); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
    return out;
  }

  // Encode MP3 with lamejs (window.lamejs must be loaded).
  function encodeMp3(lame, channels, rate, kbps = 320) {
    const nCh = Math.min(2, channels.length);
    const enc = new lame.Mp3Encoder(nCh, rate, kbps);
    const L = floatToInt16(channels[0]);
    const R = nCh > 1 ? floatToInt16(channels[1]) : null;
    const parts = []; const chunk = 1152;
    for (let i = 0; i < L.length; i += chunk) {
      const l = L.subarray(i, i + chunk);
      const d = R ? enc.encodeBuffer(l, R.subarray(i, i + chunk)) : enc.encodeBuffer(l);
      if (d.length) parts.push(new Uint8Array(d));
    }
    const end = enc.flush(); if (end.length) parts.push(new Uint8Array(end));
    let total = 0; for (const p of parts) total += p.length;
    const out = new Uint8Array(total); let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out.buffer;
  }

  /* ---------- mixing (used for both playback and export) ---------- */
  // tracks: [{id, volume, muted, solo}], clips: [...], buffers: Map(sourceId -> AudioBuffer)
  // levels: { key -> level curve } for clips with whole-mix smoothing (clip.levelKey)
  function scheduleMix(ctx, destination, tracks, clips, buffers, fromTime, t0, untilTime, levels) {
    const anySolo = tracks.some((t) => t.solo);
    const trackNodes = new Map();
    for (const t of tracks) {
      const g = ctx.createGain();
      const audible = !t.muted && (!anySolo || t.solo);
      g.gain.value = audible ? (t.volume == null ? 1 : t.volume) : 0;
      g.connect(destination);
      trackNodes.set(t.id, g);
    }
    const sources = [];
    for (const c of clips) {
      const buf = buffers.get(c.sourceId);
      const tn = trackNodes.get(c.track);
      if (!buf || !tn) continue;
      const end = untilTime == null ? clipEnd(c) : Math.min(clipEnd(c), untilTime);
      if (end <= fromTime + 0.005 || c.start >= end) continue;
      const local0 = Math.max(0, fromTime - c.start);
      const localEnd = end - c.start;
      const when = t0 + Math.max(0, c.start - fromTime);
      const r = rateOf(c);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.playbackRate.value = r;
      const g = ctx.createGain();
      const base = dbToGain(c.gainDb || 0);
      g.gain.setValueAtTime(base * envelopeAt(c, local0), when);
      for (const [pt, val] of envelopePoints(c)) {
        if (pt > local0 + EPS && pt <= localEnd + EPS) g.gain.linearRampToValueAtTime(base * val, when + (pt - local0));
      }
      let head = src;
      const curve = c.levelKey && levels ? levels[c.levelKey] : null;
      if (curve) { // smooth volume ride across the clip
        const lv = ctx.createGain();
        const s0 = c.offset + local0 * r, s1 = c.offset + localEnd * r;
        lv.gain.setValueAtTime(dbToGain(levelDbAt(curve, s0)), when);
        let i = Math.max(0, Math.ceil((s0 - curve.start) / curve.step));
        for (; i < curve.db.length; i++) {
          const st = curve.start + i * curve.step;
          if (st > s1) break;
          lv.gain.linearRampToValueAtTime(dbToGain(curve.db[i]), when + (st - s0) / r);
        }
        src.connect(lv); head = lv;
      }
      head.connect(g); g.connect(tn);
      src.start(when, c.offset + local0 * r, (localEnd - local0) * r);
      sources.push(src);
    }
    return { sources, trackNodes };
  }

  function makeLimiter(ctx) {
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -1.5; lim.knee.value = 0; lim.ratio.value = 20;
    lim.attack.value = 0.002; lim.release.value = 0.2;
    return lim;
  }

  /* ---------- project file (.hbmix) ---------- */
  // Layout: "HBMX" | uint32 jsonLength | json utf8 | concatenated source bytes
  function packProject(state, sources /* Map id -> {name, bytes:ArrayBuffer} */) {
    const list = []; let offset = 0;
    for (const [id, s] of sources) { list.push({ id, name: s.name, offset, length: s.bytes.byteLength }); offset += s.bytes.byteLength; }
    const json = new TextEncoder().encode(JSON.stringify({ app: 'HB Mashup Studio', version: 1, state, sources: list }));
    const out = new Uint8Array(8 + json.length + offset);
    out.set([72, 66, 77, 88], 0);
    new DataView(out.buffer).setUint32(4, json.length, true);
    out.set(json, 8);
    let o = 8 + json.length;
    for (const [, s] of sources) { out.set(new Uint8Array(s.bytes), o); o += s.bytes.byteLength; }
    return out.buffer;
  }
  function unpackProject(buf) {
    const u = new Uint8Array(buf);
    if (String.fromCharCode(u[0], u[1], u[2], u[3]) !== 'HBMX') throw new Error('This is not an HB Mashup Studio project file.');
    const len = new DataView(u.buffer, u.byteOffset).getUint32(4, true);
    const meta = JSON.parse(new TextDecoder().decode(u.subarray(8, 8 + len)));
    const base = 8 + len;
    const sources = new Map();
    for (const s of meta.sources) sources.set(s.id, { name: s.name, bytes: u.slice(base + s.offset, base + s.offset + s.length).buffer });
    return { state: meta.state, sources };
  }

  function formatTime(sec, withMs = false) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    const m = Math.floor(sec / 60), s = sec - m * 60;
    return withMs ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
  }

  return {
    uid, dbToGain, gainToDb, clamp, clipEnd, rateOf, sourceSpan, makeClip, sliceClip, splitClip,
    rippleDelete, keepRange, insertGap, mixLength, envelopePoints, envelopeAt,
    measureLoudness, matchGainDb, computeLevelCurve, levelDbAt, computePeaks, encodeWav, encodeMp3, floatToInt16,
    scheduleMix, makeLimiter, packProject, unpackProject, formatTime,
  };
});
