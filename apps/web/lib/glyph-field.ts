/**
 * An animated field of faint monospace glyphs, drawn on two canvases: a base
 * layer of hash-scattered cells, and a lit layer revealed only inside a slow
 * light beam that sweeps across. The pointer leaves a short afterglow that
 * strengthens the cells under it.
 *
 * Reverse-engineered from zeron.sh's hero background (`glyph-field.js`, MIT,
 * itself a dark-mode descendant of anara.com's ASCII hero) and adapted to
 * llame: the glyphs are the theme's own ink (`currentColor` of the host) —
 * pale grey on white, pale grey-white on dark — rather than a brand violet,
 * so the field follows DESIGN.md's achromatic palette and both themes.
 *
 * Fixed to its host: no scroll parallax, and nothing to keep clear, since it
 * sits behind an empty page.
 */

const LINES = [
  "llame run --model default",
  "lim n→∞ 1/n = 0",
  "read kb://notes/today.md",
  "run.queued → run.started → run.completed",
  "0 errors  0 warnings",
  "search_conversations({ q: 'deploy' })",
  "x · 0 = 0",
  "edit apps/web/app/page.tsx",
  "✓ 312 passed",
  "e^(iπ) + 1 = 0",
  "await run.done()",
  "Σ tokens → context",
  "bash › pnpm test",
  "f(0) = 0",
  "git merge --ff-only",
  "compaction › checkpoint",
];
const TEXT = `${LINES.join("     ")}     `;

const CELL_W = 7;
const CELL_H = 13;
/** Rows drawn beyond each edge, so the faded edges never show a seam. */
const OVERSCAN = 60;
/** The fraction of cells that hold a glyph; the rest are gaps. */
const DENSITY = 0.62;
const TRAIL_LIFE_MS = 650;
const TRAIL_SPACING = 12;
const BEAM = { angle: -38, width: 0.12, sweepSeconds: 32 };

/** Alphas per theme: light ink on white needs a touch more than dark. */
const PALETTES = {
  light: { base: [0.07, 0.11], glow: 0.32, lit: [0.1, 0.35], beam: 0.14 },
  dark: { base: [0.06, 0.095], glow: 0.3, lit: [0.18, 0.5], beam: 0.09 },
} as const;
type Palette = (typeof PALETTES)[keyof typeof PALETTES];

const charAt = (r: number, c: number) =>
  TEXT[(((r * 41) % TEXT.length) + c) % TEXT.length] ?? " ";

/** 0.3..0.7 intensity of a kept cell, or -1 for a gap: a stable hash, so
 *  the scatter never changes between frames or resizes. */
function cellIntensity(r: number, c: number): number {
  let h = Math.imul(r + 1, 374_761_393) ^ Math.imul(c + 1, 668_265_263);
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177);
  h = (h ^ (h >>> 16)) >>> 0;
  if (h / 4_294_967_296 <= 1 - DENSITY) return -1;
  return 0.3 + (0.4 * ((h >>> 8) % 256)) / 255;
}

/** The beam's soft band, as a mask gradient for the lit canvas. */
function beamMask(now: number, alpha: number, reduced: boolean): string {
  const phase = (now / 1000 / BEAM.sweepSeconds) % 1;
  const center = reduced
    ? 0.5
    : -0.2 + 1.4 * (0.5 - 0.5 * Math.cos(phase * Math.PI * 2));
  const w = BEAM.width * 100;
  const c = center * 100;
  const soft = `rgba(0,0,0,${alpha * 0.4})`;
  return `linear-gradient(${BEAM.angle + 90}deg, transparent ${c - w}%, ${soft} ${c - w * 0.45}%, rgba(0,0,0,${alpha}) ${c}%, ${soft} ${c + w * 0.45}%, transparent ${c + w}%)`;
}

type TrailPoint = { x: number; y: number; born: number };

export class GlyphField {
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)")
    .matches;
  private readonly coarse = matchMedia("(hover: none)").matches;
  private palette: Palette = PALETTES.light;
  private ink = "currentColor";
  private cols = 0;
  private rows = 0;
  private width = 0;
  private height = 0;
  private cache = new Float32Array(0);
  private heat = new Float32Array(0);
  private hot = new Set<number>();
  private readonly trail: Array<TrailPoint> = [];
  private last = { x: -1e9, y: -1e9 };
  private trailFrame = 0;
  private beamFrame = 0;
  private readonly resize = new ResizeObserver(() => this.setup());
  private readonly theme = new MutationObserver(() => this.setup());

  /** Starts a field in `host`, or does nothing where the platform has no 2D
   *  canvas — the field is decoration, never worth failing a page over. */
  static mount(host: HTMLElement): GlyphField | null {
    const base = document.createElement("canvas");
    const lit = document.createElement("canvas");
    const bx = base.getContext("2d");
    const lx = lit.getContext("2d");
    if (!bx || !lx) return null;
    return new GlyphField(host, { base, bx }, { base: lit, bx: lx });
  }

  private readonly base: HTMLCanvasElement;
  private readonly lit: HTMLCanvasElement;
  private readonly bx: CanvasRenderingContext2D;
  private readonly lx: CanvasRenderingContext2D;

  private constructor(
    private readonly host: HTMLElement,
    baseLayer: { base: HTMLCanvasElement; bx: CanvasRenderingContext2D },
    litLayer: { base: HTMLCanvasElement; bx: CanvasRenderingContext2D },
  ) {
    this.base = baseLayer.base;
    this.bx = baseLayer.bx;
    this.lit = litLayer.base;
    this.lx = litLayer.bx;
    for (const canvas of [this.base, this.lit]) {
      Object.assign(canvas.style, { position: "absolute", left: "0" });
      host.append(canvas);
    }
    this.start();
  }

  destroy(): void {
    cancelAnimationFrame(this.trailFrame);
    cancelAnimationFrame(this.beamFrame);
    removeEventListener("pointermove", this.onMove);
    this.resize.disconnect();
    this.theme.disconnect();
    this.base.remove();
    this.lit.remove();
  }

  private start(): void {
    this.setup();
    void document.fonts.ready.then(() => this.setup());
    this.resize.observe(this.host);
    this.theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    if (!this.coarse && !this.reduced) {
      addEventListener("pointermove", this.onMove, { passive: true });
    }
    if (!this.reduced) this.beamFrame = requestAnimationFrame(this.beamLoop);
  }

  /** Reads the theme and size, then repaints both layers from scratch. */
  private setup(): void {
    const dark = document.documentElement.classList.contains("dark");
    this.palette = dark ? PALETTES.dark : PALETTES.light;
    this.ink = getComputedStyle(this.host).color;
    this.width = this.host.clientWidth;
    this.height = this.host.clientHeight + OVERSCAN * 2;
    this.cols = Math.ceil(this.width / CELL_W) + 1;
    this.rows = Math.ceil(this.height / CELL_H) + 1;
    this.cache = new Float32Array(this.cols * this.rows);
    this.heat = new Float32Array(this.cols * this.rows);
    this.hot = new Set();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        this.cache[r * this.cols + c] = cellIntensity(r, c);
      }
    }
    this.sizeCanvases();
    this.paintBase();
    this.paintLit();
    this.applyBeam(performance.now());
  }

  private sizeCanvases(): void {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    // The host's resolved family (it carries the app's mono face), since a
    // canvas font cannot read CSS variables.
    const mono = getComputedStyle(this.host).fontFamily || "monospace";
    for (const [canvas, cx] of [
      [this.base, this.bx],
      [this.lit, this.lx],
    ] as const) {
      canvas.width = Math.floor(this.width * dpr);
      canvas.height = Math.floor(this.height * dpr);
      canvas.style.width = `${this.width}px`;
      canvas.style.height = `${this.height}px`;
      canvas.style.top = `${-OVERSCAN}px`;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.font = `11px ${mono}`;
      cx.textBaseline = "top";
      cx.fillStyle = this.ink;
    }
  }

  private paintBase(): void {
    this.bx.clearRect(0, 0, this.width, this.height);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) this.drawCell(r, c);
    }
  }

  /** Every glyph, gaps included faintly — shown only where the beam is. */
  private paintLit(): void {
    const [low, high] = this.palette.lit;
    this.lx.clearRect(0, 0, this.width, this.height);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const ch = charAt(r, c);
        if (ch === " ") continue;
        const f = this.cache[r * this.cols + c] ?? -1;
        this.lx.globalAlpha = f < 0 ? low / 3 : low + (high - low) * f;
        this.lx.fillText(ch, c * CELL_W, r * CELL_H);
      }
    }
  }

  private drawCell(r: number, c: number): void {
    this.bx.clearRect(c * CELL_W, r * CELL_H, CELL_W, CELL_H);
    const ch = charAt(r, c);
    const i = r * this.cols + c;
    const f = this.cache[i] ?? -1;
    const h = this.heat[i] ?? 0;
    if (ch === " " || (f < 0 && h <= 0)) return;
    const [low, high] = this.palette.base;
    const a = f < 0 ? 0 : low + (high - low) * f;
    this.bx.globalAlpha = h > 0 ? a + (this.palette.glow - a) * h : a;
    this.bx.fillText(ch, c * CELL_W, r * CELL_H);
  }

  private applyBeam(now: number): void {
    const mask = beamMask(now, this.palette.beam, this.reduced);
    this.lit.style.maskImage = mask;
    this.lit.style.setProperty("-webkit-mask-image", mask);
  }

  private readonly beamLoop = (now: number): void => {
    this.applyBeam(now);
    this.beamFrame = requestAnimationFrame(this.beamLoop);
  };

  /** Records the pointer's path in evenly spaced points, for the afterglow. */
  private readonly onMove = (event: PointerEvent): void => {
    const rect = this.base.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const now = performance.now();
    if (x < 0 || x > this.width || y < 0 || y > this.height) {
      this.last = { x: -1e9, y: -1e9 };
      return;
    }
    if (this.last.x < -9000) this.last = { x, y };
    let d = Math.hypot(x - this.last.x, y - this.last.y);
    while (d >= TRAIL_SPACING) {
      const k = TRAIL_SPACING / d;
      this.last = {
        x: this.last.x + (x - this.last.x) * k,
        y: this.last.y + (y - this.last.y) * k,
      };
      this.trail.push({ ...this.last, born: now });
      d = Math.hypot(x - this.last.x, y - this.last.y);
    }
    this.trail.push({ x, y, born: now });
    this.trail.splice(0, Math.max(0, this.trail.length - 70));
    this.last = { x, y };
    this.trailFrame ||= requestAnimationFrame(this.trailLoop);
  };

  /** Heat from one trail point into the cells within its shrinking radius. */
  private heatFrom(point: TrailPoint, now: number, next: Set<number>): void {
    const life = 1 - (now - point.born) / TRAIL_LIFE_MS;
    if (life <= 0) return;
    const rad = 10 + 48 * life;
    const c0 = Math.max(0, Math.floor((point.x - rad) / CELL_W));
    const c1 = Math.min(this.cols - 1, Math.ceil((point.x + rad) / CELL_W));
    const r0 = Math.max(0, Math.floor((point.y - rad) / CELL_H));
    const r1 = Math.min(this.rows - 1, Math.ceil((point.y + rad) / CELL_H));
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const dist = Math.hypot(
          c * CELL_W + CELL_W / 2 - point.x,
          r * CELL_H + CELL_H / 2 - point.y,
        );
        if (dist >= rad) continue;
        const d = 1 - dist / rad;
        const v = d * d * (3 - 2 * d) * life * life;
        const i = r * this.cols + c;
        if (v > (this.heat[i] ?? 0)) this.heat[i] = v;
        next.add(i);
      }
    }
  }

  private readonly trailLoop = (): void => {
    const now = performance.now();
    while (this.trail[0] && now - this.trail[0].born > TRAIL_LIFE_MS) {
      this.trail.shift();
    }
    for (const i of this.hot) this.heat[i] = 0;
    const next = new Set<number>();
    for (const point of this.trail) this.heatFrom(point, now, next);
    for (const i of new Set([...this.hot, ...next])) {
      const r = Math.floor(i / this.cols);
      this.drawCell(r, i - r * this.cols);
    }
    this.hot = next;
    this.trailFrame = this.trail.length
      ? requestAnimationFrame(this.trailLoop)
      : 0;
  };
}
