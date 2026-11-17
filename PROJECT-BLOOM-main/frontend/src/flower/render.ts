/**
 * Renderers for flower primitives to SVG and Canvas with canvas background
 * customization (solid, radial glow, studio dark, botanical paper).
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

export type Framing = "window" | "tight";

export function frameBox(drawing: FlowerDrawing, framing: Framing, padding = 12): Box {
  if (framing === "window") {
    return { minX: -ORIGINAL_WIDTH / 2, maxX: ORIGINAL_WIDTH / 2, minY: -ORIGINAL_HEIGHT / 2, maxY: ORIGINAL_HEIGHT / 2 };
  }
  const box = boundingBox(drawing.primitives, measureText);
  return { minX: box.minX - padding, maxX: box.maxX + padding, minY: box.minY - padding, maxY: box.maxY + padding };
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

const round = (n: number) => Math.round(n * 100) / 100;

export interface SvgOptions {
  framing?: Framing;
  background?: boolean;
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
    if (drawing.bgStyle === "radial") {
      parts.push(
        `<defs><radialGradient id="bloomRadial" cx="50%" cy="50%" r="65%"><stop offset="0%" stop-color="${drawing.background}" stop-opacity="0.85"/><stop offset="100%" stop-color="${drawing.background}" stop-opacity="1"/></radialGradient></defs>`,
      );
      parts.push(`<rect x="${round(box.minX)}" y="${round(-box.maxY)}" width="${round(w)}" height="${round(h)}" fill="url(#bloomRadial)"/>`);
    } else {
      parts.push(`<rect x="${round(box.minX)}" y="${round(-box.maxY)}" width="${round(w)}" height="${round(h)}" fill="${drawing.background}"/>`);
    }
  }

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
  scale?: number;
}

export function drawingToCanvas(drawing: FlowerDrawing, options: RasterOptions = {}): HTMLCanvasElement {
  const { framing = "window", background = true, scale = 2 } = options;
  const box = frameBox(drawing, framing);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((box.maxX - box.minX) * scale));
  canvas.height = Math.max(1, Math.round((box.maxY - box.minY) * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering context unavailable.");

  if (background) {
    ctx.fillStyle = drawing.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (drawing.bgStyle === "radial") {
      const grad = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        20,
        canvas.width / 2,
        canvas.height / 2,
        canvas.width * 0.6,
      );
      grad.addColorStop(0, "rgba(255, 255, 255, 0.15)");
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    } else if (drawing.bgStyle === "studio") {
      const grad = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        40,
        canvas.width / 2,
        canvas.height / 2,
        canvas.width * 0.7,
      );
      grad.addColorStop(0, "transparent");
      grad.addColorStop(1, "rgba(0, 0, 0, 0.45)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
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

export interface FlowerSticker {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
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
