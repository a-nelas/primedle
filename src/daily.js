import { isPrime } from './primes.js';

export const LAUNCH_KEY = '2026-11-25';
export const MIN = 100;
export const MAX = 9999;

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date as YYYY-MM-DD. */
export function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function keyToUTC(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function yesterdayKey(key) {
  const d = new Date(keyToUTC(key) - 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Puzzle #1 is the launch day. */
export function puzzleNumber(key) {
  return Math.round((keyToUTC(key) - keyToUTC(LAUNCH_KEY)) / 86400000) + 1;
}

function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same non-prime number for everyone on a given date. */
export function dailyNumber(key) {
  const rnd = mulberry32(hash(`primedle:${key}`));
  let n;
  do {
    n = MIN + Math.floor(rnd() * (MAX - MIN + 1));
  } while (isPrime(n));
  return n;
}
