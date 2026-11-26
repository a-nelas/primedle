export const MAX_TRIES = 3;
export const SITE_URL = 'https://a-nelas.github.io/primedle/';

/**
 * How far the ball reaches either side of the daily number. The closest prime
 * is never more than 18 away (at 9569, between 9551 and 9587); the wide margin
 * keeps the screen edge from hinting at the answer and adds plenty of decoys.
 */
export const REACH = 40;

export const LEVELS = [
  { max: 0, id: 'correct', label: 'Correct', emoji: '🟩' },
  { max: 2, id: 'hot', label: 'Hot', emoji: '🟥' },
  { max: 5, id: 'warm', label: 'Warm', emoji: '🟧' },
  { max: 10, id: 'cool', label: 'Cool', emoji: '🟨' },
  { max: Infinity, id: 'cold', label: 'Cold', emoji: '🟦' },
];

/** d = distance from the guess to the nearest correct prime. */
export function levelFor(d) {
  return LEVELS.find((l) => d <= l.max);
}

/**
 * The hint colour for a drop d away from the nearest correct prime: a fade
 * from neon green (spot on) through yellow and orange to red (12 or more off).
 */
export function hintColor(d) {
  const t = Math.min(1, Math.max(0, d) / 12);
  const hue = Math.round(130 * (1 - Math.sqrt(t)));
  return `hsl(${hue}, 100%, ${d === 0 ? 58 : 60}%)`;
}

/**
 * Score as a percentage, from how close you got to the prime: 100% on it,
 * dropping evenly to 0% at 12 or more away (the same scale as the hint
 * colours). Which try it was doesn't matter. It starts at 0% and only grows:
 * the score is your closest drop so far.
 */
export function dropScore(d) {
  return Math.round(100 * Math.max(0, 1 - d / 12));
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
