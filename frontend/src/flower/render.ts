/**
 * Renderers for the primitives produced by engine.ts.
 * - SVG text (vector export and the live preview)
 * - Canvas drawing (PNG export and photo overlays)
 *
 * turtle.write(align="center") puts the BOTTOM of the text box on the point.
 * Browsers position text by its baseline, so the baseline is raised by the
 * font's descent to match the original placement.
 */

import {
  ORIGINAL_HEIGHT,
  ORIGINAL_WIDTH,
  boundingBox,
  buildFlower,
  type Box,
  type FlowerDrawing,
  type MeasureText,
  type Primitive,
} from "./engine";
import type { FlowerRecipe } from "./recipe";

const DESCENT: Record<string, number> = { arial: 0.212, courier: 0.3 };

function descentFor(family: string): number {
  return family.toLowerCase().includes("courier") ? DESCENT.courier : DESCENT.arial;
}

let measureCanvas: CanvasRenderingContext2D | null = null;

export const measureText: MeasureText = (text, sizePx, family, weight) => {
  if (typeof document === "undefined") return text.length * sizePx * 0.62;
  if (!measureCanvas) measureCanvas = document.createElement("canvas").getContext("2d");
  if (!measureCanvas) return text.length * sizePx * 0.62;
  measureCanvas.font = `${weight} ${sizePx}px ${family}`;
  return measureCanvas.measureText(text).width;
};

export type Framing =
  /** The full original 900 x 600 window. */
  | "window"
  /** Just the flower, cropped tightly (for overlays and stickers). */
  | "tight";

export function frameBox(drawing: FlowerDrawing, framing: Framing, padding = 12): Box {
  if (framing === "window") {
    return { minX: -ORIGINAL_WIDTH / 2, maxX: ORIGINAL_WIDTH / 2, minY: -ORIGINAL_HEIGHT / 2, maxY: ORIGINAL_HEIGHT / 2 };
  }
  const box = boundingBox(drawing.primitives, measureText);
  return { minX: box.minX - padding, maxX: box.maxX + padding, minY: box.minY - padding, maxY: box.maxY + padding };
}

// ---------------------------------------------------------------------------
// SVG
// ---------------------------------------------------------------------------

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

const round = (n: number) => Math.round(n * 100) / 100;

export interface SvgOptions {
  framing?: Framing;
  background?: boolean;
  /** Width attribute of the SVG; the height follows the frame's aspect ratio. */
  width?: number;
  title?: string;
}

export function drawingToSvg(drawing: FlowerDrawing, options: SvgOptions = {}): string {
  const { framing = "window", background = true, title } = options;
  const box = frameBox(drawing, framing);
  const w = box.maxX - box.minX;
  const h = box.maxY - box.minY;
  const outWidth = options.width ?? w;
  const outHeight = (outWidth * h) / w;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(box.minX)} ${round(-box.maxY)} ${round(w)} ${round(h)}" width="${round(outWidth)}" height="${round(outHeight)}">`,
  );
  if (title) parts.push(`<title>${escapeXml(title)}</title>`);
  if (background) {
    parts.push(`<rect x="${round(box.minX)}" y="${round(-box.maxY)}" width="${round(w)}" height="${round(h)}" fill="${drawing.background}"/>`);
  }
  // Consecutive texts share their style, so group them to keep files small.
  let openGroup = "";
  const closeGroup = () => {
    if (openGroup) parts.push("</g>");
    openGroup = "";
  };
  for (const p of drawing.primitives) {
    if (p.kind === "line") {
      closeGroup();
      const pts = p.points.map(([x, y]) => `${round(x)},${round(-y)}`).join(" ");
      parts.push(
        `<polyline points="${pts}" fill="none" stroke="${p.color}" stroke-width="${p.width}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    } else {
      const style = `fill="${p.color}" font-family="${escapeXml(p.family)}" font-size="${p.sizePx}" font-weight="${p.weight}" text-anchor="middle"`;
      if (style !== openGroup) {
        closeGroup();
        parts.push(`<g ${style}>`);
        openGroup = style;
      }
      const baseline = -p.y - p.sizePx * descentFor(p.family);
      parts.push(`<text x="${round(p.x)}" y="${round(baseline)}">${escapeXml(p.text)}</text>`);
    }
  }
  closeGroup();
  parts.push("</svg>");
  return parts.join("");
}

export function recipeToSvg(recipe: FlowerRecipe, options: SvgOptions = {}): string {
  return drawingToSvg(buildFlower(recipe), options);
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

/**
 * Draws primitives onto a canvas context. The caller sets up a transform that
 * maps turtle units to pixels; this function only flips y.
 */
export function drawPrimitives(ctx: CanvasRenderingContext2D, primitives: Primitive[]): void {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (const p of primitives) {
    if (p.kind === "line") {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = p.width;
      ctx.beginPath();
      p.points.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, -y) : ctx.lineTo(x, -y)));
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.font = `${p.weight} ${p.sizePx}px ${p.family}`;
      ctx.fillText(p.text, p.x, -p.y - p.sizePx * descentFor(p.family));
    }
  }
  ctx.restore();
}

export interface RasterOptions {
  framing?: Framing;
  background?: boolean;
  /** Pixels per turtle unit. 1 = the original window size. */
  scale?: number;
}

/** Renders a flower to a new canvas (transparent unless background is on). */
export function drawingToCanvas(drawing: FlowerDrawing, options: RasterOptions = {}): HTMLCanvasElement {
  const { framing = "window", background = true, scale = 2 } = options;
  const box = frameBox(drawing, framing);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((box.maxX - box.minX) * scale));
  canvas.height = Math.max(1, Math.round((box.maxY - box.minY) * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot draw on a canvas.");
  if (background) {
    ctx.fillStyle = drawing.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.setTransform(scale, 0, 0, scale, -box.minX * scale, box.maxY * scale);
  drawPrimitives(ctx, drawing.primitives);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not create the image."))), type, quality);
  });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function safeFileName(word: string): string {
  return word.trim().replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "") || "flower";
}

/**
 * A cached "flower sticker": the tight-cropped transparent rendering used on
 * top of photographs. Width/height are in turtle units (scale 1).
 */
export interface FlowerSticker {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  /** Where the flower's centre (0, 0) sits inside the sticker, in turtle units from the top-left. */
  originX: number;
  originY: number;
}

const stickerCache = new Map<string, FlowerSticker>();

export function flowerSticker(recipe: FlowerRecipe, scale = 3): FlowerSticker {
  const key = JSON.stringify(recipe) + scale;
  const cached = stickerCache.get(key);
  if (cached) return cached;
  const drawing = buildFlower({ ...recipe, showHearts: false });
  const box = frameBox(drawing, "tight", 6);
  const canvas = drawingToCanvas(drawing, { framing: "tight", background: false, scale });
  const sticker: FlowerSticker = {
    canvas,
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
    originX: -box.minX,
    originY: box.maxY,
  };
  if (stickerCache.size > 40) stickerCache.clear();
  stickerCache.set(key, sticker);
  return sticker;
}
