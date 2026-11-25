import { isPrime } from './primes.js';

const PAD = 30; // px kept free at each end of the track
const BALL_R = 15;
const MIN_HALF = 6; // numbers visible on each side at rest
const STRETCH = 10; // at the far end of the track the view is this many times wider
const LN_STRETCH = Math.log(STRETCH);
const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500];

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * A number line centred on the daily number with a draggable ball.
 *
 * While dragging, the pointer's position along the track sets both the
 * value under the ball and the zoom: the farther from the centre, the wider
 * the visible range, so the ticks squeeze together (the bar "stretches").
 * The mapping is fixed per position, so the ball always stays under the
 * pointer and a given spot always means the same number.
 */
export class NumberBar {
  constructor(canvas, { center, onDrop }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.center = center;
    this.onDrop = onDrop;

    this.w = 0;
    this.h = 0;
    this.base = MIN_HALF; // rest half-range, widened so all markers fit
    this.half = MIN_HALF; // current half-range
    this.offset = 0; // ball position in units relative to center
    this.lift = 0; // 0 = resting on the track, 1 = held up
    this.mode = 'idle'; // idle | drag | key | anim
    this.kb = 0;
    this.enabled = true;
    this.markers = []; // { value, kind }
    this.answers = [];
    this.showPrimes = false;
    this.tween = null;
    this.raf = 0;

    this.readColors();
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', () => {
      this.readColors();
      this.draw();
    });

    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.onDown(e));
    canvas.addEventListener('pointermove', (e) => this.onMove(e));
    canvas.addEventListener('pointerup', (e) => this.onUp(e));
    canvas.addEventListener('pointercancel', () => this.onCancel());
    canvas.addEventListener('lostpointercapture', () => this.onCancel());
    canvas.addEventListener('keydown', (e) => this.onKey(e));
    canvas.addEventListener('blur', () => {
      if (this.mode === 'key') this.returnHome();
    });
    this.resize();
  }

  /** Update markers / end-of-game display. */
  set({ markers, answers, showPrimes, enabled }) {
    if (markers) this.markers = markers;
    if (answers) this.answers = answers;
    if (showPrimes !== undefined) this.showPrimes = showPrimes;
    if (enabled !== undefined) this.enabled = enabled;
    // While playing the rest view stays close in, so a wild guess doesn't
    // cost precision later. At the end, fit the answer with some room around
    // it. Guesses outside the view show as arrows at the edges.
    let far = 0;
    for (const a of this.answers) far = Math.max(far, Math.abs(a - this.center));
    this.base = this.answers.length ? Math.max(MIN_HALF + 2, Math.ceil(far * 1.5) + 3) : MIN_HALF;
    if (this.mode === 'idle') this.half = this.base;
    this.canvas.style.cursor = this.enabled ? 'grab' : 'default';
    this.draw();
  }

  readColors() {
    const s = getComputedStyle(document.documentElement);
    const g = (n) => s.getPropertyValue(n).trim();
    this.colors = {
      track: g('--bar-track'),
      tick: g('--bar-tick'),
      label: g('--muted'),
      ink: g('--ink'),
      bg: g('--surface'),
      accent: g('--accent'),
      accentHi: g('--accent-hi'),
      correct: g('--correct'),
      hot: g('--hot'),
      warm: g('--warm'),
      cool: g('--cool'),
      cold: g('--cold'),
    };
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.w = rect.width;
    this.h = rect.height;
    this.canvas.width = Math.round(rect.width * dpr);
    this.canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  get usable() {
    return Math.max(40, this.w / 2 - PAD);
  }
  get trackY() {
    return this.h * 0.66;
  }
  xOf(units) {
    return this.w / 2 + (units * this.usable) / this.half;
  }
  ballY() {
    return this.trackY - BALL_R - 1 - this.lift * 30;
  }
  hoverUnits() {
    return this.mode === 'key' ? this.kb : Math.round(this.offset);
  }

  // ---- animation -------------------------------------------------------

  animate(to, dur, ease = easeOut, done) {
    const from = {};
    for (const k in to) from[k] = this[k];
    this.tween = { from, to, dur, ease, done, t0: performance.now() };
    this.loop();
  }

  loop() {
    if (this.raf) return;
    this.raf = requestAnimationFrame((t) => {
      this.raf = 0;
      let more = false;
      const tw = this.tween;
      if (tw) {
        const p = clamp((t - tw.t0) / tw.dur, 0, 1);
        const e = tw.ease(p);
        for (const k in tw.to) this[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e;
        if (p < 1) more = true;
        else {
          this.tween = null;
          tw.done?.();
          if (this.tween) more = true;
        }
      }
      if (this.mode === 'drag' || this.mode === 'key') {
        this.lift += (1 - this.lift) * 0.3;
        if (1 - this.lift > 0.002) more = true;
        else this.lift = 1;
      }
      this.draw();
      if (more) this.loop();
    });
  }

  returnHome() {
    this.mode = 'anim';
    this.animate({ offset: 0, half: this.base, lift: 0 }, 480, easeInOut, () => {
      this.mode = 'idle';
      this.half = this.base;
    });
  }

  drop() {
    const v = this.hoverUnits();
    this.mode = 'anim';
    if (v === 0) {
      this.returnHome();
      return;
    }
    this.animate({ offset: v, lift: 0 }, 170, easeOut, () => {
      const accepted = this.onDrop(this.center + v);
      this.animate({}, accepted ? 650 : 120, easeOut, () => this.returnHome());
    });
  }

  // ---- input -----------------------------------------------------------

  pointerPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  hitsBall({ x, y }) {
    return Math.hypot(x - this.xOf(this.offset), y - this.ballY()) <= BALL_R + 16;
  }

  onDown(e) {
    if (!this.enabled || this.mode === 'anim' || this.mode === 'drag') return;
    const p = this.pointerPos(e);
    if (!this.hitsBall(p)) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already gone */
    }
    this.grabDx = p.x - this.xOf(this.offset);
    this.mode = 'drag';
    this.canvas.style.cursor = 'grabbing';
    this.dragTo(p.x);
  }

  onMove(e) {
    const p = this.pointerPos(e);
    if (this.mode === 'drag') {
      this.dragTo(p.x);
    } else if (this.enabled && this.mode === 'idle' && e.pointerType === 'mouse') {
      this.canvas.style.cursor = this.hitsBall(p) ? 'grab' : 'default';
    }
  }

  dragTo(px) {
    const frac = clamp((px - this.grabDx - this.w / 2) / this.usable, -1, 1);
    this.half = this.base * Math.exp(LN_STRETCH * Math.abs(frac));
    this.offset = frac * this.half;
    this.loop();
  }

  onUp() {
    if (this.mode !== 'drag') return;
    this.canvas.style.cursor = 'grab';
    this.drop();
  }

  onCancel() {
    if (this.mode !== 'drag') return;
    this.canvas.style.cursor = 'grab';
    this.returnHome();
  }

  onKey(e) {
    if (!this.enabled || this.mode === 'anim' || this.mode === 'drag') return;
    const k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      if (this.mode !== 'key') {
        this.mode = 'key';
        this.kb = 0;
      }
      const lim = Math.round(this.base * STRETCH);
      const step = (k === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1);
      this.kb = clamp(this.kb + step, -lim, lim);
      this.animate({ offset: this.kb, half: Math.max(this.base, Math.abs(this.kb) / 0.75) }, 160);
    } else if ((k === 'Enter' || k === ' ') && this.mode === 'key') {
      e.preventDefault();
      this.drop();
    } else if (k === 'Escape' && this.mode === 'key') {
      this.returnHome();
    }
  }

  // ---- drawing ---------------------------------------------------------

  draw() {
    const { ctx, w, h, colors: c } = this;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);

    const ty = this.trackY;
    const ppu = this.usable / this.half;
    const labelStep = STEPS.find((s) => s * ppu >= 40) ?? 1000;
    const tickStep = STEPS.find((s) => s * ppu >= 6) ?? 1000;
    const edgeAlpha = (x) => clamp((Math.min(x, w - x) - 4) / (PAD + 6), 0, 1);
    const xN = this.xOf(0);

    // track
    ctx.lineCap = 'round';
    ctx.strokeStyle = c.track;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(8, ty);
    ctx.lineTo(w - 8, ty);
    ctx.stroke();

    // ticks + labels
    const lo = Math.floor(this.center - this.half - 3);
    const hi = Math.ceil(this.center + this.half + 3);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '500 12px ui-sans-serif, system-ui, sans-serif';
    for (let n = Math.ceil(lo / tickStep) * tickStep; n <= hi; n += tickStep) {
      if (n === this.center) continue;
      const x = this.xOf(n - this.center);
      const a = edgeAlpha(x);
      if (a <= 0) continue;
      const major = n % labelStep === 0;
      const prime = this.showPrimes && isPrime(n);
      ctx.globalAlpha = a;
      ctx.strokeStyle = prime ? c.correct : c.tick;
      ctx.lineWidth = prime ? 2.5 : major ? 2 : 1.25;
      const th = prime ? 10 : major ? 9 : 5;
      ctx.beginPath();
      ctx.moveTo(x, ty - th);
      ctx.lineTo(x, ty + th);
      ctx.stroke();
      if (major && Math.abs(x - xN) > 34) {
        ctx.fillStyle = c.label;
        ctx.fillText(String(n), x, ty + 16);
      }
    }
    ctx.globalAlpha = 1;

    // daily number
    ctx.strokeStyle = c.accent;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(xN, ty - 13);
    ctx.lineTo(xN, ty + 13);
    ctx.stroke();
    ctx.fillStyle = c.accent;
    ctx.font = '700 15px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(String(this.center), xN, ty + 17);

    // hovered tick
    const hv = this.hoverUnits();
    if (this.lift > 0.05 && hv !== 0) {
      const x = this.xOf(hv);
      ctx.globalAlpha = this.lift;
      ctx.strokeStyle = c.accentHi;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, ty - 12);
      ctx.lineTo(x, ty + 12);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // correct answer rings
    for (const p of this.answers) {
      const x = this.xOf(p - this.center);
      ctx.strokeStyle = c.correct;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, ty, 11, 0, Math.PI * 2);
      ctx.stroke();
    }

    // guess markers
    ctx.font = '700 11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    const stacked = { left: 0, right: 0 };
    for (const m of this.markers) {
      const x = this.xOf(m.value - this.center);
      ctx.fillStyle = c[m.kind] || c.ink;
      if (x < PAD - 14 || x > w - PAD + 14) {
        // off-screen: arrow at the edge pointing to it
        const side = x < w / 2 ? 'left' : 'right';
        const dir = side === 'left' ? -1 : 1;
        const ex = side === 'left' ? 14 : w - 14;
        const ey = ty - 30 - stacked[side] * 22;
        stacked[side] += 1;
        ctx.beginPath();
        ctx.moveTo(ex + dir * 7, ey);
        ctx.lineTo(ex - dir * 3, ey - 6);
        ctx.lineTo(ex - dir * 3, ey + 6);
        ctx.closePath();
        ctx.fill();
        ctx.textAlign = side === 'left' ? 'left' : 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(m.value), ex - dir * 7, ey + 1);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        continue;
      }
      ctx.strokeStyle = c.bg;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, ty, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (labelStep > 1 || this.answers.length) {
        ctx.fillText(String(m.value), x, ty - 15);
      }
    }
    for (const p of this.answers) {
      if (this.markers.some((m) => m.value === p)) continue;
      ctx.fillStyle = c.correct;
      ctx.fillText(String(p), this.xOf(p - this.center), ty - 17);
    }

    // the ball is put away once the game is over
    if (!this.enabled && this.mode === 'idle') return;

    // ball shadow
    const bx = this.xOf(this.offset);
    const by = this.ballY();
    ctx.globalAlpha = 0.22 * (1 - this.lift * 0.5);
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(bx, ty + 1, BALL_R * (1 - this.lift * 0.35), 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    // ball
    const grad = ctx.createRadialGradient(bx - 5, by - 6, 2, bx, by, BALL_R);
    grad.addColorStop(0, c.accentHi);
    grad.addColorStop(1, c.accent);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bx, by, BALL_R, 0, Math.PI * 2);
    ctx.fill();

    // value bubble
    if (this.lift > 0.02) {
      const text = String(this.center + hv);
      ctx.font = '700 14px ui-sans-serif, system-ui, sans-serif';
      const bw = ctx.measureText(text).width + 18;
      const bh = 24;
      const bxl = clamp(bx - bw / 2, 4, w - 4 - bw);
      const byt = by - BALL_R - 10 - bh;
      ctx.globalAlpha = this.lift;
      ctx.fillStyle = c.ink;
      ctx.beginPath();
      ctx.roundRect(bxl, byt, bw, bh, 8);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(bx - 5, byt + bh);
      ctx.lineTo(bx + 5, byt + bh);
      ctx.lineTo(bx, byt + bh + 5);
      ctx.fill();
      ctx.fillStyle = c.bg;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, bxl + bw / 2, byt + bh / 2 + 1);
      ctx.globalAlpha = 1;
    }
  }
}
