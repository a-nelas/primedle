# Primedle

A daily number game. Every day there's a new number between 100 and 9,999. Aim the floating ball along the number line and click (or tap) to drop it on the prime closest to that number. The line stretches out as you move farther from the number.

You get 3 tries. Each drop is colored by how close it was: **Hot** (1–2 away), **Warm** (3–5), **Cool** (6–10) or **Cold** (more than 10). From the second try on you also see whether you got warmer or colder.

Play at **https://a-nelas.github.io/primedle/**

## Development

Plain HTML, CSS and ES modules with no build step. Serve the folder with any static server, for example:

```sh
npx http-server -c-1
```

Run the logic tests with Node 20 or later:

```sh
npm test
```

The daily number is derived from the local date, so every player gets the same number on the same day. Puzzle #1 was 2026-11-25.
