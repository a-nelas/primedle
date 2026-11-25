export const MAX_TRIES = 3;
export const SITE_URL = 'https://a-nelas.github.io/primedle/';

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
