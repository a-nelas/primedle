import * as sfx from './sound.js';

const PAD = 22; // px kept free at each end
const BALL_R = 18;
const FLOAT = 20; // gap above the crest where the ball rests when nobody steers it
const CLEAR = 26; // gap between the floor (a straight invisible line) and the highest crest
const BEND = 9; // px the floor gives way under the ball when it's pulled further down
const BEND_K = 260; // floor spring: stiffness (a touch springy so it settles back)
const BEND_D = 2 * Math.sqrt(BEND_K) * 0.55;
const REACH = 0.55; // × maxH: how quickly the wave sinks as the ball moves away from the floor
const BASE_HALF = 7; // units visible each side at rest
// Pointer → number mapping. The pointer's fraction f of the half-width maps
// to an offset from N of  reach · (K·|f| + (1 − K)·|f|³):  fine control near
// N, faster toward the edges. `reach` (24) covers the farthest the closest
// prime can ever be (18, at 9569) plus a margin, the same on both sides, so
// the screen edge gives nothing away. The camera then sits wherever puts that
// number right under the pointer, while the view widens by BETA per unit.
const K = 0.5;
const BETA = 0.42;
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
const HIT_HOLD = 0.35; // s the impact bar stays wide
const HIT_END = 0.95; // s by which it has narrowed into the drop's marker
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
  constructor(canvas, { center, onDrop, onHover, fx, reach = 24 }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fx = fx;
    this.fxCtx = fx.getContext('2d');
    this.center = center;
    this.reach = reach;
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
    this.slide = 0; // drop: lock-on progress toward the target, 0 → 1
    this.fall = 0; // drop: slam progress, 0 → 1
    this.target = null; // drop: the whole number being hit
    this.frozen = false; // the wave holds still while a drop plays out
    this.sink = 0; // drop: 0 → 1 as the ball falls on through the wave and off screen
    this.appear = 1; // the ball re-materialising for the next try, 0 → 1
    this.hit = null; // { u, color, t }: the bar a scored drop punches into the wave
    this.tinted = new Map(); // colour -> ball sprite tinted that colour
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
    this.markers = []; // { value, color }
    this.answers = []; // shown once the game is over
    this.focus = null; // game over: where the camera rests (units)
    this.reveal = 0; // 0 → 1 as the answer appears
    this.nodes = new Map(); // unit -> { h, v }
    this.sparks = [];
    this.spawnAcc = 0;
    this.tween = null;
    this.raf = 0;
    this.last = 0;
    this.hovered = undefined;

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

  set({ markers, enabled, answers }) {
    if (markers) this.markers = markers;
    if (enabled !== undefined) this.enabled = enabled;
    if (answers) {
      this.answers = answers;
      this.answerLabels = answers.map((a) => this.makeLabel(String(a), '#7dffa8', 'rgba(61, 255, 154, 0.7)'));
    }
    if (!this.enabled && this.mode !== 'drop' && this.focus === null) {
      // game over: the wave flattens and the camera glides to the answer;
      // after that the pointer can look around (no ball)
      const offs = this.answers.map((a) => a - this.center);
      this.focus = offs.length ? offs.reduce((a, b) => a + b, 0) / offs.length : 0;
      this.engaged = false;
      const half = this.restHalf + BETA * Math.abs(this.focus);
      this.animate({ ball: this.focus, cam: this.focus, half, lift: 0, reveal: 1 }, 1.1, easeInOut);
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

    this.labelSprite = this.makeLabel(String(this.center), '#e9e8ee', 'rgba(255, 255, 255, 0.6)');
    if (this.answers.length) {
      this.answerLabels = this.answers.map((a) => this.makeLabel(String(a), '#7dffa8', 'rgba(61, 255, 154, 0.7)'));
    }
    this.kick();
  }

  /** A CRT-style number label: RGB fringe, glow. */
  makeLabel(text, core, glow) {
    const dpr = this.dpr || 1;
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
    lg.shadowColor = glow;
    lg.shadowBlur = 8;
    lg.fillStyle = core;
    lg.fillText(text, tw / 2, th / 2);
    return { canvas: l, w: tw, h: th };
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

  /** Number (in units) under a pointer at canvas x. */
  valueAt(x) {
    const f = clamp((x - this.w / 2) / this.usable, -1, 1);
    const a = Math.abs(f);
    return Math.sign(f) * this.reach * (K * a + (1 - K) * a * a * a);
  }
  /** The pointer fraction that picks offset v (inverse of valueAt). */
  fracOf(v) {
    const t = Math.min(1, Math.abs(v) / this.reach);
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 24; i++) {
      const m = (lo + hi) / 2;
      if (K * m + (1 - K) * m * m * m < t) lo = m;
      else hi = m;
    }
    return Math.sign(v) * (lo + hi) / 2;
  }

  step(dt) {
    let busy = false;
    const R = (this.rect = this.canvas.getBoundingClientRect());
    const free = this.mode === 'idle' && this.engaged && this.enabled;
    const over = !this.enabled && this.mode === 'idle' && this.focus !== null;
    const look = over && this.engaged; // game over: the pointer pans the view

    // the number under the ball (or, after the game, under the pointer)
    // heads for its target; the camera catches up
    let target = null;
    if (free || look) target = this.valueAt(this.mx - R.left);
    else if (this.mode === 'key') target = this.kb;
    else if (over) target = this.focus;
    if (target !== null) {
      this.ball += (target - this.ball) * follow(18, dt);
      if (Math.abs(target - this.ball) > 0.002) busy = true;
    }
    if (this.mode !== 'drop' && !this.tween) {
      // put the number right under the pointer (or, resting after the game,
      // centre the answer)
      const halfT = this.restHalf + BETA * Math.abs(this.ball);
      const camT = over && !look ? this.focus : this.ball - this.fracOf(this.ball) * halfT;
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

    // spring nodes: a smooth bell under the floating ball
    const sigma = this.sigma;
    const lo = Math.floor(this.cam - this.half - 4);
    const hi = Math.ceil(this.cam + this.half + 4);
    const peak = this.maxH;
    for (let n = lo; n <= hi; n++) {
      const rest = this.restFor(n);
      const d = n - this.ball;
      const bell = (peak - rest) * this.lift * this.prox * Math.exp(-(d * d) / (2 * sigma * sigma));
      const target = Math.max(2, rest + bell);
      let b = this.nodes.get(n);
      if (!b) {
        b = { h: target, v: 0 };
        this.nodes.set(n, b);
      }
      if (this.frozen) {
        b.v = 0; // the wave holds its shape while the drop plays out
        continue;
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
      this.bvx = this.from.x + (restX - this.from.x) * this.slide;
      this.bvy = this.sink > 0
        ? landY + (window.innerHeight + 3 * BALL_R - landY) * this.sink
        : this.from.y + (landY - this.from.y) * this.fall;
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
    if (this.hit) {
      this.hit.t += dt;
      busy = true;
      if (this.hit.t > HIT_END) this.hit = null;
    }

    // the wave reaches up toward the ball: tall when it's near, low when far
    this.prox = Math.exp(-Math.max(0, wall - this.bvy) / (REACH * this.maxH));

    // readout
    const live = (this.enabled && (this.engaged || this.mode === 'key' || this.mode === 'drop')) || look;
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

  /**
   * Drop the ball on the whole number under it and score it: it locks on
   * (snaps across to the number), holds for a beat, then slams straight down
   * into the frozen wave, punches the scoring bar into it and keeps falling,
   * off the bottom of the screen. Then a new ball appears for the next try.
   */
  drop(u) {
    const v = Math.round(u);
    if (v === 0) return; // N itself is never the answer; ignore
    this.mode = 'drop';
    this.target = v;
    this.from = { x: this.bvx ?? 0, y: this.bvy ?? 0 };
    this.slide = 0;
    this.fall = 0;
    const linear = (t) => t;
    this.animate({ ball: v, slide: 1 }, 0.07, linear, () =>
      this.animate({}, 0.05, linear, () => {
        this.frozen = true; // the wave stays up, exactly as it is
        sfx.fall(0.12);
        this.animate({ fall: 1 }, 0.12, easeIn, () => this.impact(v));
      }),
    );
  }

  impact(v) {
    sfx.crash();
    // score it first: an accepted drop comes back with its hint colour
    const res = this.onDrop(this.center + v);
    const accepted = !!res;
    const color = typeof res === 'string' ? res : null;
    if (color) this.hit = { u: v, color, t: 0 };
    if (!REDUCED) {
      // a brief brightness pop on the whole scene
      const game = this.canvas.parentElement;
      game.classList.remove('impact');
      void game.offsetWidth;
      game.classList.add('impact');
    }
    this.kick();
    // on through the wave and off the bottom of the screen, already moving
    // fast, so it keeps accelerating from the slam's speed
    this.sink = 0;
    this.animate({ sink: 1 }, 0.24, (t) => t * (0.6 + 0.4 * t), () => {
      // wait for the bar to narrow into its marker, then the next ball
      const wait = accepted ? Math.max(0.05, HIT_END - 0.24 + 0.05) : 0.2;
      this.animate({}, wait, (t) => t, () => this.respawn());
    });
  }

  /** After a drop: thaw the wave and bring in a fresh ball (or end the game). */
  respawn() {
    this.frozen = false;
    this.sink = 0;
    this.fall = 0;
    this.slide = 0;
    this.from = null;
    this.target = null;
    this.mode = 'idle';
    if (!this.enabled) {
      this.set({}); // game over: reveal the answer
      return;
    }
    // re-materialise at the pointer (or above the wave), fading in in steps
    this.bvx = null;
    this.bvy = null;
    this.appear = 0;
    this.animate({ appear: 1 }, 0.25, (t) => t);
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
    if (this.mode === 'drop' || e.button > 0) return;
    if (!this.enabled && this.focus === null) return;
    sfx.unlock(); // browsers allow sound only after a click or tap
    e.preventDefault();
    this.canvas.focus({ preventScroll: true });
    this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    this.engage(e);
  }

  onMove(e) {
    if (this.mode === 'drop') return;
    if (!this.enabled && this.focus === null) return;
    // mouse steers by hovering; touch and pen steer while pressed
    if (e.pointerType === 'mouse' || this.down) this.engage(e);
  }

  onUp(e) {
    const d = this.down;
    this.down = null;
    if (!d || this.mode === 'drop') return;
    if (!this.enabled) {
      if (e.pointerType !== 'mouse') this.disengage(); // lifted: back to the answer
      return;
    }
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
    sfx.unlock();
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
      this.kb = clamp(this.kb + step, -this.reach, this.reach);
      this.kick();
    } else if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      this.drop(this.mode === 'key' ? this.kb : this.ball);
    }
  }

  // ---- drawing -----------------------------------------------------------

  draw() {
    const { ctx, w, h } = this;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);

    const base = this.baseline;
    const ppu = this.ppu;
    const lo = Math.floor(this.cam - this.half - 2);
    const hi = Math.ceil(this.cam + this.half + 2);
    const fade = (x) => clamp((Math.min(x, w - x) - 2) / 28, 0, 1);
    const showBall = this.showBall;
    const bx = this.ballX();

    // glow behind the crest
    if (showBall && this.lift > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gy = base - this.maxH * 0.45;
      const ry = Math.min(gy - 2, this.maxH * 0.8);
      ctx.translate(bx, gy);
      ctx.scale(1.5, 1);
      const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
      rg.addColorStop(0, `rgba(200, 70, 255, ${0.28 * this.lift * this.prox})`);
      rg.addColorStop(1, 'rgba(200, 70, 255, 0)');
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
    core.addColorStop(0, 'rgba(150, 70, 255, 0)');
    core.addColorStop(Math.max(0, p - 0.34), 'rgba(150, 70, 255, 0)');
    core.addColorStop(Math.max(0, p - 0.2), 'rgba(150, 70, 255, 0.24)');
    core.addColorStop(Math.max(0, p - 0.08), 'rgba(222, 72, 242, 0.85)');
    core.addColorStop(p, '#f0a6ff');
    core.addColorStop(Math.min(1, p + 0.08), 'rgba(222, 72, 242, 0.85)');
    core.addColorStop(Math.min(1, p + 0.2), 'rgba(150, 70, 255, 0.24)');
    core.addColorStop(Math.min(1, p + 0.34), 'rgba(150, 70, 255, 0)');
    core.addColorStop(1, 'rgba(150, 70, 255, 0)');
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
    lg.addColorStop(0, 'rgba(150, 70, 255, 0)');
    lg.addColorStop(0.5, 'rgba(220, 130, 255, 0.8)');
    lg.addColorStop(1, 'rgba(150, 70, 255, 0)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, base, w, 1.5);
    if (ppu >= 5) {
      ctx.fillStyle = 'rgba(230, 195, 255, 0.55)';
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
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
      return { x, y };
    };
    const stacked = { left: 0, right: 0 };
    for (const m of this.markers) {
      const u = m.value - this.center;
      const x = this.xOf(u);
      const color = m.color || '#fff';
      if (x < PAD - 10 || x > w - PAD + 10) {
        const side = x < w / 2 ? 'left' : 'right';
        this.edgeArrow(side, base - 40 - stacked[side] * 16, color);
        stacked[side] += 1;
        continue;
      }
      stem(u, color, 2, 10);
    }
    if (this.hit) this.drawHit();

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

    // after the game: the closest prime(s), in green
    if (this.reveal > 0.01) {
      this.answers.forEach((a, i) => {
        const u = a - this.center;
        const x = this.xOf(u);
        if (x < -2 || x > w + 2) {
          this.edgeArrow(x < w / 2 ? 'left' : 'right', base - 64, '#3dff9a');
          return;
        }
        // stepped fade-in, like a phosphor warming up
        const k = Math.round(this.reveal * 4) / 4;
        ctx.save();
        ctx.globalAlpha = k;
        const line = (dx, rgb, width, a) => {
          const lg = ctx.createLinearGradient(0, base, 0, 0);
          lg.addColorStop(0, `rgba(${rgb}, ${a})`);
          lg.addColorStop(1, `rgba(${rgb}, ${a * 0.3})`);
          ctx.fillStyle = lg;
          ctx.fillRect(x + dx - width / 2, 0, width, base);
        };
        ctx.globalCompositeOperation = 'lighter';
        line(0, '61, 255, 154', 8, 0.12);
        line(-1.5, '255, 50, 140', 1.2, 0.45);
        line(1.5, '60, 220, 255', 1.2, 0.45);
        ctx.globalCompositeOperation = 'source-over';
        line(0, '125, 255, 168', 2, 0.95);
        const L = this.answerLabels?.[i];
        if (L) ctx.drawImage(L.canvas, x - L.w / 2, this.surfaceY(u) - L.h - 10, L.w, L.h);
        ctx.restore();
      });
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
        NumberBar.poly(g, s, x, y, '#d070ff', 2.4); // soft halo
        g.globalAlpha = a * 0.8;
        NumberBar.poly(g, s, x - 1, y, 'rgb(255, 50, 140)');
        NumberBar.poly(g, s, x + 1, y, 'rgb(60, 220, 255)');
        g.globalAlpha = a;
        NumberBar.poly(g, s, x, y, s.white ? '#f4f3f8' : '#ecc8ff');
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

    // lock-on brackets on the number being hit, until the ball lands
    if (this.mode === 'drop' && this.target !== null && this.fall < 1) {
      const tx = R.left + this.xOf(this.target);
      const ty = R.top + this.surfaceY(this.target);
      const on = this.slide < 1 ? Math.floor(performance.now() / 45) % 2 === 0 : true;
      if (on) {
        const k = 11;
        const c = 5;
        const brackets = (dx, color) => {
          g.strokeStyle = color;
          g.lineWidth = 1.5;
          g.beginPath();
          for (const [qx, qy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const cx = tx + dx + qx * k;
            const cy = ty + qy * k;
            g.moveTo(cx, cy - qy * c);
            g.lineTo(cx, cy);
            g.lineTo(cx - qx * c, cy);
          }
          g.stroke();
        };
        g.save();
        g.globalCompositeOperation = 'lighter';
        brackets(-1.2, 'rgba(255, 50, 140, 0.8)');
        brackets(1.2, 'rgba(60, 220, 255, 0.7)');
        brackets(0, '#ffffff');
        g.restore();
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
      line(0, '220, 120, 255', 7, a * 0.25); // soft bloom
      line(-1.5, '255, 50, 140', 1.6, a * 0.9);
      line(1.5, '60, 220, 255', 1.6, a * 0.8);
      line(0, '255, 255, 255', 1.2, a);
      g.restore();
    }

    // ball, CRT style
    if (this.ballSprite) {
      const S = this.ballSprite;
      let kx = 1;
      let ky = 1;
      if (this.mode === 'drop' && this.fall > 0) {
        kx = 1 - 0.14 * this.fall; // stretched by the speed
        ky = 1 + 0.22 * this.fall;
      }
      const cy = y + BALL_R * (1 - ky);
      const bx0 = x - (S.size * kx) / 2;
      const by0 = cy - (S.size * ky) / 2;
      const appear = Math.round(this.appear * 4) / 4; // stepped fade-in
      if (appear <= 0) return;
      g.globalAlpha = appear;
      g.drawImage(S.canvas, bx0, by0, S.size * kx, S.size * ky);
      g.globalAlpha = 1;
      const tint = this.hit ? clamp(1 - (this.hit.t - HIT_HOLD) / 0.45, 0, 1) : 0;
      if (tint > 0) {
        g.globalAlpha = (Math.round(tint * 4) / 4) * appear; // stepped, like the rest of the CRT
        g.drawImage(this.tintedBall(this.hit.color), bx0, by0, S.size * kx, S.size * ky);
        g.globalAlpha = 1;
      }
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

  /** The ball sprite washed in a colour (cached per colour). */
  tintedBall(color) {
    let c = this.tinted.get(color);
    if (c) return c;
    const S = this.ballSprite;
    c = document.createElement('canvas');
    c.width = S.canvas.width;
    c.height = S.canvas.height;
    const g = c.getContext('2d');
    g.drawImage(S.canvas, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.globalAlpha = 0.78;
    g.fillStyle = color;
    g.fillRect(0, 0, c.width, c.height);
    this.tinted.set(color, c);
    return c;
  }

  /**
   * The bar a scored drop punches into the wave: as wide as the ball, filled
   * with the drop's colour from the baseline up to the wave, its top following
   * the wave's curve, then it narrows down into that drop's thin marker line.
   */
  drawHit() {
    const { ctx } = this;
    const H = this.hit;
    const x = this.xOf(H.u);
    const base = this.baseline;
    const grow = clamp(H.t / 0.06, 0, 1);
    const shrink = easeInOut(clamp((H.t - HIT_HOLD) / (HIT_END - HIT_HOLD), 0, 1));
    const wide = BALL_R * 2.2;
    const width = Math.max(2, wide * grow + (2 - wide) * shrink);
    // clip to the wave under the bar (fringe included), so the bar wraps the
    // wave's shape instead of poking square corners out of it
    const x0 = Math.floor(x - width / 2 - 3);
    const x1 = Math.ceil(x + width / 2 + 3);
    let top = base;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0, base);
    for (let xx = x0; xx <= x1; xx++) {
      const sy = this.surfaceY(this.uOf(xx));
      top = Math.min(top, sy);
      ctx.lineTo(xx, sy);
    }
    ctx.lineTo(x1, base);
    ctx.closePath();
    ctx.clip();
    const y = top + (base - top) * (1 - grow);
    ctx.fillStyle = H.color; // one flat, opaque colour
    ctx.shadowColor = H.color;
    ctx.shadowBlur = 18;
    ctx.fillRect(x - width / 2, y, width, base - y);
    ctx.shadowBlur = 0;
    // CRT fringe on its edges; the face itself stays flat
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.6 * (1 - shrink);
    ctx.fillStyle = 'rgb(255, 50, 140)';
    ctx.fillRect(x - width / 2 - 2, y, 2, base - y);
    ctx.fillStyle = 'rgb(60, 220, 255)';
    ctx.fillRect(x + width / 2, y, 2, base - y);
    ctx.restore();
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
