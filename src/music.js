// The background track: hype, neon-punk EDM, synthesized with Web Audio like
// the sound effects (no files).
//
// E minor, 128 bpm, 16 bars (30 s), then it loops:
//   bars 1-4   kick, offbeat hats, driving saw bass, pulse arpeggio
//   bars 5-8   + claps, ending in a snare roll into the drop
//   bars 9-16  the drop: + a detuned saw lead with echo and busier hats
// Chords, one per bar (both halves): Em C G D | Em C D B.
// Everything but the kick ducks on each beat (the EDM "pump").
//
// It starts on the first click or tap (browsers allow sound only after one),
// fades out while the tab is hidden, and the speaker button turns it off
// (remembered in this browser).

import { context, onUnlock } from './sound.js';

const BPM = 128;
const S = 60 / BPM / 4; // one 16th note, in seconds
const BARS = 16;
const STEPS = BARS * 16;
const LEVEL = 0.6; // the whole track, under the effects' master volume
const LOOKAHEAD = 1.2; // s scheduled ahead (timers get coarse in the background)
const STORE = 'primedle:music';

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// one chord per bar: bass root and arpeggio tones
const CHORDS = [
  { root: 40, arp: [64, 67, 71, 76] }, // Em
  { root: 36, arp: [64, 67, 72, 76] }, // C
  { root: 43, arp: [67, 71, 74, 79] }, // G
  { root: 38, arp: [66, 69, 74, 78] }, // D
  { root: 40, arp: [64, 67, 71, 76] }, // Em
  { root: 36, arp: [64, 67, 72, 76] }, // C
  { root: 38, arp: [66, 69, 74, 78] }, // D
  { root: 35, arp: [66, 71, 75, 78] }, // B
];
const ARP = [0, 1, 2, 3, 2, 1, 2, 3, 0, 1, 2, 3, 3, 2, 1, 2];

// the lead, in 8th notes: a MIDI note, _ to hold the one before, 0 to rest
const _ = null;
const LEAD = [
  [76, _, 76, 74, 76, _, 79, _],
  [76, _, 74, _, 72, _, 71, _],
  [74, _, 74, 71, 74, _, 79, _],
  [78, _, 76, _, 74, _, 0, _],
  [76, _, 76, 74, 76, _, 83, _],
  [81, _, 79, _, 76, _, 72, _],
  [78, _, 79, _, 81, _, 78, _],
  [78, _, _, _, 75, _, 71, _],
];

let enabled = true;
try {
  enabled = localStorage.getItem(STORE) !== 'off';
} catch {}

let mix = null; // { bus, duck, lead, noise, pulse }
let timer = 0;
let nextT = 0;
let step = 0;

/** A 25% pulse wave: the thinner, buzzier NES-style square. */
function pulseWave(ctx) {
  const n = 32;
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let k = 1; k < n; k++) {
    re[k] = Math.sin(2 * Math.PI * k * 0.25) / (Math.PI * k);
    im[k] = (1 - Math.cos(2 * Math.PI * k * 0.25)) / (Math.PI * k);
  }
  return ctx.createPeriodicWave(re, im);
}

function whiteNoise(ctx) {
  const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * The mixer: bus (volume) → lowpass → out. The kick goes straight to the
 * bus; everything else goes through `duck`, which dips on each beat. The
 * lead also feeds a dotted-8th echo.
 */
export function makeMix(ctx, out) {
  const bus = ctx.createGain();
  bus.gain.value = 0;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 5200; // bright, but not harsh behind the game
  bus.connect(lp).connect(out);
  const duck = ctx.createGain();
  duck.connect(bus);
  const lead = ctx.createGain();
  lead.connect(duck);
  const delay = ctx.createDelay(1);
  delay.delayTime.value = S * 3;
  const fb = ctx.createGain();
  fb.gain.value = 0.32;
  const wet = ctx.createGain();
  wet.gain.value = 0.3;
  lead.connect(delay);
  delay.connect(fb).connect(delay);
  delay.connect(wet).connect(duck);
  return { bus, duck, lead, noise: whiteNoise(ctx), pulse: pulseWave(ctx) };
}

function env(g, t, peak, dur, attack = 0.004) {
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}

function kick(ctx, dest, t, gain) {
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(165, t);
  o.frequency.exponentialRampToValueAtTime(42, t + 0.11);
  const g = ctx.createGain();
  env(g, t, gain, 0.32, 0.002);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + 0.34);
}

function noiseHit(ctx, dest, buf, t, { type, freq, q = 1, dur, gain }) {
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, gain, dur, 0.001);
  src.connect(f).connect(g).connect(dest);
  src.start(t, Math.random() * 0.5);
  src.stop(t + dur + 0.02);
}

function synth(ctx, dest, { type, wave, midi, t, dur, gain, cutoff = 0, detune = 0, release = 0.03 }) {
  // held notes: a quick attack, easing to about half, then a short release
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(gain * 0.55, t + dur);
  g.gain.linearRampToValueAtTime(0, t + dur + release);
  let node = g;
  if (cutoff) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff * 2, t);
    f.frequency.exponentialRampToValueAtTime(cutoff, t + dur * 0.6); // a little "pluck"
    f.connect(g);
    node = f;
  }
  g.connect(dest);
  for (const cents of detune ? [-detune, detune] : [0]) {
    const o = ctx.createOscillator();
    if (wave) o.setPeriodicWave(wave);
    else o.type = type;
    o.frequency.value = mtof(midi);
    o.detune.value = cents;
    o.connect(node);
    o.start(t);
    o.stop(t + dur + release + 0.02);
  }
}

/** Everything that sounds on step i (16ths, 0 … STEPS-1) at time t. */
export function playStep(ctx, m, i, t) {
  const bar = Math.floor(i / 16) % BARS;
  const s = i % 16;
  const chord = CHORDS[bar % 8];
  const drop = bar >= 8;

  // four on the floor, and the pump: the rest of the mix dips on each beat
  if (s % 4 === 0) {
    kick(ctx, m.bus, t, 0.8);
    m.duck.gain.setValueAtTime(0.3, t);
    m.duck.gain.setTargetAtTime(1, t + 0.02, 0.055);
  }
  // hats: offbeat 8ths, plus quiet 16ths in the drop
  if (s % 4 === 2) noiseHit(ctx, m.duck, m.noise, t, { type: 'highpass', freq: 7500, dur: 0.06, gain: 0.16 });
  else if (drop && s % 2 === 1) noiseHit(ctx, m.duck, m.noise, t, { type: 'highpass', freq: 9000, dur: 0.03, gain: 0.06 });
  // claps on 2 and 4 from bar 5, and a snare roll rising into the drop
  if (bar >= 4 && (s === 4 || s === 12)) noiseHit(ctx, m.duck, m.noise, t, { type: 'bandpass', freq: 1700, q: 0.9, dur: 0.14, gain: 0.42 });
  if (bar === 7 && s >= 8) noiseHit(ctx, m.duck, m.noise, t, { type: 'bandpass', freq: 1500 + s * 60, q: 0.9, dur: 0.07, gain: 0.08 + (s - 8) * 0.03 });
  // bass: gritty saw 16ths between the kicks, root and octave
  if (s % 4 !== 0) {
    const midi = chord.root + (s % 4 === 2 ? 12 : 0);
    synth(ctx, m.duck, { type: 'sawtooth', midi, t, dur: S * 0.85, gain: 0.2, cutoff: 650 });
  }
  // arpeggio: every 16th, a pulse-wave pluck
  synth(ctx, m.duck, { wave: m.pulse, midi: chord.arp[ARP[s]], t, dur: S * 0.7, gain: drop ? 0.075 : 0.06, cutoff: 2400 });
  // lead, in the drop: two detuned saws
  if (drop && s % 2 === 0) {
    const line = LEAD[bar - 8];
    const k = s / 2;
    const midi = line[k];
    if (midi) {
      let len = 1;
      while (k + len < 8 && line[k + len] === null) len++;
      synth(ctx, m.lead, { type: 'sawtooth', midi, t, dur: len * 2 * S * 0.92, gain: 0.1, cutoff: 3200, detune: 9, release: 0.06 });
    }
  }
}

function schedule() {
  const a = context();
  if (!a || !mix) return;
  while (nextT < a.ctx.currentTime + LOOKAHEAD) {
    playStep(a.ctx, mix, step, nextT);
    nextT += S;
    step = (step + 1) % STEPS;
  }
}

function start() {
  const a = context();
  if (!a || timer || !enabled || document.hidden) return;
  const { ctx, out } = a;
  if (!mix) mix = makeMix(ctx, out);
  const now = ctx.currentTime;
  mix.bus.gain.cancelScheduledValues(now);
  mix.bus.gain.setValueAtTime(mix.bus.gain.value, now);
  mix.bus.gain.linearRampToValueAtTime(LEVEL, now + 1.5); // fade in
  // carry on where it left off (notes already queued are never doubled)
  nextT = Math.max(nextT, now + 0.1);
  schedule();
  timer = setInterval(schedule, 200);
}

function stop() {
  clearInterval(timer);
  timer = 0;
  const a = context();
  if (!a || !mix) return;
  const now = a.ctx.currentTime;
  mix.bus.gain.cancelScheduledValues(now);
  mix.bus.gain.setValueAtTime(mix.bus.gain.value, now);
  mix.bus.gain.linearRampToValueAtTime(0, now + 0.4);
}

export const isOn = () => enabled;

export function setOn(on) {
  enabled = on;
  try {
    localStorage.setItem(STORE, on ? 'on' : 'off');
  } catch {}
  if (on) start();
  else stop();
}

onUnlock(start);
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
