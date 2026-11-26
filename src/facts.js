// A couple of short facts about the answer and the daily number, shown under
// each once the game is over. All worked out from the number itself (plus a
// few famous ones), so every day has them with nothing to maintain.

import { isPrime } from './primes.js';

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n) => String(n).split('').map((d) => SUP[d]).join('');
const reverse = (n) => Number(String(n).split('').reverse().join(''));
const isPalindrome = (n) => reverse(n) === n;

function ordinal(n) {
  const t = n % 100;
  const s = t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${n}${s}`;
}

let primeList = null;
/** Which prime p is: 2 is the 1st. */
function primeIndex(p) {
  if (!primeList) {
    primeList = [];
    for (let i = 2; i <= 20000; i++) if (isPrime(i)) primeList.push(i);
  }
  return primeList.indexOf(p) + 1;
}

/** [[prime, exponent], …], smallest first. */
export function factorize(n) {
  const out = [];
  let m = n;
  for (let d = 2; d * d <= m; d++) {
    let e = 0;
    while (m % d === 0) {
      m /= d;
      e++;
    }
    if (e) out.push([d, e]);
  }
  if (m > 1) out.push([m, 1]);
  return out;
}

const FAMOUS_PRIMES = {
  1009: 'smallest 4-digit prime',
  9973: 'largest 4-digit prime',
  101: 'smallest 3-digit prime',
  997: 'largest 3-digit prime',
  1999: 'a prime year',
  2003: 'a prime year',
  2011: 'a prime year',
  2017: 'a prime year',
  2027: 'next prime year',
};

/** Up to two short lines about prime p. */
export function primeFacts(p) {
  const lines = [`${ordinal(primeIndex(p))} prime`];
  const add = (s) => lines.length < 2 && lines.push(s);
  if (FAMOUS_PRIMES[p]) add(FAMOUS_PRIMES[p]);
  for (let k = 2; 2 ** k - 1 <= p + 2; k++) {
    if (2 ** k - 1 === p) add(`2${sup(k)} − 1, Mersenne`);
    if (2 ** k + 1 === p) add(`2${sup(k)} + 1, Fermat`);
  }
  const r = reverse(p);
  if (isPalindrome(p)) add('a palindrome');
  if (r !== p && isPrime(r)) add(`reversed: ${r}, prime`);
  if (isPrime(2 * p + 1)) add(`2×${p}+1 is prime`);
  const q = (p - 1) / 2;
  if (isPrime(q)) add(`2×${q}+1, ${q} prime`);
  if (isPrime(p - 2)) add(`twin of ${p - 2}`);
  if (isPrime(p + 2)) add(`twin of ${p + 2}`);
  if (p % 4 === 1) {
    for (let a = Math.floor(Math.sqrt(p)); a > 0; a--) {
      const b = Math.round(Math.sqrt(p - a * a));
      if (b <= a && a * a + b * b === p) {
        add(`${a}² + ${b}²`);
        break;
      }
    }
  }
  let next = p + 1;
  while (!isPrime(next)) next++;
  add(`next prime: ${next}`);
  return lines;
}

const FAMOUS_NUMBERS = {
  1729: '1³+12³ = 9³+10³',
  6174: "Kaprekar's constant",
  496: 'a perfect number',
  8128: 'a perfect number',
  1001: '×123 = 123123',
  1089: '×9 = 9801',
};

/** Up to two short lines about composite n: its factors, then one more. */
export function numberFacts(n) {
  const f = factorize(n);
  const lines = [f.map(([q, e]) => (e > 1 ? `${q}${sup(e)}` : `${q}`)).join(' × ')];
  const add = (s) => lines.length < 2 && lines.push(s);
  if (FAMOUS_NUMBERS[n]) add(FAMOUS_NUMBERS[n]);
  // a power of a composite base (a prime's power already reads that way)
  const g = f.reduce((a, [, e]) => gcd(a, e), 0);
  if (f.length > 1 && g > 1) add(`= ${Math.round(n ** (1 / g))}${sup(g)}`);
  const digits = String(n).split('').map(Number);
  if (digits.reduce((s, d) => s + d ** digits.length, 0) === n) add(`= ${digits.map((d) => `${d}${sup(digits.length)}`).join('+')}`);
  if (isFibonacci(n)) add('a Fibonacci number');
  const t = Math.round((Math.sqrt(8 * n + 1) - 1) / 2);
  if ((t * (t + 1)) / 2 === n) add(`1 + 2 + … + ${t}`);
  if (isPalindrome(n)) add('a palindrome');
  const ds = digits.reduce((s, d) => s + d, 0);
  if (n % ds === 0) add(`÷ its digit sum, ${ds}`);
  add(`${f.reduce((c, [, e]) => c * (e + 1), 1)} divisors`);
  return lines;
}

function gcd(a, b) {
  return b ? gcd(b, a % b) : a;
}

function isFibonacci(n) {
  let a = 1;
  let b = 2;
  while (b < n) [a, b] = [b, a + b];
  return b === n;
}
