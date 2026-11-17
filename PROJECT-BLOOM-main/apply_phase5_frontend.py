"""Phase 5B (Frontend Flower Studio 2.0) implementation script for Bloom 2.0."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent


def write_full(rel: str, content: str) -> None:
    path = ROOT / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content.lstrip("\n"), encoding="utf-8")
    print(f"Wrote   {rel}")


def patch(rel: str, replacements: list[tuple[str, str]]) -> None:
    path = ROOT / rel
    if not path.exists():
        raise FileNotFoundError(f"Missing expected file: {path}")
    text = path.read_text(encoding="utf-8")
    for idx, (old, new) in enumerate(replacements, start=1):
        if new in text:
            print(f"Skipped {rel} (step {idx} already present)")
            continue
        if old not in text:
            raise RuntimeError(f"Could not find target block #{idx} in {rel}")
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")
    print(f"Patched {rel}")


def main() -> None:
    if not (ROOT / "frontend" / "src").is_dir():
        sys.exit("Run apply_phase5_frontend.py directly inside PROJECT-BLOOM-main.")

    # 1. frontend/src/flower/studioThemes.ts (new)
    write_full(
        "frontend/src/flower/studioThemes.ts",
        r'''
/**
 * Studio Themes: Coordinated visual styles for Flower Studio 2.0.
 * Modifies color palette, petal style, arrangement, background and decorations.
 */

import type { FlowerColors } from "./recipe";

export interface StudioThemePreset {
  id: string;
  name: string;
  tagline: string;
  colors: FlowerColors;
  petalStyle: "classic" | "pointed" | "wavy" | "chrysanthemum" | "dahlia";
  arrangement: "rings" | "spiral" | "burst";
  bgStyle: "solid" | "radial" | "studio" | "paper";
  decoration: string;
  decorCount: number;
  swatch: [string, string, string];
}

export const STUDIO_THEMES: StudioThemePreset[] = [
  {
    id: "y2k",
    name: "Y2K",
    tagline: "Bold, punchy neon & digital bloom",
    colors: {
      ring1: "#ffffff",
      ring2: "#9fd0ff",
      ring3: "#ff7cc4",
      ring4: "#ff3ea5",
      ring5: "#2f7bff",
      green: "#3ccf91",
      hearts: "#ff3ea5",
      background: "#14161f",
    },
    petalStyle: "pointed",
    arrangement: "burst",
    bgStyle: "radial",
    decoration: "✦",
    decorCount: 16,
    swatch: ["#ff3ea5", "#2f7bff", "#14161f"],
  },
  {
    id: "vintage",
    name: "Vintage",
    tagline: "Sepia tones, dahlia petals & pressed textures",
    colors: {
      ring1: "#fff8f0",
      ring2: "#e8d3b9",
      ring3: "#c9a37e",
      ring4: "#9c6d48",
      ring5: "#6b4429",
      green: "#6a7356",
      hearts: "#c9a37e",
      background: "#f4ede1",
    },
    petalStyle: "dahlia",
    arrangement: "rings",
    bgStyle: "paper",
    decoration: "❀",
    decorCount: 10,
    swatch: ["#c9a37e", "#6a7356", "#f4ede1"],
  },
  {
    id: "disposable",
    name: "Disposable camera",
    tagline: "High-contrast party flash on dark canvas",
    colors: {
      ring1: "#ffffff",
      ring2: "#ffdf99",
      ring3: "#ff6b4a",
      ring4: "#ff2255",
      ring5: "#880022",
      green: "#2ea868",
      hearts: "#ff4466",
      background: "#0c0a0f",
    },
    petalStyle: "classic",
    arrangement: "rings",
    bgStyle: "studio",
    decoration: "♡",
    decorCount: 14,
    swatch: ["#ff2255", "#ffdf99", "#0c0a0f"],
  },
  {
    id: "dreamy-pastel",
    name: "Dreamy pastel",
    tagline: "Soft lilac, blush waves & golden spiral",
    colors: {
      ring1: "#ffffff",
      ring2: "#fae6f0",
      ring3: "#f0c2dc",
      ring4: "#d9b6e8",
      ring5: "#bca0dc",
      green: "#a0cca8",
      hearts: "#f0c2dc",
      background: "#f8f3fa",
    },
    petalStyle: "wavy",
    arrangement: "spiral",
    bgStyle: "radial",
    decoration: "♡",
    decorCount: 12,
    swatch: ["#f0c2dc", "#bca0dc", "#f8f3fa"],
  },
  {
    id: "midnight",
    name: "Midnight",
    tagline: "Nocturnal plum, slender rays & crescent moons",
    colors: {
      ring1: "#ffe6f2",
      ring2: "#d9b0df",
      ring3: "#af7dc5",
      ring4: "#884ea0",
      ring5: "#5b2c6f",
      green: "#487a5b",
      hearts: "#d9b0df",
      background: "#120817",
    },
    petalStyle: "chrysanthemum",
    arrangement: "rings",
    bgStyle: "studio",
    decoration: "☾",
    decorCount: 12,
    swatch: ["#af7dc5", "#5b2c6f", "#120817"],
  },
  {
    id: "botanical",
    name: "Botanical",
    tagline: "Herbarium greens, classic flora & parchment",
    colors: {
      ring1: "#fffdf5",
      ring2: "#e5eedb",
      ring3: "#b8d5a7",
      ring4: "#7ea368",
      ring5: "#506d40",
      green: "#506d40",
      hearts: "#b8d5a7",
      background: "#f4f1ea",
    },
    petalStyle: "classic",
    arrangement: "spiral",
    bgStyle: "paper",
    decoration: "❀",
    decorCount: 8,
    swatch: ["#7ea368", "#506d40", "#f4f1ea"],
  },
];
''',
    )

    # 2. frontend/src/flower/recipe.ts
    write_full(
        "frontend/src/flower/recipe.ts",
        r'''
/**
 * The Bloom flower recipe: everything needed to rebuild a flower exactly.
 * Fully backward-compatible with version 1 recipes.
 */

export interface FlowerColors {
  ring1: string;
  ring2: string;
  ring3: string;
  ring4: string;
  ring5: string;
  green: string;
  hearts: string;
  background: string;
}

export type { ShapeId } from "./shapes";
import type { ShapeId } from "./shapes";

const SHAPE_IDS: ShapeId[] = ["flower", "heart", "heartburst", "star", "butterfly", "infinity", "moon"];

export type PetalStyle = "classic" | "pointed" | "wavy" | "chrysanthemum" | "dahlia";
export type ArrangementKind = "rings" | "spiral" | "burst";
export type BgStyle = "solid" | "radial" | "studio" | "paper";

export interface FlowerRecipe {
  format: "bloom-flower";
  version: 1 | 2;
  word: string;
  shape: ShapeId;
  colors: FlowerColors;
  petalStyle?: PetalStyle;
  arrangement?: ArrangementKind;
  centerText?: string;
  stemMessage?: string;
  themeId?: string;
  bgStyle?: BgStyle;
  petalSize: number;
  petalCount: number;
  rotation: number;
  showStem: boolean;
  showLeaves: boolean;
  showHearts: boolean;
  decoration: string;
  decorCount: number;
  seed: number;
}

export const ORIGINAL_COLORS: FlowerColors = {
  ring1: "#ffe6f2",
  ring2: "#ffb3d9",
  ring3: "#ff66b2",
  ring4: "#ff1493",
  ring5: "#c71585",
  green: "#2e8b57",
  hearts: "#ff99cc",
  background: "#180018",
};

export const MAX_WORD_LENGTH = 24;

export const LIMITS = {
  petalSize: { min: 0.6, max: 1.5, step: 0.05 },
  petalCount: { min: 0.5, max: 2, step: 0.05 },
  rotation: { min: -180, max: 180, step: 1 },
};

export function newSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export function defaultRecipe(word = "love"): FlowerRecipe {
  return {
    format: "bloom-flower",
    version: 2,
    word,
    shape: "flower",
    petalStyle: "classic",
    arrangement: "rings",
    centerText: "",
    stemMessage: "",
    themeId: "",
    bgStyle: "solid",
    colors: { ...ORIGINAL_COLORS },
    petalSize: 1,
    petalCount: 1,
    rotation: 0,
    showStem: true,
    showLeaves: true,
    showHearts: true,
    decoration: "♡",
    decorCount: 12,
    seed: 20250101,
  };
}

export const DECORATIONS = ["♡", "♥", "★", "☆", "✿", "❀", "✦", "☾", "♪", "∞", "<3", "xoxo"];
export const MAX_DECORATION_LENGTH = 6;

export function cleanWord(raw: string): string {
  return Array.from(raw.replace(/\s+/g, " ").trim())
    .filter((ch) => ch >= " ")
    .slice(0, MAX_WORD_LENGTH)
    .join("");
}

export function cleanShortText(raw: unknown, maxLen = 32): string {
  if (typeof raw !== "string") return "";
  return Array.from(raw.replace(/\s+/g, " ").trim())
    .filter((ch) => ch >= " ")
    .slice(0, maxLen)
    .join("");
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const PETAL_STYLES: PetalStyle[] = ["classic", "pointed", "wavy", "chrysanthemum", "dahlia"];
const ARRANGEMENTS: ArrangementKind[] = ["rings", "spiral", "burst"];
const BG_STYLES: BgStyle[] = ["solid", "radial", "studio", "paper"];

export function normalizeRecipe(input: unknown): FlowerRecipe {
  const base = defaultRecipe();
  if (!input || typeof input !== "object") return base;
  const data = input as Record<string, unknown>;
  const colorsIn = (data.colors && typeof data.colors === "object" ? data.colors : {}) as Record<string, unknown>;
  const colors = { ...base.colors };
  (Object.keys(colors) as Array<keyof FlowerColors>).forEach((key) => {
    const value = colorsIn[key];
    if (typeof value === "string" && HEX.test(value)) colors[key] = value.toLowerCase();
  });
  const word = typeof data.word === "string" ? cleanWord(data.word) : "";

  return {
    format: "bloom-flower",
    version: 2,
    word: word || base.word,
    shape: SHAPE_IDS.includes(data.shape as ShapeId) ? (data.shape as ShapeId) : "flower",
    petalStyle: PETAL_STYLES.includes(data.petalStyle as PetalStyle) ? (data.petalStyle as PetalStyle) : "classic",
    arrangement: ARRANGEMENTS.includes(data.arrangement as ArrangementKind) ? (data.arrangement as ArrangementKind) : "rings",
    centerText: cleanShortText(data.centerText, 32),
    stemMessage: cleanShortText(data.stemMessage, 48),
    themeId: typeof data.themeId === "string" ? data.themeId : "",
    bgStyle: BG_STYLES.includes(data.bgStyle as BgStyle) ? (data.bgStyle as BgStyle) : "solid",
    colors,
    petalSize: clamp(data.petalSize, LIMITS.petalSize.min, LIMITS.petalSize.max, 1),
    petalCount: clamp(data.petalCount, LIMITS.petalCount.min, LIMITS.petalCount.max, 1),
    rotation: clamp(data.rotation, LIMITS.rotation.min, LIMITS.rotation.max, 0),
    showStem: typeof data.showStem === "boolean" ? data.showStem : true,
    showLeaves: typeof data.showLeaves === "boolean" ? data.showLeaves : true,
    showHearts: typeof data.showHearts === "boolean" ? data.showHearts : true,
    decoration:
      typeof data.decoration === "string" && cleanWord(data.decoration)
        ? Array.from(cleanWord(data.decoration)).slice(0, MAX_DECORATION_LENGTH).join("")
        : "♡",
    decorCount: Math.round(clamp(data.decorCount, 0, 40, 12)),
    seed: Number.isInteger(data.seed) ? (data.seed as number) >>> 0 : base.seed,
  };
}

export function isOriginalShape(recipe: FlowerRecipe): boolean {
  return (
    recipe.shape === "flower" &&
    (!recipe.petalStyle || recipe.petalStyle === "classic") &&
    (!recipe.arrangement || recipe.arrangement === "rings") &&
    !recipe.centerText &&
    !recipe.stemMessage &&
    recipe.petalSize === 1 &&
    recipe.petalCount === 1 &&
    recipe.rotation === 0 &&
    recipe.showStem &&
    recipe.showLeaves &&
    recipe.showHearts &&
    recipe.decoration === "♡" &&
    recipe.decorCount === 12
  );
}
''',
    )

    # 3. frontend/src/flower/engine.ts
    write_full(
        "frontend/src/flower/engine.ts",
        r'''
/**
 * Bloom flower engine — faithful port of legacy/bloom_turtle.py extended
 * for Studio 2.0 (petal styles, arrangements, center & stem text inscriptions).
 *
 * When defaults are used (petalStyle="classic", arrangement="rings"),
 * coordinates match the original Python Turtle program exactly.
 */

import type { BgStyle, FlowerRecipe, PetalStyle } from "./recipe";
import { evenlySpaced, shapeRings, type RingShape } from "./shapes";

export const ORIGINAL_WIDTH = 900;
export const ORIGINAL_HEIGHT = 600;

export const PETAL_FONT_PX = 10.7;
export const HEART_FONT_PX = 13.3;
export const CENTER_FONT_PX = 14;
export const STEM_FONT_PX = 9.5;

export const PETAL_FONT_FAMILY = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
export const HEART_FONT_FAMILY = "'Courier New', Courier, monospace";

export interface LinePrimitive {
  kind: "line";
  points: Array<[number, number]>;
  color: string;
  width: number;
}

export interface TextPrimitive {
  kind: "text";
  x: number;
  y: number;
  text: string;
  color: string;
  sizePx: number;
  family: string;
  weight: "bold" | "normal";
}

export type Primitive = LinePrimitive | TextPrimitive;

export interface FlowerDrawing {
  primitives: Primitive[];
  background: string;
  bgStyle: BgStyle;
}

class RecordingTurtle {
  x = 0;
  y = 0;
  heading = 0;
  isDown = false;
  color = "black";
  width = 1;

  private stroke: LinePrimitive | null = null;

  constructor(private readonly out: Primitive[]) {}

  penup(): void {
    this.isDown = false;
    this.stroke = null;
  }

  pendown(): void {
    this.isDown = true;
  }

  setColor(color: string): void {
    if (color !== this.color) this.stroke = null;
    this.color = color;
  }

  pensize(width: number): void {
    if (width !== this.width) this.stroke = null;
    this.width = width;
  }

  setheading(degrees: number): void {
    this.heading = degrees;
  }

  goto(x: number, y: number): void {
    if (this.isDown) {
      if (!this.stroke) {
        this.stroke = {
          kind: "line",
          points: [[this.x, this.y]],
          color: this.color,
          width: this.width,
        };
        this.out.push(this.stroke);
      }
      this.stroke.points.push([x, y]);
    }
    this.x = x;
    this.y = y;
  }

  forward(distance: number): void {
    const rad = (this.heading * Math.PI) / 180;
    this.goto(this.x + distance * Math.cos(rad), this.y + distance * Math.sin(rad));
  }

  left(degrees: number): void {
    this.heading = (this.heading + degrees) % 360;
  }

  circle(radius: number, extent: number): void {
    const frac = Math.abs(extent) / 360;
    const steps = 1 + Math.floor(Math.min(11 + Math.abs(radius) / 6, 59) * frac);
    let w = extent / steps;
    let w2 = 0.5 * w;
    let l = 2 * radius * Math.sin((w2 * Math.PI) / 180);
    if (radius < 0) {
      l = -l;
      w = -w;
      w2 = -w2;
    }
    this.left(w2);
    for (let i = 0; i < steps; i++) {
      this.forward(l);
      this.left(w);
    }
    this.left(-w2);
  }

  write(text: string, sizePx: number, family: string, weight: "bold" | "normal"): void {
    this.out.push({ kind: "text", x: this.x, y: this.y, text, color: this.color, sizePx, family, weight });
  }
}

export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randint(random: () => number, low: number, high: number): number {
  return low + Math.floor(random() * (high - low + 1));
}

export const ORIGINAL_RINGS = [
  { radius: 0, count: 4, length: 40, width: 15, offset: 45 },
  { radius: 10, count: 5, length: 50, width: 25, offset: 0 },
  { radius: 20, count: 7, length: 70, width: 35, offset: 30 },
  { radius: 30, count: 9, length: 90, width: 45, offset: 15 },
  { radius: 40, count: 12, length: 110, width: 55, offset: 0 },
] as const;

export function buildFlower(recipe: FlowerRecipe): FlowerDrawing {
  const primitives: Primitive[] = [];
  const t = new RecordingTurtle(primitives);
  const word = recipe.word;
  const c = recipe.colors;
  const petalScale = recipe.petalSize;
  const style: PetalStyle = recipe.petalStyle || "classic";
  const arrangement = recipe.arrangement || "rings";

  function drawPetal(
    base: [number, number],
    baseAngle: number,
    length: number,
    width: number,
    color: string,
    points = 20,
    petalWord = word,
  ): void {
    t.setColor(color);
    const [bx, by] = base;
    const cosA = Math.cos(baseAngle);
    const sinA = Math.sin(baseAngle);

    for (let i = 0; i <= points; i++) {
      const theta = (i * Math.PI) / points;
      let out = length * Math.sin(theta);
      let side = width * Math.sin(theta) * Math.cos(theta);

      if (style === "pointed") {
        out = length * Math.sin(theta) ** 0.85;
        side = width * Math.sin(theta) * Math.cos(theta) ** 3;
      } else if (style === "wavy") {
        const ripple = 1 + 0.16 * Math.sin(theta * 6);
        out *= ripple;
        side *= ripple;
      } else if (style === "chrysanthemum") {
        out = length * 1.25 * Math.sin(theta);
        side = width * 0.42 * Math.sin(theta) * Math.cos(theta);
      } else if (style === "dahlia") {
        side = width * (Math.sin(theta) ** 1.3) * Math.sign(Math.cos(theta)) * (Math.abs(Math.cos(theta)) ** 0.6);
      }

      const rx = out * cosA - side * sinA;
      const ry = out * sinA + side * cosA;
      t.goto(bx + rx, by + ry);
      t.write(petalWord, PETAL_FONT_PX, PETAL_FONT_FAMILY, "bold");
    }
  }

  function drawLeaf(base: [number, number], angleDeg: number, length: number, width: number): void {
    drawPetal(base, (angleDeg * Math.PI) / 180, length, width, c.green, 22, word);
  }

  const isFlower = !recipe.shape || recipe.shape === "flower";

  if (recipe.shape === "heartburst") {
    const rays = Math.max(24, Math.round(120 * recipe.petalCount));
    const k = 15 * petalScale * 0.92;
    const pick = seededRandom(recipe.seed ^ 0x5bd1e995);
    const tones = [c.ring3, c.ring4, c.ring5];
    t.pensize(1);
    for (let i = 0; i < rays; i++) {
      t.penup();
      t.goto(0, 40 * petalScale - 20);
      const angle = (i * Math.PI * 2) / rays;
      const x = 16 * Math.sin(angle) ** 3 * k;
      const y = (13 * Math.cos(angle) - 5 * Math.cos(2 * angle) - 2 * Math.cos(3 * angle) - Math.cos(4 * angle)) * k - 20;
      t.setColor(tones[Math.floor(pick() * tones.length)]);
      t.pendown();
      t.goto(x, y);
      t.setheading(0);
      for (let s = 0; s < 8; s++) {
        t.forward(8);
        t.forward(-8);
        t.left(-45);
      }
    }
    t.penup();
    const small: Array<[number, number]> = [];
    for (let i = 0; i < 360; i++) {
      const a = (i / 360) * Math.PI * 2;
      small.push([16 * Math.sin(a) ** 3 * 5.6 * petalScale, (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) * 5.6 * petalScale + 14]);
    }
    t.setColor(c.ring1);
    for (const [x, y] of evenlySpaced(small, Math.max(6, 14 / recipe.petalCount))) {
      t.goto(x, y);
      t.write(word, PETAL_FONT_PX, PETAL_FONT_FAMILY, "bold");
    }
  }

  if (!isFlower && recipe.shape !== "heartburst") {
    const colorsByRing = [c.ring1, c.ring2, c.ring3, c.ring4, c.ring5];
    t.penup();
    shapeRings(recipe.shape as RingShape, petalScale, recipe.petalCount).forEach((ring, index) => {
      t.setColor(colorsByRing[index]);
      for (const [x, y] of ring) {
        t.goto(x, y);
        t.write(word, PETAL_FONT_PX, PETAL_FONT_FAMILY, "bold");
      }
    });
  }

  // Stem & leaves (exact Turtle order)
  const stemPoints: Array<[number, number]> = [];
  if (isFlower && recipe.showStem) {
    t.penup();
    t.goto(0, -30);
    t.setheading(260);
    t.pendown();

    t.setColor(c.green);
    t.pensize(4);
    t.circle(250, 25);
    stemPoints.push([t.x, t.y]);

    const pos1: [number, number] = [t.x, t.y];
    const head1 = t.heading;
    t.pensize(1);
    if (recipe.showLeaves) drawLeaf(pos1, 160, 50, 25);
    t.penup();
    t.goto(pos1[0], pos1[1]);
    t.setheading(head1);
    t.pendown();

    t.setColor(c.green);
    t.pensize(4);
    t.circle(250, 30);
    stemPoints.push([t.x, t.y]);
    t.penup();
    t.pensize(1);

    const pos2: [number, number] = [t.x, t.y];
    const head2 = t.heading;
    if (recipe.showLeaves) drawLeaf(pos2, 20, 55, 28);
    t.penup();
    t.goto(pos2[0], pos2[1]);
    t.setheading(head2);
    t.pendown();

    t.setColor(c.green);
    t.pensize(4);
    t.circle(250, 30);
    stemPoints.push([t.x, t.y]);
    t.penup();
    t.pensize(1);

    // Stamped stem dedication message
    if (recipe.stemMessage && recipe.stemMessage.trim()) {
      t.setColor(c.green);
      const msg = recipe.stemMessage.trim();
      const p1 = stemPoints[0] || [0, -80];
      const p2 = stemPoints[stemPoints.length - 1] || [0, -180];
      const mx = (p1[0] + p2[0]) / 2 + 14;
      const my = (p1[1] + p2[1]) / 2;
      t.goto(mx, my);
      t.write(msg, STEM_FONT_PX, PETAL_FONT_FAMILY, "normal");
    }
  }

  // Petal generation: rings (default Turtle), spiral, or burst
  const ringColors = [c.ring1, c.ring2, c.ring3, c.ring4, c.ring5];
  if (isFlower) {
    if (arrangement === "spiral") {
      // Fibonacci phyllotaxis (Golden angle ~137.507764°)
      const totalPetals = Math.round(36 * recipe.petalCount);
      const goldenAngle = 137.507764 * (Math.PI / 180);
      for (let n = 0; n < totalPetals; n++) {
        const radius = Math.sqrt(n) * 8.5 * petalScale;
        const angle = n * goldenAngle;
        const bx = radius * Math.cos(angle);
        const by = radius * Math.sin(angle);
        const colorIdx = Math.min(4, Math.floor((n / totalPetals) * 5));
        const len = (40 + (n / totalPetals) * 70) * petalScale;
        const wid = (16 + (n / totalPetals) * 38) * petalScale;
        drawPetal([bx, by], angle, len, wid, ringColors[colorIdx]);
      }
    } else if (arrangement === "burst") {
      // Starburst outward rays
      const rays = Math.round(28 * recipe.petalCount);
      for (let i = 0; i < rays; i++) {
        const rad = ((i * 360) / rays) * (Math.PI / 180);
        const isLong = i % 2 === 0;
        const len = (isLong ? 115 : 75) * petalScale;
        const wid = (isLong ? 40 : 25) * petalScale;
        const color = isLong ? c.ring5 : c.ring3;
        drawPetal([0, 0], rad, len, wid, color);
      }
    } else {
      // Default: Original 5 concentric rings
      ORIGINAL_RINGS.forEach((ring, index) => {
        const count = Math.max(3, Math.round(ring.count * recipe.petalCount));
        for (let i = 0; i < count; i++) {
          const angle = (360 / count) * i + ring.offset;
          const rad = (angle * Math.PI) / 180;
          const baseX = ring.radius * petalScale * Math.cos(rad);
          const baseY = ring.radius * petalScale * Math.sin(rad);
          drawPetal([baseX, baseY], rad, ring.length * petalScale, ring.width * petalScale, ringColors[index]);
        }
      });
    }

    // Center custom name/inscription
    if (recipe.centerText && recipe.centerText.trim()) {
      t.penup();
      t.setColor(c.ring1);
      t.goto(0, -5);
      t.write(recipe.centerText.trim(), CENTER_FONT_PX, PETAL_FONT_FAMILY, "bold");
    }
  }

  // Floating hearts / decorations
  if (recipe.showHearts) {
    t.penup();
    t.setColor(c.hearts);
    const random = seededRandom(recipe.seed);
    const decoration = recipe.decoration || "♡";
    const tries = recipe.decorCount ?? 12;
    for (let n = 0; n < tries; n++) {
      const x = randint(random, -250, 250);
      const y = randint(random, -250, 250);
      if (Math.hypot(x, y) > 130) {
        t.goto(x, y);
        t.write(decoration, HEART_FONT_PX, HEART_FONT_FAMILY, "bold");
      }
    }
  }

  // Global rotation
  if (recipe.rotation) {
    const rad = (recipe.rotation * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rotate = (x: number, y: number): [number, number] => [x * cos - y * sin, x * sin + y * cos];
    for (const p of primitives) {
      if (p.kind === "line") p.points = p.points.map(([x, y]) => rotate(x, y));
      else if (p.sizePx !== HEART_FONT_PX) [p.x, p.y] = rotate(p.x, p.y);
    }
  }

  return { primitives, background: c.background, bgStyle: recipe.bgStyle || "solid" };
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type MeasureText = (text: string, sizePx: number, family: string, weight: string) => number;

export const approximateMeasure: MeasureText = (text, sizePx) => text.length * sizePx * 0.62;

export function boundingBox(primitives: Primitive[], measure: MeasureText = approximateMeasure): Box {
  const box: Box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const add = (x: number, y: number) => {
    box.minX = Math.min(box.minX, x);
    box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y);
    box.maxY = Math.max(box.maxY, y);
  };
  for (const p of primitives) {
    if (p.kind === "line") {
      const half = p.width / 2;
      for (const [x, y] of p.points) {
        add(x - half, y - half);
        add(x + half, y + half);
      }
    } else {
      const half = measure(p.text, p.sizePx, p.family, p.weight) / 2;
      add(p.x - half, p.y);
      add(p.x + half, p.y + p.sizePx * 1.15);
    }
  }
  if (!Number.isFinite(box.minX)) return { minX: -1, minY: -1, maxX: 1, maxY: 1 };
  return box;
}
''',
    )

    # 4. frontend/src/flower/render.ts
    write_full(
        "frontend/src/flower/render.ts",
        r'''
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
''',
    )

    # 5. frontend/src/components/FlowerControls.tsx
    write_full(
        "frontend/src/components/FlowerControls.tsx",
        r'''
/** Flower customization controls for Studio 2.0. */
import { useState } from "react";
import {
  DECORATIONS,
  LIMITS,
  MAX_DECORATION_LENGTH,
  MAX_WORD_LENGTH,
  ORIGINAL_COLORS,
  cleanWord,
  isOriginalShape,
  newSeed,
  type ArrangementKind,
  type BgStyle,
  type FlowerColors,
  type FlowerRecipe,
  type PetalStyle,
} from "../flower/recipe";
import { SHAPES, type ShapeId } from "../flower/shapes";
import { STUDIO_THEMES, type StudioThemePreset } from "../flower/studioThemes";
import { FlowerPreview } from "./FlowerPreview";
import { IconReset, IconShuffle } from "./Icons";
import { Slider, Toggle } from "./ui";

const PAINTS: Array<{ key: keyof FlowerColors; name: string }> = [
  { key: "ring1", name: "Centre" },
  { key: "ring2", name: "Ring 2" },
  { key: "ring3", name: "Ring 3" },
  { key: "ring4", name: "Ring 4" },
  { key: "ring5", name: "Outer" },
  { key: "green", name: "Stem & leaves" },
  { key: "hearts", name: "Decorations" },
  { key: "background", name: "Canvas" },
];

const PETAL_STYLES: Array<{ id: PetalStyle; name: string; hint: string }> = [
  { id: "classic", name: "Classic", hint: "Original parametric curve" },
  { id: "pointed", name: "Pointed", hint: "Sharpened apex (lotus / lily)" },
  { id: "wavy", name: "Wavy", hint: "Ruffled petal edge (carnation)" },
  { id: "chrysanthemum", name: "Chrysanthemum", hint: "Slender, tapered rays" },
  { id: "dahlia", name: "Dahlia", hint: "Cupped layered curve" },
];

const ARRANGEMENTS: Array<{ id: ArrangementKind; name: string; hint: string }> = [
  { id: "rings", name: "Concentric rings", hint: "Five balanced rings" },
  { id: "spiral", name: "Fibonacci spiral", hint: "Golden angle phyllotaxis" },
  { id: "burst", name: "Starburst", hint: "Alternating radial rays" },
];

const BG_STYLES: Array<{ id: BgStyle; name: string }> = [
  { id: "solid", name: "Solid colour" },
  { id: "radial", name: "Radial glow" },
  { id: "studio", name: "Studio dark" },
  { id: "paper", name: "Botanical paper" },
];

export function WordField({
  recipe,
  onChange,
  autoFocus,
}: {
  recipe: FlowerRecipe;
  onChange: (r: FlowerRecipe) => void;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState(recipe.word);
  const [lastWord, setLastWord] = useState(recipe.word);
  if (recipe.word !== lastWord) {
    setLastWord(recipe.word);
    setDraft(recipe.word);
  }
  return (
    <label className="field">
      <span>A word to grow</span>
      <input
        className="word-input"
        type="text"
        value={draft}
        maxLength={MAX_WORD_LENGTH}
        autoFocus={autoFocus}
        placeholder="love, home, you…"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
          const word = cleanWord(e.target.value);
          if (word) {
            setLastWord(word);
            onChange({ ...recipe, word });
          }
        }}
        onBlur={() => setDraft(recipe.word)}
      />
    </label>
  );
}

export function StudioThemePicker({
  recipe,
  onApply,
}: {
  recipe: FlowerRecipe;
  onApply: (theme: StudioThemePreset) => void;
}) {
  return (
    <div className="studio-theme-grid" role="radiogroup" aria-label="Studio Themes">
      {STUDIO_THEMES.map((th) => {
        const active = recipe.themeId === th.id;
        return (
          <button
            key={th.id}
            type="button"
            className="theme-card studio-theme-card"
            role="radio"
            aria-checked={active}
            aria-pressed={active}
            title={th.tagline}
            onClick={() => onApply(th)}
          >
            <div className="studio-theme-swatch">
              <span style={{ background: th.swatch[0] }} />
              <span style={{ background: th.swatch[1] }} />
              <span style={{ background: th.swatch[2] }} />
            </div>
            <strong>{th.name}</strong>
          </button>
        );
      })}
    </div>
  );
}

export function PetalStylePicker({
  recipe,
  onChange,
}: {
  recipe: FlowerRecipe;
  onChange: (r: FlowerRecipe) => void;
}) {
  const current = recipe.petalStyle || "classic";
  return (
    <div className="chips" role="radiogroup" aria-label="Petal style">
      {PETAL_STYLES.map((ps) => (
        <button
          key={ps.id}
          type="button"
          className="chip"
          role="radio"
          aria-checked={current === ps.id}
          aria-pressed={current === ps.id}
          title={ps.hint}
          onClick={() => onChange({ ...recipe, petalStyle: ps.id })}
        >
          {ps.name}
        </button>
      ))}
    </div>
  );
}

export function ArrangementPicker({
  recipe,
  onChange,
}: {
  recipe: FlowerRecipe;
  onChange: (r: FlowerRecipe) => void;
}) {
  const current = recipe.arrangement || "rings";
  return (
    <div className="chips" role="radiogroup" aria-label="Arrangement">
      {ARRANGEMENTS.map((arr) => (
        <button
          key={arr.id}
          type="button"
          className="chip"
          role="radio"
          aria-checked={current === arr.id}
          aria-pressed={current === arr.id}
          title={arr.hint}
          onClick={() => onChange({ ...recipe, arrangement: arr.id })}
        >
          {arr.name}
        </button>
      ))}
    </div>
  );
}

export function BackgroundStylePicker({
  recipe,
  onChange,
}: {
  recipe: FlowerRecipe;
  onChange: (r: FlowerRecipe) => void;
}) {
  const current = recipe.bgStyle || "solid";
  return (
    <div className="chips" role="radiogroup" aria-label="Canvas background style">
      {BG_STYLES.map((bg) => (
        <button
          key={bg.id}
          type="button"
          className="chip"
          role="radio"
          aria-checked={current === bg.id}
          aria-pressed={current === bg.id}
          onClick={() => onChange({ ...recipe, bgStyle: bg.id })}
        >
          {bg.name}
        </button>
      ))}
    </div>
  );
}

export function Paints({
  recipe,
  onChange,
}: {
  recipe: FlowerRecipe;
  onChange: (r: FlowerRecipe) => void;
}) {
  return (
    <div className="paints">
      {PAINTS.map(({ key, name }) => (
        <label key={key} className="dab" style={{ ["--paint" as string]: recipe.colors[key] }}>
          <input
            type="color"
            value={recipe.colors[key]}
            aria-label={`${name} colour`}
            onChange={(e) => onChange({ ...recipe, colors: { ...recipe.colors, [key]: e.target.value } })}
          />
          <span className="paint" />
          <span className="name">{name}</span>
        </label>
      ))}
    </div>
  );
}

export function ShapePicker({
  recipe,
  onPick,
}: {
  recipe: FlowerRecipe;
  onPick: (shape: ShapeId) => void;
}) {
  return (
    <div className="shape-picker" role="radiogroup" aria-label="Shape">
      {SHAPES.map((shape) => (
        <button
          key={shape.id}
          type="button"
          role="radio"
          aria-checked={recipe.shape === shape.id}
          className="shape-card"
          title={shape.hint}
          onClick={() => onPick(shape.id)}
        >
          <span className="thumb">
            <FlowerPreview
              recipe={{ ...recipe, shape: shape.id, showHearts: false, showStem: false, rotation: 0, petalSize: 1, petalCount: 1 }}
              framing="tight"
              label={shape.name}
            />
          </span>
          <span className="name">{shape.name}</span>
        </button>
      ))}
    </div>
  );
}

export function DecorationControls({
  recipe,
  onChange,
}: {
  recipe: FlowerRecipe;
  onChange: (r: FlowerRecipe) => void;
}) {
  const [custom, setCustom] = useState(DECORATIONS.includes(recipe.decoration) ? "" : recipe.decoration);
  return (
    <div className="stack">
      <Toggle label="Floating decorations" checked={recipe.showHearts} onChange={(showHearts) => onChange({ ...recipe, showHearts })} />
      {recipe.showHearts && (
        <>
          <div className="chips decor-chips" role="radiogroup" aria-label="Decoration">
            {DECORATIONS.map((d) => (
              <button
                key={d}
                type="button"
                className="chip"
                role="radio"
                aria-checked={recipe.decoration === d}
                aria-pressed={recipe.decoration === d}
                onClick={() => onChange({ ...recipe, decoration: d })}
              >
                {d}
              </button>
            ))}
          </div>
          <div className="decor-more">
            <label className="field">
              <span>Your own (up to {MAX_DECORATION_LENGTH})</span>
              <input
                type="text"
                value={custom}
                maxLength={MAX_DECORATION_LENGTH * 2}
                placeholder=":) · xo · s+b"
                onChange={(e) => {
                  const value = Array.from(cleanWord(e.target.value)).slice(0, MAX_DECORATION_LENGTH).join("");
                  setCustom(value);
                  if (value) onChange({ ...recipe, decoration: value });
                }}
              />
            </label>
            <Slider
              label="How many"
              value={recipe.decorCount}
              min={0}
              max={40}
              step={1}
              format={(v) => String(v)}
              onChange={(decorCount) => onChange({ ...recipe, decorCount })}
            />
          </div>
          <button type="button" className="btn small" style={{ justifySelf: "start" }} onClick={() => onChange({ ...recipe, seed: newSeed() })}>
            <IconShuffle /> Scatter again
          </button>
        </>
      )}
    </div>
  );
}

export function ShapeControls({
  recipe,
  onChange,
}: {
  recipe: FlowerRecipe;
  onChange: (r: FlowerRecipe) => void;
}) {
  const original = isOriginalShape(recipe);
  const isFlower = recipe.shape === "flower";
  return (
    <div className="stack">
      {isFlower && (
        <>
          <div className="stack tight">
            <span className="label">Petal Shape</span>
            <PetalStylePicker recipe={recipe} onChange={onChange} />
          </div>
          <div className="stack tight">
            <span className="label">Arrangement</span>
            <ArrangementPicker recipe={recipe} onChange={onChange} />
          </div>
        </>
      )}
      <Slider
        label={isFlower ? "Petal size" : "Size"}
        value={recipe.petalSize}
        {...LIMITS.petalSize}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(petalSize) => onChange({ ...recipe, petalSize })}
      />
      <Slider
        label={isFlower ? "Petal density" : recipe.shape === "heartburst" ? "Rays" : "Word density"}
        value={recipe.petalCount}
        {...LIMITS.petalCount}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(petalCount) => onChange({ ...recipe, petalCount })}
      />
      <Slider
        label="Rotation"
        value={recipe.rotation}
        {...LIMITS.rotation}
        format={(v) => `${Math.round(v)}°`}
        onChange={(rotation) => onChange({ ...recipe, rotation })}
      />
      {isFlower && (
        <>
          <Toggle label="Stem" checked={recipe.showStem} onChange={(showStem) => onChange({ ...recipe, showStem })} />
          <Toggle label="Leaves" checked={recipe.showLeaves} disabled={!recipe.showStem} onChange={(showLeaves) => onChange({ ...recipe, showLeaves })} />
        </>
      )}
      <button
        type="button"
        className="btn small quiet"
        style={{ justifySelf: "start" }}
        disabled={original}
        onClick={() =>
          onChange({
            ...recipe,
            shape: "flower",
            petalStyle: "classic",
            arrangement: "rings",
            centerText: "",
            stemMessage: "",
            petalSize: 1,
            petalCount: 1,
            rotation: 0,
            showStem: true,
            showLeaves: true,
            showHearts: true,
            decoration: "♡",
            decorCount: 12,
          })
        }
      >
        <IconReset /> Back to original flower
      </button>
    </div>
  );
}

export function resetPaints(recipe: FlowerRecipe): FlowerRecipe {
  return { ...recipe, colors: { ...ORIGINAL_COLORS } };
}
''',
    )

    # 6. frontend/src/pages/Studio.tsx
    write_full(
        "frontend/src/pages/Studio.tsx",
        r'''
/** Bloom Flower Studio 2.0: grow a flower from a word, styles, themes, inscriptions. */
import { useEffect, useMemo, useRef, useState } from "react";
import { FlowerPreview } from "../components/FlowerPreview";
import {
  BackgroundStylePicker,
  DecorationControls,
  Paints,
  ShapeControls,
  ShapePicker,
  StudioThemePicker,
  resetPaints,
} from "../components/FlowerControls";
import { IconCamera, IconDownload, IconJournal, IconReset, IconTrash, IconUpload } from "../components/Icons";
import { Toggle } from "../components/ui";
import { buildFlower, ORIGINAL_RINGS } from "../flower/engine";
import { cleanWord, isOriginalShape, normalizeRecipe, type FlowerRecipe } from "../flower/recipe";
import { canvasToBlob, downloadBlob, drawingToCanvas, drawingToSvg, safeFileName } from "../flower/render";
import { SHAPES } from "../flower/shapes";
import type { StudioThemePreset } from "../flower/studioThemes";
import { errorMessage } from "../lib/api";
import { useRouter } from "../lib/router";
import { useSession } from "../lib/session";
import type { SavedDesign, Visibility } from "../lib/store";
import { ThemeDots } from "../theme/ThemeMenu";
import { useTheme } from "../theme/ThemeProvider";

export function StudioPage() {
  const { recipe, setRecipe, store, toast, hasFlower, growFlower, growCount } = useSession();
  const [draftWord, setDraftWord] = useState(hasFlower ? recipe.word : "");
  const { navigate, query } = useRouter();
  const [designs, setDesigns] = useState<SavedDesign[]>([]);
  const [designId, setDesignId] = useState<string | undefined>(query.get("design") ?? undefined);
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [transparent, setTransparent] = useState(true);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = () =>
    store
      .listDesigns()
      .then(setDesigns)
      .catch((error) => toast(errorMessage(error), "error"));

  useEffect(() => {
    void refresh();
  }, [store]);

  // Reopen from design or journal entry
  const wantedDesign = query.get("design");
  const wantedEntry = query.get("entry");

  useEffect(() => {
    if (wantedDesign) {
      const match = designs.find((d) => d.id === wantedDesign);
      if (match) {
        growFlower(match.recipe);
        setDraftWord(match.recipe.word);
        setDesignId(match.id);
        setTitle(match.title);
        setVisibility(match.visibility ?? "private");
      }
    } else if (wantedEntry) {
      store.getEntry(wantedEntry).then((entry) => {
        if (entry.recipe) {
          growFlower(entry.recipe);
          setDraftWord(entry.recipe.word);
          setTitle(entry.title || entry.recipe.word);
        }
      }).catch(() => undefined);
    }
  }, [designs, wantedDesign, wantedEntry]);

  const stats = useMemo(() => {
    const drawing = buildFlower(recipe);
    const words = drawing.primitives.filter((p) => p.kind === "text" && p.text === recipe.word).length;
    const petals = ORIGINAL_RINGS.reduce((n, ring) => n + Math.max(3, Math.round(ring.count * recipe.petalCount)), 0);
    return { words, petals };
  }, [recipe]);

  const update = (next: FlowerRecipe) => setRecipe(next);
  const { theme: siteTheme } = useTheme();
  const themeColours = siteTheme.flowerColors;
  const usingThemeColours = (Object.keys(themeColours) as Array<keyof typeof themeColours>).every(
    (k) => recipe.colors[k] === themeColours[k],
  );

  const grow = () => {
    const word = cleanWord(draftWord);
    if (!word) {
      toast("Type a word first.", "error");
      return;
    }
    setDraftWord(word);
    growFlower({ ...recipe, word });
  };
  const wordChanged = hasFlower && cleanWord(draftWord) !== recipe.word && cleanWord(draftWord) !== "";

  const applyStudioTheme = (th: StudioThemePreset) => {
    const next: FlowerRecipe = {
      ...recipe,
      colors: { ...th.colors },
      petalStyle: th.petalStyle,
      arrangement: th.arrangement,
      bgStyle: th.bgStyle,
      decoration: th.decoration,
      decorCount: th.decorCount,
      themeId: th.id,
    };
    if (hasFlower) growFlower(next);
    else setRecipe(next);
    toast(`Applied ${th.name} theme.`);
  };

  const saveDesign = async (asNew: boolean) => {
    setBusy(true);
    try {
      const saved = await store.saveDesign(recipe, title || recipe.word, asNew ? undefined : designId, visibility);
      setDesignId(saved.id);
      setTitle(saved.title);
      toast(store.kind === "server" ? "Design saved to your account." : "Design saved on this device.");
      await refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const addToJournal = async () => {
    setBusy(true);
    try {
      const entry = await store.createEntry({ entry_type: "flower", title: title || recipe.word, recipe, visibility });
      toast("Pressed into your journal.");
      navigate(`/journal/${entry.id}`);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const exportPng = async () => {
    const drawing = buildFlower(recipe);
    const canvas = drawingToCanvas(drawing, { framing: transparent ? "tight" : "window", background: !transparent, scale: 4 });
    downloadBlob(await canvasToBlob(canvas), `bloom-${safeFileName(recipe.word)}.png`);
  };

  const exportSvg = () => {
    const svg = drawingToSvg(buildFlower(recipe), { framing: transparent ? "tight" : "window", background: !transparent, title: recipe.word });
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `bloom-${safeFileName(recipe.word)}.svg`);
  };

  const downloadRecipe = () => {
    downloadBlob(new Blob([JSON.stringify(recipe, null, 2)], { type: "application/json" }), `${safeFileName(recipe.word)}.bloom.json`);
  };

  const openRecipe = async (file: File | undefined) => {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data?.format !== "bloom-flower") throw new Error("That file is not a Bloom flower recipe.");
      const opened = normalizeRecipe(data);
      growFlower(opened);
      setDraftWord(opened.word);
      setDesignId(undefined);
      toast("Recipe opened.");
    } catch (error) {
      toast(error instanceof SyntaxError ? "That file is not a Bloom flower recipe." : errorMessage(error), "error");
    }
  };

  const removeDesign = async (design: SavedDesign) => {
    if (!window.confirm(`Delete the design “${design.title}”? Journal entries made from it stay.`)) return;
    try {
      await store.deleteDesign(design.id);
      if (designId === design.id) setDesignId(undefined);
      await refresh();
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <p className="eyebrow">01 · Flower studio 2.0</p>
          <h1>
            Grow a flower from <span className="flourish">a word</span>
          </h1>
        </div>
      </div>

      <div className="studio">
        <section className="sheet" aria-label="Flower settings">
          <div className="sheet-section">
            <form
              className="stack tight"
              onSubmit={(e) => {
                e.preventDefault();
                grow();
              }}
            >
              <label className="field">
                <span>A word to grow</span>
                <input
                  className="word-input"
                  type="text"
                  value={draftWord}
                  maxLength={MAX_WORD_LENGTH}
                  autoFocus
                  placeholder="love, home, you…"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setDraftWord(e.target.value)}
                />
              </label>
              <button type="submit" className="btn primary" style={{ justifySelf: "start" }} disabled={!cleanWord(draftWord)}>
                {hasFlower ? (wordChanged ? "Grow this word" : "Grow again") : "Grow my flower"}
              </button>
            </form>
          </div>

          <div className="sheet-section">
            <header>
              <h3>Studio Themes</h3>
              <span className="eyebrow">coordinated styles</span>
            </header>
            <StudioThemePicker recipe={recipe} onApply={applyStudioTheme} />
          </div>

          <div className="sheet-section">
            <header>
              <h3>Shape</h3>
              <span className="eyebrow">your word, drawn as…</span>
            </header>
            <ShapePicker
              recipe={recipe}
              onPick={(shape) => {
                const next = { ...recipe, shape, word: cleanWord(draftWord) || recipe.word };
                if (hasFlower) growFlower(next);
                else setRecipe(next);
              }}
            />
          </div>

          <details className="sheet-section" open={Boolean(recipe.centerText || recipe.stemMessage)}>
            <summary style={{ cursor: "pointer", listStyle: "none" }}>
              <header>
                <h3>Inscriptions &amp; dedications</h3>
                <span className="eyebrow">text integration</span>
              </header>
            </summary>
            <div className="stack" style={{ marginTop: 14 }}>
              <label className="field">
                <span>Center name or word</span>
                <input
                  type="text"
                  maxLength={32}
                  placeholder="e.g. for mom, forever"
                  value={recipe.centerText ?? ""}
                  onChange={(e) => update({ ...recipe, centerText: e.target.value })}
                />
              </label>
              {recipe.shape === "flower" && recipe.showStem && (
                <label className="field">
                  <span>Stem dedication note</span>
                  <input
                    type="text"
                    maxLength={48}
                    placeholder="e.g. forever in bloom"
                    value={recipe.stemMessage ?? ""}
                    onChange={(e) => update({ ...recipe, stemMessage: e.target.value })}
                  />
                </label>
              )}
            </div>
          </details>

          <div className="sheet-section">
            <header>
              <h3>Paints</h3>
              <button type="button" className="btn small quiet" onClick={() => update(resetPaints(recipe))}>
                <IconReset /> Original
              </button>
            </header>
            <Paints recipe={recipe} onChange={update} />
            <div className="stack tight" style={{ marginTop: 8 }}>
              <span className="label">Canvas background</span>
              <BackgroundStylePicker recipe={recipe} onChange={update} />
            </div>
            {!usingThemeColours && (
              <div className="suggested-colours" style={{ marginTop: 10 }}>
                <ThemeDots colors={[themeColours.ring1, themeColours.ring3, themeColours.ring5, themeColours.background]} />
                <span style={{ flex: 1 }}>{siteTheme.name} colours</span>
                <button type="button" className="btn small" onClick={() => update({ ...recipe, colors: { ...themeColours } })}>
                  Use them
                </button>
              </div>
            )}
          </div>

          <details className="sheet-section" open={!isOriginalShape(recipe)}>
            <summary style={{ cursor: "pointer", listStyle: "none" }}>
              <header>
                <h3>Petal styles &amp; arrangement</h3>
                <span className="eyebrow">{isOriginalShape(recipe) ? "original" : "custom"} · optional</span>
              </header>
            </summary>
            <div style={{ marginTop: 14 }}>
              <ShapeControls recipe={recipe} onChange={update} />
            </div>
          </details>

          <div className="sheet-section">
            <header>
              <h3>Decorations</h3>
              <span className="eyebrow">floating doodles</span>
            </header>
            <DecorationControls recipe={recipe} onChange={update} />
          </div>

          <div className="sheet-section">
            <header>
              <h3>Saved designs</h3>
              <span className="eyebrow">{store.kind === "server" ? "your account" : "this device"}</span>
            </header>
            <label className="field">
              <span>Design name</span>
              <input type="text" value={title} maxLength={80} placeholder={recipe.word} onChange={(e) => setTitle(e.target.value)} />
            </label>
            {store.kind === "server" && (
              <label className="field">
                <span>Who can see this</span>
                <select value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
                  <option value="private">Private (only me)</option>
                  <option value="friends">Friends</option>
                  <option value="public">Public profile</option>
                </select>
              </label>
            )}
            <div className="btn-row">
              <button type="submit" className="btn small primary" disabled={busy || !hasFlower} onClick={() => void saveDesign(false)}>
                {designId ? "Save changes" : "Save design"}
              </button>
              {designId && (
                <button type="button" className="btn small" disabled={busy} onClick={() => void saveDesign(true)}>
                  Save as new
                </button>
              )}
            </div>
            {designs.length > 0 && (
              <div className="design-list">
                {designs.map((design) => (
                  <div
                    key={design.id}
                    className="design-row"
                    role="button"
                    tabIndex={0}
                    aria-pressed={design.id === designId}
                    style={design.id === designId ? { borderColor: "var(--rose)" } : undefined}
                    onClick={() => {
                      growFlower(design.recipe);
                      setDraftWord(design.recipe.word);
                      setDesignId(design.id);
                      setTitle(design.title);
                      setVisibility(design.visibility ?? "private");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        growFlower(design.recipe);
                        setDraftWord(design.recipe.word);
                        setDesignId(design.id);
                        setTitle(design.title);
                        setVisibility(design.visibility ?? "private");
                      }
                    }}
                  >
                    <span className="thumb">
                      <FlowerPreview recipe={design.recipe} label={design.title} />
                    </span>
                    <span>
                      <strong>{design.title}</strong>
                      <span className="muted small">“{design.recipe.word}”</span>
                    </span>
                    <button
                      type="button"
                      className="btn icon small quiet"
                      aria-label={`Delete ${design.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeDesign(design);
                      }}
                    >
                      <IconTrash />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="sheet-section">
            <header>
              <h3>Recipe file</h3>
            </header>
            <p className="muted small">A .bloom.json recipe file containing all settings to grow this exact flower anywhere.</p>
            <div className="btn-row">
              <button type="button" className="btn small" onClick={downloadRecipe} disabled={!hasFlower}>
                <IconDownload /> Download recipe
              </button>
              <button type="button" className="btn small quiet" onClick={() => fileInput.current?.click()}>
                <IconUpload /> Open recipe
              </button>
              <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; void openRecipe(file); }} />
            </div>
          </div>
        </section>

        <section className="studio-preview" aria-label="Preview">
          {hasFlower ? (
            <>
              <div className="plate">
                <FlowerPreview recipe={recipe} growKey={growCount} />
                <div className="plate-caption">
                  <span>“{recipe.word}”</span>
                  <span className="lcd">
                    {recipe.shape === "flower"
                      ? `${stats.petals} petals · ${recipe.petalStyle || "classic"}`
                      : SHAPES.find((sh) => sh.id === recipe.shape)?.name}
                    {" · "}
                    {stats.words} words
                  </span>
                </div>
              </div>
              <div className="row between">
                <div className="btn-row">
                  <button type="button" className="btn primary" onClick={() => navigate("/cam")}>
                    <IconCamera /> Photograph it
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void addToJournal()}>
                    <IconJournal /> Add to journal
                  </button>
                </div>
                <div className="btn-row">
                  <button type="button" className="btn small" onClick={() => void exportPng()}>
                    <IconDownload /> PNG
                  </button>
                  <button type="button" className="btn small" onClick={exportSvg}>
                    <IconDownload /> SVG
                  </button>
                </div>
              </div>
              <div style={{ maxWidth: 320, marginLeft: "auto" }}>
                <Toggle label="Export flower only, transparent" checked={transparent} onChange={setTransparent} />
              </div>
            </>
          ) : (
            <div className="plate">
              <div className="empty-plate" style={{ background: recipe.colors.background }}>
                <p>
                  Type a word and press <strong>Grow my flower</strong>.
                  <br />
                  Your flower grows here, petal by petal.
                </p>
              </div>
              <div className="plate-caption">
                <span>Nothing grown yet</span>
                <span className="lcd">waiting for a word</span>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
''',
    )

    # 7. frontend/src/styles/app.css
    app_css = ROOT / "frontend" / "src" / "styles" / "app.css"
    css_text = app_css.read_text(encoding="utf-8")
    extra_studio_css = r'''
/* ---------------------------------------------------------------------
   Flower Studio 2.0 Additions
   --------------------------------------------------------------------- */

.studio-theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.studio-theme-card {
  display: grid;
  gap: 6px;
  padding: 8px;
  border-radius: var(--radius);
  border: 1px solid var(--line);
  background: var(--field);
  cursor: pointer;
  text-align: center;
}

.studio-theme-card:hover {
  border-color: var(--line-strong);
}

.studio-theme-card[aria-checked="true"] {
  border-color: var(--rose);
  background: rgba(231, 163, 181, 0.08);
}

.studio-theme-swatch {
  display: flex;
  height: 20px;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid var(--line);
}

.studio-theme-swatch span {
  flex: 1;
}

.studio-theme-card strong {
  font-size: 11.5px;
  color: var(--cream);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
'''
    if ".studio-theme-grid {" not in css_text:
        css_text += "\n" + extra_studio_css.lstrip("\n")
        app_css.write_text(css_text, encoding="utf-8")
        print("Patched frontend/src/styles/app.css")
    else:
        print("Skipped frontend/src/styles/app.css (already present)")

    print("\nPhase 5B (Frontend Flower Studio 2.0) applied successfully.")


if __name__ == "__main__":
    main()