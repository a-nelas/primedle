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

const NEON = {
  cyan: '#2de2ff',
  violet: '#8a5cff',
  pink: '#ff2fb4',
  blush: '#ff8ad8',
  coral: '#ff9e6b',
  ice: '#eaf8ff',
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const follow = (rate, dt) => 1 - Math.exp(-rate * dt);
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * A neon bar graph with one bar per integer, centred on the daily number N.
 *
 * Positions are in "units": offsets from N. The ball follows the pointer;
 * the camera (`cam`) chases it once it leaves a dead zone around the middle,
 * so holding near an edge keeps scrolling. The view widens (`half`) as the
 * camera travels so N stays on screen. Bars are springs whose targets form a
 * bell curve under the ball while it is held.
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
    this.bars = new Map(); // unit -> { h, v }
    this.tween = null;
    this.raf = 0;
    this.last = 0;
    this.hovered = undefined;

    this.readColors();
    new ResizeObserver(() => this.resize()).observe(canvas);
    document.fonts?.ready.then(() => this.draw());
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
    const g = this.ctx.createLinearGradient(0, this.baseline, 0, this.baseline - this.maxH);
    g.addColorStop(0, NEON.cyan);
    g.addColorStop(0.28, NEON.violet);
    g.addColorStop(0.58, NEON.pink);
    g.addColorStop(0.8, NEON.blush);
    g.addColorStop(1, NEON.coral);
    this.grad = g;
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
    if (n === 0) return this.maxH * 0.2;
    if (this.showPrimes && isPrime(this.center + n)) return this.maxH * 0.3;
    return this.maxH * 0.12;
  }
  xOf(u) {
    return this.w / 2 + (u - this.cam) * this.ppu;
  }
  heightAt(u) {
    const n0 = Math.floor(u);
    const t = u - n0;
    const a = this.bars.get(n0)?.h ?? this.restFor(n0);
    const b = this.bars.get(n0 + 1)?.h ?? this.restFor(n0 + 1);
    return a + (b - a) * t;
  }
  ballX() {
    return this.mode === 'drag' ? this.sx : this.xOf(this.ball);
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
    if (busy) {
      this.raf = requestAnimationFrame((t2) => this.frame(t2));
    }
  }

  zoomStep(dt) {
    const target = clamp(Math.max(this.restHalf, (Math.abs(this.cam) + 2) / 0.82), this.restHalf, MAX_HALF);
    this.half += (target - this.half) * follow(6, dt);
    return Math.abs(target - this.half) > 0.001;
  }

  step(dt) {
    let busy = false;

    if (this.mode === 'drag') {
      busy = true;
      this.sx += (clamp(this.px - this.grabDx, PAD, this.w - PAD) - this.sx) * follow(25, dt);
      const frac = (this.sx - this.w / 2) / this.usable;
      const ex = Math.max(0, Math.abs(frac) - DEAD) / (1 - DEAD);
      const speed = ex * ex * Math.min(this.half * CHASE, MAX_SPEED);
      this.cam = clamp(this.cam + Math.sign(frac) * speed * dt, -MAX_REACH, MAX_REACH);
      this.zoomStep(dt);
      this.ball = this.cam + (this.sx - this.w / 2) / this.ppu;
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

    // bar springs
    const ppu = this.ppu;
    const sigma = Math.max(1.1, 30 / ppu);
    const lo = Math.floor(this.cam - this.half - 3);
    const hi = Math.ceil(this.cam + this.half + 3);
    const peak = this.maxH;
    for (let n = lo; n <= hi; n++) {
      const rest = this.restFor(n);
      const d = n - this.ball;
      const target = rest + (peak - rest) * this.lift * Math.exp(-(d * d) / (2 * sigma * sigma));
      let b = this.bars.get(n);
      if (!b) {
        b = { h: target, v: 0 };
        this.bars.set(n, b);
      }
      const a = STIFF * (target - b.h) - DAMP * b.v;
      b.v += a * dt;
      b.h = Math.max(2, b.h + b.v * dt);
      if (Math.abs(b.v) > 0.5 || Math.abs(target - b.h) > 0.3) busy = true;
    }
    if (this.bars.size > 600) {
      for (const n of this.bars.keys()) if (n < lo - 20 || n > hi + 20) this.bars.delete(n);
    }

    // ball rides on the bar beneath it
    const targetY = this.baseline - this.heightAt(this.ball) - BALL_R - 3;
    if (this.by === null) this.by = targetY;
    this.by += (targetY - this.by) * follow(22, dt);
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
        const b = this.bars.get(v + d);
        if (b) b.v -= 240 * Math.exp(-(d * d) / 3);
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
    const gap = clamp(ppu * 0.22, 0, 3);
    const bw = Math.max(1, ppu - gap);
    const radius = bw > 6 ? Math.min(4, bw / 2) : 0;
    const lo = Math.floor(this.cam - this.half - 2);
    const hi = Math.ceil(this.cam + this.half + 2);
    const fade = (x) => clamp((Math.min(x, w - x) - 2) / 28, 0, 1);
    const showBall = this.enabled || this.mode !== 'idle';
    const bx = this.ballX();
    const hoverU = Math.round(this.mode === 'key' ? this.kb : this.ball);
    const markerAt = new Map(this.markers.map((m) => [m.value - this.center, m]));
    const answerSet = new Set(this.answers.map((a) => a - this.center));

    // glow behind the bell
    if (showBall && this.lift > 0.01) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gy = base - this.maxH * 0.45;
      const rg = ctx.createRadialGradient(bx, gy, 0, bx, gy, 140);
      rg.addColorStop(0, `rgba(255, 47, 180, ${0.32 * this.lift})`);
      rg.addColorStop(1, 'rgba(255, 47, 180, 0)');
      ctx.fillStyle = rg;
      ctx.fillRect(bx - 140, gy - 140, 280, 280);
      ctx.restore();
    }

    // bars (and a faint reflection below the baseline)
    const shapes = [];
    for (let n = lo; n <= hi; n++) {
      const x = this.xOf(n);
      const a = fade(x);
      if (a <= 0) continue;
      const bh = this.bars.get(n)?.h ?? this.restFor(n);
      let fill = this.grad;
      let glow = null;
      const m = markerAt.get(n);
      if (n === 0) {
        fill = NEON.ice;
        glow = 'rgba(200, 240, 255, 0.9)';
      } else if (m) {
        fill = c[m.kind] || NEON.ice;
        glow = fill;
      } else if (answerSet.has(n)) {
        fill = c.correct;
        glow = c.correct;
      } else if (this.showPrimes && isPrime(this.center + n)) {
        fill = c.correct;
      }
      shapes.push({ n, x, a, bh, fill });
      ctx.globalAlpha = a;
      ctx.fillStyle = fill;
      if (glow) {
        ctx.shadowColor = glow;
        ctx.shadowBlur = 14;
      }
      ctx.beginPath();
      if (radius && ctx.roundRect) ctx.roundRect(x - bw / 2, base - bh, bw, bh, [radius, radius, 0, 0]);
      else ctx.rect(x - bw / 2, base - bh, bw, bh);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (showBall && n === hoverU && this.lift > 0.05 && n !== 0 && !m) {
        ctx.globalAlpha = a * this.lift * 0.85;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(x - bw / 2, base - bh, bw, Math.min(4, bh));
      }
    }
    for (const s of shapes) {
      ctx.globalAlpha = s.a * 0.13;
      ctx.fillStyle = s.fill;
      ctx.fillRect(s.x - bw / 2, base + 2, bw, Math.min(30, s.bh * 0.35));
    }
    ctx.globalAlpha = 1;

    // baseline
    const lg = ctx.createLinearGradient(0, 0, w, 0);
    lg.addColorStop(0, 'rgba(45, 226, 255, 0)');
    lg.addColorStop(0.5, 'rgba(255, 47, 180, 0.7)');
    lg.addColorStop(1, 'rgba(45, 226, 255, 0)');
    ctx.fillStyle = lg;
    ctx.fillRect(0, base, w, 1.5);

    // tick labels
    const labelStep = STEPS.find((s) => s * ppu >= 42) ?? 200;
    const xN = this.xOf(0);
    ctx.textAlign = 'center';
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
      ctx.shadowColor = NEON.pink;
      ctx.shadowBlur = 10;
      ctx.fillText(String(this.center), xN, base + 10);
      ctx.shadowBlur = 0;
    } else {
      this.edgeArrow(xN < w / 2 ? 'left' : 'right', base - 24, String(this.center), '#ffffff', 0);
    }

    // guess markers
    const stacked = { left: 0, right: 0 };
    ctx.font = '700 11px Outfit, ui-sans-serif, system-ui, sans-serif';
    for (const m of this.markers) {
      const u = m.value - this.center;
      const x = this.xOf(u);
      const color = c[m.kind] || '#fff';
      if (x < PAD - 10 || x > w - PAD + 10) {
        const side = x < w / 2 ? 'left' : 'right';
        this.edgeArrow(side, base - 50 - stacked[side] * 20, String(m.value), color, stacked[side]);
        stacked[side] += 1;
        continue;
      }
      const top = base - (this.bars.get(u)?.h ?? this.restFor(u));
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(x, top - 8, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.textBaseline = 'alphabetic';
      if (labelStep > 1 || !this.enabled) ctx.fillText(String(m.value), x, top - 17);
      ctx.textBaseline = 'top';
    }

    // answer rings
    for (const u of answerSet) {
      const x = this.xOf(u);
      const top = base - (this.bars.get(u)?.h ?? this.restFor(u));
      ctx.strokeStyle = c.correct;
      ctx.lineWidth = 2.5;
      ctx.shadowColor = c.correct;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(x, top - 10, 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (!markerAt.has(u)) {
        ctx.fillStyle = c.correct;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(String(this.center + u), x, top - 22);
        ctx.textBaseline = 'top';
      }
    }

    if (!showBall) return;

    // ball
    const by = this.by ?? base - BALL_R;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const halo = ctx.createRadialGradient(bx, by, BALL_R * 0.6, bx, by, BALL_R * 3);
    halo.addColorStop(0, `rgba(255, 47, 180, ${0.35 + 0.25 * this.lift})`);
    halo.addColorStop(1, 'rgba(255, 47, 180, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(bx, by, BALL_R * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const sphere = ctx.createRadialGradient(bx - 4, by - 5, 1, bx, by, BALL_R);
    sphere.addColorStop(0, '#ffffff');
    sphere.addColorStop(0.35, '#ff7ad9');
    sphere.addColorStop(1, '#c3128a');
    ctx.fillStyle = sphere;
    ctx.beginPath();
    ctx.arc(bx, by, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 190, 240, 0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  edgeArrow(side, y, text, color, _i) {
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
