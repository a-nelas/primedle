import { closestPrimes } from './primes.js';
import { todayKey, yesterdayKey, dailyNumber } from './daily.js';
import { MAX_TRIES, REACH, hintColor, scoreFor } from './hints.js';
import { NumberBar } from './bar.js';
import * as sfx from './sound.js';

// Game-only build: just the number bar, the readout and the try dots.
// The title, help, hint text, results, sharing and stats dialogs were removed
// for now (see git history); stats are still recorded.

const STATE_KEY = 'primedle:state';
const STATS_KEY = 'primedle:stats';

// Testing: nothing is saved or loaded, so a reload starts today's game over.
// Set back to true for launch.
const SAVE = false;

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

let state = store.get(STATE_KEY, null);
if (!state || state.key !== key || !Array.isArray(state.guesses)) {
  state = { key, guesses: [], status: 'playing' };
}

const defaultStats = { played: 0, wins: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0], lastWinKey: null };
const stats = { ...defaultStats, ...store.get(STATS_KEY, {}) };
if (stats.lastWinKey !== key && stats.lastWinKey !== yesterdayKey(key)) stats.streak = 0;

// ---- game ----------------------------------------------------------------

const bar = new NumberBar($('bar'), { center: N, onDrop: handleDrop, onHover: showReadout, fx: $('fx'), reach: REACH });

function showReadout(v) {
  const live = v !== null;
  $('readout').classList.toggle('live', live);
  if (!live) return;
  const delta = v - N;
  sfx.tick(delta);
  $('readout-value').textContent = String(v);
  $('readout-delta').textContent = delta === 0 ? '' : delta > 0 ? `+${delta}` : `-${-delta}`;
}

function handleDrop(v) {
  if (state.status !== 'playing') return false;
  if (v === N || state.guesses.some((g) => g.value === v)) return false;
  const d = Math.min(...targets.map((t) => Math.abs(v - t)));
  state.guesses.push({ value: v, d });
  if (d === 0) finish(true);
  else if (state.guesses.length >= MAX_TRIES) finish(false);
  store.set(STATE_KEY, state);
  render();
  return true;
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
    const p = Math.min(1, (t - t0) / 600);
    el.innerHTML = `<span>${Math.round(from + (score - from) * p)}%</span>`;
    if (p < 1) scoreAnim = requestAnimationFrame(tick);
  };
  scoreAnim = requestAnimationFrame(tick);
}

// a new number at local midnight
setInterval(() => {
  if (todayKey() !== key) location.reload();
}, 30000);

render();
