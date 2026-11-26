import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrime, closestPrimes } from '../src/primes.js';
import { dailyNumber, puzzleNumber, todayKey, yesterdayKey, MIN, MAX } from '../src/daily.js';
import { levelFor, trend, shareText, hintColor, scoreFor, REACH, FAR } from '../src/hints.js';
import { cleanState } from '../src/state.js';
import { isCandidate, spotOf, numberAt, spotDistance } from '../src/slots.js';

test('isPrime', () => {
  const primes = [2, 3, 5, 7, 11, 13, 97, 101, 7919, 9973];
  const composites = [-7, 0, 1, 4, 9, 15, 25, 49, 91, 100, 7917, 9999];
  for (const p of primes) assert.equal(isPrime(p), true, `${p} is prime`);
  for (const c of composites) assert.equal(isPrime(c), false, `${c} is not prime`);
  assert.equal(isPrime(2.5), false);
});

test('closestPrimes', () => {
  assert.deepEqual(closestPrimes(100), [101]);
  assert.deepEqual(closestPrimes(9), [7, 11]);
  assert.deepEqual(closestPrimes(120), [113, 127]);
  assert.deepEqual(closestPrimes(9999), [10007]);
  // 9569 is the middle of the largest prime gap below 10k (9551..9587).
  assert.deepEqual(closestPrimes(9569), [9551, 9587]);
  assert.deepEqual(closestPrimes(13), [13]);
});

test('closestPrimes agrees with brute force', () => {
  for (let n = MIN; n <= MAX; n++) {
    const res = closestPrimes(n);
    let best = Infinity;
    for (let k = n - 40; k <= n + 40; k++) if (isPrime(k)) best = Math.min(best, Math.abs(k - n));
    for (const p of res) {
      assert.equal(isPrime(p), true);
      assert.equal(Math.abs(p - n), best);
    }
  }
});

test('dailyNumber is deterministic, in range, and never prime', () => {
  assert.equal(dailyNumber('2026-11-25'), dailyNumber('2026-11-25'));
  const seen = new Set();
  let key = '2027-12-31';
  for (let i = 0; i < 800; i++) {
    const n = dailyNumber(key);
    assert.ok(n >= MIN && n <= MAX, `${key} -> ${n}`);
    assert.equal(isPrime(n), false);
    seen.add(n);
    key = yesterdayKey(key);
  }
  assert.ok(seen.size > 600, 'numbers vary from day to day');
});

test('dates', () => {
  assert.equal(puzzleNumber('2026-11-25'), 1);
  assert.equal(puzzleNumber('2026-12-25'), 31);
  assert.equal(puzzleNumber('2027-11-25'), 366);
  assert.equal(yesterdayKey('2027-01-01'), '2026-12-31');
  assert.equal(yesterdayKey('2028-03-01'), '2028-02-29');
  assert.equal(todayKey(new Date(2026, 0, 5)), '2026-01-05');
});

test('hint levels and trend', () => {
  assert.equal(levelFor(0).id, 'correct');
  assert.equal(levelFor(1).id, 'hot');
  assert.equal(levelFor(2).id, 'warm');
  assert.equal(levelFor(3).id, 'cool');
  assert.equal(levelFor(4).id, 'cool');
  assert.equal(levelFor(5).id, 'cold');
  assert.equal(trend(8, 3), 'warmer');
  assert.equal(trend(3, 8), 'colder');
  assert.equal(trend(4, 4), 'same');
});

test('shareText hides numbers', () => {
  const text = shareText({ num: 4, won: true, guesses: [{ value: 1233, d: 2 }, { value: 1231, d: 0 }] });
  assert.equal(text, 'Primedle #4 2/3\n🟧🟩\nhttps://a-nelas.github.io/primedle/');
  const lost = shareText({ num: 4, won: false, guesses: [{ d: 6 }, { d: 3 }, { d: 1 }] });
  assert.match(lost, /^Primedle #4 X\/3\n🟦🟨🟥\n/);
});

test('hint colour fades from green (spot on) to red (far off)', () => {
  const hue = (d) => Number(/hsl\((\d+)/.exec(hintColor(d))[1]);
  assert.equal(hue(0), 130);
  assert.equal(hue(FAR), 0);
  assert.equal(hue(40), 0);
  for (let d = 1; d <= FAR; d++) assert.ok(hue(d) < hue(d - 1), `hue drops at ${d}`);
});

test('score comes from the closest drop to the prime, whatever the try', () => {
  assert.equal(scoreFor([]), 0);
  assert.equal(scoreFor([{ d: 0 }]), 100);
  assert.equal(scoreFor([{ d: 3 }, { d: 7 }, { d: 0 }]), 100); // a hit on try 3 is still 100%
  assert.equal([1, 2, 3, 4, 5].map((d) => scoreFor([{ d }])).join(), '80,60,40,20,0');
  assert.equal(scoreFor([{ d: 1 }, { d: 4 }]), 80); // never shrinks
  assert.equal(scoreFor([{ d: 30 }, { d: 5 }, { d: 9 }]), 0);
});

test('spots: N, then the numbers ending in 1, 3, 7 or 9 either side', () => {
  assert.deepEqual([-2, -1, 0, 1, 2].map((k) => numberAt(2891, k)), [2887, 2889, 2891, 2893, 2897]);
  assert.deepEqual([-1, 0, 1].map((k) => numberAt(2895, k)), [2893, 2895, 2897]); // N keeps its spot
  assert.equal(spotOf(2891, 2890), null);
  assert.equal(spotOf(2891, 2895), null);
  assert.equal(spotDistance(2891, 2893, 2887), 3); // N's spot counts as a step
  for (let n = MIN; n <= MAX; n += 7) {
    for (let k = -REACH; k <= REACH; k++) {
      const v = numberAt(n, k);
      assert.equal(spotOf(n, v), k, `N=${n} k=${k}`);
      if (k) assert.ok(isCandidate(v) && v > 0);
    }
  }
});

test('every prime here ends in 1, 3, 7 or 9, so it is on the bar', () => {
  for (let n = MIN; n <= MAX + 40; n++) if (isPrime(n)) assert.ok(isCandidate(n), `${n}`);
});

test('every answer is well within reach of the ball', () => {
  let near = 0; // the nearer answer, in spots
  let any = 0; // either answer, when two primes tie
  for (let n = MIN; n <= MAX; n++) {
    if (isPrime(n)) continue;
    const spots = closestPrimes(n).map((p) => Math.abs(spotOf(n, p)));
    near = Math.max(near, Math.min(...spots));
    any = Math.max(any, ...spots);
  }
  assert.equal(near, 7);
  assert.equal(any, 8);
  assert.ok(REACH >= any * 4);
});

// a day with N = 2891 (= 7·7·59), whose closest prime is 2887, 4 below
const DAY = { key: '2026-11-26', N: 2891, targets: [2887], reach: REACH, maxTries: 3 };

test('saved game: another day or nothing saved starts fresh', () => {
  const fresh = { key: DAY.key, guesses: [], status: 'playing' };
  assert.deepEqual(cleanState(null, DAY), fresh);
  assert.deepEqual(cleanState('junk', DAY), fresh);
  assert.deepEqual(cleanState({ key: '2026-11-25', guesses: [{ value: 2890 }], status: 'playing' }, DAY), fresh);
});

test('saved game: guesses kept, distances and status recomputed', () => {
  const s = cleanState({ key: DAY.key, guesses: [{ value: 2893, d: 0 }], status: 'won' }, DAY);
  assert.deepEqual(s.guesses, [{ value: 2893, d: 3 }]); // a tampered d doesn't count
  assert.equal(s.status, 'playing');
});

test('saved game: junk guesses are dropped', () => {
  const far = numberAt(2891, REACH + 1);
  const guesses = [{ value: 2891 }, { value: 2890 }, { value: 2895 }, { value: 2880.5 }, { value: far }, { value: 'x' }, null, { value: 2889 }, { value: 2889 }];
  const s = cleanState({ key: DAY.key, guesses }, DAY);
  assert.deepEqual(s.guesses, [{ value: 2889, d: 1 }]);
});

test('saved game: a finished game comes back finished', () => {
  const won = cleanState({ key: DAY.key, guesses: [{ value: 2897 }, { value: 2887 }, { value: 2893 }] }, DAY);
  assert.equal(won.status, 'won');
  assert.equal(won.guesses.length, 2); // nothing counts after the win
  const lost = cleanState({ key: DAY.key, guesses: [{ value: 2881 }, { value: 2883 }, { value: 2893 }, { value: 2897 }] }, DAY);
  assert.equal(lost.status, 'lost');
  assert.equal(lost.guesses.length, 3);
});

test('facts: the answer and the daily number', async () => {
  const { primeFacts, numberFacts, factorize } = await import('../src/facts.js');
  assert.deepEqual(primeFacts(2887), ['418th prime', 'next prime: 2897']);
  assert.deepEqual(numberFacts(2891), ['7² × 59']); // nothing stands out: just the factors
  assert.equal(numberFacts(2862)[1], '= 53 × 54');
  assert.equal(numberFacts(7777)[1], 'all one digit');
  assert.equal(primeFacts(8191)[1], '2¹³ − 1, Mersenne');
  assert.equal(primeFacts(1009)[1], 'smallest 4-digit prime');
  assert.equal(primeFacts(7919)[0], '1000th prime');
  assert.equal(numberFacts(1729)[1], '1³+12³ = 9³+10³');
  assert.equal(numberFacts(6174)[1], "Kaprekar's constant");
  assert.equal(numberFacts(1296)[1], '= 6⁴');
  for (let n = MIN; n <= MAX; n++) {
    const lines = isPrime(n) ? primeFacts(n) : numberFacts(n);
    assert.ok(lines.length >= 1 && lines.length <= 2, `${n}`);
    for (const l of lines) assert.ok(l.length <= 24, `${n}: ${l}`);
    if (!isPrime(n)) assert.equal(factorize(n).reduce((m, [q, e]) => m * q ** e, 1), n);
  }
});
