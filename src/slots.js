// The spots on the bar. Above 5, every prime ends in 1, 3, 7 or 9, so those
// are the only numbers the bar offers: spot 0 is the daily number N (whatever
// it ends in), and ±1, ±2, … are the next numbers ending in 1, 3, 7 or 9 to
// its right and left. For N = 2891: … 2887 2889 [2891] 2893 2897 …

const ENDS = [1, 3, 7, 9];

/** Whether v ends in 1, 3, 7 or 9 (the only endings a prime above 5 can have). */
export function isCandidate(v) {
  return Number.isInteger(v) && ENDS.includes(((v % 10) + 10) % 10);
}

/** How many candidates there are from 0 up to x (x ≥ 0). */
function upTo(x) {
  const r = x % 10;
  return Math.floor(x / 10) * 4 + ENDS.filter((e) => e <= r).length;
}

/** The spot of number v on N's bar, or null if v isn't on it. */
export function spotOf(N, v) {
  if (v === N) return 0;
  if (!isCandidate(v)) return null;
  // the candidates in (N, v], or minus those in [v, N)
  return v > N ? upTo(v) - upTo(N) : -(upTo(N - 1) - upTo(v - 1));
}

/** The number at spot k on N's bar (k = 0 is N itself). */
export function numberAt(N, k) {
  if (k === 0) return N;
  const s = Math.sign(k);
  let v = N;
  for (let n = 0; n < Math.abs(k); ) {
    v += s;
    if (isCandidate(v)) n++;
  }
  return v;
}

/** How many spots apart two numbers on N's bar are. */
export function spotDistance(N, a, b) {
  return Math.abs(spotOf(N, a) - spotOf(N, b));
}
