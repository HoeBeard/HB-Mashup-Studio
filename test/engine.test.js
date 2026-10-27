const E = require('../src/engine.js');
const assert = require('assert');
let pass = 0; const t = (name, fn) => { fn(); pass++; console.log('ok -', name); };
const sine = (f, amp, sec, rate = 48000) => { const a = new Float32Array(sec * rate); for (let i = 0; i < a.length; i++) a[i] = amp * Math.sin(2 * Math.PI * f * i / rate); return a; };

t('1 kHz full-scale sine, stereo ≈ 0 LUFS', () => {
  const s = sine(997, 1, 5); const m = E.measureLoudness([s, s], 48000);
  assert(Math.abs(m.lufs - 0) < 0.15, m.lufs);
});
t('-20 dBFS sine mono ≈ -23 LUFS', () => {
  const m = E.measureLoudness([sine(997, E.dbToGain(-20), 5)], 48000);
  assert(Math.abs(m.lufs + 23.01) < 0.15, m.lufs);
});
t('44.1k rate works', () => {
  const s = sine(997, 1, 5, 44100); const m = E.measureLoudness([s, s], 44100);
  assert(Math.abs(m.lufs) < 0.15, m.lufs);
});
t('matchGainDb brings a quiet song up, capped by peak', () => {
  assert.strictEqual(E.matchGainDb({ lufs: -20, peakDb: -10 }, -14), 6);
  assert.strictEqual(E.matchGainDb({ lufs: -30, peakDb: -2 }, -14), 8);
  assert.strictEqual(E.matchGainDb({ lufs: -8, peakDb: 0 }, -14), -6);
});
const c = E.makeClip({ sourceId: 's', track: 't', start: 10, offset: 5, duration: 20, fadeIn: 2, fadeOut: 3 });
t('split keeps source alignment and fades on correct sides', () => {
  const [l, r] = E.splitClip(c, 18);
  assert.deepStrictEqual([l.start, l.offset, l.duration, l.fadeIn, l.fadeOut], [10, 5, 8, 2, 0]);
  assert.deepStrictEqual([r.start, r.offset, r.duration, r.fadeIn, r.fadeOut], [18, 13, 12, 0, 3]);
  assert.notStrictEqual(l.id, r.id);
});
t('split respects speed', () => {
  const [, r] = E.splitClip(Object.assign({}, c, { rate: 1.25 }), 18);
  assert.strictEqual(r.offset, 15);
});
t('ripple delete closes the gap', () => {
  const d = E.makeClip({ sourceId: 's', track: 't', start: 40, offset: 0, duration: 5 });
  const out = E.rippleDelete([c, d], 15, 20);
  assert.strictEqual(out.length, 3);
  assert.deepStrictEqual(out.map(x => [x.start, x.duration]), [[10, 5], [15, 10], [35, 5]]);
  assert.strictEqual(out[1].offset, 15);
  assert.strictEqual(E.mixLength(out), 40);
});
t('keep range', () => {
  const out = E.keepRange([c], 12, 16);
  assert.deepStrictEqual([out[0].start, out[0].offset, out[0].duration], [0, 7, 4]);
});
t('insert gap', () => {
  const out = E.insertGap([c], 20, 3);
  assert.deepStrictEqual(out.map(x => [x.start, x.duration]), [[10, 10], [23, 10]]);
});
t('envelope', () => {
  assert.strictEqual(E.envelopeAt(c, 0), 0); assert.strictEqual(E.envelopeAt(c, 1), 0.5);
  assert.strictEqual(E.envelopeAt(c, 10), 1); assert.strictEqual(E.envelopeAt(c, 20), 0);
  const tiny = Object.assign({}, c, { duration: 2, fadeIn: 2, fadeOut: 2 });
  assert(Math.abs(E.envelopeAt(tiny, 1) - 1) < 1e-9);
});
t('wav header + length', () => {
  const b = E.encodeWav([new Float32Array(100), new Float32Array(100)], 44100);
  assert.strictEqual(b.byteLength, 44 + 400);
  assert.strictEqual(Buffer.from(b.slice(0, 4)).toString(), 'RIFF');
});
t('project pack/unpack round-trip', () => {
  const src = new Map([['a', { name: 'one.mp3', bytes: new Uint8Array([1, 2, 3]).buffer }], ['b', { name: 'two.wav', bytes: new Uint8Array([9, 8]).buffer }]]);
  const p = E.unpackProject(E.packProject({ x: 1 }, src));
  assert.deepStrictEqual(p.state, { x: 1 });
  assert.deepStrictEqual([...new Uint8Array(p.sources.get('b').bytes)], [9, 8]);
  assert.strictEqual(p.sources.get('a').name, 'one.mp3');
});
t('smoothing evens a quiet half and a loud half of one old mix', () => {
  const sr = 44100, half = 15 * sr, x = new Float32Array(half * 2);
  for (let i = 0; i < x.length; i++) x[i] = (i < half ? E.dbToGain(-26) : E.dbToGain(-8)) * Math.sin(2 * Math.PI * 997 * i / sr);
  const before = [E.measureLoudness([x], sr, 0, half).lufs, E.measureLoudness([x], sr, half, 2 * half).lufs];
  const cv = E.computeLevelCurve([x], sr, -14);
  const y = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) y[i] = x[i] * E.dbToGain(E.levelDbAt(cv, i / sr));
  const after = [E.measureLoudness([y], sr, 3 * sr, half - 3 * sr).lufs, E.measureLoudness([y], sr, half + 3 * sr, 2 * half).lufs];
  assert(Math.abs(before[0] - before[1]) > 15, 'test signal should start uneven');
  assert(Math.abs(after[0] - after[1]) < 1.5, `halves should match: ${after}`);
  assert(after.every((l) => Math.abs(l + 14) < 1.5), `should hit target: ${after}`);
});
t('smoothing never boosts silence', () => {
  const sr = 44100, x = new Float32Array(20 * sr);
  for (let i = 10 * sr; i < x.length; i++) x[i] = 0.3 * Math.sin(2 * Math.PI * 440 * i / sr);
  const cv = E.computeLevelCurve([x], sr, -14);
  const silentPart = E.levelDbAt(cv, 2), musicPart = E.levelDbAt(cv, 16);
  assert(Math.abs(silentPart - musicPart) < 0.5, `silence should hold the music level: ${silentPart} vs ${musicPart}`);
});
t('levelDbAt interpolates and clamps', () => {
  const cv = { start: 0.25, step: 0.5, db: [0, 10] };
  assert.strictEqual(E.levelDbAt(cv, 0), 0); assert.strictEqual(E.levelDbAt(cv, 0.5), 5); assert.strictEqual(E.levelDbAt(cv, 99), 10);
});
t('smoothing never makes a loud song blast at a change-over (both directions)', () => {
  const sr = 44100, half = 15 * sr;
  for (const order of [[-26, -8], [-8, -26]]) {
    const x = new Float32Array(half * 2);
    for (let i = 0; i < x.length; i++) x[i] = E.dbToGain(i < half ? order[0] : order[1]) * Math.sin(2 * Math.PI * 997 * i / sr);
    const cv = E.computeLevelCurve([x], sr, -14);
    const y = x.map((v, i) => v * E.dbToGain(E.levelDbAt(cv, i / sr)));
    let worst = -Infinity;
    for (let s = 0; s + 0.4 * sr <= y.length; s += 0.1 * sr) worst = Math.max(worst, E.measureLoudness([y], sr, s, s + 0.4 * sr).lufs);
    assert(worst < -14 + 1.5, `order ${order}: loudest moment ${worst.toFixed(1)} LUFS overshoots`);
  }
});
console.log(`\n${pass} tests passed`);
