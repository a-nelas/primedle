export const MAX_TRIES = 3;
export const SITE_URL = 'https://a-nelas.github.io/primedle/';

/**
 * How far the ball reaches either side of the daily number. The closest prime
 * is never more than 18 away (at 9569, between 9551 and 9587); the margin
 * keeps the screen edge from hinting at the answer.
 */
export const REACH = 24;

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
 * Score as a percentage. It starts at 0% and only grows: each drop is worth
 * up to TRY_CAP for its try (100, 75, 50), the full amount for a hit and up
 * to half of it for a near miss (less the further off, nothing from 12 away),
 * and the score is the best drop so far. So any win beats any loss.
 */
export const TRY_CAP = [100, 75, 50];
export function dropScore(d, i) {
  const cap = TRY_CAP[i] ?? 0;
  if (d === 0) return cap;
  return Math.round(cap * 0.5 * Math.max(0, 1 - d / 12));
}
export function scoreFor(guesses) {
  return guesses.reduce((best, g, i) => Math.max(best, dropScore(g.d, i)), 0);
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
