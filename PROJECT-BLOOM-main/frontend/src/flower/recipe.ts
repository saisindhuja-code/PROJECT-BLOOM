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
