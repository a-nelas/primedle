// A small 8-bit loop that plays softly behind the game, synthesized with Web
// Audio like the sound effects (no files).
//
// A minor, 88 bpm, 16 bars (about 44 s), then it loops:
//   bars 1-8   triangle bass and a quiet pulse-wave arpeggio
//   bars 9-16  the same, with a lead melody and a little echo on top
// Chords, two bars per line of the melody: Am F C G | Am F G E.
//
// It starts on the first click or tap (browsers allow sound only after one)
// and fades out while the tab is hidden.

import { context, onUnlock } from './sound.js';

const BPM = 88;
const S = 60 / BPM / 4; // one 16th note, in seconds
const BARS = 16;
const STEPS = BARS * 16;
const LEVEL = 0.75; // the whole song, under the effects' master volume
const LOOKAHEAD = 1.2; // s scheduled ahead (timers get coarse in the background)

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// one chord per bar, repeated for both halves: root (bass) and arpeggio tones
const CHORDS = [
  { root: 45, arp: [69, 72, 76, 81] }, // Am
  { root: 41, arp: [65, 69, 72, 77] }, // F
  { root: 48, arp: [67, 72, 76, 79] }, // C
  { root: 43, arp: [67, 71, 74, 79] }, // G
  { root: 45, arp: [69, 72, 76, 81] }, // Am
  { root: 41, arp: [65, 69, 72, 77] }, // F
  { root: 43, arp: [67, 71, 74, 79] }, // G
  { root: 40, arp: [64, 68, 71, 76] }, // E
];
const ARP = [0, 1, 2, 1, 3, 2, 1, 2, 0, 1, 2, 3, 2, 1, 2, 1];

// the lead, in 8th notes: a MIDI note, or _ to hold the one before, or 0 to rest
const _ = null;
const MELODY = [
  [76, _, _, 72, 69, _, 72, _],
  [74, _, 72, _, 69, _, _, 0],
  [67, _, 72, _, 76, _, 79, _],
  [77, _, 76, _, 74, _, _, 0],
  [76, _, 81, _, 79, 76, _, _],
  [77, _, 76, _, 72, _, 69, _],
  [71, _, 74, _, 79, _, 77, _],
  [76, _, _, _, 68, _, 71, _],
];

let bus = null; // { gain, lead }: the song's volume and the lead's echo send
let pulse = null;
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

/** The song's mixer: volume → soft lowpass → out, plus an echo for the lead. */
function makeBus(ctx, out) {
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2600; // keep it mellow behind the game
  gain.connect(lp).connect(out);
  // the lead's echo: a dotted-8th delay with a little feedback
  const lead = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = S * 3;
  const fb = ctx.createGain();
  fb.gain.value = 0.3;
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  lead.connect(gain);
  lead.connect(delay);
  delay.connect(fb).connect(delay);
  delay.connect(wet).connect(gain);
  return { gain, lead };
}

/** One note with a quick attack and a decay. */
function note(ctx, dest, { type, wave, midi, t, dur, gain, release = 0.04 }) {
  const o = ctx.createOscillator();
  if (wave) o.setPeriodicWave(wave);
  else o.type = type;
  o.frequency.value = mtof(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.006);
  g.gain.exponentialRampToValueAtTime(gain * 0.45, t + dur);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
  o.connect(g).connect(dest);
  o.start(t);
  o.stop(t + dur + release + 0.02);
}

/** Everything that sounds on step i (16ths, 0 … STEPS-1) at time t. */
export function playStep(ctx, dests, wave, i, t) {
  const bar = Math.floor(i / 16) % BARS;
  const s = i % 16;
  const chord = CHORDS[bar % 8];
  // bass: 8ths, root and its octave
  if (s % 2 === 0) {
    const m = chord.root + (s % 4 === 2 ? 12 : 0);
    note(ctx, dests.main, { type: 'triangle', midi: m, t, dur: S * 1.5, gain: 0.35 });
  }
  // arpeggio: every 16th, short and quiet
  note(ctx, dests.main, { wave, midi: chord.arp[ARP[s]], t, dur: S * 0.6, gain: 0.08, release: 0.03 });
  // lead, in the second half
  if (bar >= 8 && s % 2 === 0) {
    const line = MELODY[bar - 8];
    const k = s / 2;
    const m = line[k];
    if (m) {
      let len = 1;
      while (k + len < 8 && line[k + len] === null) len++;
      note(ctx, dests.lead, { type: 'square', midi: m, t, dur: len * 2 * S * 0.9, gain: 0.15, release: 0.08 });
    }
  }
}

function schedule() {
  const a = context();
  if (!a || !bus) return;
  while (nextT < a.ctx.currentTime + LOOKAHEAD) {
    playStep(a.ctx, { main: bus.gain, lead: bus.lead }, pulse, step, nextT);
    nextT += S;
    step = (step + 1) % STEPS;
  }
}

function start() {
  const a = context();
  if (!a || timer || document.hidden) return;
  const { ctx, out } = a;
  if (!bus) {
    bus = makeBus(ctx, out);
    pulse = pulseWave(ctx);
  }
  const now = ctx.currentTime;
  bus.gain.gain.cancelScheduledValues(now);
  bus.gain.gain.setValueAtTime(bus.gain.gain.value, now);
  bus.gain.gain.linearRampToValueAtTime(LEVEL, now + 2); // fade in
  // carry on where it left off (notes already queued are never doubled)
  nextT = Math.max(nextT, now + 0.1);
  schedule();
  timer = setInterval(schedule, 200);
}

function stop() {
  clearInterval(timer);
  timer = 0;
  const a = context();
  if (!a || !bus) return;
  const now = a.ctx.currentTime;
  bus.gain.gain.cancelScheduledValues(now);
  bus.gain.gain.setValueAtTime(bus.gain.gain.value, now);
  bus.gain.gain.linearRampToValueAtTime(0, now + 0.4);
}

onUnlock(start);
document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
