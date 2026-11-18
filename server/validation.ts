/**
 * Shared validation helpers for FlowerRecipe (including Studio 2.0 petalStyle & dedication message)
 * and user/chat/project payloads.
 */
import type { UserRecord } from "./db";

export const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const USERNAME_RE = /^[a-z0-9_.]{3,32}$/;
export const VALID_SHAPES = new Set([
  "flower",
  "heart",
  "heartburst",
  "star",
  "butterfly",
  "infinity",
  "moon",
]);
export const VALID_PETAL_STYLES = new Set([
  "classic",
  "rounded",
  "tulip",
  "daisy",
  "lotus",
  "heart",
]);
export const VALID_LAYOUTS = new Set([
  "side-by-side",
  "stacked",
  "polaroid-pair",
  "scrapbook",
  "diagonal",
  "overlap",
]);
export const VALID_PROJECT_MODES = new Set(["twin", "two", "moment"]);
export const VALID_REACTION_EMOJIS = new Set(["🌸", "♡", "✨", "🌿", "📷", "💫"]);

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function cleanText(raw: unknown, maxLen: number): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

export function validateRecipe(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object") {
    throw new Error("Flower recipe must be an object.");
  }
  const d = input as Record<string, unknown>;
  const word = cleanText(d.word, 24);
  if (!word) {
    throw new Error("The word cannot be empty.");
  }
  const rawColors = (d.colors && typeof d.colors === "object" ? d.colors : {}) as Record<string, unknown>;
  const defaults: Record<string, string> = {
    ring1: "#ffe6f2",
    ring2: "#ffb3d9",
    ring3: "#ff66b2",
    ring4: "#ff1493",
    ring5: "#c71585",
    green: "#2e8b57",
    hearts: "#ff99cc",
    background: "#180018",
  };
  const colors: Record<string, string> = {};
  for (const [k, def] of Object.entries(defaults)) {
    const val = rawColors[k];
    if (val !== undefined) {
      if (typeof val !== "string" || !HEX_COLOR.test(val)) {
        throw new Error("Colours must look like #ff66b2.");
      }
      colors[k] = val.toLowerCase();
    } else {
      colors[k] = def;
    }
  }
  const shape = typeof d.shape === "string" && VALID_SHAPES.has(d.shape) ? d.shape : "flower";
  const petalStyle = typeof d.petalStyle === "string" && VALID_PETAL_STYLES.has(d.petalStyle) ? d.petalStyle : "classic";
  const decoration = cleanText(d.decoration ?? "♡", 6) || "♡";
  const message = cleanText(d.message ?? "", 80);
  const signature = cleanText(d.signature ?? "", 40);

  return {
    format: "bloom-flower",
    version: 1,
    word,
    shape,
    petalStyle,
    colors,
    petalSize: clamp(d.petalSize, 0.6, 1.5, 1),
    petalCount: clamp(d.petalCount, 0.5, 2, 1),
    rotation: clamp(d.rotation, -180, 180, 0),
    showStem: typeof d.showStem === "boolean" ? d.showStem : true,
    showLeaves: typeof d.showLeaves === "boolean" ? d.showLeaves : true,
    showHearts: typeof d.showHearts === "boolean" ? d.showHearts : true,
    decoration,
    decorCount: Math.round(clamp(d.decorCount, 0, 40, 12)),
    seed: Number.isInteger(d.seed) ? (d.seed as number) >>> 0 : 20250101,
    ...(message ? { message } : {}),
    ...(signature ? { signature } : {}),
  };
}

export function userOut(u: UserRecord) {
  return {
    id: u.id,
    bloom_id: u.bloom_id,
    username: u.username,
    display_name: u.display_name,
    bio: u.bio,
    favorite_word: u.favorite_word,
    avatar_recipe: u.avatar_recipe,
    privacy: u.privacy,
    created_at: u.created_at,
  };
}

export function publicUserOut(u: UserRecord, online = false) {
  return {
    bloom_id: u.bloom_id,
    display_name: u.display_name,
    avatar_recipe: u.avatar_recipe,
    online: u.privacy.show_online ? online : false,
  };
}
