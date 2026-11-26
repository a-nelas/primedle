export const MAX_TRIES = 3;
export const SITE_URL = 'https://a-nelas.github.io/primedle/';

/**
 * How many spots the ball reaches either side of the daily number (the bar
 * only holds numbers ending in 1, 3, 7 or 9, see slots.js: about ±100). The
 * closest prime is never more than 7 spots away; the wide margin keeps the
 * screen edge from hinting at the answer and adds plenty of decoys.
 */
export const REACH = 40;

/** Spots off at which the colour is fully red and the score reaches 0%. */
export const FAR = 5;

export const LEVELS = [
  { max: 0, id: 'correct', label: 'Correct', emoji: '🟩' },
  { max: 1, id: 'hot', label: 'Hot', emoji: '🟥' },
  { max: 2, id: 'warm', label: 'Warm', emoji: '🟧' },
  { max: 4, id: 'cool', label: 'Cool', emoji: '🟨' },
  { max: Infinity, id: 'cold', label: 'Cold', emoji: '🟦' },
];

/** d = spots from the guess to the nearest correct prime. */
export function levelFor(d) {
  return LEVELS.find((l) => d <= l.max);
}

/**
 * The hint colour for a drop d spots away from the nearest correct prime: a
 * fade from neon green (spot on) through yellow and orange to red (FAR or
 * more off).
 */
export function hintColor(d) {
  const t = Math.min(1, Math.max(0, d) / FAR);
  const hue = Math.round(130 * (1 - Math.sqrt(t)));
  return `hsl(${hue}, 100%, ${d === 0 ? 58 : 60}%)`;
}

/**
 * Score as a percentage, from how close you got to the prime: 100% on it,
 * then 80, 60, 40, 20 and 0% from FAR spots away (the same scale as the hint
 * colours). Which try it was doesn't matter. It starts at 0% and only grows:
 * the score is your closest drop so far.
 */
export function dropScore(d) {
  return Math.round(100 * Math.max(0, 1 - d / FAR));
}
export function scoreFor(guesses) {
  return guesses.reduce((best, g) => Math.max(best, dropScore(g.d)), 0);
}

export function trend(prevD, d) {
  if (d < prevD) return 'warmer';
  if (d > prevD) return 'colder';
  return 'same';
}

export function shareText({ num, guesses, won }) {
  const score = won ? guesses.length : 'X';
  const squares = guesses.map((g) => levelFor(g.d).emoji).join('');
  return `Primedle #${num} ${score}/${MAX_TRIES}\n${squares}\n${SITE_URL}`;
}
