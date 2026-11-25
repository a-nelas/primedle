import { isPrime } from './primes.js';

const PAD = 22; // px kept free at each end
const BALL_R = 14;
const BASE_HALF = 7; // units visible each side at rest
const MAX_HALF = 60; // widest the view stretches
const MAX_REACH = 48; // farthest the camera may travel from N (prime gaps < 10k are ≤ 36)
const DEAD = 0.15; // camera dead zone, as a fraction of the half-width
const CHASE = 1.5; // camera speed at the very edge, in half-widths per second…
const MAX_SPEED = 24; // …capped at this many units per second
const STIFF = 180;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DAMP = REDUCED ? 2 * Math.sqrt(STIFF) : 20;
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100];
const MAX_SPARKS = 260;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const follow = (rate, dt) => 1 - Math.exp(-rate * dt);
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 1.4;

/**
 * A glowing pink wave over the number line, centred on the daily number N.
 *
 * Positions are in "units": offsets from N. Each integer is a spring node;
 * the wave is a smooth curve through the nodes plus a gentle ambient ripple.
 * While the ball is held the nodes rise into a bell curve under it.
 * The ball follows the pointer; the camera (`cam`) chases it once it leaves
 * a dead zone around the middle, so holding near an edge keeps scrolling.
 * The view widens (`half`) as the camera travels so N stays on screen.
 */
export class NumberBar {
  constructor(canvas, { center, onDrop, onHover }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.center = center;
    this.onDrop = onDrop;
    this.onHover = onHover || (() => {});

    this.w = 0;
    this.h = 0;
    this.restHalf = BASE_HALF;
    this.half = BASE_HALF;
    this.cam = 0;
    this.ball = 0;
    this.lift = 0;
    this.by = null; // smoothed ball y
    this.sx = 0; // smoothed ball screen x while dragging
    this.px = 0; // raw pointer x
    this.grabDx = 0;
    this.kb = 0;
    this.mode = 'idle'; // idle | drag | key | settle | home
    this.enabled = true;
    this.markers = []; // { value, kind }
    this.answers = [];
    this.showPrimes = false;
    this.nodes = new Map(); // unit -> { h, v }
    this.sparks = [];
    this.spawnAcc = 0;
    this.ambientAcc = 0;
    this.time = 0;
    this.tween = null;
    this.raf = 0;
    this.last = 0;
    this.hovered = undefined;

    this.readColors();
    new ResizeObserver(() => this.resize()).observe(canvas);
    document.fonts?.ready.then(() => this.kick());
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', () => this.onUp());
    canvas.addEventListener('pointercancel', () => this.onCancel());
    canvas.addEventListener('lostpointercapture', () => this.onCancel());
    canvas.addEventListener('keydown', (e) => this.onKey(e));
    canvas.addEventListener('blur', () => {
      if (this.mode === 'key') this.goHome();
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
    this.canvas.style.cursor = this.enabled ? 'grab' : 'default';
    this.kick();
  }

  readColors() {
    const s = getComputedStyle(document.documentElement);
    const g = (n, fb) => s.getPropertyValue(n).trim() || fb;
    this.colors = {
      label: g('--muted', '#b9a9d6'),
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
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const top = this.baseline - this.maxH;
    const fill = this.ctx.createLinearGradient(0, this.baseline, 0, top);
    fill.addColorStop(0, 'rgba(150, 20, 120, 0.10)');
    fill.addColorStop(0.1, 'rgba(255, 47, 180, 0.45)');
    fill.addColorStop(0.35, 'rgba(255, 79, 195, 0.85)');
    fill.addColorStop(0.7, '#ff9ddf');
    fill.addColorStop(1, '#fff0fa');
    this.fill = fill;

    this.by = null;
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
    return this.h - 40;
  }
  get maxH() {
    return Math.max(40, this.baseline - 2 * BALL_R - 22);
  }
  restFor(n) {
    if (this.showPrimes && n !== 0 && isPrime(this.center + n)) return this.maxH * 0.32;
    return this.maxH * 0.16;
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
  ambient(x) {
    if (REDUCED) return 0;
    const t = this.time;
    return 4 * Math.sin(x * 0.03 + t * 1.7) + 2.5 * Math.sin(x * 0.071 - t * 1.13) + 1.5 * Math.sin(x * 0.13 + t * 2.3);
  }
  surfaceY(u) {
    return this.baseline - Math.max(3, this.springH(u) + this.ambient(this.xOf(u)));
  }
  ballX() {
    return this.mode === 'drag' ? this.sx : this.xOf(this.ball);
  }
  get showBall() {
    return this.enabled || this.mode !== 'idle';
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
    if (busy) this.raf = requestAnimationFrame((t2) => this.frame(t2));
  }

  zoomStep(dt) {
    const target = clamp(Math.max(this.restHalf, (Math.abs(this.cam) + 2) / 0.82), this.restHalf, MAX_HALF);
    this.half += (target - this.half) * follow(6, dt);
    return Math.abs(target - this.half) > 0.001;
  }

  step(dt) {
    // The ambient ripple and sparkles keep the loop alive unless the
    // player prefers reduced motion.
    let busy = !REDUCED;
    this.time += dt;

    if (this.mode === 'drag') {
      busy = true;
      this.sx += (clamp(this.px - this.grabDx, PAD, this.w - PAD) - this.sx) * follow(25, dt);
      const frac = (this.sx - this.w / 2) / this.usable;
      const ex = Math.max(0, Math.abs(frac) - DEAD) / (1 - DEAD);
      const speed = ex * ex * Math.min(this.half * CHASE, MAX_SPEED);
      this.cam = clamp(this.cam + Math.sign(frac) * speed * dt, -MAX_REACH, MAX_REACH);
      this.zoomStep(dt);
      this.ball = this.uOf(this.sx);
      this.lift += (1 - this.lift) * follow(10, dt);
    } else if (this.mode === 'key') {
      busy = true;
      this.ball += (this.kb - this.ball) * follow(14, dt);
      this.cam += (this.ball - this.cam) * follow(5, dt);
      this.zoomStep(dt);
      this.lift += (1 - this.lift) * follow(10, dt);
    } else if (this.mode === 'idle') {
      busy = this.zoomStep(dt) || busy;
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

    // spring nodes
    const ppu = this.ppu;
    const sigma = Math.max(1.1, 30 / ppu);
    const lo = Math.floor(this.cam - this.half - 4);
    const hi = Math.ceil(this.cam + this.half + 4);
    const peak = this.maxH;
    for (let n = lo; n <= hi; n++) {
      const rest = this.restFor(n);
      const d = n - this.ball;
      const target = rest + (peak - rest) * this.lift * Math.exp(-(d * d) / (2 * sigma * sigma));
      let b = this.nodes.get(n);
      if (!b) {
        b = { h: target, v: 0 };
        this.nodes.set(n, b);
      }
      const a = STIFF * (target - b.h) - DAMP * b.v;
      b.v += a * dt;
      b.h = Math.max(2, b.h + b.v * dt);
      if (Math.abs(b.v) > 0.5 || Math.abs(target - b.h) > 0.3) busy = true;
    }
    if (this.nodes.size > 600) {
      for (const n of this.nodes.keys()) if (n < lo - 20 || n > hi + 20) this.nodes.delete(n);
    }

    // sparkles
    if (!REDUCED) {
      this.ambientAcc += dt * 7;
      while (this.ambientAcc >= 1) {
        this.ambientAcc -= 1;
        const u = this.uOf(PAD + Math.random() * (this.w - 2 * PAD));
        this.spark(u, this.surfaceY(u) - 2, 'drift');
      }
      if (this.showBall && this.lift > 0.05) {
        this.spawnAcc += dt * 48 * this.lift;
        while (this.spawnAcc >= 1) {
          this.spawnAcc -= 1;
          const u = this.ball + gauss() * sigma * 0.7;
          this.spark(u, this.surfaceY(u) - 2, 'crest');
        }
      }
    }
    for (const s of this.sparks) {
      s.life += dt;
      s.u += (s.vx * dt) / ppu;
      s.y += s.vy * dt;
      s.vy *= 1 - 1.4 * dt;
    }
    this.sparks = this.sparks.filter((s) => s.life < s.max);
    if (this.sparks.length) busy = true;

    // the ball rides on the wave
    const targetY = this.surfaceY(this.ball) - BALL_R - 2;
    if (this.by === null) this.by = targetY;
    this.by += (targetY - this.by) * follow(30, dt);
    if (Math.abs(targetY - this.by) > 0.2) busy = true;

    // readout
    const live = this.mode === 'drag' || this.mode === 'key' || this.mode === 'settle';
    const hv = live ? this.center + Math.round(this.mode === 'key' ? this.kb : this.ball) : null;
    if (hv !== this.hovered) {
      this.hovered = hv;
      this.onHover(hv);
    }

    return busy;
  }

  spark(u, y, kind) {
    if (this.sparks.length >= MAX_SPARKS) return;
    const burst = kind === 'burst';
    const drift = kind === 'drift';
    this.sparks.push({
      u,
      y,
      vx: (Math.random() - 0.5) * (burst ? 140 : 26),
      vy: -(burst ? 50 + Math.random() * 130 : drift ? 8 + Math.random() * 22 : 25 + Math.random() * 60),
      life: 0,
      max: (drift ? 0.9 : 0.5) + Math.random() * (burst ? 0.7 : 1.0),
      size: drift ? 0.8 + Math.random() * 1.4 : 1.2 + Math.random() * 2.4,
      phase: Math.random() * Math.PI * 2,
      white: Math.random() < 0.55,
    });
  }

  animate(to, dur, ease, done) {
    const from = {};
    for (const k in to) from[k] = this[k];
    this.tween = { from, to, dur, ease, done, t: 0 };
    this.kick();
  }

  goHome() {
    this.mode = 'home';
    this.animate({ ball: 0, cam: 0, half: this.restHalf, lift: 0 }, 0.55, easeInOut, () => {
      this.mode = 'idle';
    });
  }

  release() {
    const v = this.mode === 'key' ? this.kb : Math.round(this.ball);
    this.mode = 'settle';
    if (v === 0) {
      this.goHome();
      return;
    }
    this.animate({ ball: v, lift: 0 }, 0.22, easeOut, () => {
      for (let d = -3; d <= 3; d++) {
        const b = this.nodes.get(v + d);
        if (b) b.v -= 240 * Math.exp(-(d * d) / 3);
      }
      if (!REDUCED) {
        const y = this.surfaceY(v);
        for (let i = 0; i < 28; i++) this.spark(v + gauss() * 0.4, y, 'burst');
      }
      const accepted = this.onDrop(this.center + v);
      this.animate({}, accepted ? 0.6 : 0.12, easeOut, () => this.goHome());
    });
  }

  // ---- input -------------------------------------------------------------

  pointerX(e) {
    return e.clientX - this.canvas.getBoundingClientRect().left;
  }

  hitsBall(e) {
    const r = this.canvas.getBoundingClientRect();
    const by = this.by ?? this.baseline;
    return Math.hypot(e.clientX - r.left - this.ballX(), e.clientY - r.top - by) <= BALL_R + 18;
  }

  onDown(e) {
    if (!this.enabled || (this.mode !== 'idle' && this.mode !== 'key')) return;
    if (!this.hitsBall(e)) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    this.px = this.pointerX(e);
    this.sx = this.xOf(this.ball);
    this.grabDx = this.px - this.sx;
    this.mode = 'drag';
    this.canvas.style.cursor = 'grabbing';
    this.kick();
  }

  onMove(e) {
    if (this.mode === 'drag') {
      this.px = this.pointerX(e);
      this.kick();
    } else if (this.enabled && this.mode === 'idle' && e.pointerType === 'mouse') {
      this.canvas.style.cursor = this.hitsBall(e) ? 'grab' : 'default';
    }
  }

  onUp() {
    if (this.mode !== 'drag') return;
    this.canvas.style.cursor = 'grab';
    this.release();
  }

  onCancel() {
    if (this.mode !== 'drag') return;
    this.canvas.style.cursor = 'grab';
    this.goHome();
  }

  onKey(e) {
    if (!this.enabled || (this.mode !== 'idle' && this.mode !== 'key')) return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      if (this.mode !== 'key') {
        this.mode = 'key';
        this.kb = 0;
      }
      const step = (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1);
      this.kb = clamp(this.kb + step, -MAX_REACH, MAX_REACH);
      this.kick();
    } else if ((k === 'Enter' || k === ' ') && this.mode === 'key') {
      e.preventDefault();
      this.release();
    } else if (k === 'Escape' && this.mode === 'key') {
      this.goHome();
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
    const by = this.by ?? base - BALL_R;
    const markerAt = new Map(this.markers.map((m) => [m.value - this.center, m]));
    const answerSet = new Set(this.answers.map((a) => a - this.center));

    // glow behind the crest
    if (showBall && this.lift > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // an ellipse that fades out before it reaches the canvas top
      const gy = base - this.maxH * 0.45;
      const ry = Math.min(gy - 2, 110);
      ctx.translate(bx, gy);
      ctx.scale(1.5, 1);
      const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, ry);
      rg.addColorStop(0, `rgba(255, 60, 190, ${0.3 * this.lift})`);
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
    ctx.fillStyle = this.fill;
    ctx.fill();

    // reflection under the baseline
    ctx.beginPath();
    ctx.moveTo(0, base);
    for (const [x, y] of pts) ctx.lineTo(x, base + (base - y) * 0.28);
    ctx.lineTo(w, base);
    ctx.closePath();
    ctx.globalAlpha = 0.14;
    ctx.fill();
    ctx.globalAlpha = 1;

    // glowing crest line
    ctx.save();
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.strokeStyle = '#ffd0f0';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.shadowColor = '#ff2fb4';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();

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

    // stems: primes (after the game), guesses, answer and N
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
    const labelStep = STEPS.find((s) => s * ppu >= 42) ?? 200;
    ctx.font = '700 11px Outfit, ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    const stacked = { left: 0, right: 0 };
    for (const m of this.markers) {
      const u = m.value - this.center;
      const x = this.xOf(u);
      const color = c[m.kind] || '#fff';
      if (x < PAD - 10 || x > w - PAD + 10) {
        const side = x < w / 2 ? 'left' : 'right';
        this.edgeArrow(side, base - 50 - stacked[side] * 20, String(m.value), color);
        stacked[side] += 1;
        continue;
      }
      const p = stem(u, color, 2, 10);
      if (p && (labelStep > 1 || !this.enabled)) {
        ctx.fillStyle = color;
        ctx.fillText(String(m.value), p.x, p.y - 10);
      }
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
      if (!markerAt.has(u)) {
        ctx.fillStyle = c.correct;
        ctx.fillText(String(this.center + u), p.x, p.y - 14);
      }
    }
    stem(0, '#ffffff', 2, 12);

    // hovered position: a faint line from the ball to the baseline
    if (showBall && this.lift > 0.05) {
      const hx = this.xOf(Math.round(this.mode === 'key' ? this.kb : this.ball));
      ctx.globalAlpha = this.lift * 0.6;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(hx, by + BALL_R);
      ctx.lineTo(hx, base);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // tick labels
    const xN = this.xOf(0);
    ctx.textBaseline = 'top';
    ctx.font = '600 11px Outfit, ui-sans-serif, system-ui, sans-serif';
    ctx.fillStyle = c.label;
    for (let n = lo; n <= hi; n++) {
      const v = this.center + n;
      if (n === 0 || v % labelStep !== 0) continue;
      const x = this.xOf(n);
      if (Math.abs(x - xN) < 40) continue;
      ctx.globalAlpha = fade(x) * 0.85;
      ctx.fillText(String(v), x, base + 12);
    }
    ctx.globalAlpha = 1;

    // daily number label, or an arrow pinned to the edge when off-screen
    ctx.font = '800 15px Outfit, ui-sans-serif, system-ui, sans-serif';
    if (xN >= PAD - 6 && xN <= w - PAD + 6) {
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = '#ff2fb4';
      ctx.shadowBlur = 10;
      ctx.fillText(String(this.center), xN, base + 10);
      ctx.shadowBlur = 0;
    } else {
      this.edgeArrow(xN < w / 2 ? 'left' : 'right', base - 24, String(this.center), '#ffffff');
    }

    // sparkles
    if (this.sparks.length) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (const s of this.sparks) {
        const x = this.xOf(s.u);
        const a = Math.sin((Math.PI * s.life) / s.max) * (0.65 + 0.35 * Math.sin(s.phase + s.life * 16)) * fade(x);
        if (a <= 0.01) continue;
        const r = s.size;
        ctx.globalAlpha = a;
        ctx.strokeStyle = s.white ? '#ffffff' : '#ffb8ea';
        ctx.lineWidth = Math.max(0.8, r * 0.45);
        ctx.beginPath();
        ctx.moveTo(x - r * 2.2, s.y);
        ctx.lineTo(x + r * 2.2, s.y);
        ctx.moveTo(x, s.y - r * 2.2);
        ctx.lineTo(x, s.y + r * 2.2);
        ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(x, s.y, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    if (!showBall) return;

    // ball: white / light grey
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(bx, by, BALL_R * 0.6, bx, by, BALL_R * 3);
    halo.addColorStop(0, `rgba(255, 255, 255, ${0.22 + 0.18 * this.lift})`);
    halo.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(bx, by, BALL_R * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const sphere = ctx.createRadialGradient(bx - 4, by - 5, 1, bx, by, BALL_R);
    sphere.addColorStop(0, '#ffffff');
    sphere.addColorStop(0.45, '#ecebf1');
    sphere.addColorStop(1, '#a6a3b2');
    ctx.fillStyle = sphere;
    ctx.shadowColor = 'rgba(255, 255, 255, 0.7)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(bx, by, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  edgeArrow(side, y, text, color) {
    const { ctx, w } = this;
    const dir = side === 'left' ? -1 : 1;
    const ex = side === 'left' ? 12 : w - 12;
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
    ctx.shadowBlur = 0;
    ctx.font = '700 12px Outfit, ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = side === 'left' ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, ex - dir * 7, y + 1);
    ctx.restore();
  }
}
