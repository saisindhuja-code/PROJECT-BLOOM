/**
 * Bloom Scrapbook document model, 4 visual page styles, built-in botanical
 * stamps/doodles/washi/scraps, and high-res canvas snapshot renderer.
 */

import { defaultRecipe, normalizeRecipe, type FlowerRecipe } from "../flower/recipe";
import { flowerSticker } from "../flower/render";
import { context2d, makeCanvas } from "../imaging/process";

export type ScrapbookStyleId = "pressed-herbarium" | "kraft-letters" | "midnight-folio" | "pastel-keepsake";
export type ScrapbookFont = "hand" | "serif" | "display" | "mono";
export type PhotoFrameStyle = "none" | "polaroid" | "torn" | "taped";
export type DoodleId = "heart" | "sparkle" | "leaf" | "swirl" | "moon" | "star";

export interface ScrapbookStyleSpec {
  id: ScrapbookStyleId;
  name: string;
  tagline: string;
  paper: string;
  accent: string;
  ink: string;
  border: string;
  grain: number;
}

export const SCRAPBOOK_STYLES: ScrapbookStyleSpec[] = [
  {
    id: "pressed-herbarium",
    name: "Pressed Herbarium",
    tagline: "Cream botanical paper & sage ink",
    paper: "#f6eee3",
    accent: "#7d8c63",
    ink: "#4a2a22",
    border: "rgba(125, 140, 99, 0.45)",
    grain: 0.08,
  },
  {
    id: "kraft-letters",
    name: "Kraft & Letters",
    tagline: "Torn kraft scraps, tape & pen notes",
    paper: "#d8c29d",
    accent: "#a5656c",
    ink: "#3b261d",
    border: "rgba(74, 42, 34, 0.35)",
    grain: 0.14,
  },
  {
    id: "midnight-folio",
    name: "Midnight Folio",
    tagline: "Deep plum pages with lavender ink",
    paper: "#1b1024",
    accent: "#b9a2e8",
    ink: "#f4ead9",
    border: "rgba(231, 163, 181, 0.4)",
    grain: 0.05,
  },
  {
    id: "pastel-keepsake",
    name: "Pastel Keepsake",
    tagline: "Soft blush pearl & dreamy seals",
    paper: "#fbf1f6",
    accent: "#d98ab6",
    ink: "#4a3866",
    border: "rgba(201, 103, 154, 0.35)",
    grain: 0.04,
  },
];

export function scrapbookStyleById(id: string | undefined): ScrapbookStyleSpec {
  return SCRAPBOOK_STYLES.find((s) => s.id === id) ?? SCRAPBOOK_STYLES[0];
}

export interface ScrapbookElement {
  id: string;
  kind: "photo" | "flower" | "sticker" | "user-sticker" | "washi" | "stamp" | "label" | "doodle" | "scrap";
  x: number; // 0..1 page center
  y: number; // 0..1 page center
  w: number; // fraction of page width (0.05..0.9)
  rotation: number; // degrees
  // photo / user-sticker
  mediaId?: number;
  localBlobId?: string;
  url?: string;
  frame?: PhotoFrameStyle;
  caption?: string;
  // flower
  recipe?: FlowerRecipe;
  // built-in sticker
  stickerId?: string;
  // label / stamp / washi / doodle / scrap
  text?: string;
  font?: ScrapbookFont;
  color?: string;
  bgColor?: string;
  doodleId?: DoodleId;
  pattern?: "solid" | "stripe" | "dots";
}

export interface ScrapbookStroke {
  id: string;
  color: string;
  width: number; // 1..12
  points: Array<[number, number]>; // normalized 0..1
}

export interface ScrapbookDoc {
  version: 1;
  style: ScrapbookStyleId;
  elements: ScrapbookElement[];
  strokes: ScrapbookStroke[];
}

export function defaultScrapbookDoc(style: ScrapbookStyleId = "pressed-herbarium"): ScrapbookDoc {
  return { version: 1, style, elements: [], strokes: [] };
}

export function normalizeScrapbookDoc(input: unknown): ScrapbookDoc {
  if (!input || typeof input !== "object") return defaultScrapbookDoc();
  const data = input as Record<string, unknown>;
  const style = scrapbookStyleById(typeof data.style === "string" ? data.style : undefined).id;
  const elements = Array.isArray(data.elements)
    ? data.elements
        .filter((e): e is ScrapbookElement => Boolean(e) && typeof e === "object" && typeof (e as ScrapbookElement).kind === "string")
        .map((e) => ({
          ...e,
          x: Number.isFinite(e.x) ? e.x : 0.5,
          y: Number.isFinite(e.y) ? e.y : 0.5,
          w: Number.isFinite(e.w) ? Math.min(0.95, Math.max(0.06, e.w)) : 0.35,
          rotation: Number.isFinite(e.rotation) ? e.rotation : 0,
          recipe: e.recipe ? normalizeRecipe(e.recipe) : undefined,
        }))
    : [];
  const strokes = Array.isArray(data.strokes)
    ? data.strokes.filter((s): s is ScrapbookStroke => Boolean(s) && typeof s === "object" && Array.isArray((s as ScrapbookStroke).points))
    : [];
  return { version: 1, style, elements, strokes };
}

export const BUILTIN_STICKERS: Array<{ id: string; label: string; recipe: FlowerRecipe }> = [
  { id: "rose", label: "Pressed Rose", recipe: { ...defaultRecipe("rose"), shape: "flower" } },
  { id: "daisy", label: "Meadow Daisy", recipe: { ...defaultRecipe("daisy"), shape: "flower", colors: { ...defaultRecipe().colors, ring1: "#fff8d6", ring2: "#ffe8a3", ring3: "#ffffff", ring4: "#f6d3dc", ring5: "#e7a3b5" } } },
  { id: "crescent", label: "Night Moon", recipe: { ...defaultRecipe("moon"), shape: "moon" } },
  { id: "heart", label: "Paper Heart", recipe: { ...defaultRecipe("love"), shape: "heart" } },
  { id: "star", label: "Starburst", recipe: { ...defaultRecipe("shine"), shape: "star" } },
];

export const WASHI_COLORS = [
  { label: "Dusty Rose", color: "rgba(201, 123, 132, 0.72)" },
  { label: "Herbarium Sage", color: "rgba(143, 163, 133, 0.75)" },
  { label: "Warm Cream", color: "rgba(244, 234, 217, 0.82)" },
  { label: "Twilight Lavender", color: "rgba(185, 162, 232, 0.72)" },
];

export function fontFamilyFor(font: ScrapbookFont = "hand"): string {
  switch (font) {
    case "serif":
      return '"Fraunces", Georgia, serif';
    case "display":
      return '"Cormorant Garamond", Georgia, serif';
    case "mono":
      return '"DM Mono", monospace';
    default:
      return '"Caveat", "Segoe Print", cursive';
  }
}

function drawTornRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, seedNum: number): void {
  let s = seedNum || 17;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296 - 0.5;
  };
  ctx.beginPath();
  ctx.moveTo(x, y);
  const stepsX = 18;
  const stepsY = 14;
  for (let i = 1; i <= stepsX; i++) ctx.lineTo(x + (w * i) / stepsX, y + rand() * 5);
  for (let i = 1; i <= stepsY; i++) ctx.lineTo(x + w + rand() * 5, y + (h * i) / stepsY);
  for (let i = stepsX - 1; i >= 0; i--) ctx.lineTo(x + (w * i) / stepsX, y + h + rand() * 5);
  for (let i = stepsY - 1; i >= 0; i--) ctx.lineTo(x + rand() * 5, y + (h * i) / stepsY);
  ctx.closePath();
}

function drawDoodle(ctx: CanvasRenderingContext2D, id: DoodleId, w: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(2, w * 0.045);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const r = w * 0.36;
  ctx.beginPath();
  if (id === "heart") {
    ctx.moveTo(0, r * 0.75);
    ctx.bezierCurveTo(-r * 1.3, -r * 0.2, -r * 0.6, -r * 1.1, 0, -r * 0.35);
    ctx.bezierCurveTo(r * 0.6, -r * 1.1, r * 1.3, -r * 0.2, 0, r * 0.75);
    ctx.stroke();
  } else if (id === "sparkle") {
    ctx.moveTo(0, -r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.quadraticCurveTo(0, 0, 0, r);
    ctx.quadraticCurveTo(0, 0, -r, 0);
    ctx.quadraticCurveTo(0, 0, 0, -r);
    ctx.stroke();
  } else if (id === "leaf") {
    ctx.moveTo(-r * 0.7, r * 0.7);
    ctx.quadraticCurveTo(-r * 0.6, -r * 0.7, r * 0.8, -r * 0.8);
    ctx.quadraticCurveTo(r * 0.7, r * 0.6, -r * 0.7, r * 0.7);
    ctx.moveTo(-r * 0.7, r * 0.7);
    ctx.lineTo(r * 0.4, -r * 0.4);
    ctx.stroke();
  } else if (id === "swirl") {
    for (let a = 0; a < Math.PI * 4.5; a += 0.2) {
      const rr = (a / (Math.PI * 4.5)) * r;
      const px = Math.cos(a) * rr;
      const py = Math.sin(a) * rr;
      if (a === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  } else if (id === "moon") {
    ctx.arc(0, 0, r * 0.8, 0.4, Math.PI * 1.75);
    ctx.quadraticCurveTo(-r * 0.1, 0, Math.cos(0.4) * r * 0.8, Math.sin(0.4) * r * 0.8);
    ctx.stroke();
  } else {
    for (let i = 0; i < 10; i++) {
      const rr = i % 2 === 0 ? r : r * 0.44;
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      if (i === 0) ctx.moveTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
      else ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
}

export async function renderScrapbookToCanvas(
  doc: ScrapbookDoc,
  loadImage: (el: ScrapbookElement) => Promise<HTMLImageElement | null>,
  width = 1200,
  height = 1600,
): Promise<HTMLCanvasElement> {
  const style = scrapbookStyleById(doc.style);
  const canvas = makeCanvas(width, height);
  const ctx = context2d(canvas);

  // Page paper background
  ctx.fillStyle = style.paper;
  ctx.fillRect(0, 0, width, height);

  // Subtle paper grain
  let s = 42;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const specks = Math.round((width * height) / 1400);
  for (let i = 0; i < specks; i++) {
    ctx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${style.grain * rand()})` : `rgba(40,25,15,${style.grain * rand()})`;
    ctx.fillRect(rand() * width, rand() * height, 2, 2);
  }

  // Thin double rule border
  ctx.strokeStyle = style.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(24, 24, width - 48, height - 48);
  ctx.lineWidth = 1;
  ctx.strokeRect(32, 32, width - 64, height - 64);

  // Render elements in z-order
  for (let idx = 0; idx < doc.elements.length; idx++) {
    const el = doc.elements[idx];
    const px = el.x * width;
    const py = el.y * height;
    const ew = el.w * width;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate((el.rotation * Math.PI) / 180);

    if (el.kind === "photo" || el.kind === "user-sticker") {
      const img = await loadImage(el);
      if (img) {
        const aspect = img.naturalHeight / Math.max(1, img.naturalWidth);
        const eh = ew * aspect;
        if (el.kind === "photo") {
          const frame = el.frame ?? "polaroid";
          if (frame === "polaroid") {
            const b = ew * 0.06;
            const bb = ew * 0.22;
            ctx.shadowColor = "rgba(0,0,0,0.28)";
            ctx.shadowBlur = 24;
            ctx.shadowOffsetY = 8;
            ctx.fillStyle = "#fcfaf4";
            ctx.fillRect(-ew / 2 - b, -eh / 2 - b, ew + b * 2, eh + b + bb);
            ctx.shadowColor = "transparent";
            ctx.drawImage(img, -ew / 2, -eh / 2, ew, eh);
            if (el.caption) {
              ctx.fillStyle = "#3b2c35";
              ctx.font = `italic 400 ${Math.max(18, ew * 0.085)}px "Caveat", cursive`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(el.caption, 0, eh / 2 + bb * 0.5, ew);
            }
          } else if (frame === "torn") {
            ctx.shadowColor = "rgba(0,0,0,0.25)";
            ctx.shadowBlur = 18;
            ctx.fillStyle = "#f9f6ee";
            drawTornRectPath(ctx, -ew / 2 - 10, -eh / 2 - 10, ew + 20, eh + 20, idx + 9);
            ctx.fill();
            ctx.shadowColor = "transparent";
            ctx.drawImage(img, -ew / 2, -eh / 2, ew, eh);
          } else if (frame === "taped") {
            ctx.drawImage(img, -ew / 2, -eh / 2, ew, eh);
            ctx.fillStyle = "rgba(201, 123, 132, 0.72)";
            ctx.save();
            ctx.translate(0, -eh / 2);
            ctx.rotate(-0.04);
            ctx.fillRect(-ew * 0.18, -12, ew * 0.36, 24);
            ctx.restore();
          } else {
            ctx.drawImage(img, -ew / 2, -eh / 2, ew, eh);
          }
        } else {
          ctx.drawImage(img, -ew / 2, -eh / 2, ew, eh);
        }
      }
    } else if (el.kind === "flower" || el.kind === "sticker") {
      const rec =
        el.kind === "flower" && el.recipe
          ? el.recipe
          : BUILTIN_STICKERS.find((b) => b.id === el.stickerId)?.recipe ?? defaultRecipe("bloom");
      const sticker = flowerSticker(rec, 3);
      const eh = ew * (sticker.height / sticker.width);
      ctx.drawImage(sticker.canvas, -ew / 2, -eh / 2, ew, eh);
    } else if (el.kind === "washi") {
      const eh = ew * 0.22;
      ctx.fillStyle = el.color ?? "rgba(201, 123, 132, 0.74)";
      ctx.fillRect(-ew / 2, -eh / 2, ew, eh);
      if (el.pattern === "stripe") {
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        for (let sx = -ew / 2 + 10; sx < ew / 2; sx += 22) ctx.fillRect(sx, -eh / 2, 8, eh);
      } else if (el.pattern === "dots") {
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        for (let sx = -ew / 2 + 14; sx < ew / 2; sx += 24) {
          ctx.beginPath();
          ctx.arc(sx, 0, 4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (el.kind === "scrap") {
      const eh = ew * 0.65;
      ctx.shadowColor = "rgba(0,0,0,0.18)";
      ctx.shadowBlur = 14;
      ctx.fillStyle = el.bgColor ?? "#efe4d4";
      drawTornRectPath(ctx, -ew / 2, -eh / 2, ew, eh, idx + 31);
      ctx.fill();
      ctx.shadowColor = "transparent";
    } else if (el.kind === "stamp") {
      const r = ew * 0.45;
      const col = el.color ?? style.accent;
      ctx.strokeStyle = col;
      ctx.fillStyle = col;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.82, 0, Math.PI * 2);
      ctx.stroke();
      ctx.font = `600 ${Math.max(14, r * 0.28)}px "DM Mono", monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText((el.text || "BLOOM ARCHIVE").toUpperCase(), 0, 0, r * 1.5);
    } else if (el.kind === "label") {
      const eh = ew * 0.34;
      ctx.fillStyle = el.bgColor ?? "#fffaf2";
      ctx.strokeStyle = style.border;
      ctx.lineWidth = 2;
      ctx.fillRect(-ew / 2, -eh / 2, ew, eh);
      ctx.strokeRect(-ew / 2, -eh / 2, ew, eh);
      ctx.fillStyle = el.color ?? style.ink;
      ctx.font = `500 ${Math.max(18, eh * 0.48)}px ${fontFamilyFor(el.font)}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(el.text || "A note…", 0, 0, ew * 0.88);
    } else if (el.kind === "doodle") {
      drawDoodle(ctx, el.doodleId ?? "heart", ew, el.color ?? style.accent);
    }

    ctx.restore();
  }

  // Freehand strokes
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of doc.strokes) {
    if (stroke.points.length < 2) continue;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.width * (width / 600);
    ctx.beginPath();
    stroke.points.forEach(([nx, ny], i) => {
      if (i === 0) ctx.moveTo(nx * width, ny * height);
      else ctx.lineTo(nx * width, ny * height);
    });
    ctx.stroke();
  }
  ctx.restore();

  return canvas;
}
