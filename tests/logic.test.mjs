import test from 'node:test';
import assert from 'node:assert/strict';
import { isPrime, closestPrimes } from '../src/primes.js';
import { dailyNumber, puzzleNumber, todayKey, yesterdayKey, MIN, MAX } from '../src/daily.js';
import { levelFor, trend, shareText } from '../src/hints.js';

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
  assert.equal(levelFor(2).id, 'hot');
  assert.equal(levelFor(3).id, 'warm');
  assert.equal(levelFor(5).id, 'warm');
  assert.equal(levelFor(6).id, 'cool');
  assert.equal(levelFor(10).id, 'cool');
  assert.equal(levelFor(11).id, 'cold');
  assert.equal(trend(8, 3), 'warmer');
  assert.equal(trend(3, 8), 'colder');
  assert.equal(trend(4, 4), 'same');
});

test('shareText hides numbers', () => {
  const text = shareText({ num: 4, won: true, guesses: [{ value: 1234, d: 4 }, { value: 1231, d: 0 }] });
  assert.equal(text, 'Primedle #4 2/3\n🟧🟩\nhttps://a-nelas.github.io/primedle/');
  const lost = shareText({ num: 4, won: false, guesses: [{ d: 12 }, { d: 7 }, { d: 1 }] });
  assert.match(lost, /^Primedle #4 X\/3\n🟦🟨🟥\n/);
});
