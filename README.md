# Primedle

A daily number game. Every day there's a new number between 100 and 9,999. Move the ball anywhere on screen to aim (it can't go below the wave, which rises to meet it) and click (or tap) to drop it on the prime closest to that number. The line stretches out as you move farther from the number.

You get 3 tries. The only hints are your drops, each colored from red (12 or more away) through yellow to green (spot on). The closest prime is never more than 18 away, and the ball reaches 24 either side.

Your score is how close your best drop got to the prime: 100% on it, dropping evenly to 0% at 12 or more away. It doesn't matter which try it was. After the game the answer is revealed and you can look around the number line.

A small 8-bit song plays softly in the background, and every sound is synthesized in the browser.

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
