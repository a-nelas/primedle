import { closestPrimes } from './primes.js';
import { todayKey, yesterdayKey, puzzleNumber, dailyNumber } from './daily.js';
import { MAX_TRIES, levelFor, trend, shareText } from './hints.js';
import { NumberBar } from './bar.js';

const STATE_KEY = 'primedle:state';
const STATS_KEY = 'primedle:stats';
const HELP_KEY = 'primedle:seenHelp';

const store = {
  get(k, fallback) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(k, v) {
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
const num = puzzleNumber(key);
const N = dailyNumber(key);
const targets = closestPrimes(N);
const gap = Math.abs(targets[0] - N);

let state = store.get(STATE_KEY, null);
if (!state || state.key !== key || !Array.isArray(state.guesses)) {
  state = { key, guesses: [], status: 'playing' };
}

const defaultStats = { played: 0, wins: 0, streak: 0, maxStreak: 0, dist: [0, 0, 0], lastWinKey: null };
let stats = { ...defaultStats, ...store.get(STATS_KEY, {}) };
// A streak only survives if the last win was today or yesterday.
if (stats.lastWinKey !== key && stats.lastWinKey !== yesterdayKey(key)) stats.streak = 0;

// ---- UI ------------------------------------------------------------------

const bar = new NumberBar($('bar'), { center: N, onDrop: handleDrop, onHover: showReadout });

function showReadout(v) {
  const live = v !== null;
  $('readout').classList.toggle('live', live);
  if (!live) return;
  const delta = v - N;
  $('readout-value').textContent = String(v);
  $('readout-delta').textContent = delta === 0 ? '' : delta > 0 ? `+${delta}` : `-${-delta}`;
}

$('daily-number').textContent = String(N);
const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
$('puzzle').textContent = `#${num} · ${dateLabel}`;

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

function handleDrop(v) {
  if (state.status !== 'playing') return false;
  if (v === N) {
    toast("That's today's number. It's never prime!");
    return false;
  }
  if (state.guesses.some((g) => g.value === v)) {
    toast(`You already tried ${v}.`);
    return false;
  }
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
  setTimeout(() => $('share-btn').focus({ preventScroll: true }), 50);
}

function hintHTML() {
  const g = state.guesses;
  if (!g.length) return '';
  const last = g[g.length - 1];
  const lvl = levelFor(last.d);
  if (last.d === 0) return `<strong>${last.value}</strong> <span class="chip correct">Correct!</span>`;
  let html = `<strong>${last.value}</strong> is <span class="chip ${lvl.id}">${lvl.label}</span>`;
  if (g.length > 1) {
    const t = trend(g[g.length - 2].d, last.d);
    const word = { warmer: 'warmer', colder: 'colder', same: 'just as close' }[t];
    html += ` <span class="trend">· ${word} than ${g[g.length - 2].value}</span>`;
  }
  return html;
}

function render() {
  const over = state.status !== 'playing';
  const g = state.guesses;

  bar.set({
    markers: g.map((x) => ({ value: x.value, kind: levelFor(x.d).id })),
    answers: over ? targets : [],
    showPrimes: over,
    enabled: !over,
  });

  $('tries').innerHTML = Array.from({ length: MAX_TRIES }, (_, i) => {
    const x = g[i];
    return x ? `<span class="try used ${levelFor(x.d).id}"></span>` : '<span class="try"></span>';
  }).join('');
  $('tries').setAttribute('aria-label', `${g.length} of ${MAX_TRIES} tries used`);

  $('hint').innerHTML = hintHTML();

  $('prompt').textContent = over
    ? 'Green bars mark the primes nearby.'
    : g.length === 0
      ? 'Drag the ball onto the closest prime.'
      : `Try ${g.length + 1} of ${MAX_TRIES}. Drag again.`;

  $('readout-hint').textContent = over ? 'see you tomorrow ✦' : 'drag the ball ↔';

  $('result').hidden = !over;
  if (over) {
    const won = state.status === 'won';
    $('result-title').textContent = won
      ? ['Perfect! 🎉', 'Nice one! 🎉', 'Phew, got it! 🎉'][g.length - 1]
      : 'Out of tries';
    const away = `${gap} away from ${N}`;
    $('result-text').textContent =
      targets.length > 1
        ? `${targets[0]} and ${targets[1]} are both ${away}.`
        : `${targets[0]} is the closest prime, ${away}.`;
  }
}

// ---- share ---------------------------------------------------------------

async function share() {
  const text = shareText({ num, guesses: state.guesses, won: state.status === 'won' });
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try {
      await navigator.share({ text });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast('Result copied to clipboard');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand?.('copy');
    ta.remove();
    toast(ok ? 'Result copied to clipboard' : text);
  }
}
$('share-btn').addEventListener('click', share);

// ---- dialogs -------------------------------------------------------------

function renderStats() {
  $('st-played').textContent = stats.played;
  $('st-win').textContent = stats.played ? Math.round((stats.wins / stats.played) * 100) : 0;
  $('st-streak').textContent = stats.streak;
  $('st-max').textContent = stats.maxStreak;
  const most = Math.max(1, ...stats.dist);
  const todayTry = state.status === 'won' ? state.guesses.length : 0;
  $('st-dist').innerHTML = stats.dist
    .map((n, i) => {
      const pct = Math.max(8, Math.round((n / most) * 100));
      const cls = todayTry === i + 1 ? 'dist-bar today' : 'dist-bar';
      return `<div class="dist-row"><span>${i + 1}</span><span class="${cls}" style="width:${pct}%">${n}</span></div>`;
    })
    .join('');
}

function openDialog(id) {
  const d = $(id);
  if (id === 'stats') renderStats();
  if (!d.open) d.showModal();
}
for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close(); // backdrop click
  });
}
$('help-btn').addEventListener('click', () => openDialog('help'));
$('stats-btn').addEventListener('click', () => openDialog('stats'));

// ---- countdown -----------------------------------------------------------

function tickCountdown() {
  if (todayKey() !== key) {
    location.reload();
    return;
  }
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const s = Math.max(0, Math.floor((next - now) / 1000));
  const p = (n) => String(n).padStart(2, '0');
  $('countdown').textContent = `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}
tickCountdown();
setInterval(tickCountdown, 1000);

// ---- start ---------------------------------------------------------------

render();
if (!store.get(HELP_KEY, false)) {
  store.set(HELP_KEY, true);
  openDialog('help');
}
