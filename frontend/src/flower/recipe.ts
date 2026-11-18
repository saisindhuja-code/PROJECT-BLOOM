/**
 * The Bloom flower recipe: everything needed to rebuild a flower exactly.
 * Recipes are plain JSON, saved with designs, journal entries and shared
 * projects, and can be downloaded as a .bloom.json file.
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

export type PetalStyle = "classic" | "rounded" | "tulip" | "daisy" | "lotus" | "heart";

export const PETAL_STYLES: Array<{ id: PetalStyle; name: string; hint: string }> = [
  { id: "classic", name: "Classic", hint: "The original Python Turtle petal curve" },
  { id: "rounded", name: "Peony", hint: "Full, soft, rounded overlapping petals" },
  { id: "tulip", name: "Tulip", hint: "Cupped silhouette opening outward" },
  { id: "daisy", name: "Daisy", hint: "Long slender ray petals" },
  { id: "lotus", name: "Lotus", hint: "Pointed arched botanical petals" },
  { id: "heart", name: "Heart", hint: "Double-lobed heart-tipped petals" },
];

const PETAL_STYLE_IDS: PetalStyle[] = ["classic", "rounded", "tulip", "daisy", "lotus", "heart"];

export interface FlowerRecipe {
  format: "bloom-flower";
  version: 1;
  word: string;
  /** "flower" is the original Bloom flower; the others are word shapes. */
  shape: ShapeId;
  /** Petal curve variant for flower mode (defaults to "classic"). */
  petalStyle?: PetalStyle;
  colors: FlowerColors;
  /** 1 = the original petal size. */
  petalSize: number;
  /** 1 = the original number of petals per ring (4, 5, 7, 9, 12). */
  petalCount: number;
  /** Degrees; 0 = the original upright flower. */
  rotation: number;
  showStem: boolean;
  showLeaves: boolean;
  showHearts: boolean;
  /** The little floating decoration (the original is ♡). */
  decoration: string;
  /** How many times to try placing a decoration (the original tries 12). */
  decorCount: number;
  /** Decides where the floating hearts land. */
  seed: number;
  /** Optional dedication message & signature rendered on the studio plate. */
  message?: string;
  signature?: string;
}

/** The colours of the original Python program. */
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

export const STUDIO_PALETTES: Array<{ id: string; name: string; colors: FlowerColors }> = [
  { id: "original", name: "Original Rose", colors: { ...ORIGINAL_COLORS } },
  {
    id: "midnight",
    name: "Midnight Plum",
    colors: {
      ring1: "#fff2eb",
      ring2: "#f5ccd6",
      ring3: "#e7a3b5",
      ring4: "#c96f8b",
      ring5: "#8d4360",
      green: "#6f9f7b",
      hearts: "#f7c4d1",
      background: "#160d1c",
    },
  },
  {
    id: "sage",
    name: "Sage Botanical",
    colors: {
      ring1: "#faf6ee",
      ring2: "#e8dfc9",
      ring3: "#c5d4bd",
      ring4: "#88a782",
      ring5: "#4e704c",
      green: "#3f6142",
      hearts: "#d8a59b",
      background: "#1a241b",
    },
  },
  {
    id: "golden",
    name: "Golden Hour",
    colors: {
      ring1: "#fff7e0",
      ring2: "#ffe099",
      ring3: "#ffb36b",
      ring4: "#e87846",
      ring5: "#b34436",
      green: "#5b8248",
      hearts: "#ffd180",
      background: "#231214",
    },
  },
  {
    id: "lavender",
    name: "Lavender Mist",
    colors: {
      ring1: "#f9f5ff",
      ring2: "#e1d1ff",
      ring3: "#be9cf7",
      ring4: "#946ae0",
      ring5: "#633da8",
      green: "#5d9986",
      hearts: "#f2b8dc",
      background: "#171128",
    },
  },
  {
    id: "y2k",
    name: "Y2K Chrome",
    colors: {
      ring1: "#ffffff",
      ring2: "#c2ecff",
      ring3: "#82bfff",
      ring4: "#ff5ec4",
      ring5: "#5572e6",
      green: "#45c49e",
      hearts: "#ff99df",
      background: "#0b1429",
    },
  },
];

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
    version: 1,
    word,
    shape: "flower",
    petalStyle: "classic",
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

/** Ready-made decorations; people can also type their own. */
export const DECORATIONS = ["♡", "♥", "★", "☆", "✿", "❀", "✦", "☾", "♪", "∞", "<3", "xoxo"];
export const MAX_DECORATION_LENGTH = 6;

export function cleanWord(raw: string): string {
  return Array.from(raw.replace(/\s+/g, " ").trim())
    .filter((ch) => ch >= " ")
    .slice(0, MAX_WORD_LENGTH)
    .join("");
}

function cleanNoteText(raw: unknown, maxLen: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Turns anything (a saved file, server data, an old version) into a valid
 * recipe. Unknown or broken values fall back to the original design.
 */
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
  const petalStyle = PETAL_STYLE_IDS.includes(data.petalStyle as PetalStyle)
    ? (data.petalStyle as PetalStyle)
    : "classic";
  const message = cleanNoteText(data.message, 80);
  const signature = cleanNoteText(data.signature, 40);

  return {
    format: "bloom-flower",
    version: 1,
    word: word || base.word,
    shape: SHAPE_IDS.includes(data.shape as ShapeId) ? (data.shape as ShapeId) : "flower",
    petalStyle,
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
    ...(message ? { message } : {}),
    ...(signature ? { signature } : {}),
  };
}

export function isOriginalShape(recipe: FlowerRecipe): boolean {
  return (
    recipe.shape === "flower" &&
    (!recipe.petalStyle || recipe.petalStyle === "classic") &&
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
