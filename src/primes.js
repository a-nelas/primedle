export function isPrime(n) {
  if (!Number.isInteger(n) || n < 2) return false;
  if (n % 2 === 0) return n === 2;
  if (n % 3 === 0) return n === 3;
  for (let i = 5; i * i <= n; i += 6) {
    if (n % i === 0 || n % (i + 2) === 0) return false;
  }
  return true;
}

/** The prime(s) nearest to n. Two primes when they are equally close. */
export function closestPrimes(n) {
  if (isPrime(n)) return [n];
  for (let d = 1; ; d++) {
    const found = [];
    if (isPrime(n - d)) found.push(n - d);
    if (isPrime(n + d)) found.push(n + d);
    if (found.length) return found;
  }
}
