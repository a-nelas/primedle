import { closestPrimes } from './primes.js';
import { todayKey, yesterdayKey, dailyNumber } from './daily.js';
import { MAX_TRIES, REACH, hintColor, scoreFor } from './hints.js';
import { NumberBar } from './bar.js';
import { cleanState } from './state.js';
import { numberAt, spotOf, spotDistance } from './slots.js';
import * as sfx from './sound.js';
import * as music from './music.js';

// Game-only build: just the number bar, the readout and the try dots.
// The title, help, hint text, results, sharing and stats dialogs were removed
// for now (see git history); stats are still recorded.

const STATE_KEY = 'primedle:state';
const STATS_KEY = 'primedle:stats';

// Today's progress is saved in this browser, so a reload carries on (or shows
// the finished game) instead of giving a fresh set of tries.
const SAVE = true;

const store = {
  get(k, fallback) {
    if (!SAVE) return fallback;
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(k, v) {
    if (!SAVE) return;
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage unavailable: play continues without saving */
    }
  },
};

const $ = (id) => document.getElementById(id);

// ---- today's puzzle ------------------------------------------------------

const key = todayKey();
const N = dailyNumber(key);
const targets = closestPrimes(N);

const state = cleanState(store.get(STATE_KEY, null), { key, N, targets, reach: REACH, maxTries: MAX_TRIES });

const defaultStats = { played: 0, wins: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0], lastWinKey: null };
const stats = { ...defaultStats, ...store.get(STATS_KEY, {}) };
if (stats.lastWinKey !== key && stats.lastWinKey !== yesterdayKey(key)) stats.streak = 0;

// ---- game ----------------------------------------------------------------

const bar = new NumberBar($('bar'), {
  center: N,
  numberAt: (k) => numberAt(N, k),
  spotOf: (v) => spotOf(N, v),
  onDrop: handleDrop,
  onHover: showReadout,
  fx: $('fx'),
  reach: REACH,
});

function showReadout(v) {
  const live = v !== null;
  $('readout').classList.toggle('live', live);
  if (!live) return;
  const delta = v - N; // shown as the real difference
  sfx.tick(spotOf(N, v)); // pitched by spot: each one an even step
  $('readout-value').textContent = String(v);
  $('readout-delta').textContent = delta === 0 ? '' : delta > 0 ? `+${delta}` : `-${-delta}`;
}

function handleDrop(v) {
  if (state.status !== 'playing') return false;
  if (v === N) return false;
  // the same number again: show its bar once more, but it costs no try
  const again = state.guesses.find((g) => g.value === v);
  if (again) return hintColor(again.d);
  const d = Math.min(...targets.map((t) => spotDistance(N, v, t))); // in spots
  state.guesses.push({ value: v, d });
  if (d === 0) finish(true);
  else if (state.guesses.length >= MAX_TRIES) finish(false);
  store.set(STATE_KEY, state);
  render();
  return hintColor(d); // accepted: the bar takes this colour
}

function finish(won) {
  state.status = won ? 'won' : 'lost';
  stats.played += 1;
  if (won) {
    stats.wins += 1;
    stats.dist[state.guesses.length - 1] += 1;
    stats.streak = stats.lastWinKey === yesterdayKey(key) ? stats.streak + 1 : 1;
    stats.lastWinKey = key;
  } else {
    stats.streak = 0;
  }
  stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
  store.set(STATS_KEY, stats);
}

function render() {
  const over = state.status !== 'playing';
  const g = state.guesses;
  // the drops are the only hints: each coloured from red (far) to green (spot on)
  bar.set({
    markers: g.map((x) => ({ value: x.value, color: hintColor(x.d) })),
    enabled: !over,
    answers: over ? targets : undefined, // revealed once the game is over
  });
  showScore(scoreFor(g), over);
  $('tries').innerHTML = Array.from({ length: MAX_TRIES }, (_, i) => {
    const x = g[i];
    if (!x) return '<span class="try"></span>';
    const c = hintColor(x.d);
    return `<span class="try used" style="background:${c};box-shadow:0 0 10px ${c}"></span>`;
  }).join('');
  $('tries').setAttribute('aria-label', `${g.length} of ${MAX_TRIES} tries used`);
}

// ---- score: a big faded percentage in the background ----------------------

let shownScore = null;
let scoreAnim = 0;
function showScore(score, over) {
  const el = $('score');
  el.classList.toggle('final', over);
  el.setAttribute('aria-label', `Score ${score} percent`);
  cancelAnimationFrame(scoreAnim);
  const from = shownScore ?? score;
  shownScore = score;
  if (from === score) {
    el.innerHTML = `<span>${score}%</span>`;
    return;
  }
  // count up to the new score
  const t0 = performance.now();
  const tick = (t) => {
    // a frame's timestamp can come from just before t0: never count below `from`
    const p = Math.min(1, Math.max(0, (t - t0) / 600));
    el.innerHTML = `<span>${Math.round(from + (score - from) * p)}%</span>`;
    if (p < 1) scoreAnim = requestAnimationFrame(tick);
  };
  scoreAnim = requestAnimationFrame(tick);
}

// ---- music on/off: the speaker button, top right ---------------------------

const musicBtn = $('music');
function showMusic() {
  musicBtn.classList.toggle('muted', !music.isOn());
  musicBtn.setAttribute('aria-pressed', String(music.isOn()));
}
// keep the press away from the game (a click here is not a drop)
for (const t of ['pointerdown', 'pointerup']) musicBtn.addEventListener(t, (e) => e.stopPropagation());
musicBtn.addEventListener('click', () => {
  music.setOn(!music.isOn());
  showMusic();
});
showMusic();
// it brightens and glows as the mouse comes close (0 far … 1 on it)
window.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse') return;
  const r = musicBtn.getBoundingClientRect();
  const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
  const near = Math.min(1, Math.max(0, 1 - (d - 16) / 140)) ** 2;
  musicBtn.style.setProperty('--near', near.toFixed(3));
}, { passive: true });
document.documentElement.addEventListener('pointerleave', () => musicBtn.style.setProperty('--near', '0'));

// another tab played: pick up its progress, so tries can't be doubled up
window.addEventListener('storage', (e) => {
  if (SAVE && e.key === STATE_KEY && e.newValue !== JSON.stringify(state)) location.reload();
});

// a new number at local midnight, but a game in progress gets finished first
setInterval(() => {
  if (todayKey() !== key && (state.status !== 'playing' || state.guesses.length === 0)) location.reload();
}, 30000);

render();
