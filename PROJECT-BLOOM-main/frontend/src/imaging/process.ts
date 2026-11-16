/**
 * The theme renderer. Always starts from an untouched source image and
 * returns a NEW canvas, so effects never stack onto the only copy.
 *
 * Order: colour grade (+ grain, vignette, flash) -> glow/halation -> date
 * stamp -> frame.
 */

import { themeById, type DateStyle, type FrameStyle, type ThemeSettings } from "./themes";

export interface RenderOptions {
  /** Longest side of the photo area in pixels (frames add a little around it). */
  maxSize?: number;
  /** Date printed by the date stamp. */
  date?: Date;
  /** Text written on Polaroid frames. */
  caption?: string;
  /** Makes grain and frame details repeatable. */
  seed?: number;
}

export function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function context2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: false });
  if (!ctx) throw new Error("This browser cannot edit images (no canvas support).");
  return ctx;
}

export type Source = HTMLCanvasElement | HTMLImageElement | HTMLVideoElement | ImageBitmap;

export function sourceSize(source: Source): { width: number; height: number } {
  if (source instanceof HTMLVideoElement) return { width: source.videoWidth, height: source.videoHeight };
  if (source instanceof HTMLImageElement) return { width: source.naturalWidth, height: source.naturalHeight };
  return { width: source.width, height: source.height };
}

/** Copies (and optionally shrinks) any image source into a fresh canvas. */
export function toCanvas(source: Source, maxSize = Infinity): HTMLCanvasElement {
  const { width, height } = sourceSize(source);
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const canvas = makeCanvas(width * scale, height * scale);
  const ctx = context2d(canvas);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Colour grade, flash, vignette and grain in a single pass over the pixels. */
function gradePixels(canvas: HTMLCanvasElement, settings: ThemeSettings, seed: number): void {
  const preset = themeById(settings.preset);
  const g = preset.grade;
  const ctx = context2d(canvas);
  const { width: W, height: H } = canvas;
  const image = ctx.getImageData(0, 0, W, H);
  const data = image.data;
  const src = new Uint8ClampedArray(data); // untouched copy for fringing and intensity blending

  // Per-channel lookup tables: white balance -> exposure -> contrast -> fade.
  const exposure = Math.pow(2, g.exposure);
  const mul = [1 + g.temperature * 0.12 + g.tint * 0.04, 1 - g.tint * 0.08, 1 - g.temperature * 0.14 + g.tint * 0.04];
  const luts = mul.map((m) => {
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) {
      let x = (v / 255) * m * exposure;
      x = (x - 0.5) * g.contrast + 0.5;
      x = Math.min(1, Math.max(0, x));
      x = g.fade + x * (1 - g.fade);
      lut[v] = Math.round(x * 255);
    }
    return lut;
  });
  const [lutR, lutG, lutB] = luts;

  const intensity = settings.intensity;
  const sat = g.saturation;
  const bright = (settings.brightness ?? 0) * 60;
  const cont = 1 + (settings.contrast ?? 0) * 0.6;
  const usat = 1 + (settings.saturation ?? 0);
  const adjust = bright !== 0 || cont !== 1 || usat !== 1;
  const split = g.split * 255;
  const [sR, sG, sB] = g.shadows;
  const [hR, hG, hB] = g.highlights;
  const vignette = settings.vignette;
  const grain = settings.grain * 46;
  const flash = g.flash;
  const shift = Math.round(g.chroma * (Math.max(W, H) / 1200));
  const cx = W / 2;
  const cy = H / 2;
  const maxD = Math.hypot(cx, cy);
  let state = (seed >>> 0) || 1;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let r0 = src[i];
      const g0 = src[i + 1];
      let b0 = src[i + 2];
      if (shift) {
        r0 = src[(y * W + Math.min(W - 1, x + shift)) * 4];
        b0 = src[(y * W + Math.max(0, x - shift)) * 4 + 2];
      }
      let r = lutR[r0];
      let gg = lutG[g0];
      let b = lutB[b0];

      const l = 0.299 * r + 0.587 * gg + 0.114 * b;
      if (sat !== 1) {
        r = l + (r - l) * sat;
        gg = l + (gg - l) * sat;
        b = l + (b - l) * sat;
      }
      if (split) {
        const t = l / 255;
        const ws = (1 - t) * (1 - t);
        const wh = t * t;
        r += split * (ws * sR + wh * hR);
        gg += split * (ws * sG + wh * hG);
        b += split * (ws * sB + wh * hB);
      }
      if (g.bw) {
        const m = 0.25 * r + 0.65 * gg + 0.1 * b;
        r += (m - r) * g.bw;
        gg += (m - gg) * g.bw;
        b += (m - b) * g.bw;
      }

      // Blend the colour grade with the original by the chosen intensity.
      if (intensity < 1) {
        r = src[i] + (r - src[i]) * intensity;
        gg = src[i + 1] + (gg - src[i + 1]) * intensity;
        b = src[i + 2] + (b - src[i + 2]) * intensity;
      }

      // Your own brightness / contrast / saturation, on top of the filter.
      if (adjust) {
        r = (r + bright - 127.5) * cont + 127.5;
        gg = (gg + bright - 127.5) * cont + 127.5;
        b = (b + bright - 127.5) * cont + 127.5;
        if (usat !== 1) {
          const m = 0.299 * r + 0.587 * gg + 0.114 * b;
          r = m + (r - m) * usat;
          gg = m + (gg - m) * usat;
          b = m + (b - m) * usat;
        }
      }

      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) / maxD;
      if (flash) {
        const hot = flash * 95 * Math.max(0, 1 - d * 1.4) ** 2;
        const fall = 1 - flash * 0.55 * smoothstep(0.25, 1, d);
        r = (r + hot) * fall;
        gg = (gg + hot) * fall;
        b = (b + hot * 0.92) * fall;
      }
      if (vignette) {
        const v = 1 - vignette * 0.82 * smoothstep(0.32, 1.05, d);
        r *= v;
        gg *= v;
        b *= v;
      }
      if (grain) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        const n = ((state >>> 0) / 4294967296 - 0.5) * grain * (1.2 - l / 400);
        r += n;
        gg += n;
        b += n;
      }
      data[i] = clamp255(r);
      data[i + 1] = clamp255(gg);
      data[i + 2] = clamp255(b);
    }
  }
  ctx.putImageData(image, 0, 0);
}

/** Soft blur by shrinking and enlarging (works in every browser). */
function blurred(canvas: HTMLCanvasElement, factor = 14): HTMLCanvasElement {
  const small = makeCanvas(canvas.width / factor, canvas.height / factor);
  const sctx = context2d(small);
  sctx.imageSmoothingQuality = "high";
  const mid = makeCanvas(canvas.width / 4, canvas.height / 4);
  const mctx = context2d(mid);
  mctx.imageSmoothingQuality = "high";
  mctx.drawImage(canvas, 0, 0, mid.width, mid.height);
  sctx.drawImage(mid, 0, 0, small.width, small.height);
  const out = makeCanvas(canvas.width, canvas.height);
  const octx = context2d(out);
  octx.imageSmoothingQuality = "high";
  octx.drawImage(small, 0, 0, out.width, out.height);
  return out;
}

function applyGlow(canvas: HTMLCanvasElement, glow: number, halation: number): void {
  if (glow <= 0 && halation <= 0) return;
  const ctx = context2d(canvas);
  const soft = blurred(canvas);
  if (glow > 0) {
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = Math.min(0.75, glow * 0.7);
    ctx.drawImage(soft, 0, 0);
    ctx.restore();
  }
  if (halation > 0) {
    const red = makeCanvas(canvas.width, canvas.height);
    const rctx = context2d(red);
    rctx.drawImage(soft, 0, 0);
    rctx.globalCompositeOperation = "multiply";
    rctx.fillStyle = "#ff3a1a";
    rctx.fillRect(0, 0, red.width, red.height);
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = halation * 0.45;
    ctx.drawImage(red, 0, 0);
    ctx.restore();
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

export function dateText(style: DateStyle, date: Date): string {
  const yy = pad(date.getFullYear() % 100);
  if (style === "handwritten") return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
  return `'${yy} ${pad(date.getMonth() + 1)} ${pad(date.getDate())}`;
}

function drawDateStamp(canvas: HTMLCanvasElement, style: DateStyle, date: Date): void {
  if (style === "none" || style === "handwritten") return; // handwritten dates are written on the frame
  const ctx = context2d(canvas);
  const size = Math.max(12, Math.round(canvas.height * 0.042));
  ctx.save();
  ctx.font = `${style === "film" ? "italic " : ""}500 ${size}px "DM Mono", "Consolas", monospace`;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffa042";
  ctx.shadowColor = "rgba(255, 120, 30, 0.85)";
  ctx.shadowBlur = size * 0.45;
  ctx.fillText(dateText(style, date), canvas.width - size * 1.1, canvas.height - size * 0.95);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

function paperNoise(ctx: CanvasRenderingContext2D, w: number, h: number, base: string, amount: number, seed: number): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);
  let s = seed || 7;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const specks = Math.round((w * h) / 900);
  for (let i = 0; i < specks; i++) {
    ctx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${amount * rand()})` : `rgba(60,40,20,${amount * rand()})`;
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

function leaf(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(size * 0.5, -size * 0.35, size, 0);
  ctx.quadraticCurveTo(size * 0.5, size * 0.35, 0, 0);
  ctx.fill();
  ctx.restore();
}

function sprig(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, angle: number, stem: string, leafColor: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.strokeStyle = stem;
  ctx.lineWidth = Math.max(1, size * 0.025);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(size * 0.5, -size * 0.12, size, -size * 0.05);
  ctx.stroke();
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    leaf(ctx, size * t, -size * 0.1 * t, size * 0.24, -0.9, leafColor);
    leaf(ctx, size * t, -size * 0.06 * t, size * 0.22, 0.75, leafColor);
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function frame(photo: HTMLCanvasElement, style: FrameStyle, opts: { date: Date; caption: string; seed: number; showDate: boolean }): HTMLCanvasElement {
  const W = photo.width;
  const H = photo.height;
  const unit = Math.max(W, H);

  if (style === "polaroid") {
    const side = unit * 0.05;
    const bottom = unit * 0.2;
    const out = makeCanvas(W + side * 2, H + side + bottom);
    const ctx = context2d(out);
    paperNoise(ctx, out.width, out.height, "#f6f2e9", 0.06, opts.seed);
    ctx.drawImage(photo, side, side);
    ctx.strokeStyle = "rgba(40, 30, 20, 0.12)";
    ctx.lineWidth = Math.max(1, unit * 0.0015);
    ctx.strokeRect(side, side, W, H);
    const size = bottom * 0.3;
    ctx.fillStyle = "#3b2c35";
    ctx.font = `italic 400 ${size}px "Fraunces", Georgia, serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(opts.caption, side * 1.2, H + side + bottom * 0.5, W * 0.62);
    if (opts.showDate) {
      ctx.textAlign = "right";
      ctx.font = `italic 400 ${size * 0.62}px "Fraunces", Georgia, serif`;
      ctx.fillStyle = "#7b6670";
      ctx.fillText(dateText("handwritten", opts.date), out.width - side * 1.2, H + side + bottom * 0.52);
    }
    return out;
  }

  if (style === "film") {
    const band = unit * 0.075;
    const side = unit * 0.02;
    const out = makeCanvas(W + side * 2, H + band * 2);
    const ctx = context2d(out);
    ctx.fillStyle = "#0d0a0b";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(photo, side, band);
    const holeW = band * 0.42;
    const holeH = band * 0.34;
    ctx.fillStyle = "#2a2324";
    for (let x = side + holeW * 0.6; x < out.width - holeW; x += holeW * 1.9) {
      roundRect(ctx, x, band * 0.18, holeW, holeH, holeH * 0.25);
      ctx.fill();
      roundRect(ctx, x, out.height - band * 0.18 - holeH, holeW, holeH, holeH * 0.25);
      ctx.fill();
    }
    ctx.fillStyle = "#e0912f";
    ctx.font = `500 ${band * 0.22}px "DM Mono", monospace`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText("BLOOM 400", side * 2, band * 0.78);
    ctx.textAlign = "right";
    ctx.fillText(`${(opts.seed % 36) + 1}A  ▸`, out.width - side * 2, out.height - band * 0.78);
    return out;
  }

  if (style === "scrapbook") {
    const padX = unit * 0.11;
    const padY = unit * 0.12;
    const out = makeCanvas(W + padX * 2, H + padY * 2);
    const ctx = context2d(out);
    paperNoise(ctx, out.width, out.height, "#d9c4a1", 0.12, opts.seed);
    const border = unit * 0.022;
    ctx.save();
    ctx.translate(out.width / 2, out.height / 2 - unit * 0.01);
    ctx.rotate((-2.2 * Math.PI) / 180);
    ctx.shadowColor = "rgba(60, 40, 20, 0.35)";
    ctx.shadowBlur = unit * 0.02;
    ctx.shadowOffsetY = unit * 0.006;
    ctx.fillStyle = "#fbf8f1";
    ctx.fillRect(-W / 2 - border, -H / 2 - border, W + border * 2, H + border * 2);
    ctx.shadowColor = "transparent";
    ctx.drawImage(photo, -W / 2, -H / 2);
    const tapeW = unit * 0.16;
    const tapeH = unit * 0.045;
    const tape = (x: number, y: number, angle: number, color: string) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.fillStyle = color;
      ctx.fillRect(-tapeW / 2, -tapeH / 2, tapeW, tapeH);
      ctx.restore();
    };
    tape(-W / 2 + tapeW * 0.25, -H / 2 - border * 0.5, -0.6, "rgba(231, 163, 181, 0.72)");
    tape(W / 2 - tapeW * 0.25, -H / 2 - border * 0.5, 0.55, "rgba(157, 179, 154, 0.75)");
    ctx.restore();
    if (opts.showDate) {
      ctx.fillStyle = "#4a3326";
      ctx.font = `italic 400 ${unit * 0.042}px "Fraunces", Georgia, serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(dateText("handwritten", opts.date), out.width - padX * 0.9, out.height - padY * 0.45);
    }
    ctx.fillStyle = "#c96b88";
    ctx.font = `${unit * 0.035}px "Fraunces", Georgia, serif`;
    ctx.textAlign = "left";
    ctx.fillText("♡", padX * 0.8, out.height - padY * 0.45);
    return out;
  }

  if (style === "cream" || style === "garden" || style === "midnight") {
    const border = unit * (style === "cream" ? 0.04 : 0.07);
    const out = makeCanvas(W + border * 2, H + border * 2);
    const ctx = context2d(out);
    const base = style === "cream" ? "#f4ead9" : style === "garden" ? "#dfe6d5" : "#1e1226";
    paperNoise(ctx, out.width, out.height, base, style === "midnight" ? 0.05 : 0.07, opts.seed);
    ctx.drawImage(photo, border, border);
    ctx.strokeStyle = style === "midnight" ? "rgba(231, 163, 181, 0.6)" : "rgba(80, 60, 50, 0.25)";
    ctx.lineWidth = Math.max(1, unit * 0.0016);
    const inset = border * 0.45;
    ctx.strokeRect(inset, inset, out.width - inset * 2, out.height - inset * 2);
    if (style === "garden") {
      sprig(ctx, border * 0.3, out.height - border * 0.35, border * 2.2, -0.55, "#687d5f", "#8fa385");
      sprig(ctx, out.width - border * 0.3, border * 0.35, border * 2.2, Math.PI - 0.55, "#687d5f", "#8fa385");
    }
    if (style === "midnight") {
      let s = opts.seed || 3;
      for (let i = 0; i < 26; i++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const x = (s / 4294967296) * out.width;
        s = (s * 1664525 + 1013904223) >>> 0;
        const y = (s / 4294967296) * out.height;
        const inside = x > border && x < out.width - border && y > border && y < out.height - border;
        if (inside) continue;
        ctx.fillStyle = "rgba(244, 234, 217, 0.7)";
        ctx.beginPath();
        ctx.arc(x, y, unit * 0.0016 + (i % 3) * unit * 0.0008, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (opts.showDate && style !== "midnight") {
      ctx.fillStyle = style === "garden" ? "#4d5f47" : "#5d4a52";
      ctx.font = `italic 400 ${border * 0.42}px "Fraunces", Georgia, serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(dateText("handwritten", opts.date), out.width - border, out.height - border * 0.5);
    }
    return out;
  }

  if (style === "y2k") {
    const border = unit * 0.022;
    const out = makeCanvas(W + border * 2, H + border * 2);
    const ctx = context2d(out);
    ctx.fillStyle = "#0b0b0e";
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.save();
    roundRect(ctx, border, border, W, H, unit * 0.012);
    ctx.clip();
    ctx.drawImage(photo, border, border);
    ctx.restore();
    const size = unit * 0.024;
    ctx.font = `500 ${size}px "DM Mono", monospace`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.86)";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText("AUTO  3.2M  ◉", border + size, border + size * 0.8);
    ctx.textAlign = "right";
    ctx.fillText("▮▮▮▯", out.width - border - size, border + size * 0.8);
    return out;
  }

  return photo;
}

/**
 * Renders a theme onto a COPY of the source. The source is never modified.
 */
export function renderThemed(source: Source, settings: ThemeSettings, options: RenderOptions = {}): HTMLCanvasElement {
  const preset = themeById(settings.preset);
  const seed = options.seed ?? 1234;
  const date = options.date ?? new Date();
  const working = toCanvas(source, options.maxSize ?? 2400);
  const neutral =
    preset.id === "natural" &&
    settings.grain === 0 &&
    settings.vignette === 0 &&
    settings.glow === 0 &&
    !settings.brightness &&
    !settings.contrast &&
    !settings.saturation;
  if (!neutral) gradePixels(working, settings, seed);
  applyGlow(working, settings.glow, preset.grade.halation * settings.intensity);
  if (settings.dateStamp) drawDateStamp(working, preset.date, date);
  if (!settings.frame || preset.frame === "none") return working;
  const showDate = settings.dateStamp || preset.date === "handwritten";
  return frame(working, preset.frame, {
    date,
    caption: options.caption ?? "",
    seed,
    showDate: settings.dateStamp && showDate,
  });
}
