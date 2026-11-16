/**
 * Putting flowers on photos, and arranging several photos into one
 * composition (Bloom Together and Live Bloom).
 */

import { buildFlower } from "../flower/engine";
import type { FlowerRecipe } from "../flower/recipe";
import { flowerSticker, type FlowerSticker } from "../flower/render";
import { context2d, makeCanvas, sourceSize, type Source } from "./process";

/** Where a flower sits on a photo. Positions are fractions of the photo size. */
export interface FlowerPlacement {
  /** Centre of the flower head (where the petals meet). */
  x: number;
  y: number;
  /** Height of the whole flower (with stem) as a fraction of the photo height. */
  size: number;
  /** Degrees, clockwise. */
  rotation: number;
  /** How much of each edge of the flower to cut away (0..0.45). */
  crop: { top: number; right: number; bottom: number; left: number };
  flip: boolean;
  /** Hidden flowers are kept in the edit but not drawn. */
  visible: boolean;
}

export function defaultPlacement(): FlowerPlacement {
  // A pleasant default: lower right third, as if offered toward the camera.
  return { x: 0.64, y: 0.42, size: 0.72, rotation: -8, crop: { top: 0, right: 0, bottom: 0, left: 0 }, flip: false, visible: true };
}

export function normalizePlacement(input: unknown): FlowerPlacement {
  const base = defaultPlacement();
  if (!input || typeof input !== "object") return base;
  const data = input as Record<string, unknown>;
  const num = (value: unknown, min: number, max: number, fallback: number) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const crop = (data.crop && typeof data.crop === "object" ? data.crop : {}) as Record<string, unknown>;
  return {
    x: num(data.x, -0.5, 1.5, base.x),
    y: num(data.y, -0.5, 1.5, base.y),
    size: num(data.size, 0.05, 2.5, base.size),
    rotation: num(data.rotation, -180, 180, base.rotation),
    crop: {
      top: num(crop.top, 0, 0.45, 0),
      right: num(crop.right, 0, 0.45, 0),
      bottom: num(crop.bottom, 0, 0.45, 0),
      left: num(crop.left, 0, 0.45, 0),
    },
    flip: Boolean(data.flip),
    visible: data.visible === undefined ? true : Boolean(data.visible),
  };
}

/** Pixels per turtle unit when the flower is drawn at `size` on an image `imageHeight` tall. */
function unitScale(sticker: FlowerSticker, placement: FlowerPlacement, imageHeight: number): number {
  return (placement.size * imageHeight) / sticker.height;
}

/**
 * Draws a flower onto ctx. (ox, oy, w, h) is the rectangle of the photo it
 * belongs to, in the context's current coordinates.
 */
export function drawFlowerOn(
  ctx: CanvasRenderingContext2D,
  recipe: FlowerRecipe,
  placement: FlowerPlacement,
  rect: { x: number; y: number; w: number; h: number },
): void {
  if (!placement.visible) return;
  const sticker = flowerSticker(recipe);
  const k = unitScale(sticker, placement, rect.h);
  const { crop } = placement;
  const sx = crop.left * sticker.width;
  const sy = crop.top * sticker.height;
  const sw = sticker.width * (1 - crop.left - crop.right);
  const sh = sticker.height * (1 - crop.top - crop.bottom);
  if (sw <= 0 || sh <= 0) return;
  const pxPerUnit = sticker.canvas.width / sticker.width;
  ctx.save();
  ctx.translate(rect.x + placement.x * rect.w, rect.y + placement.y * rect.h);
  ctx.rotate((placement.rotation * Math.PI) / 180);
  ctx.scale(placement.flip ? -k : k, k);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    sticker.canvas,
    sx * pxPerUnit,
    sy * pxPerUnit,
    sw * pxPerUnit,
    sh * pxPerUnit,
    -sticker.originX + sx,
    -sticker.originY + sy,
    sw,
    sh,
  );
  ctx.restore();
}

/** The flower's outline on the photo (for the on-screen handles), in rect pixels. */
export function placementCorners(
  recipe: FlowerRecipe,
  placement: FlowerPlacement,
  rect: { w: number; h: number },
): Array<[number, number]> {
  const sticker = flowerSticker(recipe);
  const k = unitScale(sticker, placement, rect.h);
  const { crop } = placement;
  const left = -sticker.originX + crop.left * sticker.width;
  const right = -sticker.originX + sticker.width * (1 - crop.right);
  const top = -sticker.originY + crop.top * sticker.height;
  const bottom = -sticker.originY + sticker.height * (1 - crop.bottom);
  const angle = (placement.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const fx = placement.flip ? -1 : 1;
  return [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom],
  ].map(([u, v]) => {
    const x = u * k * fx;
    const y = v * k;
    return [placement.x * rect.w + x * cos - y * sin, placement.y * rect.h + x * sin + y * cos];
  });
}

/**
 * Where the stem ends, relative to the flower centre, in turtle units with
 * y pointing DOWN (screen style). Used to put the stem in a hand.
 */
export function stemEnd(recipe: FlowerRecipe): { x: number; y: number } {
  const drawing = buildFlower({ ...recipe, showHearts: false });
  let end: [number, number] | null = null;
  for (const p of drawing.primitives) {
    if (p.kind === "line" && p.width >= 4) end = p.points[p.points.length - 1];
  }
  if (!end) return { x: 0, y: 120 };
  return { x: end[0], y: -end[1] };
}

// ---------------------------------------------------------------------------
// Photo framing inside a slot (cover-fit, then zoom/pan/rotate)
// ---------------------------------------------------------------------------

export interface PhotoTransform {
  zoom: number; // 1 = fill the slot
  panX: number; // -1..1
  panY: number; // -1..1
  rotation: number; // degrees
}

export function defaultPhotoTransform(): PhotoTransform {
  return { zoom: 1, panX: 0, panY: 0, rotation: 0 };
}

export function normalizePhotoTransform(input: unknown): PhotoTransform {
  const base = defaultPhotoTransform();
  if (!input || typeof input !== "object") return base;
  const d = input as Record<string, unknown>;
  const num = (v: unknown, min: number, max: number, f: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : f;
  };
  return {
    zoom: num(d.zoom, 1, 4, 1),
    panX: num(d.panX, -1, 1, 0),
    panY: num(d.panY, -1, 1, 0),
    rotation: num(d.rotation, -180, 180, 0),
  };
}

export function drawPhotoInRect(
  ctx: CanvasRenderingContext2D,
  photo: Source,
  transform: PhotoTransform,
  rect: { x: number; y: number; w: number; h: number },
): void {
  const { width, height } = sourceSize(photo);
  const cover = Math.max(rect.w / width, rect.h / height) * transform.zoom;
  const dw = width * cover;
  const dh = height * cover;
  const spareX = Math.max(0, (dw - rect.w) / 2);
  const spareY = Math.max(0, (dh - rect.h) / 2);
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.translate(rect.x + rect.w / 2 + transform.panX * spareX, rect.y + rect.h / 2 + transform.panY * spareY);
  ctx.rotate((transform.rotation * Math.PI) / 180);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(photo, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Layouts for compositions with several pictures
// ---------------------------------------------------------------------------

export type LayoutId = "side-by-side" | "stacked" | "polaroid-pair" | "scrapbook" | "diagonal" | "overlap";

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
  rotation: number;
  /** A white instant-film border around this slot. */
  polaroid?: boolean;
  /** Clip to the left or right of a diagonal line. */
  diagonal?: "left" | "right";
  tape?: boolean;
}

export interface LayoutSpec {
  id: LayoutId;
  name: string;
  width: number;
  height: number;
  background: string;
  slots: Slot[];
}

export const LAYOUTS: Array<{ id: LayoutId; name: string; hint: string }> = [
  { id: "side-by-side", name: "Side by side", hint: "Two frames, shoulder to shoulder" },
  { id: "stacked", name: "Stacked", hint: "One above the other, like a photo strip" },
  { id: "polaroid-pair", name: "Polaroid pair", hint: "Two instant photos on a table" },
  { id: "scrapbook", name: "Scrapbook", hint: "Taped, tilted, a little messy" },
  { id: "diagonal", name: "Diagonal", hint: "One frame split corner to corner" },
  { id: "overlap", name: "Picture in picture", hint: "One big, one tucked in the corner" },
];

export function layoutSpec(id: LayoutId, count: number): LayoutSpec {
  const n = Math.max(1, count);
  const gap = 24;
  const name = LAYOUTS.find((l) => l.id === id)?.name ?? "Layout";
  if (id === "stacked") {
    const W = 1400;
    const slotH = 900;
    const H = gap + n * (slotH + gap);
    return {
      id, name, width: W, height: H, background: "#f4ead9",
      slots: Array.from({ length: n }, (_, i) => ({ x: gap, y: gap + i * (slotH + gap), w: W - gap * 2, h: slotH, rotation: 0 })),
    };
  }
  if (id === "polaroid-pair" || id === "scrapbook") {
    const W = 2000;
    const H = 1500;
    const cols = n <= 2 ? n : 2;
    const rows = Math.ceil(n / cols);
    const cellW = W / cols;
    const cellH = H / rows;
    const tilts = [-4, 3.5, 2.5, -3, 4, -2.5, 3, -3.5];
    return {
      id, name, width: W, height: H, background: id === "scrapbook" ? "#d9c4a1" : "#2a1934",
      slots: Array.from({ length: n }, (_, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        const w = cellW * 0.74;
        const h = rows === 1 ? Math.min(cellH * 0.62, w * 1.05) : cellH * 0.66;
        return {
          x: c * cellW + (cellW - w) / 2,
          y: r * cellH + (cellH - h) / 2 - (id === "polaroid-pair" ? cellH * 0.04 : 0),
          w,
          h,
          rotation: tilts[i % tilts.length],
          polaroid: id === "polaroid-pair",
          tape: id === "scrapbook",
        };
      }),
    };
  }
  if (id === "diagonal" && n === 2) {
    const W = 2000;
    const H = 1400;
    return {
      id, name, width: W, height: H, background: "#160d1c",
      slots: [
        { x: 0, y: 0, w: W, h: H, rotation: 0, diagonal: "left" },
        { x: 0, y: 0, w: W, h: H, rotation: 0, diagonal: "right" },
      ],
    };
  }
  if (id === "overlap" && n >= 2) {
    const W = 2000;
    const H = 1400;
    const small = { w: 760, h: 560 };
    const extra = Array.from({ length: n - 1 }, (_, i) => ({
      x: W - small.w - 60 - i * 70,
      y: H - small.h - 60 - i * 70,
      w: small.w,
      h: small.h,
      rotation: 2 + i,
      polaroid: true,
    }));
    return { id, name, width: W, height: H, background: "#160d1c", slots: [{ x: 0, y: 0, w: W, h: H, rotation: 0 }, ...extra] };
  }
  // side-by-side (and the fallback for layouts that need two pictures)
  const cols = Math.min(n, 4);
  const rows = Math.ceil(n / cols);
  const slotW = 900;
  const slotH = 1200;
  const W = gap + cols * (slotW + gap);
  const H = gap + rows * (slotH + gap);
  return {
    id: "side-by-side", name: "Side by side", width: W, height: H, background: "#f4ead9",
    slots: Array.from({ length: n }, (_, i) => ({
      x: gap + (i % cols) * (slotW + gap),
      y: gap + Math.floor(i / cols) * (slotH + gap),
      w: slotW,
      h: slotH,
      rotation: 0,
    })),
  };
}

export interface CompositionItem {
  photo: Source | null;
  photoTransform: PhotoTransform;
  recipe: FlowerRecipe | null;
  flower: FlowerPlacement;
  /** Shown on empty slots ("Waiting for Asha's photo"). */
  label?: string;
}

/** Draws a whole multi-photo composition (before the theme is applied). */
export function renderComposition(layoutId: LayoutId, items: CompositionItem[], scale = 1): HTMLCanvasElement {
  const spec = layoutSpec(layoutId, items.length);
  const canvas = makeCanvas(spec.width * scale, spec.height * scale);
  const ctx = context2d(canvas);
  ctx.scale(scale, scale);
  ctx.fillStyle = spec.background;
  ctx.fillRect(0, 0, spec.width, spec.height);

  spec.slots.forEach((slot, index) => {
    const item = items[index];
    if (!item) return;
    ctx.save();
    ctx.translate(slot.x + slot.w / 2, slot.y + slot.h / 2);
    ctx.rotate((slot.rotation * Math.PI) / 180);
    const rect = { x: -slot.w / 2, y: -slot.h / 2, w: slot.w, h: slot.h };
    if (slot.polaroid) {
      const border = slot.w * 0.05;
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 40;
      ctx.shadowOffsetY = 12;
      ctx.fillStyle = "#f7f3ea";
      ctx.fillRect(rect.x - border, rect.y - border, rect.w + border * 2, rect.h + border * 4.2);
      ctx.shadowColor = "transparent";
    }
    if (slot.tape) {
      ctx.shadowColor = "rgba(60,40,20,0.3)";
      ctx.shadowBlur = 24;
      ctx.fillStyle = "#fbf8f1";
      const b = slot.w * 0.025;
      ctx.fillRect(rect.x - b, rect.y - b, rect.w + b * 2, rect.h + b * 2);
      ctx.shadowColor = "transparent";
    }
    if (slot.diagonal) {
      ctx.beginPath();
      if (slot.diagonal === "left") {
        ctx.moveTo(rect.x, rect.y);
        ctx.lineTo(rect.x + rect.w * 0.58, rect.y);
        ctx.lineTo(rect.x + rect.w * 0.42, rect.y + rect.h);
        ctx.lineTo(rect.x, rect.y + rect.h);
      } else {
        ctx.moveTo(rect.x + rect.w * 0.58 + 6, rect.y);
        ctx.lineTo(rect.x + rect.w, rect.y);
        ctx.lineTo(rect.x + rect.w, rect.y + rect.h);
        ctx.lineTo(rect.x + rect.w * 0.42 + 6, rect.y + rect.h);
      }
      ctx.closePath();
      ctx.clip();
    }
    if (item.photo) {
      drawPhotoInRect(ctx, item.photo, item.photoTransform, rect);
    } else {
      ctx.fillStyle = slot.diagonal || layoutId === "overlap" ? "#2a1934" : "#ede2d0";
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      if (item.label && !item.recipe) {
        ctx.fillStyle = "rgba(120, 95, 110, 0.85)";
        ctx.font = `italic 400 ${Math.round(slot.w * 0.045)}px "Fraunces", Georgia, serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(item.label, rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w * 0.85);
      }
    }
    if (item.recipe) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      if (!slot.diagonal) ctx.clip();
      drawFlowerOn(ctx, item.recipe, item.flower, rect);
      ctx.restore();
    }
    if (slot.tape) {
      const tw = slot.w * 0.26;
      const th = slot.w * 0.07;
      ctx.fillStyle = index % 2 ? "rgba(157,179,154,0.78)" : "rgba(231,163,181,0.75)";
      ctx.save();
      ctx.translate(0, rect.y - th * 0.15);
      ctx.rotate(index % 2 ? 0.05 : -0.06);
      ctx.fillRect(-tw / 2, -th / 2, tw, th);
      ctx.restore();
    }
    ctx.restore();
  });
  return canvas;
}

/** Renders a single photo with its flower (Bloom Cam), at full photo resolution or smaller. */
export function renderPhotoWithFlower(
  photo: Source,
  recipe: FlowerRecipe | null,
  placement: FlowerPlacement,
  maxSize = 2400,
): HTMLCanvasElement {
  const { width, height } = sourceSize(photo);
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const canvas = makeCanvas(width * scale, height * scale);
  const ctx = context2d(canvas);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);
  if (recipe) drawFlowerOn(ctx, recipe, placement, { x: 0, y: 0, w: canvas.width, h: canvas.height });
  return canvas;
}
