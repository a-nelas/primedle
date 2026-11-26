import { spotOf, spotDistance } from './slots.js';

/**
 * Today's game, rebuilt from what was saved (or fresh if nothing usable was).
 *
 * Only a game from today counts. Guesses are checked (spots on today's bar
 * within reach, not N itself, no repeats, at most maxTries), their distances
 * (in spots) are recomputed from today's answers rather than trusted, and so
 * is the status.
 */
export function cleanState(saved, { key, N, targets, reach, maxTries }) {
  const fresh = { key, guesses: [], status: 'playing' };
  if (!saved || typeof saved !== 'object' || saved.key !== key || !Array.isArray(saved.guesses)) return fresh;
  const guesses = [];
  for (const g of saved.guesses) {
    const v = g && g.value;
    const k = Number.isInteger(v) ? spotOf(N, v) : null;
    if (k === null || k === 0 || Math.abs(k) > reach) continue;
    if (guesses.some((x) => x.value === v)) continue;
    const d = Math.min(...targets.map((t) => spotDistance(N, v, t)));
    guesses.push({ value: v, d });
    if (d === 0 || guesses.length >= maxTries) break; // nothing counts after the game ended
  }
  const won = guesses.some((g) => g.d === 0);
  const status = won ? 'won' : guesses.length >= maxTries ? 'lost' : 'playing';
  return { key, guesses, status };
}
