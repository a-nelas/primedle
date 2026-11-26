// 8-bit sound effects, synthesized with Web Audio (no files): square-wave
// blips and a crunchy, bit-crushed noise crash.
//
// Browsers only allow sound after a click, tap or key press, so `unlock()`
// is called from those; until then every effect is silently skipped.

let ctx = null;
let out = null;
let noise = null;
let lastTick = 0;

const VOLUME = 0.16;

export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    out = ctx.createGain();
    out.gain.value = VOLUME;
    out.connect(ctx.destination);
    noise = crunchyNoise(0.5);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
}

const ready = () => ctx && ctx.state === 'running';

/** Noise held for a few samples at a time and quantized to 8 levels: a lo-fi, 8-bit hiss. */
function crunchyNoise(seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  const hold = Math.max(1, Math.round(ctx.sampleRate / 11025)); // ~11 kHz sample-and-hold
  let v = 0;
  for (let i = 0; i < len; i++) {
    if (i % hold === 0) v = Math.round((Math.random() * 2 - 1) * 4) / 4;
    d[i] = v;
  }
  return buf;
}

/** A square (or triangle) tone sliding from f0 to f1 with a short decay. */
function tone(type, f0, f1, dur, gain, at = ctx.currentTime, lowpass = 0) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, at + dur);
  g.gain.setValueAtTime(gain, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  if (lowpass) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = lowpass;
    o.connect(lp).connect(g).connect(out);
  } else {
    o.connect(g).connect(out);
  }
  o.start(at);
  o.stop(at + dur + 0.02);
}

/**
 * A short blip each time the number under the ball changes. Its pitch follows
 * the offset from the daily number (lower to the left, higher to the right,
 * an octave each way), which says nothing about where the answer is.
 */
export function tick(offset) {
  if (!ready()) return;
  const now = ctx.currentTime;
  if (now - lastTick < 0.025) return; // a fast sweep stays a buzz, not a pile-up
  lastTick = now;
  const semis = Math.round(Math.max(-24, Math.min(24, offset)) / 2);
  const f = 247 * 2 ** (semis / 12); // around B3: a low, bassy blip
  tone('square', f, f * 0.94, 0.045, 0.55, now, 1500); // softened top end
}

/** The slam: a falling square-wave zip. */
export function fall(dur = 0.12) {
  if (!ready()) return;
  tone('square', 1100, 140, dur, 0.22);
}

/** The impact: a bit-crushed noise burst over a deep square thump. */
export function crash() {
  if (!ready()) return;
  const now = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(6000, now);
  lp.frequency.exponentialRampToValueAtTime(300, now + 0.5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(1, now);
  g.gain.setValueAtTime(1, now + 0.05); // hold the hit, then let it crumble away
  g.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  src.connect(lp).connect(g).connect(out);
  src.start(now);
  src.stop(now + 0.5);
  tone('square', 160, 36, 0.32, 0.8, now); // the thump
  tone('square', 80, 28, 0.45, 0.45, now + 0.03); // and its rumble
}
