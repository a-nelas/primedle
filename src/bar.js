import { isPrime } from './primes.js';

const PAD = 22; // px kept free at each end
const BALL_R = 14;
const FLOAT = 20; // gap above the crest where the ball rests when nobody steers it
const CLEAR = 26; // gap between the floor (a straight invisible line) and the highest crest
const BEND = 9; // px the floor gives way under the ball when it's pulled further down
const BEND_K = 260; // floor spring: stiffness (a touch springy so it settles back)
const BEND_D = 2 * Math.sqrt(BEND_K) * 0.55;
const REACH = 0.55; // × maxH: how quickly the wave sinks as the ball moves away from the floor
const BASE_HALF = 7; // units visible each side at rest
// Pointer → number mapping. The camera follows the ball to ALPHA of its
// distance from N and the view widens by BETA per unit, which gives
//   value = base · f / ((1 − ALPHA) − BETA · f)   for f = pointer fraction
// so reach grows quickly toward the edges (about 54 at the very edge, more
// than the largest prime gap below 10k) while N stays in view. A pointer
// position always means the same number, so nothing drifts while it's still.
const ALPHA = 0.45;
const BETA = 0.42;
const MAX_KEY = 54;
const STIFF = 120;
const DAMP = 2 * Math.sqrt(STIFF) * 0.95; // just under critical: smooth, no wobble
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const MAX_SPARKS = 60;
const SPARK_DENSITY = 25; // px of wave per twinkling sparkle (20 to 50 at once)
// low-poly sparkle shapes (unit vertices)
const SHAPES = [
  [[0, -1.6], [1, 0], [0, 1.6], [-1, 0]], // diamond
  [[0, -1.3], [1.15, 0.8], [-1.15, 0.8]], // triangle
  [[0, -2], [0.4, -0.4], [2, 0], [0.4, 0.4], [0, 2], [-0.4, 0.4], [-2, 0], [-0.4, -0.4]], // 4-point star
  Array.from({ length: 6 }, (_, i) => [Math.cos((i * Math.PI) / 3), Math.sin((i * Math.PI) / 3)]), // hexagon
];
const TAP_SLOP = 8; // px a tap may move and still count as a click
const TAP_TIME = 450; // ms

const CRT_FONT = 'VT323';
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const follow = (rate, dt) => 1 - Math.exp(-rate * dt);
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * A pink wave over the number line, centred on the daily number N.
 *
 * Positions are in "units": offsets from N. Each integer is a spring node
 * and the wave is a smooth curve through them, rising into a bell under the
 * ball. The ball lives on a full-screen overlay (`fx`) and follows the pointer
 * anywhere on the page (mouse hover, or a finger sliding), but it can't pass
 * below the wave: it stops at an invisible wall just above it, flashing on
 * contact, and slides along at that height. Its x picks the number. A click
 * or tap drops it and scores the guess. The camera (`cam`) catches up behind
 * the ball and the view widens (`half`) the farther it goes, so N stays on
 * screen. The wave only moves when the pointer does; sparkles twinkle across
 * it on their own.
 */
export class NumberBar {
  constructor(canvas, { center, onDrop, onHover, fx }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fx = fx;
    this.fxCtx = fx.getContext('2d');
    this.center = center;
    this.onDrop = onDrop;
    this.onHover = onHover || (() => {});

    this.w = 0;
    this.h = 0;
    this.restHalf = BASE_HALF;
    this.half = BASE_HALF;
    this.cam = 0;
    this.ball = 0;
    this.lift = 1; // bell height under the ball
    this.prox = 1; // 1 = ball on the floor, → 0 as it moves away; scales the bell
    this.press = 0; // 1 = the landed ball bends the wave down beneath it
    this.fall = 0; // drop progress, 0 → 1
    this.from = null; // where a drop started (viewport px)
    this.bvx = null; // ball position in viewport px
    this.bvy = null;
    this.mx = 0; // pointer in viewport px
    this.my = 0;
    this.blocked = false; // ball is pressed against the wall above the wave
    this.flash = 0; // contact flash, 1 → 0
    this.bend = 0; // how far the floor is bent down under the ball (px)
    this.bendV = 0;
    this.rect = null;
    this.engaged = false; // pointer is steering the ball
    this.down = null; // { x, y, t } of the current press
    this.kb = 0;
    this.mode = 'idle'; // idle | key | drop
    this.enabled = true;
    this.markers = []; // { value, kind }
    this.answers = [];
    this.showPrimes = false;
    this.nodes = new Map(); // unit -> { h, v }
    this.sparks = [];
    this.spawnAcc = 0;
    this.tween = null;
    this.raf = 0;
    this.last = 0;
    this.hovered = undefined;

    this.readColors();
    new ResizeObserver(() => this.resize()).observe(canvas);
    document.fonts?.load(`24px ${CRT_FONT}`).then(() => this.buildSprites()).catch(() => {});
    window.addEventListener('resize', () => this.resizeFx());
    window.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', () => {
      this.down = null;
      this.disengage();
    });
    document.documentElement.addEventListener('mouseleave', () => this.disengage());
    window.addEventListener('blur', () => this.disengage());
    canvas.addEventListener('keydown', (e) => this.onKey(e));
    canvas.addEventListener('blur', () => {
      if (this.mode === 'key') this.mode = 'idle';
      this.kick();
    });
    this.resize();
  }

  set({ markers, answers, showPrimes, enabled }) {
    if (markers) this.markers = markers;
    if (answers) this.answers = answers;
    if (showPrimes !== undefined) this.showPrimes = showPrimes;
    if (enabled !== undefined) this.enabled = enabled;
    let far = 0;
    for (const a of this.answers) far = Math.max(far, Math.abs(a - this.center));
    this.restHalf = this.answers.length ? Math.max(BASE_HALF + 2, Math.ceil(far * 1.5) + 3) : BASE_HALF;
    if (!this.enabled && this.mode !== 'drop') {
      // game over: settle the view back on N with a flat wave
      this.engaged = false;
      this.animate({ ball: 0, cam: 0, lift: 0, press: 0 }, 0.6, easeInOut);
    }
    // while playing, the ball is the cursor
    document.documentElement.classList.toggle('playing', this.enabled);
    this.kick();
  }

  resizeFx() {
    const dpr = window.devicePixelRatio || 1;
    this.fx.width = Math.round(window.innerWidth * dpr);
    this.fx.height = Math.round(window.innerHeight * dpr);
    this.fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.kick();
  }

  readColors() {
    const s = getComputedStyle(document.documentElement);
    const g = (n, fb) => s.getPropertyValue(n).trim() || fb;
    this.colors = {
      correct: g('--correct', '#3dff9a'),
      hot: g('--hot', '#ff3d6e'),
      warm: g('--warm', '#ff9a3d'),
      cool: g('--cool', '#ffe45c'),
      cold: g('--cold', '#3dc8ff'),
    };
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.dpr = dpr;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.resizeFx();
    this.buildSprites();
    this.kick();
  }

  // ---- CRT sprites -------------------------------------------------------
  // Scanlines and the vignette come from a page-wide overlay (style.css);
  // the sprites only carry the RGB fringe and glow.

  buildSprites() {
    const dpr = this.dpr || 1;

    // ball
    const size = BALL_R * 2 + 44;
    const b = document.createElement('canvas');
    b.width = b.height = Math.ceil(size * dpr);
    const g = b.getContext('2d');
    g.scale(dpr, dpr);
    const m = size / 2;
    const halo = g.createRadialGradient(m, m, BALL_R * 0.7, m, m, BALL_R * 2.4);
    halo.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
    halo.addColorStop(1, 'rgba(255, 255, 255, 0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, size, size);
    for (const [dx, col] of [[-1.8, 'rgba(255, 50, 140, 0.75)'], [1.8, 'rgba(60, 220, 255, 0.65)']]) {
      g.fillStyle = col;
      g.beginPath();
      g.arc(m + dx, m, BALL_R, 0, Math.PI * 2);
      g.fill();
    }
    const sphere = g.createRadialGradient(m - 4, m - 5, 1, m, m, BALL_R);
    sphere.addColorStop(0, '#ffffff');
    sphere.addColorStop(0.5, '#e9e8ee');
    sphere.addColorStop(1, '#a9a6b4');
    g.fillStyle = sphere;
    g.beginPath();
    g.arc(m, m, BALL_R, 0, Math.PI * 2);
    g.fill();
    this.ballSprite = { canvas: b, size };

    // daily number label
    const text = String(this.center);
    const font = `26px ${CRT_FONT}, ui-monospace, Consolas, monospace`;
    const meas = document.createElement('canvas').getContext('2d');
    meas.font = font;
    const tw = Math.ceil(meas.measureText(text).width) + 24;
    const th = 34;
    const l = document.createElement('canvas');
    l.width = Math.ceil(tw * dpr);
    l.height = Math.ceil(th * dpr);
    const lg = l.getContext('2d');
    lg.scale(dpr, dpr);
    lg.font = font;
    lg.textAlign = 'center';
    lg.textBaseline = 'middle';
    lg.fillStyle = 'rgba(255, 50, 140, 0.75)';
    lg.fillText(text, tw / 2 - 1.5, th / 2);
    lg.fillStyle = 'rgba(60, 220, 255, 0.65)';
    lg.fillText(text, tw / 2 + 1.5, th / 2);
    lg.shadowColor = 'rgba(255, 255, 255, 0.6)';
    lg.shadowBlur = 8;
    lg.fillStyle = '#e9e8ee';
    lg.fillText(text, tw / 2, th / 2);
    this.labelSprite = { canvas: l, w: tw, h: th };
    this.kick();
  }

  // ---- geometry ----------------------------------------------------------

  get usable() {
    return Math.max(40, this.w / 2 - PAD);
  }
  get ppu() {
    return this.usable / this.half;
  }
  get baseline() {
    return this.h - 48; // room below for N's label
  }
  /** Tallest the wave rises: it keeps to the lower part of the screen. */
  get maxH() {
    return Math.max(40, Math.min(this.h * 0.4, this.baseline - 2 * BALL_R - FLOAT - 12));
  }
  get sparkCount() {
    return clamp(Math.round(this.w / SPARK_DENSITY), 20, 50);
  }
  get sigma() {
    return Math.max(1.6, 46 / this.ppu);
  }
  restFor(n) {
    if (this.showPrimes && n !== 0 && isPrime(this.center + n)) return this.maxH * 0.32;
    return this.maxH * 0.14;
  }
  xOf(u) {
    return this.w / 2 + (u - this.cam) * this.ppu;
  }
  uOf(x) {
    return this.cam + (x - this.w / 2) / this.ppu;
  }
  nodeH(n) {
    return this.nodes.get(n)?.h ?? this.restFor(n);
  }
  /** Smooth height through the spring nodes (Catmull-Rom). */
  springH(u) {
    const n = Math.floor(u);
    const t = u - n;
    const p0 = this.nodeH(n - 1);
    const p1 = this.nodeH(n);
    const p2 = this.nodeH(n + 1);
    const p3 = this.nodeH(n + 2);
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  surfaceY(u) {
    return this.baseline - Math.max(3, this.springH(u));
  }
  /** Where the bell (and the colour) is centred, in canvas x. */
  ballX() {
    return this.xOf(this.ball);
  }
  /** The floor: lowest the ball's centre may go (viewport px), a straight
   *  line just above the highest the wave can rise. */
  get floorY() {
    return this.rect.top + this.baseline - this.maxH - CLEAR - BALL_R;
  }
  get showBall() {
    return this.enabled || this.mode === 'drop';
  }

  // ---- simulation --------------------------------------------------------

  kick() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  frame(t) {
    this.raf = 0;
    const dt = clamp((t - this.last) / 1000, 0.001, 1 / 30);
    this.last = t;
    const busy = this.step(dt);
    this.draw();
    this.drawFx();
    if (busy) this.raf = requestAnimationFrame((t2) => this.frame(t2));
  }

  /** Number (in units) under a pointer at fraction f of the half-width. */
  valueAt(x) {
    const f = clamp((x - this.w / 2) / this.usable, -1, 1);
    const a = Math.abs(f);
    return (Math.sign(f) * this.restHalf * a) / (1 - ALPHA - BETA * a);
  }

  step(dt) {
    let busy = false;
    const R = (this.rect = this.canvas.getBoundingClientRect());
    const free = this.mode === 'idle' && this.engaged && this.enabled;

    // the number under the ball heads for its target; the camera catches up
    let target = null;
    if (free) target = this.valueAt(this.mx - R.left);
    else if (this.mode === 'key') target = this.kb;
    if (target !== null) {
      this.ball += (target - this.ball) * follow(18, dt);
      if (Math.abs(target - this.ball) > 0.002) busy = true;
    }
    if (this.mode !== 'drop' && !this.tween) {
      const camT = ALPHA * this.ball;
      const halfT = this.restHalf + BETA * Math.abs(this.ball);
      this.cam += (camT - this.cam) * follow(7, dt);
      this.half += (halfT - this.half) * follow(7, dt);
      if (Math.abs(camT - this.cam) > 0.002 || Math.abs(halfT - this.half) > 0.002) busy = true;
    }

    const tw = this.tween;
    if (tw) {
      busy = true;
      tw.t += dt;
      const p = clamp(tw.t / tw.dur, 0, 1);
      const e = tw.ease(p);
      for (const k in tw.to) this[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
      if (p >= 1) {
        this.tween = null;
        tw.done?.();
      }
    }

    // spring nodes: a smooth bell under the floating ball, or a small dent
    // where it has landed
    const sigma = this.sigma;
    const dentSigma = Math.max(0.9, 20 / this.ppu);
    const lo = Math.floor(this.cam - this.half - 4);
    const hi = Math.ceil(this.cam + this.half + 4);
    const peak = this.maxH;
    for (let n = lo; n <= hi; n++) {
      const rest = this.restFor(n);
      const d = n - this.ball;
      const bell = (peak - rest) * this.lift * this.prox * Math.exp(-(d * d) / (2 * sigma * sigma));
      const dent = rest * 0.75 * this.press * Math.exp(-(d * d) / (2 * dentSigma * dentSigma));
      const target = Math.max(2, rest + bell - dent);
      let b = this.nodes.get(n);
      if (!b) {
        b = { h: target, v: 0 };
        this.nodes.set(n, b);
      }
      if (REDUCED) {
        b.h = target;
        b.v = 0;
        continue;
      }
      const a = STIFF * (target - b.h) - DAMP * b.v;
      b.v += a * dt;
      b.h = Math.max(2, b.h + b.v * dt);
      if (Math.abs(b.v) > 0.3 || Math.abs(target - b.h) > 0.2) busy = true;
    }
    if (this.nodes.size > 600) {
      for (const n of this.nodes.keys()) if (n < lo - 20 || n > hi + 20) this.nodes.delete(n);
    }

    // sparkles twinkle evenly across the wave, independent of the ball
    if (!REDUCED && this.w) {
      if (!this.sparks.length) {
        for (let i = 0; i < this.sparkCount; i++) this.spark(Math.random());
      }
      this.spawnAcc += dt * (this.sparkCount / 1.5);
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        this.spark(0);
      }
      for (const s of this.sparks) {
        s.life += dt;
        if (s.dy < 0) s.dy -= 4 * dt; // the ones above the crest drift up slowly
      }
      this.sparks = this.sparks.filter((s) => s.life < s.max);
      busy = true;
    }

    // the ball, in viewport px: follows the pointer anywhere, but never
    // below the floor just above the wave
    const restX = R.left + this.xOf(this.ball);
    const wall = this.floorY;
    if (this.mode === 'drop' && this.from) {
      const landY = R.top + this.surfaceY(this.ball) - BALL_R - 1;
      this.bvx = this.from.x + (restX - this.from.x) * this.fall;
      this.bvy = this.from.y + (landY - this.from.y) * this.fall;
      this.blocked = false;
    } else {
      const tx = free ? this.mx : restX;
      if (this.bvx === null) this.bvx = tx;
      this.bvx += (tx - this.bvx) * follow(free ? 30 : 12, dt);
      const ty = free ? this.my : wall - FLOAT;
      if (this.bvy === null) this.bvy = ty;
      this.bvy += (ty - this.bvy) * follow(free ? 30 : 12, dt);
      // pulling further down bends the floor a little (eases toward BEND)
      const push = free ? Math.max(0, ty - wall) : 0;
      const bendT = BEND * (1 - Math.exp(-push / 70));
      if (REDUCED) {
        this.bend = bendT;
        this.bendV = 0;
      } else {
        this.bendV += (BEND_K * (bendT - this.bend) - BEND_D * this.bendV) * dt;
        this.bend += this.bendV * dt;
      }
      if (Math.abs(bendT - this.bend) > 0.05 || Math.abs(this.bendV) > 0.05) busy = true;
      const limit = wall + Math.max(0, this.bend);
      if (this.bvy > limit) this.bvy = limit;
      // pressed against the floor (a little hysteresis so it doesn't chatter)
      const blocked = free && this.bvy >= Math.min(wall, limit) - 0.5 && ty > wall - (this.blocked ? 6 : 0);
      if (blocked && !this.blocked && this.flash < 0.4) this.flash = 1; // hit the wall
      this.blocked = blocked;
      if (this.blocked) busy = true;
      if (Math.abs(tx - this.bvx) > 0.3 || Math.abs(Math.min(ty, limit) - this.bvy) > 0.3) busy = true;
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt / 0.4);
      busy = true;
    }
    // the wave reaches up toward the ball: tall when it's near, low when far
    this.prox = Math.exp(-Math.max(0, wall - this.bvy) / (REACH * this.maxH));

    // readout
    const live = this.enabled && (this.engaged || this.mode === 'key' || this.mode === 'drop');
    const hv = live ? this.center + Math.round(this.mode === 'key' ? this.kb : this.ball) : null;
    if (hv !== this.hovered) {
      this.hovered = hv;
      this.onHover(hv);
    }

    return busy;
  }

  /**
   * A sparkle at a random spot along the visible wave. Its height is kept
   * relative to the wave surface (`dy`), so it rides the wave: some sit just
   * above the crest line, most glint inside the pink body.
   */
  spark(startAt) {
    if (this.sparks.length >= MAX_SPARKS) return;
    const max = 0.9 + Math.random() * 1.3;
    this.sparks.push({
      u: this.uOf(PAD + Math.random() * (this.w - 2 * PAD)),
      dy: Math.random() < 0.3 ? -(2 + Math.random() * 12) : Math.random() * 1,
      inside: Math.random(), // fraction of the wave's depth, used when dy ≥ 0
      life: startAt * max,
      max,
      size: 0.8 + Math.random() * 0.9,
      shape: Math.floor(Math.random() * SHAPES.length),
      rot: Math.random() < 0.5 ? 0 : Math.random() * Math.PI,
      phase: Math.random() * Math.PI * 2,
      white: Math.random() < 0.55,
    });
  }

  static poly(g, s, x, y, color, scale = 1) {
    const cos = Math.cos(s.rot);
    const sin = Math.sin(s.rot);
    const r = s.size * scale;
    g.fillStyle = color;
    g.beginPath();
    SHAPES[s.shape].forEach(([px, py], i) => {
      const X = x + (px * cos - py * sin) * r;
      const Y = y + (px * sin + py * cos) * r;
      if (i) g.lineTo(X, Y);
      else g.moveTo(X, Y);
    });
    g.closePath();
    g.fill();
  }

  sparkY(s) {
    const top = this.surfaceY(s.u);
    if (s.dy < 0) return top + s.dy;
    return top + (this.baseline - top) * s.inside * 0.85 + 2;
  }

  animate(to, dur, ease, done) {
    const from = {};
    for (const k in to) from[k] = this[k];
    this.tween = { from, to, dur, ease, done, t: 0 };
    this.kick();
  }

  /** Drop the ball on the whole number under it and score it. */
  drop(u) {
    const v = Math.round(u);
    if (v === 0) return; // N itself is never the answer; ignore
    this.mode = 'drop';
    this.from = { x: this.bvx ?? 0, y: this.bvy ?? 0 };
    this.fall = 0;
    // fall: the bell flattens and the wave bends down where the ball lands
    this.animate({ ball: v, fall: 1, lift: 0, press: 1 }, 0.32, easeIn, () => {
      for (let d = -2; d <= 2; d++) {
        const b = this.nodes.get(v + d);
        if (b) b.v -= 90 * Math.exp(-(d * d) / 2);
      }
      const accepted = this.onDrop(this.center + v);
      this.animate({}, accepted ? 0.7 : 0.15, easeOut, () => {
        if (!this.enabled) {
          this.mode = 'idle';
          this.set({});
          return;
        }
        this.animate({ lift: 1, press: 0 }, 0.5, easeInOut, () => {
          this.mode = 'idle';
          this.from = null;
        });
      });
    });
  }

  // ---- input -------------------------------------------------------------

  engage(e) {
    this.engaged = true;
    this.mx = e.clientX;
    this.my = e.clientY;
    if (this.mode === 'key') this.mode = 'idle';
    this.kick();
  }

  disengage() {
    if (!this.engaged) return;
    this.engaged = false;
    this.kick();
  }

  onDown(e) {
    if (!this.enabled || this.mode === 'drop' || e.button > 0) return;
    e.preventDefault();
    this.canvas.focus({ preventScroll: true });
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.engage(e);
  }

  onMove(e) {
    if (!this.enabled || this.mode === 'drop') return;
    // mouse steers by hovering; touch and pen steer while pressed
    if (e.pointerType === 'mouse' || this.down) this.engage(e);
  }

  onUp(e) {
    const d = this.down;
    this.down = null;
    if (!d || !this.enabled || this.mode === 'drop') return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    const isTap = moved <= TAP_SLOP && performance.now() - d.t <= TAP_TIME;
    if (isTap) {
      // mouse: drop where the ball (and readout) is; touch: where the tap was
      const rect = this.canvas.getBoundingClientRect();
      if (e.pointerType !== 'mouse') this.bvx = e.clientX;
      this.drop(e.pointerType === 'mouse' ? this.ball : this.valueAt(e.clientX - rect.left));
    } else if (e.pointerType !== 'mouse') {
      this.disengage(); // finger lifted after aiming: the ball stays floating there
    }
  }

  onKey(e) {
    if (!this.enabled || this.mode === 'drop') return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      if (this.mode !== 'key') {
        this.mode = 'key';
        this.engaged = false;
        this.kb = Math.round(this.ball);
      }
      const step = (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1);
      this.kb = clamp(this.kb + step, -MAX_KEY, MAX_KEY);
      this.kick();
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      this.drop(this.mode === 'key' ? this.kb : this.ball);
    }
  }

  // ---- drawing -----------------------------------------------------------

  draw() {
    const { ctx, w, h, colors: c } = this;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);

    const base = this.baseline;
    const ppu = this.ppu;
    const lo = Math.floor(this.cam - this.half - 2);
    const hi = Math.ceil(this.cam + this.half + 2);
    const fade = (x) => clamp((Math.min(x, w - x) - 2) / 28, 0, 1);
    const showBall = this.showBall;
    const bx = this.ballX();
    const markerAt = new Map(this.markers.map((m) => [m.value - this.center, m]));
    const answerSet = new Set(this.answers.map((a) => a - this.center));

    // glow behind the crest
    if (showBall && this.lift > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gy = base - this.maxH * 0.45;
      const ry = Math.min(gy - 2, this.maxH * 0.8);
      ctx.translate(bx, gy);
      ctx.scale(1.5, 1);
      const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
      rg.addColorStop(0, `rgba(255, 60, 190, ${0.28 * this.lift * this.prox})`);
      rg.addColorStop(1, 'rgba(255, 60, 190, 0)');
      ctx.fillStyle = rg;
      ctx.fillRect(-ry, -ry, ry * 2, ry * 2);
      ctx.restore();
    }

    // the wave
    const pts = [];
    for (let x = 0; x <= w + 3; x += 3) pts.push([x, this.surfaceY(this.uOf(x))]);

    ctx.beginPath();
    ctx.moveTo(0, base);
    for (const [x, y] of pts) ctx.lineTo(x, y);
    ctx.lineTo(w, base);
    ctx.closePath();
    // colour spreads sideways: richest around the ball, fading toward the sides
    const p = clamp((showBall ? bx : w / 2) / w, 0, 1);
    const fadeStops = (g, rgb, peak) => {
      g.addColorStop(0, `rgba(${rgb}, 0)`);
      g.addColorStop(Math.max(0, p - 0.34), `rgba(${rgb}, 0)`);
      g.addColorStop(Math.max(0, p - 0.2), `rgba(${rgb}, ${0.18 * peak})`);
      g.addColorStop(Math.max(0, p - 0.08), `rgba(${rgb}, ${0.8 * peak})`);
      g.addColorStop(p, `rgba(${rgb}, ${peak})`);
      g.addColorStop(Math.min(1, p + 0.08), `rgba(${rgb}, ${0.8 * peak})`);
      g.addColorStop(Math.min(1, p + 0.2), `rgba(${rgb}, ${0.18 * peak})`);
      g.addColorStop(Math.min(1, p + 0.34), `rgba(${rgb}, 0)`);
      g.addColorStop(1, `rgba(${rgb}, 0)`);
      return g;
    };
    const core = ctx.createLinearGradient(0, 0, w, 0);
    core.addColorStop(0, 'rgba(255, 47, 180, 0)');
    core.addColorStop(Math.max(0, p - 0.34), 'rgba(255, 47, 180, 0)');
    core.addColorStop(Math.max(0, p - 0.2), 'rgba(255, 47, 180, 0.22)');
    core.addColorStop(Math.max(0, p - 0.08), 'rgba(255, 79, 195, 0.85)');
    core.addColorStop(p, '#ff9ddf');
    core.addColorStop(Math.min(1, p + 0.08), 'rgba(255, 79, 195, 0.85)');
    core.addColorStop(Math.min(1, p + 0.2), 'rgba(255, 47, 180, 0.22)');
    core.addColorStop(Math.min(1, p + 0.34), 'rgba(255, 47, 180, 0)');
    core.addColorStop(1, 'rgba(255, 47, 180, 0)');
    ctx.fillStyle = core;
    ctx.fill();

    // CRT colour fringe along the wave's edge (pink left, cyan right),
    // fading out sideways with the colour
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth = 1.4;
    ctx.lineJoin = 'round';
    for (const [dx, rgb, peak] of [[-1.6, '255, 50, 140', 0.55], [1.6, '60, 220, 255', 0.4]]) {
      ctx.strokeStyle = fadeStops(ctx.createLinearGradient(0, 0, w, 0), rgb, peak);
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x + dx, y) : ctx.moveTo(x + dx, y)));
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = core;

    ctx.beginPath();
    ctx.moveTo(0, base);
    for (const [x, y] of pts) ctx.lineTo(x, base + (base - y) * 0.28);
    ctx.lineTo(w, base);
    ctx.closePath();
    ctx.globalAlpha = 0.14;
    ctx.fill();
    ctx.globalAlpha = 1;

    // soften both ends
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (const [x0, x1] of [[0, 34], [w, w - 34]]) {
      const eg = ctx.createLinearGradient(x0, 0, x1, 0);
      eg.addColorStop(0, 'rgba(0,0,0,1)');
      eg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = eg;
      ctx.fillRect(Math.min(x0, x1), 0, 34, h);
    }
    ctx.restore();

    // baseline with a dot at each whole number
    const lg = ctx.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, 'rgba(255, 47, 180, 0)');
    lg.addColorStop(0.5, 'rgba(255, 120, 210, 0.8)');
    lg.addColorStop(1, 'rgba(255, 47, 180, 0)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, base, w, 1.5);
    if (ppu >= 5) {
      ctx.fillStyle = 'rgba(255, 190, 235, 0.55)';
      for (let n = lo; n <= hi; n++) {
        const x = this.xOf(n);
        const a = fade(x);
        if (a <= 0) continue;
        ctx.globalAlpha = a * 0.8;
        ctx.beginPath();
        ctx.arc(x, base + 0.75, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    // stems (no digits): primes after the game, guesses, the answer and N
    const stem = (u, color, width, glow) => {
      const x = this.xOf(u);
      const a = fade(x);
      if (a <= 0) return null;
      const y = this.surfaceY(u);
      ctx.globalAlpha = a;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.shadowColor = color;
      ctx.shadowBlur = glow;
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, width + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      return { x, y };
    };
    if (this.showPrimes) {
      for (let n = lo; n <= hi; n++) {
        if (n !== 0 && !markerAt.has(n) && !answerSet.has(n) && isPrime(this.center + n)) stem(n, c.correct, 1.5, 6);
      }
    }
    const stacked = { left: 0, right: 0 };
    for (const m of this.markers) {
      const u = m.value - this.center;
      const x = this.xOf(u);
      const color = c[m.kind] || '#fff';
      if (x < PAD - 10 || x > w - PAD + 10) {
        const side = x < w / 2 ? 'left' : 'right';
        this.edgeArrow(side, base - 40 - stacked[side] * 16, color);
        stacked[side] += 1;
        continue;
      }
      stem(u, color, 2, 10);
    }
    for (const u of answerSet) {
      const p = markerAt.has(u) ? { x: this.xOf(u), y: this.surfaceY(u) } : stem(u, c.correct, 2, 10);
      if (!p) continue;
      ctx.strokeStyle = c.correct;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = c.correct;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // N: a straight line from the baseline to the top of the screen
    const x0 = this.xOf(0);
    if (x0 >= -2 && x0 <= w + 2) {
      ctx.save();
      const line = (dx, rgb, width, a) => {
        const lg = ctx.createLinearGradient(0, base, 0, 0);
        lg.addColorStop(0, `rgba(${rgb}, ${a})`);
        lg.addColorStop(1, `rgba(${rgb}, ${a * 0.3})`);
        ctx.fillStyle = lg;
        ctx.fillRect(x0 + dx - width / 2, 0, width, base);
      };
      ctx.globalCompositeOperation = 'lighter';
      line(0, '255, 255, 255', 6, 0.08); // soft glow
      line(-1.5, '255, 50, 140', 1.2, 0.6);
      line(1.5, '60, 220, 255', 1.2, 0.5);
      ctx.globalCompositeOperation = 'source-over';
      line(0, '255, 255, 255', 1.5, 0.95);
      ctx.restore();
    }

    // daily number (the only digits on the bar), CRT style
    const xN = this.xOf(0);
    const L = this.labelSprite;
    if (L) {
      if (xN >= PAD - 6 && xN <= w - PAD + 6) {
        ctx.drawImage(L.canvas, xN - L.w / 2, base + 6, L.w, L.h);
      } else {
        const side = xN < w / 2 ? 'left' : 'right';
        this.edgeArrow(side, base - 20, '#ffffff');
        const lx = side === 'left' ? 16 : w - 16 - L.w;
        ctx.drawImage(L.canvas, lx, base + 6, L.w, L.h);
      }
    }

    // sparkles: small CRT polygons with an RGB fringe, pixel-snapped
    // positions and stepped flicker (scanlines come from the page overlay)
    if (this.sparks.length) {
      const g = ctx;
      g.save();
      g.globalCompositeOperation = 'lighter';
      for (const s of this.sparks) {
        const x = Math.round(this.xOf(s.u));
        const y = Math.round(this.sparkY(s));
        let a = Math.sin((Math.PI * s.life) / s.max) * (0.7 + 0.3 * Math.sin(s.phase + s.life * 9)) * fade(x);
        a = Math.round(a * 4) / 4; // stepped, like a CRT phosphor
        if (a <= 0) continue;
        g.globalAlpha = a * 0.18;
        NumberBar.poly(g, s, x, y, '#ff6ad0', 2.4); // soft halo
        g.globalAlpha = a * 0.8;
        NumberBar.poly(g, s, x - 1, y, 'rgb(255, 50, 140)');
        NumberBar.poly(g, s, x + 1, y, 'rgb(60, 220, 255)');
        g.globalAlpha = a;
        NumberBar.poly(g, s, x, y, s.white ? '#f4f3f8' : '#ffc4ee');
      }
      g.restore();
    }
  }

  /** The ball, its aim line and the wall flash, on the full-screen overlay. */
  drawFx() {
    const g = this.fxCtx;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    g.clearRect(0, 0, vw, vh);
    const R = this.rect;
    if (!R || !this.w || !this.showBall || this.bvx === null) return;
    const x = this.bvx;
    const y = this.bvy;

    // aim line from the ball down to the whole number it would land on
    if (this.mode !== 'drop' && this.lift > 0.05) {
      const hx = R.left + this.xOf(Math.round(this.mode === 'key' ? this.kb : this.ball));
      const top = y + BALL_R + 3;
      const bot = R.top + this.baseline;
      if (bot > top) {
        g.globalAlpha = this.lift * 0.55;
        g.strokeStyle = '#ffffff';
        g.lineWidth = 1;
        g.setLineDash([3, 4]);
        g.beginPath();
        g.moveTo(hx, top);
        g.lineTo(hx, bot);
        g.stroke();
        g.setLineDash([]);
        g.globalAlpha = 1;
      }
    }

    // the invisible wall lights up where the ball pushes on it
    const f = this.flash;
    const hold = this.blocked ? 0.22 + 0.25 * clamp(this.bend / BEND, 0, 1) : 0;
    const a = Math.max(f, hold);
    if (a > 0.01) {
      g.save();
      g.globalCompositeOperation = 'lighter';
      // a segment of the floor, bright under the ball and fading out, with a
      // shallow dip where the ball pushes it down
      const span = 60 + 50 * (1 - f) * (f > hold ? 1 : 0);
      const ly = this.floorY + BALL_R + 1;
      const bend = Math.max(0, this.bend);
      const line = (off, rgb, width, alpha) => {
        const lg = g.createLinearGradient(x - span, 0, x + span, 0);
        lg.addColorStop(0, `rgba(${rgb}, 0)`);
        lg.addColorStop(0.5, `rgba(${rgb}, ${alpha})`);
        lg.addColorStop(1, `rgba(${rgb}, 0)`);
        g.strokeStyle = lg;
        g.lineWidth = width;
        g.beginPath();
        for (let dx = -span; dx <= span; dx += 2) {
          const yy = ly + bend * Math.exp(-(dx * dx) / (2 * 26 * 26));
          if (dx === -span) g.moveTo(x + dx + off, yy);
          else g.lineTo(x + dx + off, yy);
        }
        g.stroke();
      };
      line(0, '255, 120, 210', 7, a * 0.25); // soft bloom
      line(-1.5, '255, 50, 140', 1.6, a * 0.9);
      line(1.5, '60, 220, 255', 1.6, a * 0.8);
      line(0, '255, 255, 255', 1.2, a);
      // the impact ring
      if (f > 0.01) {
        const r = BALL_R + 4 + 22 * (1 - f);
        g.globalAlpha = f * 0.7;
        g.strokeStyle = '#ffffff';
        g.lineWidth = 1.5;
        g.beginPath();
        g.ellipse(x, y + BALL_R * 0.4, r, r * 0.55, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }

    // ball, CRT style
    if (this.ballSprite) {
      const S = this.ballSprite;
      g.drawImage(S.canvas, x - S.size / 2, y - S.size / 2, S.size, S.size);
      if (f > 0.01) {
        // it flares white on impact
        g.save();
        g.globalCompositeOperation = 'lighter';
        const glow = g.createRadialGradient(x, y, 0, x, y, BALL_R * 2.2);
        glow.addColorStop(0, `rgba(255, 255, 255, ${0.75 * f})`);
        glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
        g.fillStyle = glow;
        g.fillRect(x - BALL_R * 2.2, y - BALL_R * 2.2, BALL_R * 4.4, BALL_R * 4.4);
        g.restore();
      }
    }
  }

  edgeArrow(side, y, color) {
    const { ctx, w } = this;
    const dir = side === 'left' ? -1 : 1;
    const ex = side === 'left' ? 10 : w - 10;
    ctx.save();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(ex + dir * 6, y);
    ctx.lineTo(ex - dir * 3, y - 6);
    ctx.lineTo(ex - dir * 3, y + 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
