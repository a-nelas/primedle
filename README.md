# Primedle

A daily number game. Every day there's a new number between 100 and 9,999. Move the ball anywhere on screen to aim (it can't go below the wave, which rises to meet it) and click (or tap) to drop it on the prime closest to that number. The line stretches out as you move farther from the number.

Every prime in this range ends in 1, 3, 7 or 9, so those are the only numbers on the line: the daily number sits in the middle, with one spot for each 1, 3, 7 or 9 number around it (for 2891: … 2887, 2889, **2891**, 2893, 2897 …). The ball reaches 40 spots either side (about 100 numbers), and the closest prime is never more than 7 spots away.

You get 3 tries. The only hints are your drops, each colored from red (5 or more spots away) through yellow to green (spot on).

Your score is how close your best drop got to the prime: 100% on it, then 80, 60, 40, 20 and 0% from 5 spots away. It doesn't matter which try it was. After the game the answer is revealed and you can look around the number line.

Your progress is saved in your browser for the day, so a refresh doesn't give you new tries (a private window or clearing site data does start over: there's no server).

A hype 8-bit EDM track (128 bpm) plays in the background; turn it off with the speaker button at the top right. Every sound is synthesized in the browser.

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
